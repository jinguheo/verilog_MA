# Sample Test 4 — Phase 3~6 구현 계획 (개략)

작성 2026-08-09. Phase 1-2는 완료·검증됨(`RESULTS.md` 참고). 이 문서는 phase
3-6을 어떻게 구현할지에 대한 **설계 방향**이고, 각 phase 착수 시점에 세부
설계는 바뀔 수 있습니다. "이렇게 하겠다"는 확정이 아니라 "지금 시점의 계획"
입니다.

## Phase 3 — 스트림 경로

**모듈**: `pkt_align.sv`, `pkt_check.sv`, `chan_ctrl.sv`, `chan_top.sv`

**데이터 흐름**:
```
src_clk 도메인                          axi_clk 도메인
8비트 바이트 스트림                     
(src_valid/ready/data/sop/eop,          
 Sample Test 3 daq_if 컨벤션 재사용)     
        |                               
        v                               
   pkt_align.sv                          prim_fifo_async         pkt_check.sv
   (AxiDw beat로 패킹,      ------>      (재사용, CDC)   ----->   (CRC-32 검증,
    byte strobe, partial                                          length 체크)
    last beat 처리)                                                    |
                                                                        v
                                                                  chan_ctrl.sv
                                                                  (5-state FSM:
                                                                   idle/armed/
                                                                   running/
                                                                   draining/error)

  chan_top.sv = 위 넷을 하나의 채널 블록으로 묶음
```

**핵심 결정 (이미 `daq_pkg.sv`에 반영, `pkt_align.sv` 초안 있음 — 미검증)**:
- **CRC-32는 스트림에 안 섞고 sideband로 전달**(`src_crc_i[31:0]`, eop 사이클에
  유효). CRC-8(1바이트, Sample Test 3)과 달리 CRC-32(4바이트)는 패킹된
  멀티바이트 beat 경계에 걸치면 pkt_check가 lookahead 없이는 payload/trailer를
  구분 못 함. Sample Test 3 RTL 가이드의 "expected CRC를 data와 함께 실어
  보내라"는 원칙을 4바이트 케이스로 확장 적용.
- **패킹된 beat 레이아웃**(`daq_pkg::PktBeat*` 상수)을 pkt_align 출력·CDC
  FIFO·pkt_check 입력이 공유 — 필드 순서를 세 곳이 각자 정의하다 어긋나는 걸
  방지.
- **backpressure는 바이트 누적과 분리**: pkt_align은 완성된 beat만
  skid_buffer(phase 1 재사용)로 내보내고, 누적 자체는 downstream이 막혀도
  진행. beat를 완성시키는 바이트 하나만 skid 여유를 보고 accept 결정.
- **FIFO overflow 탐지는 phase 3에서 만들지 않음** — backpressure 설계상
  구조적으로 도달 불가능한 상태라, 억지로 탐지 로직을 넣으면 아무것도
  체크하지 않는 코드가 됨. 필요해지면 Sample Test 3처럼 "소스가 ready 무시"
  스트레스 테스트를 별도 설계.
- **length 체크**: 패킷 바이트 수가 0이거나 `MaxPacketBytes`(1 MiB, `DescMaxLength`와
  개념적으로 분리된 별도 상수) 초과 시 에러. descriptor 기반 length 대조는
  phase 4 이후(desc_fetch가 생긴 뒤) 가능.

**검증 게이트**: 모듈별 block TB(byte-enable/partial-beat 커버리지), `chan_top`
통합 TB, mutation 4~6종 예상.

## Phase 4 — DMA 엔진 (가장 큰 phase로 예상)

**모듈**: `desc_fetch.sv`, `axi_rd_master.sv`, `axi_wr_master.sv`, `wr_track.sv`,
`dma_sched.sv`

- `dma_sched`: `prim_arbiter_tree`(재사용) 기반 채널 간 round-robin.
- `desc_fetch`: descriptor ring 순회, `daq_pkg::desc_check()`(phase 1에 이미
  있음) 재사용.
- `axi_rd_master`/`axi_wr_master`: AR/R, AW/W/B, outstanding 관리, 4KB 버스트
  경계 분할(`axi_pkg::bytes_to_boundary()`, phase 1에 이미 정의), `MaxBurst`
  초과 시 분할.
- `wr_track`: outstanding 응답 추적, 에러 집계.
- **open question**: AXI read master가 descriptor fetch 이외에 필요한지는
  `desc_fetch.sv`를 실제로 짜면서 결정.

**검증 게이트**: AXI 프로토콜 체크, 4KB 분할 테스트, arbiter fairness. 간단한
AXI 메모리 모델(latency, SLVERR/DECERR)을 block TB 수준에서 먼저 쓰고, phase
6에서 정식 UVM 메모리 슬레이브로 승격.

## Phase 5 — top 통합

**모듈**: `irq_ctrl.sv`, `perf_cnt.sv`, `daq_subsystem.sv`

- `irq_ctrl`: 채널별/전역 인터럽트 집계 — daq_csr에 이미 있는 요약 로직과
  역할이 안 겹치게 재검토 필요.
- `perf_cnt`: byte/pkt/err/stall 카운터 — 지금 daq_csr의 `ch_byte_cnt_i` 등은
  block TB가 직접 구동 중인데, 여기서 실제 소스가 생김.
- `daq_subsystem.sv`: top-level 배선, **모든 CDC를 명시적으로 인스턴스화**
  (plan의 "No ad-hoc crossings" 원칙).

**검증 게이트**: full elaboration + **CDC audit**(이 phase의 실질적 게이트) —
axil_slave/daq_csr(ctrl_clk 근처)와 각 chan_top(각자 다른 src_clk) 사이
크로싱이 전부 prim CDC 프리미티브를 통과하는지 리뷰.

## Phase 6 — 통합 UVM + formal + regression

- 통합 UVM: AXI4-Lite agent + 8개 source agent + AXI4 slave 메모리 모델
  (latency, SLVERR/DECERR) + reference model + scoreboard.
- block별 formal: phase 1-5에서 만든 각 블록에 SymbiYosys 하네스.
- parameter sweep regression: `NUM_CH`/`AXI_DW` 여러 값 전체 재실행.
- mutation: 전체 스택에 결함 주입, 이번 세션 패턴 유지.

## 진행 속도에 대해

Phase 1+2가 이번 세션의 대부분을 차지했고(특히 phase 2는 AXI 타이밍 버그
디버깅에 시간이 많이 들었음), phase 4가 지금까지 중 가장 크고, phase 6도
시간이 많이 걸릴 가능성이 높습니다. 정확한 세션 수는 약속드리기 어렵습니다.

## 현재 상태 (2026-08-26)

**Phase 3 완료 및 검증됨** — `pkt_align.sv`, `pkt_check.sv`, `chan_ctrl.sv`,
`chan_top.sv` 전부 lint clean(6 configuration 스윕), block TB PASS, mutation
9/9 killed. 상세 근거는 [RESULTS.md](RESULTS.md)의 "Phase 3" 절 참고.

- `chan_top.sv`(유일하게 클럭을 넘는 모듈)의 block TB에서 phase 4(랜덤 멀티
  패킷) 구간이 한동안 실패했음 — 원인은 RTL이 아니라 TB 스코어보드였음:
  phase 2의 CRC 오류 패킷이 `track=1'b0`로 보내져 `exp_*` 카운터에 반영이
  안 됐는데, `pkt_check`/`chan_ctrl`은 설계상 CRC 결과를 알기 전에 eop
  beat까지 그대로 forward하기 때문에 `got_*` 카운터는 실제로 그 패킷을
  세고 있었음 — 두 카운터가 영구적으로 어긋나면서 이후 `while (got_pkt_count
  < exp_pkt_count)` 대기들이 조기 종료되는 연쇄 오류. phase 2도 추적하도록
  고쳐서 해결. 디버그 트레이싱 코드는 수정 후 전부 제거함.
- `chan_ctrl.sv`의 mutant 3종은 이번 세션 실버그 수정 3건(모두 `ChIdle`
  drain-and-discard 로직) 이후의 최신 RTL 기준으로 재검증해서 3/3 killed
  확인.
- phase 1-3 전체 block TB regression 재실행, 전부 PASS.

**Phase 4 착수, `dma_sched.sv` 완료 및 검증됨** — 채널 간 packet-granularity
round-robin arbiter(`prim_arbiter_tree` 재사용, 이 프로젝트에서 첫 사용).
lint clean(6 configuration), block TB PASS(6 phase + seed 5회 추가 검증),
mutation 3/3 killed. 상세 근거는 RESULTS.md의 "Phase 4" 절 참고.

- `chan_ctrl.sv`의 mutant 파일이 이번 세션 idle-drain 기능 추가 이전 버전
  으로 stale했던 것을 뒤늦게 발견 — "3/3 killed"였지만 전부 무관한
  `phase8` 실패에 편승한 결과였음. 최신 golden RTL 기준으로 mutant 파일을
  재생성해서 각자 자기 결함에 해당하는 체크에서만 실패하는 것 확인 후 재검증.
- `dma_sched.sv`는 NumCh=1에서 `prim_arbiter_tree`의 `idx_o`가
  `[$clog2(1)-1:0]` = 0폭이 되는 경우를 lint 스윕이 즉시 잡아냄 —
  `generate if (NumCh > 1)`로 단일 채널 케이스를 아예 우회해서 해결.

다음: phase 4 나머지 (`desc_fetch.sv`, `axi_rd_master.sv`,
`axi_wr_master.sv`, `wr_track.sv`).
