// P&R 연구 탭 — "현재(flat) 방식 vs hierarchical(macro) 방식"을 나란히 비교하고,
// 후보군을 최대한 병렬로 많이 돌리면서 가능성 없는 것들을 빠르게 버리는 깔때기
// (funnel) 탐색 구조를 설계한다. 이 탭은 실행 결과가 아니라 설계 문서 — 각 단계가
// "검증됨"인지 "제안됨"인지를 명시한다. 2026-09-18 작성.

const approaches = [
  ['현재 (Flat)', 'daq_subsystem 8채널 전체를 매번 통째로 재합성·재배치·재라우팅', '단순함, 전역 최적화 가능(매크로 경계에 갇히지 않음)', '셀 수 증가에 비선형으로 시간 증가 실측(chan_ctrl→chan_top 약 22배 셀에 22배보다 훨씬 큰 시간) · 4번째 시도까지 한 번도 완주 못 함(세션/호스트 종료로 중단, 실제 flow 에러 아님) · 위반이 있으면 원인 위치를 8채널 전체에서 다시 찾아야 함'],
  ['Hierarchical (Macro)', 'chan_top을 1번만 hardening → GDS/LEF/LIB/SPEF 확보 → daq_subsystem에서 OpenLane MACROS로 8번 배치, 나머지 로직(dma_sched 등)만 top에서 새로 P&R', '1회 P&R + 8회 저렴한 매크로 배치로 시간 절감 예상 · 각 채널 타이밍이 독립적으로 확정(전체 재검증 불필요) · chan_top 자체가 이미 검증된 블록이라 위반 원인 추적 범위가 좁아짐', '매크로 경계를 넘는 경로는 수동 IO 타이밍 budget 필요(daq_subsystem.sdc에 이미 일부 작성됨) · chan_top이 먼저 worst-corner까지 닫혀야 의미 있음(안 닫힌 블록 8배 복제는 위반만 8배) · 매크로 배치(어디에 8개를 놓을지) 자체가 별도 최적화 문제 — OpenROAD 내장 배치기보다 ParSAC(SA 기반) 같은 전용 floorplanner가 더 잘 풀 가능성'],
] as const

const funnelStages = [
  ['0. 후보 생성', '설계 공간을 명시적으로 나열', 'Flat: SYNTH_STRATEGY(9) × PL_TARGET_DENSITY_PCT(예: 30/40/50) × clock period 후보 — 최대 수십~백 개 조합.  Hierarchical: 매크로 배치 후보(ParSAC SA restart마다 다른 배치) × 채널당 SYNTH_STRATEGY', '제안됨 — 조합 명시만 하면 나머지 단계는 이미 만든 스크립트 재사용', '해당 없음 (생성 단계, EDA 실행 없음)'],
  ['1. 초저가 필터', '어떤 EDA 툴도 완주 없이, 초~분 단위로 전량 실행', 'Flat: openlane --flow SynthesisExploration (합성+STAPrePNR만, wire delay 없음) — 9개 전략을 병렬 스레드풀로 한 번에.  Hierarchical: ParSAC의 ParallelSearch가 이미 N개 SA worker를 병렬로 돌려 비용(wirelength+whitespace)이 낮은 배치만 남김 — OpenLane/OpenROAD 자체를 아예 안 씀', '검증됨(Flat) — 107_synth_explore.sh로 chan_ctrl/cnt_sat/skid_buffer 9개 전략을 25~30초에 비교 완료.  미착수(Hierarchical) — ParSAC 설치·글루코드 필요', 'pre-placement worst slack이 목표 기준 대비 음수로 크게 벌어짐 + area가 현재 최선 후보보다 나쁨 → 즉시 버림'],
  ['2. 재시간측정 필터', '기존에 이미 라우팅된 참조 넷리스트의 실제 DEF+SPEF를 그대로 읽고, 후보 SDC(주기 등)만 바꿔서 초 단위로 재계산 — 새 P&R 없음', 'chan_top.sdc를 그대로 source하되 src_period/axi_period 두 줄만 sed로 바꿔서 OpenSTA만 재실행 — 이번 세션에 axi 32→48ns/src 10→12ns가 실제로 plateau 없이 선형 개선됨을 이 방법으로 확인함', '검증됨 — 같은 netlist를 다른 목표로 재검사하는 것의 함정(6/10-targeted netlist를 32/10 기준으로 착각)도 이번에 직접 겪고 고침. 반드시 "이 재검사가 어떤 target으로 P&R된 netlist인지" 먼저 확인하고 씀', '같은 계열(같은 구조, 주기/코너만 다름) 후보에서 TNS>0 또는 목표 slack 미달 → 버림. 구조가 다른 새 후보(다른 전략/매크로 배치)는 이 단계를 건너뛰고 3단계에서 최소 1개는 반드시 검증'],
  ['3. 전체 P&R', '진짜 synthesis+floorplan+placement+CTS+routing+DRC/LVS+signoff STA — 살아남은 후보만, 비용이 가장 큼(블록당 25~40분)', '109_run_full_pnr.sh / 111_run_chan_top_safe.sh 같은 race-safe(블록별 독립 shim) 러너로 실행', '검증됨 — chan_ctrl/cnt_sat SYNTH_STRATEGY 재검증에 이미 사용, 결과가 pre-placement 예측과 실제로 다를 수 있음도 확인(면적 방향 반전 등) → 이 단계 없이 "최종"이라고 부르면 안 됨', '해당 없음 (최종 후보만 여기 도달 — 버리는 단계가 아니라 확정하는 단계)'],
  ['4. Flat vs Hierarchical 맞대결', '3단계를 통과한 두 트랙의 최선 후보를 실제 signoff 수치로 직접 비교', '면적/최악 slack/TNS + (아직 실측 없는) power', '미착수 — hierarchical 트랙이 아직 1단계도 안 감', '해당 없음'],
] as const

const concurrency = [
  ['1~2단계 (저가)', '거의 무제한 — 8코어 기준 8~16개 동시 실행 가능', '각 작업이 짧고 단일 스레드(OpenSTA 1회 실행) 또는 순수 CPU SA라서 서로 거의 경합 안 함'],
  ['3단계 (전체 P&R)', '2~3개 동시가 한계로 보임 — 정확한 N은 아직 실측 안 함', 'SynthesisExploration 3개 동시 실행 실측: 8코어에서 1.43배 속도 향상(3배 아님) — 각 OpenLane 프로세스가 이미 내부적으로 스레드풀을 쓰기 때문에 외부에서 더 겹쳐도 같은 코어를 두고 경합함. 전체 P&R은 SynthesisExploration보다 무거우므로 3개 동시는 더 나쁠 가능성 — N=1,2,3 각각 실측 후 결정 필요(제안, 미실측)'],
] as const

const races = [
  ['공유 shim 경로 재사용 금지', '$HOME/.cache/openlane-tools/bin을 여러 후보가 동시에 rm -rf + 재생성하면 서로의 심볼릭 링크를 지움 — 이미 2번 실제로 겪은 버그', '후보(블록)별 독립 경로($HOME/.cache/openlane-tools-<후보명>/bin) + 이미 있으면 재생성 안 함(idempotent) — 107/109/111번 스크립트에 이미 적용된 패턴, 새 후보 러너도 그대로 재사용'],
  ['run 디렉터리 충돌 없음', 'OpenLane이 자체적으로 asic/<design>/runs/RUN_<timestamp>/를 만들어서 후보끼리 겹칠 일 없음', '이미 확인됨 — 별도 조치 불필요'],
  ['peer 세션과의 리소스 경합', '이 프로젝트는 다른 세션(daq_subsystem 등)과 같은 8코어/WSL을 공유', '큰 배치 실행 전 ListAgents로 활성 세션 확인 + SendMessage로 셰어드 리소스(공유 shim, CPU 부하) 조율 — 이번 세션에서 실제로 이렇게 조율해서 충돌 회피함'],
] as const

const status = [
  ['Flat 트랙 1~3단계', '검증됨', 'chan_ctrl/cnt_sat/skid_buffer로 1~3단계 전부 실행·검증 완료. chan_top은 2단계(재시간측정)까지 검증, 3단계(from-scratch 12/48 확인)는 지금 백그라운드 진행 중(2026-09-18 21:19 시작, hold-violation 수리 단계)'],
  ['daq_subsystem — 2단계 적용', '진행 중 (2026-09-18)', '8채널 전체를 처음부터 32/10 ns로 완주 시도하던 4번째 런을 killed하고, chan_top의 확정된 48/12 ns로 SDC/config 갱신 후 재시작 — 전체 완주(수 시간) 전에 DEFAULT_CORNER=nom_ss_100C_1v60 오버라이드로 mid-flow 추정부터 먼저 확인 중(102_daq_subsystem_worst_corner_estimate.sh). 32/10 그대로 8시간 태웠으면 chan_top과 똑같은 실패를 8배 규모로 반복했을 것 — 이게 이 탭이 말하는 깔때기를 daq_subsystem 자신에게도 적용한 첫 사례'],
  ['Hierarchical 트랙', '설계만 됨, 미착수', 'ParSAC(IntelLabs, Apache 2.0, archived지만 사용 가능) 조사 완료 — 매크로 floorplanning 전용 SA 도구, OpenLane MACROS와 연결하는 글루코드 필요. chan_top이 worst-corner까지 안 닫힌 상태라 아직 투입 시점 아님'],
  ['4단계 맞대결', '미착수', 'Hierarchical 1단계부터 선행 필요'],
] as const

export default function PnrResearch() {
  return <>
    <section className="card"><div className="card-title"><div><small className="kicker">P&R 연구 · 2026-09-18</small><h2>Flat vs Hierarchical — 두 접근을 나란히</h2></div></div>
      <div className="data-table"><table><thead><tr><th>방식</th><th>정의</th><th>장점</th><th>단점 / 전제조건</th></tr></thead><tbody>{approaches.map(([name, def_, pro, con]) => <tr key={name}><td><b>{name}</b></td><td>{def_}</td><td>{pro}</td><td>{con}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note">둘 중 하나를 "정답"으로 미리 정하지 않는다 — daq_subsystem처럼 반복 구조(8채널 동일)가 강한 설계는 hierarchical이 유리할 가능성이 높지만, 실측(4단계) 없이는 가정일 뿐이다. 이 탭의 목적은 그 실측을 최소 비용으로 빨리 얻는 것.</p>
    </section>

    <section className="card"><div className="card-title"><div><small className="kicker">탐색 구조</small><h2>깔때기(funnel) — 비쌀수록 후보 수를 줄인다</h2></div></div>
      <div className="data-table"><table><thead><tr><th>단계</th><th>방법</th><th>구체적 실행</th><th>상태</th><th>버리는 기준</th></tr></thead><tbody>{funnelStages.map(([stage, method, exec_, stat, drop]) => <tr key={stage}><td><b>{stage}</b><br/><small>{method}</small></td><td>{exec_}</td><td>{stat.includes('검증됨') ? <span className="ok-badge">{stat}</span> : <span className="warning-badge">{stat}</span>}</td><td>{drop}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note">핵심 원칙: <b>비용이 100~1000배 뛰는 단계(2→3단계, 재시간측정 초 단위 → 전체 P&R 25~40분)로 넘어가기 전에, 훨씬 싼 단계에서 최대한 많이 걸러낸다.</b> 이번 세션에서 SYNTH_STRATEGY 재검증 때 이미 증명됨 — pre-placement 예측이 방향까지 틀린 적 있지만(chan_ctrl 면적 반전), 그래도 "이 전략을 시도할 가치가 있는가"라는 1차 판단 자체는 맞았다. 즉 싼 필터는 "무엇을 3단계에 보낼지" 정도는 신뢰할 수 있어도, 최종 PPA 숫자로는 못 쓴다.</p>
    </section>

    <section className="card"><div className="card-title"><div><small className="kicker">동시성 설계</small><h2>단계마다 다른 병렬도</h2></div></div>
      <div className="data-table"><table><thead><tr><th>단계</th><th>권장 동시 실행 수</th><th>근거</th></tr></thead><tbody>{concurrency.map(([stage, n, why]) => <tr key={stage}><td>{stage}</td><td><b>{n}</b></td><td>{why}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note">"최대한 병렬로"가 곧 "후보 수만큼 동시에"는 아니다 — 이 호스트가 8코어이고 OpenLane 자체가 내부적으로 이미 병렬화돼 있어서, 외부 동시 실행 수를 늘려도 어느 지점부터는 서로의 코어를 뺏을 뿐 순수 이득이 없다(실측: SynthesisExploration 3개 동시 = 1.43배, 3배 아님). 1~2단계는 가볍고 짧아서 거의 무제한으로 병렬화하고, 3단계(전체 P&R)만 동시 개수를 실측 기반으로 제한하는 게 맞다.</p>
    </section>

    <section className="card"><div className="card-title"><div><small className="kicker">병렬 실행 시 충돌 방지</small><h2>여러 후보/세션이 같은 리소스를 쓸 때</h2></div></div>
      <div className="check-list">{races.map(([title, risk, fix]) => <p key={title}><b>{title}</b><span><i>위험:</i> {risk}<br/><i>대응:</i> {fix}</span></p>)}</div>
    </section>

    <section className="card"><div className="card-title"><div><small className="kicker">현재 진행 상태</small><h2>뭐가 검증됐고 뭐가 아직 설계만 됐는가</h2></div></div>
      <div className="data-table"><table><thead><tr><th>항목</th><th>상태</th><th>비고</th></tr></thead><tbody>{status.map(([item, stat, note]) => <tr key={item}><td><b>{item}</b></td><td>{stat === '검증됨' ? <span className="ok-badge">{stat}</span> : <span className="warning-badge">{stat}</span>}</td><td>{note}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note">다음 구체적 실행 단계 — 이 순서로: (1) chan_top 12/48 from-scratch 확인 + daq_subsystem을 같은 48/12로 재타겟해서 2단계 필터(mid-flow 추정)부터 먼저 확인, 둘 다 지금 백그라운드 진행 중 → (2) daq_subsystem 2단계 추정이 나쁘지 않으면 그때 전체 완주(3단계) 커밋, 나쁘면 완주 전에 재튜닝 → (3) chan_top이 worst-corner까지 닫히면 hardening해서 macro LEF/GDS 확보 → (4) ParSAC venv 설치 + chan_top macro를 8개 배치하는 글루코드 작성(1단계 실행) → (5) 살아남은 배치 후보로 daq_subsystem hierarchical 3단계(전체 P&R) 실행 → (6) 같은 시점의 flat 3단계 결과와 4단계 맞대결.</p>
    </section>
  </>
}
