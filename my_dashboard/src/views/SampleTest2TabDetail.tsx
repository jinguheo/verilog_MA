export type SampleTest2Tab = 'overview' | 'design' | 'verification' | 'uvm' | 'implementation' | 'documents'

const tests = [
  ['FIFO-001', 'Reset / clear', 'reset 후 empty, depth=0, rvalid=0을 확인합니다.', 'pass'],
  ['FIFO-002', 'Fill / full', '4개 write 후 full_o와 depth=4를 확인합니다.', 'pass'],
  ['FIFO-003', 'Ordering', 'push한 데이터가 FIFO 순서대로 pop되는지 scoreboard로 확인합니다.', 'pass'],
  ['FIFO-004', 'Drain / empty', 'read마다 depth가 감소하고 마지막 read 후 empty가 되는지 확인합니다.', 'pass'],
] as const

const formalProps = [
  ['depth_o <= 4', '용량 초과(overflow) 없음: depth가 4를 넘는 상태는 도달 불가능합니다.'],
  ['full_o == (depth_o == 4)', 'full 플래그와 depth가 항상 일치합니다.'],
  ['rvalid_o == (depth_o != 0)', 'Pass=0 구성에서 read-valid와 non-empty가 항상 일치합니다.'],
  ['!(full_o && wvalid_i && wready_o)', '가득 찬 상태에서 write가 수락되는 경우가 없습니다.'],
  ['!((depth_o==0) && rvalid_o)', '빈 상태에서 유효한 read 데이터가 나오는 경우가 없습니다.'],
] as const

const covBins = [
  ['PUSH · empty', '0', '도달 불가 (push 직후 depth는 0이 될 수 없음)'],
  ['PUSH · mid', '6', 'hit'],
  ['PUSH · full', '1', 'hit'],
  ['POP · empty', '2', 'hit'],
  ['POP · mid', '5', 'hit'],
  ['POP · full', '0', '도달 불가 (pop 직후 depth는 4가 될 수 없음)'],
] as const

export default function SampleTest2TabDetail({ tab }: { tab: SampleTest2Tab }) {
  if (tab === 'design') return <>
    <section className="card sample-design"><div className="card-title"><div><small className="kicker">MODULE HIERARCHY</small><h2>FIFO 구조와 연결</h2></div><span className="connection">Width=8 · Depth=4</span></div>
      <div className="fifo-tree"><div><b>prim_fifo_sync</b><span>write/read handshake, storage, output path</span><i>top module</i></div><div className="tree-line">└─</div><div><b>prim_fifo_sync_cnt</b><span>read/write pointer, wrap, full/empty, depth</span><i>submodule</i></div><div className="tree-line">└─</div><div><b>prim_util_pkg</b><span>vbits(Depth), pointer/depth width calculation</span><i>package</i></div></div>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">PORT CONTRACT</small><h2>Top module ports</h2></div></div><div className="check-list"><p><b>Write side</b><span>wvalid_i, wready_o, wdata_i</span></p><p><b>Read side</b><span>rvalid_o, rready_i, rdata_o</span></p><p><b>Control</b><span>clk_i, rst_ni, clr_i</span></p><p><b>Status</b><span>full_o, depth_o, err_o</span></p></div></section>
  </>

  if (tab === 'verification') return <>
    <section className="card"><div className="card-title"><div><small className="kicker">TEST BREAKDOWN</small><h2>테스트별 검증 항목</h2></div><span className="connection">PASS · Verilator (2026-08-02)</span></div><div className="run-list">{tests.map(([id, title, detail, status]) => <article className="run-item" key={id}><button type="button"><i>✓</i><div><b>{id} · {title}</b><span>{detail}</span></div><em className="ready">{status.toUpperCase()}</em></button></article>)}</div><p className="rtl-guide-note">번들된 Verilator(<code>--timing</code>)로 <code>fifo_requirements_test</code>를 실행: <code>UVM_ERROR: 0</code>, <code>UVM_FATAL: 0</code>, <code>[FIFO_SB] UVM FIFO PASS: 7 checked reads</code>. 상용 IEEE 1800.2 시뮬레이터(Questa/ModelSim)로는 아직 실행하지 않았습니다 — <code>run_questa.ps1</code>은 준비되어 있습니다.</p></section>
    <section className="card"><div className="card-title"><div><small className="kicker">FORMAL VERIFICATION — REQ-FIFO-006</small><h2>SymbiYosys k-induction 증명</h2></div><span className="connection">PASS · depth 12</span></div><div className="check-list">{formalProps.map(([prop, detail]) => <p key={prop}><b><code>{prop}</code></b><span>{detail}</span></p>)}</div><p className="rtl-guide-note">basecase와 induction 모두 <code>passed</code> — 도달 가능한 모든 상태에 대해 성립함을 증명했습니다(테스트가 우연히 실행한 시나리오만이 아님). <code>formal/prim_fifo_sync.sby</code>, 실행: <code>sby_windows.cmd -f formal\prim_fifo_sync.sby</code>.</p></section>
    <section className="card"><div className="card-title"><div><small className="kicker">FUNCTIONAL COVERAGE</small><h2>op × depth 버킷 커버리지</h2></div><span className="connection">4/4 reachable bins</span></div><div className="data-table"><table><thead><tr><th>Bin</th><th>Hits</th><th>비고</th></tr></thead><tbody>{covBins.map(([bin, hits, note]) => <tr key={bin}><td><b>{bin}</b></td><td>{hits}</td><td>{note}</td></tr>)}</tbody></table></div><p className="rtl-guide-note">Verilator 5.051은 UVM 컴포넌트(클래스) 안의 <code>covergroup</code>을 데이터 타입으로 참조하지 못해(최소 재현으로 확인, module scope에서는 정상) 수동 hit-count 매트릭스로 대체했습니다. <code>PUSH·empty</code>/<code>POP·full</code>은 depth-after 방식 버킷팅에서 구조적으로 도달 불가능한 셀이라 실제 갭이 아닙니다 — 진짜 남은 갭은 "가득 찬 상태에서 push 시도"/"빈 상태에서 pop 시도"에 대한 negative 시퀀스 부재입니다.</p></section>
  </>

  if (tab === 'uvm') return <section className="card"><div className="card-title"><div><small className="kicker">UVM VERIFICATION PLAN</small><h2>구현된 테스트 구성</h2></div><span className="connection">PASS · Verilator --timing</span></div><div className="uvm-stack"><b>fifo_smoke_test</b><span>push 3회 → pop 3회: 기본 FIFO 순서 검증</span><b>fifo_requirements_test</b><span>smoke sequence + fill/drain sequence로 요구사항 검증 — PASS</span><b>fifo_driver</b><span>reset, push, pop 동작과 depth/full 상태를 검사, op×depth 커버리지 매트릭스 수집</span><b>fifo_scoreboard</b><span>reference queue로 데이터 순서와 잔여 항목을 비교 — 7건 read 전부 일치</span><b>fifo_monitor</b><span>write/read handshake 횟수를 관찰</span></div><p className="rtl-guide-note"><b>실행 완료(2026-08-02):</b> <code>run_verilator_uvm.ps1</code>이 <code>Vprim_fifo_sync_uvm_tb.exe</code>를 빌드/실행해 <code>UVM_ERROR: 0</code>, <code>UVM_FATAL: 0</code>로 통과했습니다. 이 환경 특유의 Windows 툴체인 문제 3가지를 스크립트에서 고쳤습니다: (1) <code>oss-cad-suite</code>에 GNU Make가 없어 PATH가 무관한 레거시 <code>System32\make.exe</code>를 잡던 문제, (2) 설치된 g++ 16.1.0이 <code>-Os</code> 최적화에서만 <code>std::string</code> move 생성자 링크에 실패하던 버그(<code>-O2</code>로 강제), (3) <code>oss-cad-suite\lib</code>의 구버전 런타임 DLL이 실제 빌드에 쓰인 mingw64 DLL을 가려 실행 시 <code>STATUS_ENTRYPOINT_NOT_FOUND</code>로 죽던 문제. 자세한 실험 기록은 <code>docs/session_notes/2026-08-02.md</code>.</p></section>

  if (tab === 'implementation') return <section className="detail-split"><section className="card"><div className="card-title"><div><small className="kicker">ELABORATION</small><h2>구조 검증</h2></div><span className="connection">PASS</span></div><div className="check-list"><p><b>Target</b><span>prim_fifo_sync + prim_fifo_sync_cnt + prim_util_pkg</span></p><p><b>Parameters</b><span>Width=8, Depth=4, Pass=0, Secure=0</span></p><p><b>결과</b><span>Verilator hierarchy elaboration + UVM regression 통과 (exit code 0)</span></p></div></section><section className="card"><div className="card-title"><div><small className="kicker">PHYSICAL SIGNOFF</small><h2>Layout / P&amp;R 상태</h2></div><span className="warning-badge">BLOCKED</span></div><div className="check-list"><p><b>미실행 항목</b><span>STA, floorplan, placement, CTS, routing, DRC/LVS</span></p><p><b>차단 요인</b><span>Target PDK, standard-cell library, timing constraints가 없습니다.</span></p><p><b>Required input</b><span>공정/PDK와 SDC constraints를 결정한 뒤 OpenLane/OpenROAD flow를 연결합니다.</span></p></div></section></section>

  if (tab === 'documents') return <section className="card"><div className="card-title"><div><small className="kicker">ARTIFACT LIBRARY</small><h2>준비된 UVM / formal 파일</h2></div><span className="connection">7 files</span></div><div className="sample-list"><div><b>prim_fifo_sync_if.sv</b><span>FIFO DUT 신호를 묶는 virtual interface</span></div><div><b>prim_fifo_sync_uvm_pkg.sv</b><span>sequence, driver(+커버리지), monitor, scoreboard, test classes</span></div><div><b>prim_fifo_sync_uvm_tb.sv</b><span>DUT 인스턴스와 UVM testbench top</span></div><div><b>run_verilator_uvm.ps1</b><span>번들 OSS CAD Suite 기반 UVM lint / build / regression 실행 — PASS 확인됨</span></div><div><b>run_questa.ps1</b><span>Questa/ModelSim 컴파일 및 batch simulation 실행 스크립트</span></div><div><b>formal/prim_fifo_sync_formal.sv</b><span>REQ-FIFO-006 안전성 속성 5개 + reset 앵커</span></div><div><b>formal/prim_fifo_sync.sby</b><span>SymbiYosys k-induction 설정 — PASS 확인됨</span></div></div><p className="rtl-guide-note">작업 파일 위치: <code>samples/sample_test_2/uvm</code>, <code>samples/sample_test_2/formal</code>. 실험 전체 기록: <code>docs/session_notes/2026-08-02.md</code>.</p></section>

  return <section className="card"><div className="card-title"><div><small className="kicker">OVERVIEW</small><h2>테스트 실행 상태</h2></div><span className="connection">4/4 REQ PASS · Formal PASS</span></div><div className="decision-grid"><div><b>설계 범위</b><p>top, counter submodule, utility package까지 포함한 계층형 FIFO입니다.</p></div><div><b>테스트 구성</b><p>reset, fill/full, ordering, drain/empty의 4개 요구사항 테스트 + REQ-FIFO-006 formal 안전성 증명을 완료했습니다.</p></div><div><b>실행 결과 (2026-08-02)</b><p>번들 Verilator UVM regression PASS(<code>UVM_ERROR: 0</code>), SymbiYosys formal PASS, 커버리지 4/4(도달 가능 bin 기준). 상용 Questa/ModelSim 실행은 아직 남아 있습니다.</p></div></div></section>
}
