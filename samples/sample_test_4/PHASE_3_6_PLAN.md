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

**`desc_fetch.sv` 완료 및 검증됨** — 전 채널 공유 descriptor ring walker
(PLAN.md 아키텍처: `dma_sched -> desc_fetch -> axi_rd_master -> AXI4`, AXI를
직접 만지지 않고 axi_rd_master에 작은 request/response 프로토콜만 요청).
`prim_arbiter_tree`를 이번 모듈에서 두 번째로 재사용 (한 번에 채널 하나씩만
fetch). lint clean(6 configuration, NumCh=1은 dma_sched와 동일한 우회 재사용
+ `daq_pkg.sv`와 이름 충돌한 `BeatCntW`를 `DescBeatCntW`로 리네임), block TB
PASS(6 phase: 단일 descriptor / linear ring walk / link jump / 5가지 에러
경로 / abort 후 clean restart / 2채널 경합), mutation 3/3 killed
(`MUT_DESC_NOLINK`, `MUT_DESC_NOHALT`, `MUT_DESC_NOCHECK`). 상세 근거는
RESULTS.md의 "desc_fetch.sv" 절 참고.

- RTL 실버그 1건: `ch_desc_go_i`가 pulse되는 그 사이클에는 `cur_ptr_q`가
  아직 새 base로 로드되기 전(레지스터 업데이트는 그 edge에 커밋)인데,
  `need_fetch`가 `ch_enable_i`만 보고 계산되어 있어서 매 go마다 주소 0으로
  fetch가 나가버림. `need_fetch`에 `~ch_desc_go_i` 게이팅 추가해서 해결 —
  `tb_desc_fetch.sv`가 즉시 잡아냄.
- TB 버그 1건 (axi_rd_master 대역 memory 모델 stub): 응답 beat의
  valid를 세운 뒤 negedge 하나 대기하고 `ready`의 **레벨**을 확인하는
  방식으로 짰는데, fetch의 마지막 beat가 accept되는 바로 그 edge에
  `rd_resp_ready_o`가 떨어지는 걸 못 보고 `while(!ready)`에 갇힘 — 나중에
  무관한 다른 fetch가 ready를 다시 세워줄 때까지 우연히 안 풀림 (그 사이
  valid/데이터를 계속 잘못 세워놓고 있었음). tb_chan_top.sv의
  `offer_taken`과 동일한 posedge-monitor acceptance 패턴(`resp_taken =
  valid & ready`, DUT가 실제로 accept를 결정하는 그 posedge에 latch)으로
  고침.

**`axi_rd_master.sv` 완료 및 검증됨** — 실제 AXI4 AR/R 마스터. desc_fetch가
유일한 소비자이고 항상 fetch 하나만 outstanding이라는 게 확정됐으므로
(PLAN.md의 미정 사항이었음), single-outstanding·고정 ARID=0으로 스코프를
좁힘. 항상 full-bus-width burst만 사용(narrow transfer 없음) — 이 결정
때문에 `daq_pkg::DescAlignBytes`를 고정 4에서 `AxiDw/8`로 변경(AxiDw=64
기본값에서만 실제로 영향, tb_desc_fetch.sv의 length-overflow 테스트 케이스
하나만 정렬 유지하도록 수정 필요했음). 4KB 경계를 넘는 fetch는
`axi_pkg::bytes_to_boundary()`로 2-burst 분할. lint clean(6 configuration),
block TB PASS(5 phase: 비분할 fetch / 경계 분할 fetch / RRESP 에러 /
분할 fetch 중 양방향 backpressure / 연속 fetch, + ARSIZE/ARBURST/ARID/
ARCACHE/ARPROT 검증 + seed 5회 추가), mutation 3/3 killed
(`MUT_RDM_NOSPLIT`, `MUT_RDM_LASTWRONG`, `MUT_RDM_ERRDROP`). 상세 근거는
RESULTS.md의 "axi_rd_master.sv" 절 참고.

- TB 레이스 버그 2건, 전부 desc_fetch 게이트에서 이미 겪은 것과 같은
  종류(`ready`/`valid`를 negedge에서 라이브로 읽어서 다른 negedge 프로세스와
  경쟁): (1) AXI 메모리 stub의 R-beat 드라이버가 `rready` 레벨 체크 —
  posedge-latch된 `r_taken`으로 수정. (2) phase 4의 backpressure 루프가
  `rd_resp_valid`를 직접 읽음 — 이미 올바른 `collect_resp`(latched
  `resp_taken` 사용)를 재사용하도록 재작성.

**`axi_wr_master.sv`/`wr_track.sv` 완료 및 검증됨 — phase 4 전체 완료.**
`axi_wr_master.sv`는 dma_sched의 병합된 beat 스트림과 desc_fetch의 채널별
목적지 addr/length를 받아 AXI4 AW/W/B를 issue한다. axi_rd_master와 마찬가지로
전체 설계에서 single-outstanding(같은 시점에 write burst가 둘 이상 진행되지
않음)이지만, axi_rd_master와 달리 `daq_pkg::MaxBurst`(16 beat) 캡이 추가로
필요하다 — descriptor 기반 payload write는 최대 1 MiB까지 갈 수 있어서, 4KB
경계 체크만으로는 burst 하나가 비현실적으로 커짐. burst 크기 결정(descriptor
length 기반)과 "전체 transfer 완료" 판단(실제 스트림의 `wr_eop_i` 기반)을
의도적으로 분리 — 서로 다른 신호에서 각자 답을 구해서, 만약 descriptor
length와 실제 패킷 길이가 어긋나도 잘못된 완료 신호로 이어지지 않도록 함.
lint clean(6 configuration), block TB PASS(6 phase + race 수정 후 seed 10회
추가 검증), mutation 3/3 killed(`MUT_WRM_NOSPLIT`, `MUT_WRM_LASTWRONG`,
`MUT_WRM_ERRDROP`). `wr_track.sv`는 axi_wr_master의 burst 단위 완료 이벤트를
채널 단위 의미(desc_fetch에 보낼 xfer_done, sticky 채널 에러 상태)로
변환하는 얇은 모듈 — desc_fetch/axi_rd_master가 이미 쓴 프로토콜/의미 분리
패턴을 반복. write 에러가 아직 채널의 ring walk를 멈추지 않는 것은 의도적
미해결 사항으로 문서화(phase 5에서 재검토). lint clean(6 configuration),
block TB PASS(5 phase), mutation 3/3 killed(`MUT_TRACK_NOERR`,
`MUT_TRACK_NOCLEAR`, `MUT_TRACK_WRONGCH`). 상세 근거는 RESULTS.md 참고.

- **RTL 실버그 1건**: `awlen_o`가 accept 시점에만 갱신되는 레지스터
  `burst_beats_q`에서 읽혔는데, `WrAw` 상태에서 `awready_i` 백프레셔가 걸리는
  동안은 그 값이 이전 burst 것으로 stale함. 라이브 조합 신호
  `burst_beats_c`로 바꿔서 해결.
- **테스트벤치 레이스 1건, 이번 세션 중 가장 시간이 걸린 디버깅**: `bd_taken`
  캡처를 하는 always 블록과 그걸 큐에 push하는 별도의 always 블록이 둘 다
  같은 posedge에 걸려 있어서, 두 블록의 상대적 실행 순서가 시뮬레이터
  스케줄러에 달려 있었음 — 실제로 phase 1의 4-beat 단일 burst에서
  `last=0`으로 잘못 push되어 `wait_transfer_done()`이 영원히 멈추는 증상으로
  나타났고, seed에 따라 재현 여부가 달라짐(데이터 버그가 아니라 스케줄링
  레이스라는 증거). 캡처와 그 같은-edge 소비자를 하나의 always 블록으로
  합쳐서 해결 — 상세 근거는 RESULTS.md 참고.

**Phase 5 완료.** `irq_ctrl.sv`/`perf_cnt.sv` 완료 및 검증됨,
`daq_subsystem.sv`(top-level 배선)도 lint clean + smoke-level 통합 테스트
PASS. `irq_ctrl.sv`는 chan_top(stream)/desc_fetch(fetch
error)/wr_track(write error+완료)의 서로 다른 상태를 daq_csr가 이미 기대하는
채널별 busy/err/cause 형태로 합침 — daq_csr 자신의 IRQ_STATE 요약 로직과는
겹치지 않게 그 한 단계 앞에서 멈춤. `ch_cause_o[IrqCauseDone]`은
chan_ctrl의 패킷 단위 Done이 아니라 wr_track의 `xfer_done_i`(실제 descriptor
완료)로 구동 — daq_pkg.sv 주석이 말하는 "descriptor completed"를 처음으로
실제로 만족시키는 신호. desc_fetch/wr_track의 sticky 에러 레벨은 rising-edge
검출로 one-shot pulse로 변환 후 daq_csr의 W1C에 넣음(안 그러면 소프트웨어
클리어가 sticky 소스를 절대 이길 수 없음). lint clean(6 configuration),
block TB PASS(5 phase), mutation 3/3 killed. `perf_cnt.sv`는 `cnt_sat`(phase
1) 재사용, dma_sched 중재 이전(각 채널 자신의 chan_top 출력) 지점에서 측정 —
다른 채널이 공유 write 경로를 쓰고 있다고 이 채널이 stall인 건 아니므로.
CH_ECC_STATUS는 ECC 하드웨어가 아직 없어서 상수 0. lint clean, block TB
PASS(6 phase), mutation 3/3 killed.

`daq_subsystem.sv`는 phase 1-5 전체를 배선하는 top — **PLAN.md 원안에서 실제
벗어난 부분을 확정**: 원안은 reg_clk(axil_slave/daq_csr)를 axi_clk과 별도의
세 번째 클럭으로 두고 그 사이에 CDC를 넣는 설계였지만, 실제로 만들어진
daq_csr.sv(phase 2, 이미 검증·커밋됨)는 단일 clk_i만 받고 자기 인터페이스
안에 CDC 인식이 전혀 없음 — 지금 와서 진짜 CDC 경계를 넣으려면 이미 검증된
모듈을 다시 열어야 함. 그래서 daq_subsystem.sv는 reg_clk과 axi_clk을 하나의
clk_i로 묶었고, 이 설계의 진짜 비동기 경계는 각 채널 자신의 src_clk[c] 하나뿐
(chan_top.sv가 이미 prim_fifo_async/prim_rst_sync로 건너고 있음) — 이게 이번
phase 5의 CDC audit 핵심 결론. GLOBAL_CTRL.global_enable은 각 채널
CH_CTRL.enable과 AND, soft_rst_pulse는 axil_slave/daq_csr를 제외한 DMA 쪽
전체에 한 사이클짜리 추가 리셋(ctrl_rst_n)을 만듦(소프트웨어가 자기 설정을
잃지 않도록). err_inject_o/axi_max_burst_o/axi_outstanding_o는 대응하는
하드웨어가 phase 1-4 어디에도 없어서 그대로 미연결(기존부터 있던 gap, 이번에
생긴 게 아님). **6 configuration 전체(NumCh 1/2/8 × AxiDw 32/64) lint
clean** — 전체 설계가 하나로 elaborate됨.

**`tb_daq_subsystem.sv` 빌드 및 PASS 확인됨.** NumCh=1, 채널 1개·descriptor
1개·패킷 1개, 실제 AXI4-Lite(설정)와 채널 자신의 src_clk 스트림(clk_i와 다른
주기, non-integer ratio로 실제 CDC 경로를 실사용)으로 구동, descriptor fetch
읽기와 payload 쓰기를 하나의 공유 AXI4 메모리 모델이 응답. 첫 실행부터 기능
버그 없이 PASS, seed 8회 추가 검증. `scripts/run_block_tb.ps1`의 기본 `$tbs`
목록에도 추가함. 전체 lint sweep(102 configuration) + 전체 block TB
regression(16개) 모두 clean/PASS.

**CDC audit 완료**: `rtl/*.sv` 전체에서 `clk_i`(모듈 자신의 범용 클럭
포트명)와 `src_clk_i[c]` 외의 클럭 신호가 있는지 grep으로 확인 — chan_top.sv/
daq_subsystem.sv를 제외한 모든 모듈이 단일 `clk_i`만 가짐. 이 설계 전체에서
진짜 비동기 클럭 경계는 chan_top.sv의 prim_fifo_async/prim_rst_sync 하나뿐
(phase 3에서 이미 검증 완료)이라는 결론 — RESULTS.md phase 5 절에 상세 기록.

다음: phase 6(통합 UVM, 블록별 formal, 회귀 스크립트) 착수.
