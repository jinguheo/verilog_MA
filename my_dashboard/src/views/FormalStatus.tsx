// Live-ish status for Sample Test 4's phase 6 per-block formal work, shown
// only on the "Formal / Security" tab. Mirrors PhysicalDesignStatus.tsx's
// pattern for the manufacturing tab and VerificationStatus.tsx's for the
// verification tab: TaskWorkspace's generic tasks{} entry describes formal
// verification in the abstract, this component reports what has actually
// run, with real numbers.
// Snapshot as of 2026-08-30 — refresh after the next block's proof lands
// (see samples/sample_test_4/RESULTS.md's "Phase 6" section for evidence).

const provenBlocks = [
  ['skid_buffer.sv', 'formal/skid_buffer.sby', 'PASS — k-induction (unbounded)', 'MUT_SKID_READY · MUT_SKID_BYPASS · MUT_SKID_DRAIN'],
  ['cnt_sat.sv', 'formal/cnt_sat.sby', 'PASS — k-induction (unbounded)', 'MUT_CNT_WRAP · MUT_CNT_CLEAR_LOSE'],
  ['dma_sched.sv', 'formal/dma_sched.sby', 'PASS — k-induction (unbounded)', 'MUT_SCHED_STICKYLOCK · MUT_SCHED_EARLYUNLOCK · MUT_SCHED_DBLREADY'],
] as const

const remaining = [
  ['daq_csr.sv', '다음 대상 1순위', 'per-bit W1C — Sample Test 3의 daq_status_sync.sby와 같은 패턴 재사용 가능'],
  ['axil_slave.sv', '다음 대상 2순위', 'AXI4-Lite handshake compliance (단일 outstanding, AW/W 독립 캡처)'],
  ['wr_track.sv', '다음 대상 3순위', 'outstanding-write 카운트가 절대 음수가 되거나 leak되지 않음'],
  ['chan_ctrl.sv (FSM)', '더 어려운 대상', '5-state FSM 전이 — 실제 반복이 필요할 것으로 예상'],
  ['axi_rd_master.sv / axi_wr_master.sv', '더 어려운 대상', 'burst/4KB-split 로직 — chan_ctrl과 마찬가지로 고난도'],
  ['나머지 ~7개 블록', '미정', 'pkt_align, pkt_check, desc_fetch, irq_ctrl, perf_cnt 등'],
] as const

export default function FormalStatus() {
  return <>
    <section className="card"><div className="card-title"><div><small className="kicker">LIVE STATUS · 2026-08-30</small><h2>Sample Test 4 — Phase 6 Formal 진행 상황</h2></div><span className="warning-badge">3/15+ 블록</span></div>
      <p className="rtl-guide-note">Phase 6 범위(PHASE_3_6_PLAN.md): 통합 UVM 환경, 블록별 SymbiYosys formal, 파라미터 스윕 회귀 스크립트, 전체 스택 mutation. 이 중 <b>블록별 formal에서 실제 검증된 시작</b>만 반영합니다 — 통합 UVM 환경은 phase 5의 smoke 통합 테스트 + 블록별 TB/formal이 이미 덮는 범위 대비 비용이 커서 지금은 보류 결정했습니다.</p>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">PROVEN — UNBOUNDED (k-induction)</small><h2>3개 블록, mutation 전부 검출</h2></div></div>
      <div className="data-table"><table><thead><tr><th>블록</th><th>proof 파일</th><th>결과</th><th>mutant (전부 catch)</th></tr></thead><tbody>{provenBlocks.map(([name, file, result, mutants]) => <tr key={name}><td><code>{name}</code></td><td><code>{file}</code></td><td><span className="ok-badge">{result}</span></td><td>{mutants}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note">세 블록 모두 단일 클럭이라 (Sample Test 3의 CDC 블록들과 달리) 별도 induction-helper invariant 없이 첫 시도에서 무한 증명이 닫혔습니다. 뮤턴트는 "증상"이 아니라 그 결함이 깨뜨리는 <b>바로 그 property</b>에서 실패해야 인정됩니다 — 아래 커버리지 갭 사례가 그 기준을 실제로 적용한 결과입니다.</p>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">실제로 찾아 메운 formal 커버리지 갭</small><h2>skid_buffer.sv — 첫 property 세트가 놓친 것</h2></div></div>
      <p className="rtl-guide-note">capacity·no-silent-accept·correct-source-selection·no-silent-drop 4개 property는 골든 RTL에서 통과했지만 <code>MUT_SKID_DRAIN</code>(스큐드 레지스터가 <code>out_advance</code>를 기다리지 않고 즉시 클리어되는 결함)을 놓쳤습니다 — 이 결함이 스큐드 beat을 지우는 시점이, 4개 property가 <code>skid_valid_q</code>를 occupied로 관찰하는 1-cycle-history 체크보다 한 사이클 빨랐기 때문입니다. 다섯 번째 property("skid_valid_q는 out_advance가 발생하는 사이클에만 클리어될 수 있다")를 추가해 정확히 그 지점에서 실패하도록 닫았습니다 — <code>skid_buffer_formal.sv</code> 자체 주석에 전체 서사가 남아있습니다.</p>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">범위 결정: dma_sched.sv는 fairness를 증명하지 않음</small><h2>Safety만 — liveness는 k-induction의 범위 밖</h2></div></div>
      <p className="rtl-guide-note">"계속 요청하는 채널은 언젠가 grant된다"(fairness)는 liveness property라 <code>mode prove</code> k-induction으로는 증명할 수 없습니다. 대신 증명된 것: <code>$countones(ch_ready_o) &lt;= 1</code>(mutual exclusion), lock은 실제로 accept된 eop에서만 풀림, single-beat 패킷도 정확히 처리, sop이 아닌 beat에서는 grant가 나가지 않음(packet-atomicity). <code>NumCh</code>는 <code>-DDAQ_NUM_CH=2</code>로 줄여 state space를 최소화했습니다 — 2채널이 "한 채널이 lock인 동안 다른 채널의 sop가 도착"을 만들어내는 최소 조건이고, 3개 뮤턴트 전부가 정확히 이 시나리오를 공격합니다.</p>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">남은 대상, 우선순위 순</small><h2>~12개 블록 + 통합 UVM(보류)</h2></div></div>
      <div className="data-table"><table><thead><tr><th>대상</th><th>우선순위</th><th>비고</th></tr></thead><tbody>{remaining.map(([name, prio, note]) => <tr key={name}><td><code>{name}</code></td><td>{prio}</td><td>{note}</td></tr>)}</tbody></table></div>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">외부 prim 파일 경로 — OpenLane과 다른 점</small><h2>SymbiYosys는 절대경로를 그대로 받아들임</h2></div></div>
      <p className="rtl-guide-note"><code>.sby</code>의 <code>[files]</code> 섹션은 <code>D:\MyWork\verilog\dbs\opentitan\...</code> 같은 Windows 절대경로를 그대로 받아들입니다 — OpenLane 설정처럼 작업 디렉터리 밖 파일을 거부하고 <code>dir::../../../../../verilog</code> 상대경로 우회가 필요했던 것과 대조적입니다. 다만 <code>read_slang</code>의 <code>-I</code> 플래그를 따옴표로 감싸면 그대로 문자열의 일부로 취급돼 "no such directory"로 실패합니다 — <code>-I</code> 자체를 빼고 <code>prim_assert.sv</code>가 include하는 두 <code>.svh</code> 파일을 <code>[files]</code>에 나란히 나열하는 방식(같은 <code>SYNTHESIS</code> define 아래 dummy no-op 매크로로 라우팅됨)으로 해결했습니다.</p>
    </section>
  </>
}
