import { useState, type ReactNode } from 'react'
import Layout3DStack from './Layout3DStack'

type Tab = 'overview' | 'architecture' | 'verification' | 'synthesis' | 'layout' | 'documents'
const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' }, { id: 'architecture', label: 'Architecture' },
  { id: 'verification', label: 'Verification' }, { id: 'synthesis', label: 'Synthesis' },
  { id: 'layout', label: 'Layout' }, { id: 'documents', label: 'Documents' },
]

// Rendered from the finished GDS with KLayout (tools/wsl/63_render_all.sh),
// using the sky130A layer properties so layers carry their real colours.
// Images live in my_dashboard/public/layout/ and are served by Vite directly.
type LayoutDesign = {
  id: string; title: string; die: string; cells: string; note: string
}
const layoutDesigns: LayoutDesign[] = [
  { id: 'chan_ctrl', title: 'chan_ctrl', die: '300 × 300 µm', cells: '1,360 instances · 2,630 µm²',
    note: '5-state FSM. Die was oversized to fit 165 IO pins, so utilisation is only 3.3% — the fill cells you see covering the die are the consequence, not the design.' },
  { id: 'cnt_sat', title: 'cnt_sat', die: '86.2 × 96.9 µm', cells: '47 cells in GDS hierarchy',
    note: 'Saturating counter — one of the two genuinely new common blocks (the other nine are reused OpenTitan prim modules).' },
  { id: 'skid_buffer', title: 'skid_buffer', die: '101.5 × 112.2 µm', cells: '27 cells in GDS hierarchy',
    note: 'valid/ready pipeline stage. Smallest of the three and the first block taken through the flow.' },
]

const layoutZooms = [
  { key: 'full', label: '전체 다이', hint: '칩 전체. 배치된 표준셀보다 fill cell이 훨씬 많아 빽빽하게 보입니다.' },
  { key: 'mid', label: '60 µm 창', hint: '표준셀 행과 배선 구조가 보이는 배율.' },
  { key: 'detail', label: '20 µm 창', hint: '개별 셀, 비아, 금속 트랙까지 구분됩니다.' },
]

// prim reuse mapping — the load-bearing decision of phase 1. Proven by
// tb/prim_reuse_smoke.sv, not just written here.
const primReuse = [
  ['async_fifo.sv', 'prim_fifo_async', '채널 스트림 CDC FIFO — chan_top.sv에서 실제 사용'],
  ['sync_fifo.sv', 'prim_fifo_sync', '같은-클럭 FIFO (Sample Test 2와 동일 모듈)'],
  ['arb_rr.sv', 'prim_arbiter_tree', '채널 간 round-robin 중재 — dma_sched.sv에서 실제 사용'],
  ['crc32.sv', 'prim_crc32', '스트림 CRC-32 — 실제로는 폐기, 아래 참고'],
  ['cdc_pulse.sv', 'prim_pulse_sync', '이벤트 펄스 CDC'],
  ['cdc_data_handshake.sv', 'prim_sync_reqack_data', '다중 비트 데이터 CDC 핸드셰이크'],
  ['ecc_secded.sv', 'prim_secded_39_32_{enc,dec}', '채널 FIFO payload ECC'],
  ['reset_sync.sv', 'prim_rst_sync', '도메인별 리셋 동기화 — chan_top.sv에서 실제 사용'],
  ['sync_2ff.sv', 'prim_flop_2sync', '단일 비트 2-flop 동기화'],
] as const
const notReused = [
  ['skid_buffer.sv', 'AXI 타이밍용 valid/ready 파이프라인 스테이지 — OpenTitan은 TileLink 기반이라 대응 모듈이 없음'],
  ['cnt_sat.sv', '통계용 saturating 카운터 — prim_count는 hardened dual-counter라 여기 필요 없는 tamper 감지 비용을 지불함'],
  ['pkt_check.sv의 CRC 코어', 'phase 3에서 밝혀짐: prim_crc32는 파셜 마지막 beat에 항상 풀 워드 패딩을 먹여 CRC를 틀리게 계산 — byte-enable 인식 bit-serial 코어를 새로 작성'],
] as const

const regMap = [
  ['0x000', 'ID', 'RO', '상수 "DAQ4"'],
  ['0x004', 'VERSION', 'RO', 'major/minor · NumCh · AxiDw readback'],
  ['0x008', 'GLOBAL_CTRL', 'RW', '[0] global_enable · [1] soft_rst (pulse, 항상 0으로 읽힘)'],
  ['0x00C', 'GLOBAL_STATUS', 'RO', '[7:0] 채널별 busy bitmap · [8] dma_busy'],
  ['0x010', 'IRQ_STATE', 'RO', '채널별 live summary — CH_IRQ_STATE&CH_IRQ_ENABLE의 OR (수정됨, 원안은 W1C)'],
  ['0x014', 'IRQ_ENABLE', 'RW', '[NumCh-1:0] 채널 summary 마스크'],
  ['0x018', 'ERR_INJECT', 'RW', 'fault-injection hook, 순수 passthrough'],
  ['0x01C', 'AXI_CFG', 'RW', '[7:0] max_burst · [15:8] outstanding, 상위 비트 readback 시 0'],
  ['0x100+ch·0x40', 'CH_CTRL', 'RW', '[0] enable · [1] abort'],
  ['…', 'CH_STATUS', 'RO', '[0] busy · [1] err'],
  ['…', 'CH_DESC_BASE', 'RW', '32-bit descriptor ring 시작 주소'],
  ['…', 'CH_DESC_CTRL', 'RW', '[0] go (pulse, 항상 0으로 읽힘)'],
  ['…', 'CH_IRQ_STATE', 'W1C', '[3:0] done/err/crc/fifo_ovf — HW set이 동시 SW clear를 이김'],
  ['…', 'CH_IRQ_ENABLE', 'RW', '[3:0] 원인별 마스크'],
  ['…', 'CH_BYTE_CNT / PKT_CNT / ERR_CNT / STALL_CNT / CRC_STATUS / ECC_STATUS', 'RO', '전부 순수 passthrough — 아직 이 값을 채워줄 블록이 없음'],
] as const

const mutantsP12 = [
  ['MUT_SKID_READY', 'skid_buffer', 'ready_o가 skid 레지스터를 무시 → 데이터 유실', 'killed'],
  ['MUT_SKID_BYPASS', 'skid_buffer', 'skid drain이 저장된 값 대신 현재 입력을 내보냄 → 재정렬', 'killed'],
  ['MUT_SKID_DRAIN', 'skid_buffer', 'skid이 소비되지 않고도 클리어됨 → beat 유실', 'killed'],
  ['MUT_CNT_WRAP', 'cnt_sat', 'carry 폐기 → clamp 대신 wrap', 'killed'],
  ['MUT_CNT_CLEAR_LOSE', 'cnt_sat', '같은 사이클 increment가 clear를 이김', 'killed'],
  ['MUT_AXIL_WPRIO', 'axil_slave', '동시 경합 시 read가 write보다 우선', 'killed'],
  ['MUT_AXIL_NODECERR', 'axil_slave', 'reg_error_i를 write에서 무시 (DECERR 없음)', 'killed'],
  ['MUT_CSR_IRQNOHW', 'daq_csr', '같은 사이클 SW clear가 HW set을 이김', 'killed'],
  ['MUT_CSR_NODECERR', 'daq_csr', 'reg_error_o가 항상 0', 'killed'],
  ['MUT_CSR_GOALL', 'daq_csr', 'DESC_CTRL go pulse가 모든 채널에서 발생', 'killed'],
] as const

const mutantsP3 = [
  ['MUT_ALIGN_NOEOP', 'pkt_align', '마지막 beat의 eop 마킹 누락', 'killed'],
  ['MUT_ALIGN_SOPFROZEN', 'pkt_align', 'sop이 첫 beat 이후에도 계속 세팅됨', 'killed'],
  ['MUT_ALIGN_NOCRC', 'pkt_align', 'src_crc_i가 out-of-band로 전달되지 않음', 'killed'],
  ['MUT_CHECK_WRONGIDX', 'pkt_check', 'CRC 코어가 항상 AxiBw로 인덱싱 (파셜 beat 무시)', 'killed'],
  ['MUT_CHECK_NOSOPRESET', 'pkt_check', 'sop에서 CRC 누산기가 리셋되지 않음', 'killed'],
  ['MUT_CHECK_NOLENERR', 'pkt_check', '길이 오류가 항상 미검출', 'killed'],
  ['MUT_CTRL_NODRAIN', 'chan_ctrl', 'ChDraining이 disable 후 패킷을 끝까지 안 내보냄', 'killed'],
  ['MUT_CTRL_NOABORT', 'chan_ctrl', 'ch_abort_i가 ChError에서 무시됨', 'killed'],
  ['MUT_CTRL_BUSYWRONG', 'chan_ctrl', 'ch_busy_o가 ChArmed에서도 세팅됨', 'killed'],
] as const

const mutantsP4 = [
  ['MUT_SCHED_STICKYLOCK', 'dma_sched', '패킷 완료(eop) 후에도 채널 lock이 안 풀림', 'killed'],
  ['MUT_SCHED_EARLYUNLOCK', 'dma_sched', 'eop 이전에 lock이 풀려 다른 채널이 끼어들 수 있음', 'killed'],
  ['MUT_SCHED_DBLREADY', 'dma_sched', '동시에 두 채널의 ready_o가 세팅될 수 있음 (onehot0 위반)', 'killed'],
  ['MUT_DESC_NOLINK', 'desc_fetch', 'ctrl.link 무시하고 항상 선형(+DescBytes)으로만 진행', 'killed'],
  ['MUT_DESC_NOHALT', 'desc_fetch', 'ctrl.last인 descriptor 완료 후에도 halt하지 않음', 'killed'],
  ['MUT_DESC_NOCHECK', 'desc_fetch', 'desc_check() 결과를 무시하고 항상 유효 처리', 'killed'],
  ['MUT_RDM_NOSPLIT', 'axi_rd_master', '4KB 경계 분할 결정을 건너뜀', 'killed'],
  ['MUT_RDM_LASTWRONG', 'axi_rd_master', 'rd_resp_last_o가 분할 여부와 무관하게 rlast_i 그대로', 'killed'],
  ['MUT_RDM_ERRDROP', 'axi_rd_master', 'rd_resp_err_o가 항상 0', 'killed'],
  ['MUT_WRM_NOSPLIT', 'axi_wr_master', 'burst 크기 결정이 MaxBurst/4KB를 완전히 무시', 'killed'],
  ['MUT_WRM_LASTWRONG', 'axi_wr_master', 'wlast_o가 burst의 모든 beat에서 세팅됨', 'killed'],
  ['MUT_WRM_ERRDROP', 'axi_wr_master', 'burst_done_err_o가 항상 0', 'killed'],
  ['MUT_TRACK_NOERR', 'wr_track', 'burst의 BRESP 에러가 절대 latch되지 않음', 'killed'],
  ['MUT_TRACK_NOCLEAR', 'wr_track', 'ch_abort_i가 latch된 에러를 더 이상 클리어하지 않음', 'killed'],
  ['MUT_TRACK_WRONGCH', 'wr_track', 'xfer_done_ch_o가 항상 채널 0', 'killed'],
] as const

const mutantsP5 = [
  ['MUT_IRQ_NOEDGE', 'irq_ctrl', 'fetch/write 에러가 pulse가 아닌 level로 IrqCauseErr에 반영', 'killed'],
  ['MUT_IRQ_WRONGCH', 'irq_ctrl', 'xfer_done_i가 항상 채널 0의 IrqCauseDone을 pulse', 'killed'],
  ['MUT_IRQ_BUSYWRONG', 'irq_ctrl', 'ch_busy_o가 desc_valid_i를 빼고 stream_busy_i만 반영', 'killed'],
  ['MUT_PERF_BYTEWRONG', 'perf_cnt', '바이트 카운터가 strobe popcount를 무시', 'killed'],
  ['MUT_PERF_NOSTALL', 'perf_cnt', 'stall 카운트가 절대 증가하지 않음', 'killed'],
  ['MUT_PERF_ERRMISS', 'perf_cnt', 'CRC 원인이 에러 이벤트로 카운트되지 않음', 'killed'],
] as const

const chanCtrlBugs = [
  ['Bug A — 세션 넘어 남는 stale FIFO 데이터', 'pkt_align은 ch_enable_i를 모르기 때문에, axi_clk이 아직 한 beat도 못 본 채로 disable된 패킷이 CDC FIFO 안에 그대로 남아있었습니다. 다음 enable이 그 잔여 바이트를 새 세션의 sop로 오인. ChIdle이 무조건 drain-and-discard하도록 수정 — 처음 버전은 "이번 사이클에 뭔가 오고 있나"만 확인해 CDC FIFO read-side의 순간적인 gap을 "다 drain됨"으로 오판했고, sticky한 drain_pending_q 비트(드레인 중인 beat의 실제 eop만 클리어)로 두 번째 시도에서 고침.'],
  ['Bug B — single-beat 패킷의 pkt_done 누락', 'ChArmed의 전이 로직이 accept & sop만 확인하고 같은 사이클의 pkt_done_i 펄스(sop==eop인 1-beat 패킷에서 항상 발생)를 놓쳐, 이미 지나간 완료 신호를 영원히 기다리며 ChRunning에 멈춰있었습니다. accept & sop 분기 안에서 pkt_done_i를 먼저 확인하도록 수정.'],
  ['Bug C — drain 중 스퓨리어스 ch_cause_o', 'pkt_check는 discard 중인 beat도 계속 처리해 pkt_done_o/crc_err_o/len_err_o를 발생시키는데, 원래 ch_cause_o는 이걸 그대로 반영해 소프트웨어가 시작하지도 않은 세션의 인터럽트가 발생했습니다. 세 cause 비트 모두 accepting으로 게이팅.'],
] as const

const otherBugsP34 = [
  ['tb_chan_top.sv 스코어보드 버그 (RTL 버그 아님)', 'phase 2의 corrupted-CRC 패킷을 track=0으로 보냈지만, pkt_check/chan_ctrl은 CRC 결과가 나오기 전에 이미 그 패킷의 beat(eop 포함)를 전달하도록 설계돼 있어 그 바이트들이 got_bytes에 실제로 들어갔습니다. got_pkt_count가 exp_pkt_count보다 영구히 하나 앞서게 되어 이후 모든 "while (got_pkt_count < exp_pkt_count)" 대기가 조기 종료. phase 2 패킷도 추적하도록 고쳐서 해결 — RTL 변경 없음.'],
  ['stale mutant 파일 문제 (두 번째 발견)', 'mutants/chan_ctrl_MUTANT.sv가 idle_drain/drain_pending_q 기능이 생기기 전 버전에서 복사돼 있었습니다. 3개 MUT_CTRL_* 전부 "killed"로 보고됐지만 실제로는 무관한 idle-drain 체크가 항상 실패하며 편승한 것 — 의도한 결함이 실제로 잡혔다는 증거가 아니었습니다. 최신 golden RTL에서 재생성해 각 뮤턴트가 자기 이름의 결함에서만 실패하도록 수정. 교훈: 골든 RTL이 계속 바뀌는 한 뮤턴트 파일도 그만큼 stale해질 수 있다 — "킬됐다"는 증거만으로 충분하지 않음.'],
] as const

const synthResults = [
  ['skid_buffer', '443', '4,341.66', '11,390.3', '+4.80', '+0.12', '0', 'Passed', 'Passed', 'Passed'],
  ['cnt_sat', '297', '2,275.93', '8,349.01', '+3.77', '+0.12', '0', 'Passed', 'Passed', 'Passed'],
  ['chan_ctrl', '1,360', '2,630.02', '90,000', '+4.22', '+0.12', '0', 'Passed', 'Passed', 'Passed'],
] as const

const chanCtrlSynthIssues = [
  ['SystemVerilog 파싱 실패', "axi_pkg.sv의 '{...} assignment pattern(struct 캐스트)을 yosys 기본 Verilog-2005 리더가 못 읽음 (\"unexpected OP_CAST\") — skid_buffer/cnt_sat는 daq_pkg를 안 써서 안 걸렸던 문제. USE_SYNLIG: true로 synlig(SV 전용 프론트엔드)를 켜서 해결."],
  ['IO 핀 165개 > 배치 가능 80개', 'chan_ctrl은 64비트 버스가 여러 개(in/out beat_data·strb 등)라 핀 수가 많은데, FP_SIZING: relative가 셀 면적 기준으로 다이를 너무 작게 잡아 둘레에 다 못 놓음. FP_SIZING: absolute + DIE_AREA를 300×300µm로 명시해서 해결 — 필요 이상 크지만 첫 시도는 여유 있게.'],
] as const

const toolchainSteps = [
  ['Docker Desktop 미실행', 'WSL 통합은 이미 설정돼 있었으나 프로세스가 꺼져 있었음 — 실행'],
  ['WSL idle timeout이 tmpfs /tmp를 날림', '작업 중 WSL2 VM이 유휴 종료되며 진행 중이던 빌드 로그가 tmpfs라 소실됨 → .wslconfig에 vmIdleTimeout=-1 설정 + 로그를 홈 디렉토리(영구)로 이동'],
  ['시스템 Python 3.14가 klayout wheel과 안 맞음', 'Ubuntu 26.04 기본 Python이 너무 최신이라 klayout이 prebuilt wheel 없이 소스 빌드를 시도하다 실패 → uv로 별도 Python 3.11 venv 생성'],
  ['click/cloup 버전 비호환', 'pip이 openlane의 예상보다 최신 click을 설치해 모든 실행이 TypeError로 즉시 크래시 → click<8.2, cloup<3.1로 다운그레이드'],
  ['--dockerized 기본값이 TTY 요구', '비대화형 스크립트에서 컨테이너에 TTY를 붙이지 못해 실패 → --docker-no-tty 추가'],
  ['config가 작업 디렉토리 밖 파일 참조 거부됨', 'asic/<design>/config.json에서 ../../rtl/...로 상위 참조 시 PermissionError → sample_test_4/ 루트를 cwd로 잡고 아래로만 참조하도록 재구성'],
  ['Nix devShell 경로는 결국 포기', 'Determinate Nix 설치, trusted-users 설정, sandbox=false까지 시도했지만 openlane 파생물 빌드에서 genericBuild: command not found로 원인 불명 실패 — pip+Docker 경로로 전환해 바로 성공'],
] as const

export default function SampleTest4() {
  const [tab, setTab] = useState<Tab>('overview')
  return <>
    <section className="task-hero">
      <small className="kicker">RTL PHASE 5 OF 6 완료 · PHASE 6 진행 중 · ASIC SYNTHESIS TRACK 병행</small>
      <h2>Multi-channel DAQ/DMA Subsystem</h2>
      <p>8채널 AXI4-Lite CSR + AXI4 DMA IP 리허설. Phase 1-5(패키지·common·CSR·스트림 경로·DMA 엔진·top 통합)가 전부 완료·검증됐고, phase 6(블록별 formal·통합 UVM)이 진행 중입니다. 동시에 검증이 끝난 블록부터 <b>sky130 오픈소스 PDK로 실제 ASIC 합성</b>을 진행해 툴체인과 타이밍 클로징을 확인하고 있습니다.</p>
      <b>구현: rtl/pkg · rtl/common · rtl/csr · rtl/stream · rtl/dma · rtl/irq · rtl/stat · rtl/daq_subsystem.sv(top) · asic/(sky130 합성)</b>
    </section>
    <section className="sample-summary">
      <span><b>102</b> lint 구성 전부 clean (phase 1-5)</span>
      <span><b>40/40</b> mutation 검출</span>
      <span><b>16</b> block testbench PASS</span>
      <span><b>3</b> 블록 formal(k-induction) 무한 증명 완료</span>
      <span><b>3</b> 블록 ASIC 합성 성공 (sky130, FSM 로직 포함)</span>
    </section>
    <div className="sample-tabs" role="tablist">
      {tabs.map(item => <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}
    </div>
    <section className="sample-tab-panel"><Detail tab={tab}/></section>
  </>
}

function Detail({ tab }: { tab: Tab }) {
  if (tab === 'architecture') return <>
    <Card kicker="PRIM REUSE — PHASE 1의 핵심 결정" title="OpenTitan hw/ip/prim에서 재사용한 9개"><div className="data-table"><table><thead><tr><th>계획된 모듈</th><th>실제 사용</th><th>역할</th></tr></thead><tbody>{primReuse.map(([mod, real, role]) => <tr key={mod}><td><code>{mod}</code></td><td><b>{real}</b></td><td>{role}</td></tr>)}</tbody></table></div><div className="check-list">{notReused.map(([mod, why]) => <p key={mod}><b><code>{mod}</code> — 새로 작성</b><span>{why}</span></p>)}</div><p className="rtl-guide-note">이 매핑은 문서로만 남긴 게 아니라 <code>tb/prim_reuse_smoke.sv</code>가 9개 전부를 실제 폭으로 인스턴스화해 lint gate에 포함시켜 증명합니다 — 나중에 어떤 phase가 하나를 안 쓰게 되면 이 smoke test가 그 drift를 잡아냅니다.</p></Card>
    <Card kicker="BLOCK &amp; PORT DIAGRAM" title="phase 1-5 완성된 전체 파이프라인 (daq_subsystem.sv)"><pre className="rtl-code">{`clk_i (reg_clk = axi_clk, 하나로 통일 — CDC audit 결론)\nAXI4-Lite  --->  +---------------+   regbus (내부)   +---------------+\n  AW/W/B/AR/R     | axil_slave.sv | -----------------> |   daq_csr.sv   |\n                  +---------------+                     +---------------+\n                                                            |        ^\nsrc_clk[c] 도메인 (채널당 독립)     axi_clk 도메인 (chan_top.sv)      | ctrl   | status/irq/cnt\n+------------+   +------------+   async CDC FIFO   +-----------+   +-----------+\n| byte stream| ->| pkt_align  | ----------------->  | pkt_check | ->| chan_ctrl |--+\n+------------+   +------------+  (prim_fifo_async)  +-----------+   +-----------+  |\n     (유일한 실제 클럭 경계 — chan_top.sv, phase 3 CDC audit 완료)                   |\n            채널 NumCh개의 chan_top.sv 게이티드 beat 스트림 전부 ---------------------+\n                                        |                                            v\n                                        v                                  +------------+\n                              +------------------+  packet-granularity RR  | dma_sched  |\n                              | axi_wr_master     |  <----------------------| (완료)     |\n                              | (완료) -> AXI4     |                        +------------+\n                              +--------+---------+                                |\n                                       v                                          v\n                                 +-----------+                            +-------------+\n                                 | wr_track  |--- xfer_done ------------->| desc_fetch  |--> axi_rd_master --> AXI4\n                                 +-----------+                            +-------------+\n                                       |                                          |\n                                       v                                          v\n                              +------------------+  ch_busy/err/cause   +--------------+\n                              |    irq_ctrl       | <------------------ |   perf_cnt   |\n                              +------------------+                      +--------------+`}</pre><p className="rtl-guide-note"><code>chan_top.sv</code>가 이 설계 전체에서 유일하게 클럭 도메인을 실제로 건너는 지점입니다 — <code>prim_fifo_async</code> + 도메인별 <code>prim_rst_sync</code>(phase 3에서 검증, phase 5 CDC audit에서 재확인: <code>rtl/*.sv</code> 전체에 <code>clk_i</code>/<code>src_clk_i[c]</code> 외의 클럭 신호가 없음을 grep으로 확인). <code>dma_sched.sv</code>는 beat 단위가 아니라 <b>패킷 경계에서만</b> 중재합니다 — 한 채널의 sop가 이기면 그 채널의 eop까지 다른 채널은 중재에서 완전히 배제되어, 정지가 두 채널의 패킷을 인터리빙하는 일이 없습니다. <code>irq_ctrl.sv</code>의 Done 원인은 chan_ctrl의 패킷 단위 완료가 아니라 <b>wr_track의 실제 descriptor 완료</b>(<code>xfer_done_i</code>)로 구동됩니다.</p></Card>
    <Card kicker="REGISTER MAP" title="daq_csr.sv 구현 완료"><div className="data-table"><table><thead><tr><th>주소</th><th>이름</th><th>Access</th><th>필드</th></tr></thead><tbody>{regMap.map(([addr, name, acc, fields]) => <tr key={`${addr}-${name}`}><td><code>{addr}</code></td><td><b>{name}</b></td><td>{acc}</td><td>{fields}</td></tr>)}</tbody></table></div><p className="rtl-guide-note"><b>IRQ_STATE를 원안(W1C)에서 RO로 바꿨습니다</b> — 같은 정보를 요약하는 두 번째 W1C 래치는 채널 원인이 여전히 pending인 채로 클리어돼도 다음 사이클에 다시 세팅될 뿐인 중복이자 오해의 소지였습니다.</p></Card>
    <Card kicker="chan_ctrl.sv — 5-STATE FSM" title="ChIdle → ChArmed → ChRunning/ChDraining → ChError"><div className="check-list">{chanCtrlBugs.map(([title, detail]) => <p key={title}><b>{title}</b><span>{detail}</span></p>)}</div><p className="rtl-guide-note">셋 다 이번 세션에 발견·수정한 실제 RTL 버그입니다 — chan_ctrl.sv 자체 헤더 코멘트에 전체 서사가 남아있습니다.</p></Card>
    <Card kicker="STATUS · 2026-08-30" title="Phase 4-6 실제 현황"><div className="check-list">
      <p><b>Phase 4 — DMA 엔진</b><span className="ok-badge" style={{marginLeft:8}}>완료</span><span>dma_sched, desc_fetch, axi_rd_master, axi_wr_master, wr_track 전부 완료·검증, lint sweep clean.</span></p>
      <p><b>Phase 5 — top 통합</b><span className="ok-badge" style={{marginLeft:8}}>완료</span><span>irq_ctrl, perf_cnt, daq_subsystem.sv 전부 완료·검증. smoke 레벨 통합 테스트로 end-to-end 바이트 이동 확인.</span></p>
      <p><b>Phase 6 — 블록별 formal</b><span className="ok-badge" style={{marginLeft:8}}>3/15 블록</span><span><code>skid_buffer</code>·<code>cnt_sat</code>·<code>dma_sched</code> k-induction 무한 증명 + 뮤턴트 전부 검출 완료. 근거: RESULTS.md의 "Phase 6" 절.</span></p>
      <p><b>Phase 6 — 통합 UVM 환경</b><span className="warning-badge" style={{marginLeft:8}}>보류 결정</span><span>AXI4-Lite agent + 8채널 source agent + AXI4 slave 메모리 모델을 새로 짜는 건 phase 5의 smoke 통합 테스트 + 블록별 TB/formal이 이미 덮는 것 대비 비용이 커서 지금은 진행하지 않기로 결정했습니다. 재개할 가치가 생기면(예: 실제 fault-injection 시나리오 필요) 그때 다시 판단합니다.</span></p>
    </div></Card>
    <Card kicker="다음에 이어서 할 때" title="바로 실행할 명령"><div className="data-table"><table><thead><tr><th>무엇을</th><th>명령</th></tr></thead><tbody>
      <tr><td>chan_top P&R 결과 확인/재개</td><td><code>Get-Content tools\wsl\logs\87f_chan_top_resume.log -Tail 10</code><br/>완료 안 됐으면: <code>wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/87_run_chan_top.sh</code></td></tr>
      <tr><td>블록별 formal 다음 대상</td><td><code>daq_csr</code>(W1C, Sample Test 3의 <code>daq_status_sync.sby</code> 패턴 재사용) → <code>axil_slave</code>(AXI4-Lite handshake) → <code>wr_track</code> 순으로 진행 권장</td></tr>
      <tr><td>완료된 3블록 재검증</td><td><code>sby -f formal/skid_buffer.sby</code>, <code>formal/cnt_sat.sby</code>, <code>formal/dma_sched.sby</code> (각각 mutation .sby도 동일 디렉터리에 있음)</td></tr>
    </tbody></table></div><p className="rtl-guide-note">전체 배경은 <code>NEXT_SESSION.md</code> 마지막 "Sample Test 4 phase 6" 절, 근거는 <code>samples/sample_test_4/RESULTS.md</code>의 "Phase 6" 절 참고.</p></Card>
  </>
  if (tab === 'verification') return <>
    <Card kicker="LINT GATE — PARAMETER SWEEP" title="102개 구성 전부 clean (phase 1-5)"><pre className="rtl-code">{`scripts/run_lint.ps1\n  for NumCh in {1, 2, 8}:\n    for AxiDw in {32, 64}:\n      for top in {skid_buffer, cnt_sat, prim_reuse_smoke, axil_slave, daq_csr,\n                  pkt_align, pkt_check, chan_ctrl, chan_top, dma_sched,\n                  desc_fetch, axi_rd_master, axi_wr_master, wr_track,\n                  irq_ctrl, perf_cnt, daq_subsystem}:\n        verilator --lint-only -Wall  ->  PASS (102/102)`}</pre><p className="rtl-guide-note">NumCh=1이 dma_sched.sv와 desc_fetch.sv 양쪽에서 실제 버그를 잡았습니다 — prim_arbiter_tree의 idx_o가 N=1에서 zero-width가 되는 걸 그 prim 자체가 가드하지 않아, generate if (NumCh &gt; 1)로 우회.</p></Card>
    <Card kicker="BLOCK TESTBENCHES" title="16개 전부 PASS"><div className="data-table"><table><thead><tr><th>Testbench</th><th>대상</th><th>커버리지</th></tr></thead><tbody>
      <tr><td><code>tb_skid_buffer</code></td><td>skid_buffer.sv</td><td>full-rate throughput, random backpressure, 2-beat capacity 한계</td></tr>
      <tr><td><code>tb_cnt_sat</code></td><td>cnt_sat.sv</td><td>saturation, clear 우선순위, wide-increment 교차확인</td></tr>
      <tr><td><code>tb_axil_slave</code></td><td>axil_slave.sv</td><td>AW/W 동시·분리 도착, AW+W+AR 동시 경합, DECERR</td></tr>
      <tr><td><code>tb_daq_csr</code></td><td>axil_slave+daq_csr (NumCh=4)</td><td>레지스터 전체 readback, W1C 동시성, IRQ 마스킹 계층</td></tr>
      <tr><td><code>tb_pkt_align</code></td><td>pkt_align.sv</td><td>18패킷/228바이트, 랜덤 stall, out-of-band CRC 전달</td></tr>
      <tr><td><code>tb_pkt_check</code></td><td>pkt_check.sv</td><td>17패킷, 독립 bit-serial CRC 레퍼런스 모델과 교차검증</td></tr>
      <tr><td><code>tb_chan_ctrl</code></td><td>chan_ctrl.sv</td><td>8 phase — Idle drain, single-beat pkt_done, abort, cause 게이팅</td></tr>
      <tr><td><code>tb_chan_top</code></td><td>chan_top.sv (전체 통합)</td><td>비정수 클럭비, phase 3a/3b drain/discard 경계, 랜덤 8패킷 양방향 backpressure</td></tr>
      <tr><td><code>tb_dma_sched</code></td><td>dma_sched.sv (NumCh=4)</td><td>동시 sop 경합, mid-packet 경합, 4채널 랜덤 스트레스 + 5회 추가 시드</td></tr>
      <tr><td><code>tb_desc_fetch</code></td><td>desc_fetch.sv (NumCh=4)</td><td>단일/링크/에러 5종/abort-재시작/2채널 경합, 6 phase</td></tr>
      <tr><td><code>tb_axi_rd_master</code></td><td>axi_rd_master.sv</td><td>4KB 분할, RRESP 에러, 양방향 backpressure, 연속 fetch, 5 phase + 시드 5회</td></tr>
      <tr><td><code>tb_axi_wr_master</code></td><td>axi_wr_master.sv</td><td>MaxBurst/4KB 분할, BRESP 에러, 백프레셔, 6 phase + 시드 10회</td></tr>
      <tr><td><code>tb_wr_track</code></td><td>wr_track.sv</td><td>단일/다중 burst 완료, 에러 sticky, abort clear, 채널 독립성</td></tr>
      <tr><td><code>tb_irq_ctrl</code></td><td>irq_ctrl.sv</td><td>busy OR, sticky→pulse 변환, xfer_done 라우팅, cause passthrough</td></tr>
      <tr><td><code>tb_perf_cnt</code></td><td>perf_cnt.sv</td><td>바이트/패킷/에러/stall 카운트, popcount 정확성, abort clear</td></tr>
      <tr><td><code>tb_daq_subsystem</code></td><td>daq_subsystem.sv (NumCh=1, 통합 smoke)</td><td>실제 AXI4-Lite+src_clk 스트림으로 채널 1개 end-to-end 확인, 시드 8회</td></tr>
    </tbody></table></div></Card>
    <Card kicker="MUTATION — NON-VACUOUS" title="40/40 결함 검출 (phase 1-5)"><div className="data-table"><table><thead><tr><th>결함</th><th>모듈</th><th>내용</th><th>결과</th></tr></thead><tbody>{[...mutantsP12, ...mutantsP3, ...mutantsP4, ...mutantsP5].map(([id, mod, desc, result]) => <tr key={id}><td><code>{id}</code></td><td>{mod}</td><td>{desc}</td><td><span className="ok-badge">{result}</span></td></tr>)}</tbody></table></div><p className="rtl-guide-note">뮤턴트를 만드는 과정에서 <code>MUT_SKID_ORDER</code> 하나는 폐기했습니다 — 애초에 동시 도달 불가능한 equivalent mutant였습니다.</p></Card>
    <Card kicker="PHASE 6 — 블록별 FORMAL" title="3개 블록 unbounded k-induction 증명 완료"><div className="data-table"><table><thead><tr><th>블록</th><th>proof</th><th>결과</th><th>mutant (전부 catch)</th></tr></thead><tbody>
      <tr><td><code>skid_buffer.sv</code></td><td><code>formal/skid_buffer.sby</code></td><td><span className="ok-badge">PASS — k-induction</span></td><td>MUT_SKID_READY · MUT_SKID_BYPASS · MUT_SKID_DRAIN</td></tr>
      <tr><td><code>cnt_sat.sv</code></td><td><code>formal/cnt_sat.sby</code></td><td><span className="ok-badge">PASS — k-induction</span></td><td>MUT_CNT_WRAP · MUT_CNT_CLEAR_LOSE</td></tr>
      <tr><td><code>dma_sched.sv</code></td><td><code>formal/dma_sched.sby</code></td><td><span className="ok-badge">PASS — k-induction</span></td><td>MUT_SCHED_STICKYLOCK · MUT_SCHED_EARLYUNLOCK · MUT_SCHED_DBLREADY</td></tr>
    </tbody></table></div><p className="rtl-guide-note">세 블록 모두 단일 클럭이라 별도 induction-helper 없이 첫 시도에서 무한 증명이 닫혔습니다. skid_buffer.sv는 첫 property 세트가 MUT_SKID_DRAIN을 놓쳐 다섯 번째 property("no premature drain")를 추가해 갭을 메웠고, dma_sched.sv는 fairness(liveness) 대신 mutual-exclusion/packet-atomicity 같은 safety만 증명합니다. 남은 ~12개 블록과 통합 UVM 환경(보류 결정)은 위 STATUS 카드 참고.</p></Card>
    <Card kicker="이번 세션에 발견한 버그 (RTL이 아닌 것도 포함)" title="검증 코드 자체의 버그 2건"><div className="check-list">{otherBugsP34.map(([title, detail]) => <p key={title}><b>{title}</b><span>{detail}</span></p>)}</div><p className="rtl-guide-note">Sample Test 2/3/4 phase 1-2에서 반복된 것과 같은 교훈: 정확히 그 케이스를 겨냥하지 않는 드라이버·스코어보드는 망가진 설계 옆에서도, 혹은 stale해진 뮤턴트 옆에서도 그냥 통과합니다.</p></Card>
  </>
  if (tab === 'synthesis') return <>
    <Card kicker="ASIC FLOW — TOOLCHAIN" title="OpenLane2 + sky130A, WSL Ubuntu 네이티브 (Docker 아님)"><pre className="rtl-code">{`오픈소스 전용, foundry NDA 없음\nYosys(nix, slang+pyosys) -> OpenROAD/OpenSTA -> Magic (DRC) -> Netgen (LVS) -> KLayout\n실행: openlane <config.json>  (초기엔 --dockerized였으나 이후 네이티브 venv로 전환)\nPDK: sky130A, volare로 영구 설치 (D:\\...\\pdk\\volare\\sky130\\versions\\, ~2.06GB)\n환경: WSL Ubuntu, Python 3.12 venv (~/.venvs/openlane312), openlane==2.3.10`}</pre><p className="rtl-guide-note">FPGA(yosys+nextpnr, 이미 있는 oss-cad-suite로 PDK 없이 즉시 가능)와 실제 foundry PDK(접근 불가, NDA 필요) 사이의 중간 지점 — 오픈소스 sky130으로 GDS까지 전체 플로우를 실제로 돌려 툴체인과 타이밍을 검증합니다. 최초 설치는 Docker 기반이었지만, 대용량 실행(daq_subsystem 등)의 안정성을 위해 이후 세션에서 네이티브 venv 경로로 전환했습니다 — 상세는 <b>General RTL Pipeline → Physical Design</b> 탭.</p></Card>
    <Card kicker="설치 중 만난 문제와 해결" title="7가지, 전부 이번 세션에 실시간 해결"><div className="check-list">{toolchainSteps.map(([title, detail]) => <p key={title}><b>{title}</b><span>{detail}</span></p>)}</div></Card>
    <Card kicker="SMOKE TEST" title="openlane --dockerized --smoke-test"><p className="rtl-guide-note">OpenLane 내장 예제 설계로 78개 스테이지(합성→플로어플랜→배치→CTS→라우팅→STA→DRC/LVS/Antenna) 전체 완주, 1분 42초. <span className="ok-badge">Smoke test passed</span> — 툴체인 자체가 정상 동작함을 먼저 확인.</p></Card>
    <Card kicker="이 프로젝트 RTL 합성 결과" title="검증 완료된 블록 3개, 전부 통과"><div className="data-table"><table><thead><tr><th>모듈</th><th>셀 수</th><th>셀 면적(µm²)</th><th>다이 면적(µm²)</th><th>Setup slack</th><th>Hold slack</th><th>DRC 에러</th><th>DRC</th><th>LVS</th><th>Antenna</th></tr></thead><tbody>{synthResults.map(([name, cells, cellArea, dieArea, setup, hold, drcErr, drc, lvs, ant]) => <tr key={name}><td><code>{name}</code></td><td>{cells}</td><td>{cellArea}</td><td>{dieArea}</td><td>{setup} ns</td><td>{hold} ns</td><td>{drcErr}</td><td><span className="ok-badge">{drc}</span></td><td><span className="ok-badge">{lvs}</span></td><td><span className="ok-badge">{ant}</span></td></tr>)}</tbody></table></div><p className="rtl-guide-note">클럭 목표 10ns(100MHz)에서 세 블록 모두 setup slack이 여유 커서(+3.8~4.8ns) — <code>chan_ctrl</code>처럼 실제 5-state FSM 로직이 들어간 블록도 마찬가지로, sky130에서 타이밍 클로징이 이 프로젝트 설계 복잡도에서 문제없이 유지됩니다. Hold slack은 세 설계 모두 +0.12ns로 통과하지만 여유가 좁아 — phase 5/6에서 더 큰 블록을 합성할 때 주시할 지표입니다. 산출물(GDS/LEF/netlist/SPEF/SDF/5-corner .lib)은 각 <code>asic/&lt;module&gt;/runs/RUN_*/final/</code>에 완전한 세트로 생성됩니다.</p></Card>
    <Card kicker="chan_ctrl 합성에서 새로 만난 문제 2가지" title="실제 FSM 블록이라 처음 나타난 이슈"><div className="check-list">{chanCtrlSynthIssues.map(([title, detail]) => <p key={title}><b>{title}</b><span>{detail}</span></p>)}</div></Card>
    <Card kicker="다음 합성 대상" title="chan_top.sv · daq_subsystem.sv 둘 다 지금 실행 중"><div className="check-list"><p><b>chan_top.sv</b><span>CDC 포함 첫 멀티클럭 합성 대상 — 12/48ns 재합성으로 setup 위반 926→5개까지 줄였고, 지금 axi만 52ns로 올려 완전 클로징 재시도 중. 실시간 상세는 <b>General RTL Pipeline → Physical Design</b> 탭 참고.</span></p><p><b>daq_subsystem.sv (8채널 top)</b><span>phase 5 완료 후 첫 전체-IP 합성 시도 — 지금 4번째 시도가 진행 중 (앞 3번은 세션/PC 종료로 WSL 프로세스가 죽어 미완주). ~107k 셀, worst-corner 타이밍부터 확인 중.</span></p><p><b>dma_sched.sv</b><span>prim_arbiter_tree(OpenTitan 외부 prim) 재사용 블록의 첫 합성 — 아직 시작 전</span></p></div></Card>
  </>
  if (tab === 'layout') return <LayoutGallery/>
  if (tab === 'documents') return <Card kicker="ARTIFACT LIBRARY" title="phase 1-5 완료 + phase 6 formal 시작 + ASIC 합성 산출물"><div className="sample-list">
    <div><b>PLAN.md / PHASE_3_6_PLAN.md</b><span>6-phase 계획, phase 3-6 상세 실행 계획 및 현황</span></div>
    <div><b>RESULTS.md</b><span>phase 1-6 근거 전체 — lint, TB, mutation, formal, 발견한 버그와 원인분석</span></div>
    <div><b>rtl/pkg/{'{axi_pkg,daq_pkg}'}.sv</b><span>AXI 인코딩, descriptor struct, 레지스터 맵, packed-beat 레이아웃</span></div>
    <div><b>rtl/common/{'{skid_buffer,cnt_sat}'}.sv</b><span>prim에 대응 모듈이 없는 두 신규 모듈</span></div>
    <div><b>rtl/csr/{'{axil_slave,daq_csr}'}.sv</b><span>AXI4-Lite 브리지 + 레지스터 파일</span></div>
    <div><b>rtl/stream/{'{pkt_align,pkt_check,chan_ctrl,chan_top}'}.sv</b><span>채널당 스트림 경로 — CDC 포함</span></div>
    <div><b>rtl/dma/{'{dma_sched,desc_fetch,axi_rd_master,axi_wr_master,wr_track}'}.sv</b><span>DMA 엔진 전체 — channel arbiter, descriptor ring walker, AXI4 read/write master, write completion tracking</span></div>
    <div><b>rtl/irq/irq_ctrl.sv · rtl/stat/perf_cnt.sv</b><span>상태/인터럽트 집계, per-channel 카운터</span></div>
    <div><b>rtl/daq_subsystem.sv</b><span>top-level 배선 — phase 1-5 전체 블록을 하나로 인스턴스화, reg_clk/axi_clk 통일 결정 포함</span></div>
    <div><b>formal/{'{skid_buffer,cnt_sat,dma_sched}'}_formal.sv + .sby</b><span>3개 블록 unbounded k-induction 증명 + mutation .sby</span></div>
    <div><b>tb/prim_reuse_smoke.sv</b><span>prim 재사용 매핑을 증명하는 lint-gate 인스턴스화</span></div>
    <div><b>scripts/{'{run_lint,run_block_tb}'}.ps1</b><span>parameter sweep lint gate, block TB + <code>-Mutant</code> 실행</span></div>
    <div><b>mutants/</b><span>17파일, 40개 결함 (phase 1-5)</span></div>
    <div><b>asic/{'{skid_buffer,cnt_sat,chan_ctrl,chan_top}'}/config.json + runs/</b><span>sky130 OpenLane 합성 설정과 산출물(GDS/LEF/netlist/lib/SPEF/SDF) — 상세는 General RTL Pipeline → Physical Design 탭</span></div>
  </div><p className="rtl-guide-note">작업 위치: <code>samples/sample_test_4/</code>. Sample Test 3는 이 작업으로 수정되지 않았습니다.</p></Card>
  return <>
    <Card kicker="OVERVIEW" title="지금까지의 결정과 상태"><div className="decision-grid">
      <div><b>왜 이 샘플이 있는가</b><p>Sample Test 3(229줄, 단일 파일)는 교육용이지, 실제 IP 리허설이 아닙니다. Test 4는 file list, block-level vs integration 검증, regression 관리, parameter sweep이 실제로 문제가 되는 규모(목표 ~5천줄 RTL, 24 모듈, 6 phase)를 겨냥합니다.</p></div>
      <div><b>가장 중요한 결정</b><p>계획된 <code>rtl/common/</code> 11개 모듈 중 9개를 직접 작성하는 대신 OpenTitan <code>hw/ip/prim</code>에서 재사용하기로 했고, <code>tb/prim_reuse_smoke.sv</code>로 그 매핑이 실제로 동작함을 증명했습니다.</p></div>
      <div><b>지금까지 검증</b><p>lint sweep 102/102, block TB 16/16, mutation 40/40 — phase 1(패키지·common), phase 2(AXI4-Lite CSR), phase 3(스트림 경로), phase 4(DMA 엔진), phase 5(top 통합) 전부 완료·검증. phase 6(블록별 formal)은 3개 블록 k-induction 무한 증명 완료, 나머지 진행 중 — 통합 UVM 환경은 phase 5 smoke 테스트로 대체 가능하다고 판단해 보류 결정.</p></div>
      <div><b>검증 이후 목표는 ASIC</b><p>FPGA가 아니라 오픈소스 sky130 PDK로 실제 GDS까지 합성하기로 결정 — 이후 P&R 최적화가 메인 작업으로 이어짐. OpenLane2를 WSL 네이티브 venv로 설치·검증했고(초기 Docker에서 전환), 검증 완료된 블록 3개(skid_buffer, cnt_sat, chan_ctrl)가 DRC/LVS/Antenna 전부 통과하며 합성됐습니다. chan_top(첫 멀티클럭 대상)은 RTL 파이프라이닝(ch_cause_o 레지스터화) + src_period 14ns로 전 코너 셋업 타이밍을 완전히 닫았고, 남은 안테나 위반 1건을 strategy 6으로 재검증 중(라이브)입니다. daq_subsystem(8채널 top)은 chan_top의 12/48ns 기준 worst-corner 부분 검증(STAMidPNR-3)이 라이브로 진행 중 — 상세·PPA 민감도 분석은 <b>General RTL Pipeline → P&R Research</b> 탭.</p></div>
    </div></Card>
    <Card kicker="PHASE PROGRESS" title="6-phase 계획 + ASIC 합성 트랙 대비 현황"><div className="pipeline-flow">
      <div className="pipeline-step pass"><span>01</span><b>pkg/ + common/</b><small>파일 리스트, 빌드 스크립트, lint gate</small><em>DONE</em></div>
      <div className="pipeline-step pass"><span>02</span><b>AXI4-Lite CSR</b><small>axil_slave, daq_csr, W1C/readback TB</small><em>DONE</em></div>
      <div className="pipeline-step pass"><span>03</span><b>스트림 경로</b><small>pkt_align, pkt_check, chan_ctrl, chan_top — CDC 포함</small><em>DONE</em></div>
      <div className="pipeline-step pass"><span>04</span><b>DMA 엔진</b><small>dma_sched, desc_fetch, axi_rd_master, axi_wr_master, wr_track 전부 완료</small><em>DONE</em></div>
      <div className="pipeline-step pass"><span>05</span><b>top</b><small>irq_ctrl, perf_cnt, daq_subsystem — smoke 통합 테스트로 end-to-end 확인</small><em>DONE</em></div>
      <div className="pipeline-step blocked"><span>06</span><b>통합</b><small>블록별 formal 3/15+ 완료 · 통합 UVM은 보류 결정 · regression/mutation 대기</small><em>진행중</em></div>
      <div className="pipeline-step blocked"><span>ASIC</span><b>sky130 합성</b><small>skid_buffer, cnt_sat, chan_ctrl(FSM) 완료 · chan_top 셋업 타이밍 완전 클로징(안테나 1건 재검증 중) · daq_subsystem worst-corner 부분 검증 진행 중 · dma_sched 대기</small><em>진행중</em></div>
    </div><p className="rtl-guide-note">각 phase는 parameter sweep 전체에서 lint clean이 나와야 다음 phase로 넘어갑니다 — 지금까지 어긴 적 없습니다. ASIC 합성 트랙은 RTL 검증(lint→TB→mutation)이 끝난 블록부터 phase 진행과 별도로 병행합니다. 전체 근거: <code>samples/sample_test_4/RESULTS.md</code>. 실시간 상세: 검증은 위 Verification 탭, formal은 Architecture 탭의 STATUS 카드와 <b>General RTL Pipeline → Verification/Formal</b> 탭, ASIC은 <b>General RTL Pipeline → Physical Design</b> 탭.</p></Card>
  </>
}
function Card({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) { return <section className="card"><div className="card-title"><div><small className="kicker">{kicker}</small><h2>{title}</h2></div></div>{children}</section> }

function LayoutGallery() {
  const [design, setDesign] = useState(layoutDesigns[0].id)
  const [zoom, setZoom] = useState('detail')
  const d = layoutDesigns.find(x => x.id === design) ?? layoutDesigns[0]
  const z = layoutZooms.find(x => x.key === zoom) ?? layoutZooms[2]
  return <>
    <Card kicker="3D LAYOUT GAME" title="다층 배선과 트랜지스터 배치">
      <Layout3DStack />
    </Card>
    <Card kicker="GDS LAYOUT" title="완성된 레이아웃 보기">
      <div className="layout-controls">
        <div className="layout-pills" role="tablist" aria-label="design">
          {layoutDesigns.map(x => <button key={x.id} role="tab" aria-selected={x.id === design}
            className={x.id === design ? 'active' : ''} onClick={() => setDesign(x.id)}>{x.title}</button>)}
        </div>
        <div className="layout-pills" role="tablist" aria-label="zoom">
          {layoutZooms.map(x => <button key={x.key} role="tab" aria-selected={x.key === zoom}
            className={x.key === zoom ? 'active' : ''} onClick={() => setZoom(x.key)}>{x.label}</button>)}
        </div>
      </div>
      <figure className="layout-figure">
        {/* Not lazy: only one image is on screen at a time, so deferring buys
            nothing and leaves the figure blank until it scrolls into view. */}
        <img src={`/layout/${d.id}_${z.key}.png`} alt={`${d.title} layout, ${z.label}`}/>
        <figcaption>{z.hint}</figcaption>
      </figure>
      <div className="data-table"><table><tbody>
        <tr><td><b>다이 크기</b></td><td>{d.die}</td></tr>
        <tr><td><b>셀</b></td><td>{d.cells}</td></tr>
        <tr><td><b>비고</b></td><td>{d.note}</td></tr>
      </tbody></table></div>
      <p className="rtl-guide-note">이미지는 완성된 GDS를 KLayout으로 렌더링한 것이고, <b>sky130A 레이어 속성 파일을 적용</b>해 각 레이어가 실제 색으로 나옵니다. 20 µm 창에서 보이는 파란 가로줄이 met1 전원 레일(VPWR/VGND), 자홍색 세로줄이 met2 신호 배선, 녹색이 N-well입니다. 재생성: <code>tools\wsl\63_render_all.sh</code>.</p>
    </Card>
    <Card kicker="INTERACTIVE" title="KLayout GUI로 직접 열기">
      <p className="rtl-guide-note">이미지는 고정 배율이라 원하는 곳을 확대하거나 레이어를 껐다 켤 수 없습니다. 실제로 조작하려면 KLayout을 여세요 — <b>WSL 안의 KLayout이 WSLg를 통해 Windows 화면에 직접 뜹니다</b>. Windows에 따로 설치할 것은 없습니다.</p>
      <pre className="rtl-code">{`tools\\open_layout.bat              # chan_ctrl\ntools\\open_layout.bat cnt_sat\ntools\\open_layout.bat skid_buffer`}</pre>
      <div className="check-list">
        <p><b>왜 브라우저에서 바로 못 여는가</b><span>웹 페이지가 로컬 GUI 프로그램을 실행하려면 그걸 대신 실행해 줄 로컬 백엔드가 필요합니다. 브라우저는 보안상 임의의 프로그램을 실행하지 못합니다. 배치 파일 한 번이 그 역할을 대신하며, 서버를 추가로 띄우지 않아도 됩니다.</span></p>
        <p><b>GDS 원본 위치</b><span><code>samples/sample_test_4/asic/&lt;design&gt;/runs/RUN_*/final/gds/</code>. 같은 <code>final/</code> 아래에 DEF, 게이트 네트리스트, SPEF 기생 성분, SDF, 5개 코너 .lib가 함께 있습니다.</span></p>
      </div>
    </Card>
  </>
}
