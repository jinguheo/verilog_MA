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

## 현재 상태 (2026-08-09)

Phase 3 착수만 시작한 상태입니다:
- `daq_pkg.sv`에 `PktBeat*` 레이아웃 상수, `MaxPacketBytes` 추가됨.
- `rtl/stream/pkt_align.sv` 초안 작성됨.
- **둘 다 lint도, block TB도 아직 안 돌렸습니다** — phase 1-2처럼 "설계→lint→
  block TB→mutation" 사이클을 완료하기 전까지는 검증된 것으로 취급하지 마세요.
