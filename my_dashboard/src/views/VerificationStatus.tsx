// Live-ish status for Sample Test 4's verification (lint/block-TB/mutation),
// shown only on the "Verification" tab. TaskWorkspace's generic tasks{}
// entry describes the workflow in the abstract; this component reports what
// has actually run, with real numbers, mirroring PhysicalDesignStatus.tsx's
// pattern for the manufacturing tab.
// Snapshot as of 2026-08-30 — refresh the numbers by hand after the next
// phase's gate finishes (see samples/sample_test_4/RESULTS.md for the
// underlying evidence).

const lintTops = [
  'skid_buffer', 'cnt_sat', 'prim_reuse_smoke', 'axil_slave', 'daq_csr',
  'pkt_align', 'pkt_check', 'chan_ctrl', 'chan_top', 'dma_sched',
  'desc_fetch', 'axi_rd_master', 'axi_wr_master', 'wr_track',
  'irq_ctrl', 'perf_cnt', 'daq_subsystem',
] as const

const blockTbs = [
  ['tb_skid_buffer', 'skid_buffer.sv', 'full-rate throughput, random backpressure, 2-beat capacity 한계'],
  ['tb_cnt_sat', 'cnt_sat.sv', 'saturation, clear 우선순위, wide-increment 교차확인'],
  ['tb_axil_slave', 'axil_slave.sv', 'AW/W 동시·분리 도착, AW+W+AR 동시 경합, DECERR'],
  ['tb_daq_csr', 'axil_slave+daq_csr (NumCh=4)', '레지스터 전체 readback, W1C 동시성, IRQ 마스킹 계층'],
  ['tb_pkt_align', 'pkt_align.sv', '18패킷/228바이트, 랜덤 stall, out-of-band CRC 전달'],
  ['tb_pkt_check', 'pkt_check.sv', '17패킷, 독립 bit-serial CRC 레퍼런스 모델과 교차검증'],
  ['tb_chan_ctrl', 'chan_ctrl.sv', '8 phase — Idle drain, single-beat pkt_done, abort, cause 게이팅'],
  ['tb_chan_top', 'chan_top.sv (통합)', '비정수 클럭비, drain/discard 경계, 랜덤 8패킷 양방향 backpressure'],
  ['tb_dma_sched', 'dma_sched.sv (NumCh=4)', '동시 sop 경합, mid-packet 경합, 4채널 랜덤 스트레스 + 시드 5회'],
  ['tb_desc_fetch', 'desc_fetch.sv (NumCh=4)', '단일/링크/에러 5종/abort-재시작/2채널 경합, 6 phase'],
  ['tb_axi_rd_master', 'axi_rd_master.sv', '4KB 분할, RRESP 에러, 양방향 backpressure, 연속 fetch, 5 phase'],
  ['tb_axi_wr_master', 'axi_wr_master.sv', 'MaxBurst/4KB 분할, BRESP 에러, backpressure, 6 phase + 시드 10회'],
  ['tb_wr_track', 'wr_track.sv', '단일/다중 burst 완료, 에러 sticky, abort clear, 채널 독립성'],
  ['tb_irq_ctrl', 'irq_ctrl.sv', 'busy OR, sticky→pulse 변환, xfer_done 라우팅, cause passthrough'],
  ['tb_perf_cnt', 'perf_cnt.sv', '바이트/패킷/에러/stall 카운트, popcount 정확성, abort clear'],
  ['tb_daq_subsystem', 'daq_subsystem.sv (NumCh=1, 통합 smoke)', '실제 AXI4-Lite+src_clk 스트림으로 채널 1개 end-to-end 확인'],
] as const

const mutationByPhase = [
  ['Phase 1-2', 10, 'skid_buffer(3) · cnt_sat(2) · axil_slave(2) · daq_csr(3)'],
  ['Phase 3', 9, 'pkt_align(3) · pkt_check(3) · chan_ctrl(3)'],
  ['Phase 4', 15, 'dma_sched(3) · desc_fetch(3) · axi_rd_master(3) · axi_wr_master(3) · wr_track(3)'],
  ['Phase 5', 6, 'irq_ctrl(3) · perf_cnt(3)'],
] as const

const realBugsFound = [
  ['RTL: awlen_o가 stale 레지스터를 읽음 (axi_wr_master.sv)', 'AW 채널 백프레셔가 걸리는 동안 awlen_o가 accept 시점에만 갱신되는 레지스터를 읽고 있어서, 그 몇 사이클 동안 이전 burst의 길이를 그대로 내보내고 있었습니다. 라이브 조합 신호로 바꿔서 해결 — tb_axi_wr_master.sv의 phase 1이 WLAST 타이밍 오류로 즉시 잡아냈습니다.'],
  ['테스트벤치 레이스: 같은 posedge의 두 always 블록 (tb_axi_wr_master.sv)', '완료 이벤트를 캡처하는 always 블록과 그걸 큐에 push하는 별도 always 블록이 같은 edge에 걸려 있어 상대 실행 순서가 시뮬레이터 스케줄러에 달려 있었습니다. seed에 따라 재현 여부가 달라지는 hang으로 나타나 데이터 버그가 아니라 스케줄링 레이스임을 확인 — 캡처와 소비자를 한 블록으로 합쳐서 해결.'],
  ['테스트벤치 설계 교훈: edge detector 자극 타이밍 (tb_irq_ctrl.sv)', '같은 클럭 도메인의 "레지스터 상태" 입력을 negedge에서 미리 세팅하면(이 프로젝트의 일반적인 valid/ready 관례) rising-edge 검출기가 절대 펄스를 못 봅니다 — 검출기 자신의 flop이 첫 샘플링 기회에 이미 "새 값"을 같이 잡아버려서 lag이 0이 됩니다. posedge에 맞춘 non-blocking assignment로 자극을 바꿔서 실제 상위 레지스터와 같은 타이밍 관계를 재현해 해결.'],
] as const

export default function VerificationStatus() {
  return <>
    <section className="card"><div className="card-title"><div><small className="kicker">LIVE STATUS · 2026-08-30</small><h2>Sample Test 4 — 검증 진행 상황</h2></div><span className="ok-badge">Phase 1-5 완료</span></div>
      <div className="sample-summary" style={{marginBottom: 12}}>
        <span><b>102</b> lint 구성 전부 clean</span>
        <span><b>16</b> block testbench PASS</span>
        <span><b>40/40</b> mutation 검출</span>
      </div>
      <p className="rtl-guide-note">Block level과 integration이 별도 레벨입니다 — 각 블록이 자기 testbench를 갖고, phase가 끝날 때마다 parameter sweep 전체에서 lint clean이 나와야 다음 phase로 넘어갑니다. 근거 전체: <code>samples/sample_test_4/RESULTS.md</code>.</p>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">LINT GATE — PARAMETER SWEEP</small><h2>17개 top × NumCh{'{'}1,2,8{'}'} × AxiDw{'{'}32,64{'}'} = 102 구성</h2></div></div>
      <pre className="rtl-code">{`scripts/run_lint.ps1\n${lintTops.map(t => `  ${t}`).join('\n')}\n  -> verilator --lint-only -Wall  =>  PASS (102/102)`}</pre>
      <p className="rtl-guide-note">NumCh=1이 dma_sched.sv/desc_fetch.sv 양쪽에서 실제 버그를 잡았습니다 — <code>prim_arbiter_tree</code>의 <code>idx_o</code>가 N=1에서 zero-width가 되는 걸 그 prim 자체가 가드하지 않아, <code>generate if (NumCh &gt; 1)</code>로 우회했습니다.</p>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">BLOCK TESTBENCHES</small><h2>16개 전부 PASS</h2></div></div>
      <div className="data-table"><table><thead><tr><th>Testbench</th><th>대상</th><th>커버리지</th></tr></thead><tbody>{blockTbs.map(([tb, target, cov]) => <tr key={tb}><td><code>{tb}</code></td><td>{target}</td><td>{cov}</td></tr>)}</tbody></table></div>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">MUTATION — NON-VACUOUS</small><h2>40/40 결함 검출, phase별 분포</h2></div></div>
      <div className="data-table"><table><thead><tr><th>Phase</th><th>결함 수</th><th>모듈별 내역</th></tr></thead><tbody>{mutationByPhase.map(([phase, n, detail]) => <tr key={phase}><td><b>{phase}</b></td><td>{n}</td><td>{detail}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note">"killed"는 골든 RTL에서 통과하는 testbench가 결함 있는 mutant RTL에서는 반드시 실패해야 한다는 뜻입니다 — 이 프로젝트는 두 번(chan_ctrl, 그리고 이번 phase들 사이) stale mutant 파일이 무관한 실패에 편승해 "killed"로 오보고된 사례를 실제로 잡아낸 적이 있어서, mutation 결과 자체도 재검증 대상으로 취급합니다.</p>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">이번 phase들에서 검증이 실제로 잡은 것</small><h2>RTL 버그 1건, 테스트벤치 레이스 2건</h2></div></div>
      <div className="check-list">{realBugsFound.map(([title, detail]) => <p key={title}><b>{title}</b><span>{detail}</span></p>)}</div>
      <p className="rtl-guide-note">공통 교훈: valid/ready나 같은-클럭 상태 신호를 다루는 testbench 자극은 실제 하드웨어(레지스터, 다른 always 블록)와 같은 타이밍 관계를 재현해야 합니다 — "그럴듯해 보이는" 자극 타이밍이 오히려 검출기를 무력화하거나 레이스를 감출 수 있습니다.</p>
    </section>
  </>
}
