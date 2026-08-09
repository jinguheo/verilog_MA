export type SampleTest2Tab = 'overview' | 'design' | 'verification' | 'uvm' | 'implementation' | 'documents'

const tests = [
  ['FIFO-001', 'Reset / clear', 'reset 후 empty, depth=0, rvalid=0을 확인합니다.', 'pass'],
  ['FIFO-002', 'Fill / full', '4개 write 후 full_o와 depth=4를 확인합니다.', 'pass'],
  ['FIFO-003', 'Ordering', 'push한 데이터가 FIFO 순서대로 pop되는지 scoreboard로 확인합니다.', 'pass'],
  ['FIFO-004', 'Drain / empty', 'read마다 depth가 감소하고 마지막 read 후 empty가 되는지 확인합니다.', 'pass'],
  ['FIFO-005', 'Reject paths', 'full 상태에서 push 시도, empty 상태에서 pop 시도를 DUT가 거부하는지 확인합니다.', 'pass'],
] as const

const formalProps = [
  ['depth_o <= 4', '용량 초과(overflow) 없음: depth가 4를 넘는 상태는 도달 불가능합니다.'],
  ['full_o == (depth_o == 4)', 'full 플래그와 depth가 항상 일치합니다.'],
  ['rvalid_o == (depth_o != 0)', 'Pass=0 구성에서 read-valid와 non-empty가 항상 일치합니다.'],
  ['!(full_o && wvalid_i && wready_o)', '가득 찬 상태에서 write가 수락되는 경우가 없습니다.'],
  ['!((depth_o==0) && rvalid_o)', '빈 상태에서 유효한 read 데이터가 나오는 경우가 없습니다.'],
] as const

// 2026-08-08 regression 실측값. checked reads 23건.
const covBins = [
  ['PUSH · empty', '0', '도달 불가 (push 직후 depth는 0이 될 수 없음)'],
  ['PUSH · mid', '16', 'hit'],
  ['PUSH · full', '7', 'hit'],
  ['POP · empty', '4', 'hit'],
  ['POP · mid', '19', 'hit'],
  ['POP · full', '0', '도달 불가 (pop 직후 depth는 4가 될 수 없음)'],
] as const

const verifLayers = [
  ['Smoke (directed)', 'PASS', 'fifo_smoke_seq — push 3회→pop 3회, 하드코딩된 값'],
  ['Directed requirement', 'PASS', 'fifo_fill_drain_seq — push 4회(full)→pop 4회(empty), REQ-FIFO-001~004 전부 PASS'],
  ['Negative / reject path', 'PASS', 'fifo_negative_seq — full 상태 push와 empty 상태 pop 모두 DUT가 거부, reject bin 2/2 hit'],
  ['Randomized traffic', 'PASS', 'fifo_random_seq — 16~24개 아이템, $urandom으로 op/data 무작위화 후 empty까지 drain'],
  ['Functional coverage', 'PASS (도달가능 100%)', 'op×depth 6bin 중 도달 가능 4/4 hit (2bin은 구조적으로 도달 불가)'],
  ['Formal (k-induction)', 'PASS', '안전성 속성 5개, basecase+induction 모두 passed, depth 12'],
  ['Checker sanity (mutation)', 'PASS', 'full_o를 0으로 고정한 뮤턴트 RTL에 동일 하네스 재실행 → UVM_ERROR 16건, formal FAIL + 반례 trace'],
  ['Assertion error', '0건', 'UVM_ERROR 0 · UVM_FATAL 0 · formal assert 위반 0 (골든 RTL 기준)'],
] as const

const verifGaps = [
  ['constraint solver 사용 불가', 'randomize() 대신 $urandom을 씁니다. Verilator의 constraint solver가 외부 SAT/SMT 프로세스와 통신해야 하는데 이 Windows+MinGW 빌드에서 그 핸드셰이크가 실패합니다("Unable to communicate with SAT solver"). 자극 자체는 실제로 무작위지만 SV constraint block이 풀리는 것은 아닙니다.'],
  ['Questa/ModelSim 미실행', 'run_questa.ps1은 준비돼 있지만 상용 IEEE1800.2 시뮬레이터로는 아직 돌리지 않았습니다.'],
  ['DUT 내장 SVA 미연결', 'prim_fifo_assert.svh가 UVM/formal 컴파일 목록에서 빠져 있습니다. 번들된 slang 프론트엔드가 prim_count의 temporal 연산자(|=>, $past, $stable)와 disable iff SVA를 파싱하지 못하는 툴 한계이며, 이 저장소에서 고칠 수 있는 문제가 아닙니다.'],
] as const

// Overview 탭 요약. 숫자는 전부 2026-08-08 실측입니다.
const expSummary = [
  ['UVM regression', '5 요구사항 · 23 checked reads', 'UVM_ERROR 0 · UVM_FATAL 0. smoke + fill/drain + negative + random 4개 시퀀스'],
  ['Functional coverage', '도달 가능 4/4 · reject 2/2', 'op×depth 6bin 중 2bin은 구조적으로 도달 불가'],
  ['Formal', '무한 증명 PASS', 'k-induction basecase+induction 모두 통과, 안전성 속성 5개, depth 12'],
  ['Checker sanity', '뮤턴트 양쪽 모두 검출', 'UVM 16 errors · formal FAIL + 반례 trace'],
] as const

const expFindings = [
  ['formal이 bounded가 아닌 무한 증명', 'basecase와 induction이 모두 닫혀서, 테스트가 우연히 실행한 시나리오가 아니라 도달 가능한 모든 상태에 대해 성립함을 보였습니다. Sample Test 3의 CDC 쪽이 bounded에 그친 것과 대비됩니다.'],
  ['뮤턴트가 정확히 해당 요구사항에서 잡힘', 'full_o를 0으로 고정한 뮤턴트가 REQ-FIFO-002/004/005에서 걸립니다 — 하위 증상으로 우회해 걸리는 것이 아니므로 이 체크들이 vacuous하지 않다는 근거가 됩니다.'],
  ['리포트 버그 하나 수정', '두 개의 1비트 비교 결과를 더한 값이 self-determined 폭으로 잘려, 실제 2/2인 reject bin이 0/2로 출력되고 있었습니다. 체크 로직이 아니라 리포트만의 문제였지만 판단을 왜곡할 수 있는 종류입니다.'],
  ['남은 갭은 전부 툴 제약', 'constraint solver 통신 실패, slang의 temporal 연산자 미지원, 상용 시뮬레이터 부재 — 저장소 수정으로 풀 수 있는 것이 없습니다.'],
] as const

// 2026-08-08 실행 기록. "결과"는 의도한 결과 기준입니다 — 뮤턴트 실험은 FAIL이 나와야 성공입니다.
const expLog = [
  ['EXP-1', 'Smoke ordering', 'fifo_smoke_seq — push 3회 → pop 3회, 하드코딩 값', 'PASS', 'scoreboard reference queue와 pop 순서 완전 일치'],
  ['EXP-2', 'Fill / drain depth', 'fifo_fill_drain_seq — push 4회(full) → pop 4회(empty)', 'PASS', 'depth_o가 매 write/read마다 정확히 증감, depth=4에서 full_o 어서션 (REQ-FIFO-002/004)'],
  ['EXP-3', 'Reject paths', 'fifo_negative_seq — full에서 push 시도, empty에서 pop 시도', 'PASS', 'full에서 wready_o low, empty에서 rvalid_o low, depth 불변. reject bin 2/2 hit (REQ-FIFO-005)'],
  ['EXP-4', 'Randomized traffic', 'fifo_random_seq — 16~24 아이템, $urandom으로 op/data 무작위화', 'PASS', 'shadow depth로 legal op만 생성, 종료 시 empty까지 drain. 누적 23건 checked read'],
  ['EXP-5', 'Functional coverage', 'EXP-1~4 누적 op × depth 버킷 샘플링', 'PASS', 'PUSH.mid=16 PUSH.full=7 POP.empty=4 POP.mid=19 — 도달 가능 4/4'],
  ['EXP-6', 'Formal k-induction', 'prim_fifo_sync.sby, mode prove, depth 12', 'PASS', 'basecase + induction 모두 통과 — 도달 가능한 모든 상태에서 성립 (bounded 아님)'],
  ['EXP-7', 'Mutation — UVM', 'run_verilator_uvm.ps1 -Mutant (full_o를 1\'b0로 고정)', '의도된 FAIL', 'UVM_ERROR 16건: REQ-FIFO-002 ×7, REQ-FIFO-004 ×4, REQ-FIFO-005 ×3, scoreboard data mismatch got=de'],
  ['EXP-8', 'Mutation — formal', 'prim_fifo_sync_MUTANT.sby (동일 속성, 뮤턴트 RTL)', '의도된 FAIL', 'k-induction FAIL + 구체적 반례 trace (trace.vcd / trace_induct.vcd)'],
] as const

const assertionIssues = [
  ['수정됨 · 커버리지 리포트 폭 잘림', '`(a>0)+(b>0)`을 $sformatf 인자로 바로 넘겼는데, 비교 결과는 1비트이고 합도 self-determined 1비트로 평가돼 1\'b1+1\'b1이 1\'b0으로 잘렸습니다. 두 bin 모두 hit인데 "0/2"로 출력되고 있었습니다. int\'() 캐스트로 수정 후 "2/2"로 정상 출력됩니다. 자극이나 체크 로직이 아니라 리포트만의 문제였지만, 커버리지 수치를 그대로 믿으면 안 되는 사례입니다.'],
  ['툴 한계 · DUT 내장 SVA 미연결', 'prim_fifo_sync.sv가 include하는 prim_fifo_assert.svh가 UVM/formal 컴파일 목록에 없습니다. read_slang이 SYNTHESIS를 암묵 정의해 prim_assert.sv가 no-op 더미 매크로로 라우팅되는데, --no-synthesis-define으로 실제 SVA를 켜면 두 경로 모두 실패합니다: YOSYS 매크로 셋은 prim_count의 temporal 연산자(|=>, $past, $stable)에서 "expected \';\'", 표준 SVA 매크로 셋은 disable iff 구문에서 "unsupported SVA feature"와 미지원 $isunknown. 번들된 slang 프론트엔드의 갭이라 이 저장소에서 해결 불가합니다.'],
  ['툴 한계 · covergroup 대체 구현', 'Verilator 5.051은 UVM 컴포넌트(클래스) 안에 선언된 covergroup을 다른 멤버의 데이터 타입으로 참조하지 못합니다("Expecting a data type", 최소 재현으로 확인 — module scope에서는 정상). 동일한 bin 정보를 주는 수동 hit-count 매트릭스로 대체했습니다.'],
] as const

export default function SampleTest2TabDetail({ tab }: { tab: SampleTest2Tab }) {
  if (tab === 'design') return <>
    <section className="card sample-design"><div className="card-title"><div><small className="kicker">MODULE HIERARCHY</small><h2>FIFO 구조와 연결</h2></div><span className="connection">Width=8 · Depth=4</span></div>
      <div className="fifo-tree"><div><b>prim_fifo_sync</b><span>write/read handshake, storage, output path</span><i>top module</i></div><div className="tree-line">└─</div><div><b>prim_fifo_sync_cnt</b><span>read/write pointer, wrap, full/empty, depth</span><i>submodule</i></div><div className="tree-line">└─</div><div><b>prim_util_pkg</b><span>vbits(Depth), pointer/depth width calculation</span><i>package</i></div></div>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">UVM VERIFICATION SEQUENCE</small><h2>실행된 검증 흐름</h2></div><span className="connection">UVM_ERROR 0 · 23 checked reads</span></div><pre className="rtl-code">{`fifo_requirements_test\n  |\n  +-- fifo_smoke_seq       -> push ×3 -> pop ×3 (하드코딩 값)                          PASS\n  +-- fifo_fill_drain_seq  -> push ×4(full) -> pop ×4(empty)   REQ-FIFO-001~004         PASS\n  +-- fifo_negative_seq    -> full에서 push 시도 / empty에서 pop 시도  REQ-FIFO-005     PASS\n  +-- fifo_random_seq      -> 16~24 items, $urandom op/data 무작위화 -> drain to empty  PASS\n        |\n        v\n  fifo_driver  -->  DUT (wvalid/wdata, rready)  -->  fifo_monitor (handshake 관찰)\n        |                                                    |\n        v                                                    v\n  op×depth coverage matrix                     fifo_scoreboard (reference queue 비교)\n  4/4 reachable bins hit                        23 reads 전부 순서·데이터 일치\n\n  checker sanity: full_o를 0으로 고정한 mutant RTL에 동일 시퀀스 재실행 -> UVM_ERROR 16건`}</pre><p className="rtl-guide-note">Verilator(<code>--timing</code>)로 실제 실행: <code>UVM_ERROR: 0</code>, <code>UVM_FATAL: 0</code>, <code>[FIFO_SB] UVM FIFO PASS: 23 checked reads</code>. 뮤턴트 재실행으로 이 체크들이 vacuous하지 않음을 확인했습니다 — 상세는 UVM Plan 탭.</p></section>
    <section className="card"><div className="card-title"><div><small className="kicker">PORT CONTRACT</small><h2>Top module ports</h2></div></div><div className="check-list"><p><b>Write side</b><span>wvalid_i, wready_o, wdata_i</span></p><p><b>Read side</b><span>rvalid_o, rready_i, rdata_o</span></p><p><b>Control</b><span>clk_i, rst_ni, clr_i</span></p><p><b>Status</b><span>full_o, depth_o, err_o</span></p></div></section>
    <section className="card"><div className="card-title"><div><small className="kicker">BLOCK &amp; PORT DIAGRAM</small><h2>Top / submodule / package 연결</h2></div><span className="connection">3 design units · Width=8 · Depth=4</span></div><pre className="rtl-code">{`                      +--------------------- prim_fifo_sync (top) ---------------------+\n  clk_i,rst_ni ------>|                                                                 |\n  clr_i        ------>|  storage[Depth-1:0][Width-1:0]  +  output path (Pass=0)         |\n  wvalid_i     ------>|                                                                 |\n  wdata_i[7:0] ------>|            +----------------------------------+                 |\n                      |            |  prim_fifo_sync_cnt (submodule)  |                 |\n  wready_o    <-------|            |  wptr/rptr, wrap, full/empty     |------> full_o\n  rvalid_o    <-------|            |  depth_o = wptr - rptr           |------> depth_o\n  rdata_o[7:0]<-------|            |  uses: DepthW = prim_util_pkg    |------> err_o\n  rready_i     ------>|            |         ::vbits(Depth+1)         |                 |\n                      |            +----------------------------------+                 |\n                      +-----------------------------------------------------------------+`}</pre><p className="rtl-guide-note">top이 storage와 출력 경로를 갖고, submodule은 포인터·wrap·상태 신호만 계산합니다 — 데이터는 submodule을 거치지 않습니다. <code>DepthW</code>(포인터/뎁스 비트폭)는 package 함수 <code>vbits()</code>로 top과 submodule이 공유합니다.</p></section>
  </>

  if (tab === 'verification') return <>
    <section className="card"><div className="card-title"><div><small className="kicker">TEST BREAKDOWN</small><h2>테스트별 검증 항목</h2></div><span className="connection">PASS · Verilator (2026-08-08)</span></div><div className="run-list">{tests.map(([id, title, detail, status]) => <article className="run-item" key={id}><button type="button"><i>✓</i><div><b>{id} · {title}</b><span>{detail}</span></div><em className="ready">{status.toUpperCase()}</em></button></article>)}</div><p className="rtl-guide-note">번들된 Verilator(<code>--timing</code>)로 <code>fifo_requirements_test</code>를 실행: <code>UVM_ERROR: 0</code>, <code>UVM_FATAL: 0</code>, <code>[FIFO_SB] UVM FIFO PASS: 23 checked reads</code>. 상용 IEEE 1800.2 시뮬레이터(Questa/ModelSim)로는 아직 실행하지 않았습니다 — <code>run_questa.ps1</code>은 준비되어 있습니다.</p></section>
    <section className="card"><div className="card-title"><div><small className="kicker">VERIFICATION LAYERS</small><h2>계층별 검증 현황</h2></div><span className="connection">2026-08-08 실측</span></div><div className="data-table"><table><thead><tr><th>계층</th><th>결과</th><th>근거</th></tr></thead><tbody>{verifLayers.map(([layer, result, evidence]) => <tr key={layer}><td><b>{layer}</b></td><td>{result}</td><td>{evidence}</td></tr>)}</tbody></table></div></section>
    <section className="card"><div className="card-title"><div><small className="kicker">CHECKER SANITY — MUTATION</small><h2>체크가 실제로 실패할 수 있는가</h2></div><span className="connection">뮤턴트 RTL: UVM 16 errors · formal FAIL</span></div><div className="check-list"><p><b>골든 RTL</b><span>UVM_ERROR 0 · formal <code>prove</code> basecase+induction PASS</span></p><p><b>뮤턴트 RTL (<code>full_o</code>를 1&apos;b0로 고정)</b><span>동일 하네스를 그대로 재실행 → UVM_ERROR 16건 (REQ-FIFO-002 ×7, REQ-FIFO-004 ×4, REQ-FIFO-005 ×3, scoreboard <code>data mismatch got=de</code>), formal은 반례 trace와 함께 FAIL</span></p><p><b>왜 중요한가</b><span>뮤턴트가 망가뜨린 바로 그 요구사항(full 플래그 / overflow)에서 잡히므로, 이 체크들이 항상 통과하는 vacuous한 체크가 아님을 보여줍니다.</span></p></div><p className="rtl-guide-note">재현: <code>run_verilator_uvm.ps1 -Mutant</code>, <code>formal\prim_fifo_sync_MUTANT.sby</code>.</p></section>
    <section className="card"><div className="card-title"><div><small className="kicker">KNOWN GAPS</small><h2>남아 있는 한계</h2></div><span className="connection">{verifGaps.length}건</span></div><div className="check-list">{verifGaps.map(([name, detail]) => <p key={name}><b>{name}</b><span>{detail}</span></p>)}</div></section>
    <section className="card"><div className="card-title"><div><small className="kicker">FORMAL VERIFICATION — REQ-FIFO-006</small><h2>SymbiYosys k-induction 증명</h2></div><span className="connection">PASS · depth 12</span></div><div className="check-list">{formalProps.map(([prop, detail]) => <p key={prop}><b><code>{prop}</code></b><span>{detail}</span></p>)}</div><p className="rtl-guide-note">basecase와 induction 모두 <code>passed</code> — 도달 가능한 모든 상태에 대해 성립함을 증명했습니다(테스트가 우연히 실행한 시나리오만이 아님). <code>formal/prim_fifo_sync.sby</code>, 실행: <code>sby_windows.cmd -f formal\prim_fifo_sync.sby</code>.</p></section>
    <section className="card"><div className="card-title"><div><small className="kicker">FUNCTIONAL COVERAGE</small><h2>op × depth 버킷 커버리지</h2></div><span className="connection">4/4 reachable bins</span></div><div className="data-table"><table><thead><tr><th>Bin</th><th>Hits</th><th>비고</th></tr></thead><tbody>{covBins.map(([bin, hits, note]) => <tr key={bin}><td><b>{bin}</b></td><td>{hits}</td><td>{note}</td></tr>)}</tbody></table></div><p className="rtl-guide-note">Verilator 5.051은 UVM 컴포넌트(클래스) 안의 <code>covergroup</code>을 데이터 타입으로 참조하지 못해(최소 재현으로 확인, module scope에서는 정상) 수동 hit-count 매트릭스로 대체했습니다. <code>PUSH·empty</code>/<code>POP·full</code>은 depth-after 방식 버킷팅에서 구조적으로 도달 불가능한 셀이라 실제 갭이 아닙니다. "가득 찬 상태에서 push 시도"/"빈 상태에서 pop 시도"는 <code>fifo_negative_seq</code>로 채워져 reject bin 2/2가 hit됩니다.</p></section>
  </>

  if (tab === 'uvm') return <>
    <section className="card"><div className="card-title"><div><small className="kicker">EXPERIMENT LOG · 2026-08-08</small><h2>실험별 실행 결과</h2></div><span className="connection">8 experiments · 전부 의도한 결과</span></div><div className="data-table"><table><thead><tr><th>ID</th><th>실험</th><th>자극 / 설정</th><th>결과</th><th>근거</th></tr></thead><tbody>{expLog.map(([id, name, setup, result, evidence]) => <tr key={id}><td><b>{id}</b></td><td><b>{name}</b></td><td>{setup}</td><td>{result === 'PASS' ? <span className="ok-badge">PASS</span> : <span className="warning-badge">{result}</span>}</td><td>{evidence}</td></tr>)}</tbody></table></div><p className="rtl-guide-note">EXP-7/8은 <b>실패해야 성공인 실험</b>입니다. 골든 RTL에서 통과하는 체크가 고장난 RTL에서도 통과하면 그 체크는 아무것도 검증하지 않는 것이므로, 뮤턴트를 넣고 같은 하네스를 그대로 재실행해 정확히 그 요구사항에서 깨지는지를 확인합니다.</p></section>
    <section className="card"><div className="card-title"><div><small className="kicker">ASSERTION &amp; TOOLING ISSUES</small><h2>검증 중 발견한 문제와 처리</h2></div><span className="connection">1 fixed · 2 tool limits</span></div><div className="check-list">{assertionIssues.map(([title, detail]) => <p key={title}><b>{title}</b><span>{detail}</span></p>)}</div></section>
    <section className="card"><div className="card-title"><div><small className="kicker">FORMAL SUMMARY</small><h2>formal 증명 범위와 강도</h2></div><span className="connection">unbounded PASS</span></div><div className="data-table"><table><thead><tr><th>항목</th><th>내용</th></tr></thead><tbody><tr><td><b>모드</b></td><td><code>mode prove</code>, depth 12 — basecase와 induction 모두 통과했으므로 <b>bounded가 아닌 무한 증명</b>입니다. (Sample Test 3의 formal은 bounded에 그친 것과 대비됩니다.)</td></tr><tr><td><b>속성 수</b></td><td>5개 — overflow 없음, full/depth 일치, rvalid/non-empty 일치, full 상태 write 미수락, empty 상태 read-valid 없음</td></tr><tr><td><b>reset 앵커</b></td><td>trace 시작 시 실제 reset을 강제하는 <code>cyc</code> 카운터 — induction basecase가 임의의 out-of-range 초기값이 아니라 known-good 상태에서 출발하도록 합니다.</td></tr><tr><td><b>비-vacuity 근거</b></td><td>EXP-8 — 동일 속성이 뮤턴트 RTL에서 반례와 함께 FAIL</td></tr></tbody></table></div></section>
    <section className="card"><div className="card-title"><div><small className="kicker">UVM VERIFICATION PLAN</small><h2>구현된 테스트 구성</h2></div><span className="connection">PASS · Verilator --timing</span></div><div className="uvm-stack"><b>fifo_smoke_test</b><span>push 3회 → pop 3회: 기본 FIFO 순서 검증</span><b>fifo_requirements_test</b><span>smoke + fill/drain + negative + random 4개 시퀀스로 요구사항 검증 — PASS</span><b>fifo_negative_seq</b><span>full 상태 push 시도와 empty 상태 pop 시도: DUT가 거부하면 성공, 수락하면 REQ-FIFO-005 error</span><b>fifo_random_seq</b><span>16~24개 아이템의 op/data를 <code>$urandom</code>으로 무작위화 (constraint solver 사용 불가로 <code>randomize()</code> 미사용)</span><b>fifo_driver</b><span>reset, push, pop 동작과 depth/full 상태를 검사, op×depth 커버리지 매트릭스 수집</span><b>fifo_scoreboard</b><span>reference queue로 데이터 순서와 잔여 항목을 비교 — 23건 read 전부 일치</span><b>fifo_monitor</b><span>write/read handshake 횟수를 관찰</span></div><p className="rtl-guide-note"><b>실행 완료(2026-08-02):</b> <code>run_verilator_uvm.ps1</code>이 <code>Vprim_fifo_sync_uvm_tb.exe</code>를 빌드/실행해 <code>UVM_ERROR: 0</code>, <code>UVM_FATAL: 0</code>로 통과했습니다. 이 환경 특유의 Windows 툴체인 문제 3가지를 스크립트에서 고쳤습니다: (1) <code>oss-cad-suite</code>에 GNU Make가 없어 PATH가 무관한 레거시 <code>System32\make.exe</code>를 잡던 문제, (2) 설치된 g++ 16.1.0이 <code>-Os</code> 최적화에서만 <code>std::string</code> move 생성자 링크에 실패하던 버그(<code>-O2</code>로 강제), (3) <code>oss-cad-suite\lib</code>의 구버전 런타임 DLL이 실제 빌드에 쓰인 mingw64 DLL을 가려 실행 시 <code>STATUS_ENTRYPOINT_NOT_FOUND</code>로 죽던 문제. 자세한 실험 기록은 <code>docs/session_notes/2026-08-02.md</code>.</p></section>
    <section className="card"><div className="card-title"><div><small className="kicker">OPEN ISSUES</small><h2>미해결 항목</h2></div><span className="warning-badge">{verifGaps.length} OPEN</span></div><div className="check-list">{verifGaps.map(([name, detail]) => <p key={name}><b>{name}</b><span>{detail}</span></p>)}</div><p className="rtl-guide-note">세 항목 모두 이번 검증에서 <b>통과했다고 표시하지 않았습니다</b>. constraint solver와 DUT 내장 SVA는 이 환경의 툴 갭이라 저장소 수정으로 풀 수 없고, Questa 실행은 상용 시뮬레이터 확보가 선행돼야 합니다. 전체 근거는 <code>samples/sample_test_2/RESULTS.md</code>.</p></section>
  </>

  if (tab === 'implementation') return <section className="detail-split"><section className="card"><div className="card-title"><div><small className="kicker">ELABORATION</small><h2>구조 검증</h2></div><span className="connection">PASS</span></div><div className="check-list"><p><b>Target</b><span>prim_fifo_sync + prim_fifo_sync_cnt + prim_util_pkg</span></p><p><b>Parameters</b><span>Width=8, Depth=4, Pass=0, Secure=0</span></p><p><b>결과</b><span>Verilator hierarchy elaboration + UVM regression 통과 (exit code 0)</span></p></div></section><section className="card"><div className="card-title"><div><small className="kicker">PHYSICAL SIGNOFF</small><h2>Layout / P&amp;R 상태</h2></div><span className="warning-badge">BLOCKED</span></div><div className="check-list"><p><b>미실행 항목</b><span>STA, floorplan, placement, CTS, routing, DRC/LVS</span></p><p><b>차단 요인</b><span>Target PDK, standard-cell library, timing constraints가 없습니다.</span></p><p><b>Required input</b><span>공정/PDK와 SDC constraints를 결정한 뒤 OpenLane/OpenROAD flow를 연결합니다.</span></p></div></section></section>

  if (tab === 'documents') return <section className="card"><div className="card-title"><div><small className="kicker">ARTIFACT LIBRARY</small><h2>준비된 UVM / formal 파일</h2></div><span className="connection">7 files</span></div><div className="sample-list"><div><b>prim_fifo_sync_if.sv</b><span>FIFO DUT 신호를 묶는 virtual interface</span></div><div><b>prim_fifo_sync_uvm_pkg.sv</b><span>sequence, driver(+커버리지), monitor, scoreboard, test classes</span></div><div><b>prim_fifo_sync_uvm_tb.sv</b><span>DUT 인스턴스와 UVM testbench top</span></div><div><b>run_verilator_uvm.ps1</b><span>번들 OSS CAD Suite 기반 UVM lint / build / regression 실행 — PASS 확인됨</span></div><div><b>run_questa.ps1</b><span>Questa/ModelSim 컴파일 및 batch simulation 실행 스크립트</span></div><div><b>formal/prim_fifo_sync_formal.sv</b><span>REQ-FIFO-006 안전성 속성 5개 + reset 앵커</span></div><div><b>formal/prim_fifo_sync.sby</b><span>SymbiYosys k-induction 설정 — PASS 확인됨</span></div></div><p className="rtl-guide-note">작업 파일 위치: <code>samples/sample_test_2/uvm</code>, <code>samples/sample_test_2/formal</code>. 실험 전체 기록: <code>docs/session_notes/2026-08-02.md</code>.</p></section>

  return <>
    <section className="card"><div className="card-title"><div><small className="kicker">EXPERIMENT SUMMARY · 2026-08-08</small><h2>실험 결과 요약</h2></div><span className="connection">8 experiments</span></div><div className="data-table"><table><thead><tr><th>영역</th><th>결과</th><th>근거</th></tr></thead><tbody>{expSummary.map(([area, result, detail]) => <tr key={area}><td><b>{area}</b></td><td><span className="ok-badge">{result}</span></td><td>{detail}</td></tr>)}</tbody></table></div><div className="check-list">{expFindings.map(([t, d]) => <p key={t}><b>{t}</b><span>{d}</span></p>)}</div><p className="rtl-guide-note">실험별 상세는 <b>UVM Plan</b> 탭, 계층별 현황과 커버리지는 <b>Verification</b> 탭에 있습니다. 전체 근거: <code>samples/sample_test_2/RESULTS.md</code>.</p></section>
    <section className="card"><div className="card-title"><div><small className="kicker">OVERVIEW</small><h2>테스트 실행 상태</h2></div><span className="connection">5/5 REQ PASS · Formal PASS</span></div><div className="decision-grid"><div><b>설계 범위</b><p>top, counter submodule, utility package까지 포함한 계층형 FIFO입니다. DUT는 OpenTitan 기성 코드라 새로 작성한 RTL은 없습니다.</p></div><div><b>테스트 구성</b><p>reset, fill/full, ordering, drain/empty, reject path의 5개 요구사항 테스트 + 랜덤 시퀀스 + REQ-FIFO-006 formal 안전성 증명.</p></div><div><b>남은 항목</b><p>constraint solver 사용 불가(<code>randomize()</code> 대신 <code>$urandom</code>), DUT 내장 SVA 미연결(slang 파싱 한계), 상용 Questa/ModelSim 미실행. 셋 다 이 환경의 툴 제약입니다.</p></div></div></section>
  </>
}
