import { useState, type ReactNode } from 'react'

type Tab = 'overview' | 'architecture' | 'verification' | 'documents'
const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' }, { id: 'architecture', label: 'Architecture' },
  { id: 'verification', label: 'Verification' }, { id: 'documents', label: 'Documents' },
]

// prim reuse mapping — the load-bearing decision of phase 1. Proven by
// tb/prim_reuse_smoke.sv, not just written here.
const primReuse = [
  ['async_fifo.sv', 'prim_fifo_async', '채널 스트림 CDC FIFO'],
  ['sync_fifo.sv', 'prim_fifo_sync', '같은-클럭 FIFO (Sample Test 2와 동일 모듈)'],
  ['arb_rr.sv', 'prim_arbiter_tree', '채널 간 round-robin 중재'],
  ['crc32.sv', 'prim_crc32', '스트림 CRC-32'],
  ['cdc_pulse.sv', 'prim_pulse_sync', '이벤트 펄스 CDC'],
  ['cdc_data_handshake.sv', 'prim_sync_reqack_data', '다중 비트 데이터 CDC 핸드셰이크'],
  ['ecc_secded.sv', 'prim_secded_39_32_{enc,dec}', '채널 FIFO payload ECC'],
  ['reset_sync.sv', 'prim_rst_sync', '도메인별 리셋 동기화'],
  ['sync_2ff.sv', 'prim_flop_2sync', '단일 비트 2-flop 동기화'],
] as const
const notReused = [
  ['skid_buffer.sv', 'AXI 타이밍용 valid/ready 파이프라인 스테이지 — OpenTitan은 TileLink 기반이라 대응 모듈이 없음'],
  ['cnt_sat.sv', '통계용 saturating 카운터 — prim_count는 hardened dual-counter라 여기 필요 없는 tamper 감지 비용을 지불함'],
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

const mutants = [
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

const testbenchBugs = [
  ['awready류 신호를 accept edge 한 negedge 뒤에 재확인', 'axil 프로토콜을 처음 다루는 두 TB(tb_axil_slave, tb_daq_csr) 모두 같은 실수를 했습니다. awready는 조합 신호이고 accept가 일어나는 바로 그 edge에 떨어지므로, 그 다음 negedge에 다시 읽으면 이미 사라진 뒤입니다. bready를 미리 올려둔 상태였기 때문에 유일한 BVALID pulse가 조용히 소비돼 버렸고, 드라이버는 다시는 오지 않을 두 번째 BVALID를 영원히 기다렸습니다 — tb_axil_slave가 첫 트랜잭션에서 그대로 타임아웃. tb_skid_buffer의 offer_taken이 이미 쓰던 것과 같은 posedge monitor 기법으로 고쳤습니다.'],
  ['MUT_AXIL_WPRIO가 처음엔 안 잡힘', 'AW+W와 AR이 같은 idle 사이클에 동시에 걸리는 경우를 테스트한 적이 없었습니다. phase 2c를 추가해 어느 응답(BVALID/RVALID)이 먼저 오는지로 승자를 판별하도록 했습니다.'],
  ['MUT_CSR_IRQNOHW가 두 번 안 잡힘', '1차: HW pulse를 fork 안 negedge 이후에 세워 실제 commit edge보다 한 박자 늦었습니다. 2차: pulse를 axil_write 호출 전체 동안 켜 두어, 경합이 끝난 뒤의 다른 edge에서 일반 HW-set 경로가 다시 비트를 세팅해 뮤턴트의 결함을 가렸습니다. 정확히 한 edge짜리 pulse로 고쳤습니다.'],
] as const

export default function SampleTest4() {
  const [tab, setTab] = useState<Tab>('overview')
  return <>
    <section className="task-hero">
      <small className="kicker">IN-PROGRESS · PHASES 1-2 OF 6</small>
      <h2>Multi-channel DAQ/DMA Subsystem</h2>
      <p>8채널 AXI4-Lite CSR + AXI4 DMA IP 리허설. <b>OpenTitan prim 라이브러리를 재사용</b>하는 것이 phase 1의 핵심 결정이었고, phase 2가 AXI4-Lite CSR 브리지와 레지스터 파일을 완성했습니다.</p>
      <b>구현: rtl/pkg (AXI 인코딩·레지스터 맵) · rtl/common (skid_buffer, cnt_sat + prim 9종 재사용) · rtl/csr (axil_slave, daq_csr)</b>
    </section>
    <section className="sample-summary">
      <span><b>11</b> rtl/common 중 <b>9</b>개 prim 재사용</span>
      <span><b>30</b> lint 구성 전부 clean</span>
      <span><b>10/10</b> mutation 검출</span>
      <span><b>4</b> block testbench PASS</span>
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
    <Card kicker="BLOCK &amp; PORT DIAGRAM" title="지금까지 구현된 phase 1-2 블록"><pre className="rtl-code">{`AXI4-Lite  --->  +---------------+        regbus (내부, 프로토콜 독립)       +---------------+\n  AW/W/B/AR/R     | axil_slave.sv |  ------------------------------------>  |   daq_csr.sv   |\n                  | (Aw/Dw 제네릭)|  reg_valid/write/addr/wdata/wstrb  -->  | 글로벌 뱅크     |\n                  | 1건씩 처리,   |  <--  reg_rdata/reg_error (조합)         | + NumCh 채널   |\n                  | write 우선   |                                          | 뱅크          |\n                  +---------------+                                          +-------+-------+\n                                                                                      |\n                          rtl/pkg: axi_pkg.sv (AXI 인코딩) + daq_pkg.sv (파라미터·descriptor·레지스터 맵)\n                                                                                      |\n                          rtl/common: skid_buffer.sv, cnt_sat.sv  +  prim_* 9종 재사용 (위 표)\n                                                                                      |\n                          아직 없음: rtl/stream, rtl/dma, rtl/irq, rtl/stat, daq_subsystem.sv (top)`}</pre><p className="rtl-guide-note"><code>axil_slave.sv</code>는 레지스터 맵과 무관한 제네릭 프로토콜 브리지입니다 — regbus 뒤에 무엇이 있는지 모릅니다. <code>daq_csr.sv</code>의 status/counter/cause 입력은 지금 블록 테스트벤치가 직접 구동합니다 — 아래 블록들이 아직 없기 때문입니다.</p></Card>
    <Card kicker="REGISTER MAP" title="daq_csr.sv 구현 완료"><div className="data-table"><table><thead><tr><th>주소</th><th>이름</th><th>Access</th><th>필드</th></tr></thead><tbody>{regMap.map(([addr, name, acc, fields]) => <tr key={`${addr}-${name}`}><td><code>{addr}</code></td><td><b>{name}</b></td><td>{acc}</td><td>{fields}</td></tr>)}</tbody></table></div><p className="rtl-guide-note"><b>IRQ_STATE를 원안(W1C)에서 RO로 바꿨습니다</b> — 같은 정보를 요약하는 두 번째 W1C 래치는 채널 원인이 여전히 pending인 채로 클리어돼도 다음 사이클에 다시 세팅될 뿐인 중복이자 오해의 소지였습니다. 실제로 클리어해야 하는 래치는 CH_IRQ_STATE 하나뿐입니다.</p></Card>
    <Card kicker="NOT DONE YET" title="Phase 3-6 청사진"><div className="check-list"><p><b>Phase 3 — 스트림 경로</b><span>pkt_align, pkt_check, chan_ctrl, chan_top (per-block TB)</span></p><p><b>Phase 4 — DMA 엔진</b><span>desc_fetch, AXI read/write master, wr_track, dma_sched</span></p><p><b>Phase 5 — top</b><span>irq_ctrl, perf_cnt, daq_subsystem.sv (모든 CDC를 명시적으로 인스턴스화)</span></p><p><b>Phase 6 — 통합</b><span>integration UVM, block별 formal, regression script</span></p></div><p className="rtl-guide-note">AXI read master가 descriptor fetch 이외에 필요한지는 phase 4에서 <code>desc_fetch.sv</code>가 생긴 뒤 구체적으로 결정합니다.</p></Card>
  </>
  if (tab === 'verification') return <>
    <Card kicker="LINT GATE — PARAMETER SWEEP" title="30개 구성 전부 clean"><pre className="rtl-code">{`scripts/run_lint.ps1\n  for NumCh in {1, 2, 8}:\n    for AxiDw in {32, 64}:\n      for top in {skid_buffer, cnt_sat, prim_reuse_smoke, axil_slave, daq_csr}:\n        verilator --lint-only -Wall  ->  PASS (30/30)`}</pre><p className="rtl-guide-note">NumCh=1이 실제 버그를 하나 잡았습니다 — <code>sel_chan_idx</code>를 고정 3비트로 선언했더니 1-entry 배열 인덱싱에서 WIDTHTRUNC. <code>daq_pkg::ChIdxW</code>(NumCh에 맞춰 계산된 폭)로 바꿔 해결. sweep이 스캐폴딩이 아니라 실제 게이트라는 근거입니다.</p></Card>
    <Card kicker="BLOCK TESTBENCHES" title="4개 전부 PASS"><div className="data-table"><table><thead><tr><th>Testbench</th><th>대상</th><th>커버리지</th></tr></thead><tbody><tr><td><code>tb_skid_buffer</code></td><td>skid_buffer.sv</td><td>full-rate throughput, random backpressure, 2-beat capacity 한계</td></tr><tr><td><code>tb_cnt_sat</code></td><td>cnt_sat.sv</td><td>saturation, clear 우선순위, wide-increment 교차확인, randomized</td></tr><tr><td><code>tb_axil_slave</code></td><td>axil_slave.sv</td><td>AW/W 동시·분리 도착, AW+W+AR 동시 경합, DECERR, byte-strobe, 400회 랜덤</td></tr><tr><td><code>tb_daq_csr</code></td><td>axil_slave+daq_csr (NumCh=4)</td><td>레지스터 전체 readback, W1C 동시성 경합, IRQ 마스킹 계층, RO 카운터</td></tr></tbody></table></div></Card>
    <Card kicker="MUTATION — NON-VACUOUS" title="10/10 결함 검출"><div className="data-table"><table><thead><tr><th>결함</th><th>모듈</th><th>내용</th><th>결과</th></tr></thead><tbody>{mutants.map(([id, mod, desc, result]) => <tr key={id}><td><code>{id}</code></td><td>{mod}</td><td>{desc}</td><td><span className="ok-badge">{result}</span></td></tr>)}</tbody></table></div><p className="rtl-guide-note">뮤턴트를 만드는 과정에서 <code>MUT_SKID_ORDER</code> 하나는 폐기했습니다 — <code>ready_o = ~skid_valid_q</code>라는 설계 때문에 swap한 두 분기가 애초에 동시에 도달 불가능한 <b>equivalent mutant</b>였습니다. <code>MUT_SKID_BYPASS</code>/<code>MUT_SKID_DRAIN</code>으로 대체했습니다.</p></Card>
    <Card kicker="TESTBENCH BUGS FOUND WHILE CLOSING THE GATE" title="RTL이 아니라 검증 코드의 버그"><div className="check-list">{testbenchBugs.map(([title, detail]) => <p key={title}><b>{title}</b><span>{detail}</span></p>)}</div><p className="rtl-guide-note">Sample Test 2/3에서 반복된 것과 같은 교훈입니다: 정확히 그 케이스, 정확히 그 edge를 겨냥하지 않는 드라이버는 망가진 설계 옆에서도 그냥 통과합니다. 세 버그 전부 뮤턴트를 실제로 돌려보기 전까지는 녹색이었습니다.</p></Card>
  </>
  if (tab === 'documents') return <Card kicker="ARTIFACT LIBRARY" title="phase 1-2 산출물"><div className="sample-list">
    <div><b>PLAN.md</b><span>6-phase 계획, 결정 사항, open questions</span></div>
    <div><b>RESULTS.md</b><span>phase 1-2 근거 전체 — lint, TB, mutation, 발견한 버그와 원인분석</span></div>
    <div><b>rtl/pkg/{'{axi_pkg,daq_pkg}'}.sv</b><span>AXI 인코딩, descriptor struct, 레지스터 맵, apply_wstrb 헬퍼</span></div>
    <div><b>rtl/common/{'{skid_buffer,cnt_sat}'}.sv</b><span>prim에 대응 모듈이 없는 두 신규 모듈</span></div>
    <div><b>rtl/csr/{'{axil_slave,daq_csr}'}.sv</b><span>AXI4-Lite 브리지 + 레지스터 파일</span></div>
    <div><b>tb/prim_reuse_smoke.sv</b><span>prim 재사용 매핑을 증명하는 lint-gate 인스턴스화</span></div>
    <div><b>scripts/{'{run_lint,run_block_tb}'}.ps1</b><span>parameter sweep lint gate, block TB + <code>-Mutant</code> 실행</span></div>
    <div><b>mutants/</b><span>skid_buffer, cnt_sat, axil_slave, daq_csr 뮤턴트 4파일, 10개 결함</span></div>
  </div><p className="rtl-guide-note">작업 위치: <code>samples/sample_test_4/</code>. Sample Test 3는 이 작업으로 수정되지 않았습니다.</p></Card>
  return <>
    <Card kicker="OVERVIEW" title="지금까지의 결정과 상태"><div className="decision-grid">
      <div><b>왜 이 샘플이 있는가</b><p>Sample Test 3(229줄, 단일 파일)는 교육용이지, 실제 IP 리허설이 아닙니다. Test 4는 file list, block-level vs integration 검증, regression 관리, parameter sweep이 실제로 문제가 되는 규모(목표 ~5천줄 RTL, 24 모듈, 6 phase)를 겨냥합니다.</p></div>
      <div><b>가장 중요한 결정</b><p>계획된 <code>rtl/common/</code> 11개 모듈 중 9개를 직접 작성하는 대신 OpenTitan <code>hw/ip/prim</code>에서 재사용하기로 했고, <code>tb/prim_reuse_smoke.sv</code>로 그 매핑이 실제로 동작함을 증명했습니다.</p></div>
      <div><b>지금까지 검증</b><p>lint sweep 30/30, block TB 4/4, mutation 10/10 — 전부 phase 1(패키지·common)과 phase 2(AXI4-Lite CSR)만 해당합니다. phase 3-6(스트림, DMA, top, 통합 UVM)은 아직 시작 전입니다.</p></div>
    </div></Card>
    <Card kicker="PHASE PROGRESS" title="6-phase 계획 대비 현황"><div className="pipeline-flow">
      <div className="pipeline-step"><span>01</span><b>pkg/ + common/</b><small>파일 리스트, 빌드 스크립트, lint gate</small><em>DONE</em></div>
      <div className="pipeline-step"><span>02</span><b>AXI4-Lite CSR</b><small>axil_slave, daq_csr, W1C/readback TB</small><em>DONE</em></div>
      <div className="pipeline-step"><span>03</span><b>스트림 경로</b><small>pkt_align, pkt_check, chan_ctrl, chan_top</small><em>대기</em></div>
      <div className="pipeline-step"><span>04</span><b>DMA 엔진</b><small>desc_fetch, AXI masters, dma_sched</small><em>대기</em></div>
      <div className="pipeline-step"><span>05</span><b>top</b><small>irq_ctrl, perf_cnt, daq_subsystem</small><em>대기</em></div>
      <div className="pipeline-step"><span>06</span><b>통합</b><small>UVM, formal, regression, mutation</small><em>대기</em></div>
    </div><p className="rtl-guide-note">각 phase는 parameter sweep 전체에서 lint clean이 나와야 다음 phase로 넘어갑니다 — 지금까지 어긴 적 없습니다. 전체 근거: <code>samples/sample_test_4/RESULTS.md</code>.</p></Card>
  </>
}
function Card({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) { return <section className="card"><div className="card-title"><div><small className="kicker">{kicker}</small><h2>{title}</h2></div></div>{children}</section> }
