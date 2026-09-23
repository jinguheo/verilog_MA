// Live-ish status for the Sample Test 4 ASIC track, shown only on the
// "Physical Design" (manufacturing) tab. TaskWorkspace's generic tasks{}
// entry describes the workflow in the abstract; this component reports what
// has actually run, with real numbers, so the tab is not just a checklist.
// Snapshot as of 2026-09-23 13:10 KST — refresh the numbers by hand after the
// next run finishes (see the "how to refresh" note at the bottom).
import PhysicalDesignLive from './PhysicalDesignLive'
import ParsacFloorplan from './ParsacFloorplan'

const toolchain = [
  ['flow', 'OpenLane 2 v2.3.10', 'Python 3.12 venv (~/.venvs/openlane312), native — not the ORFS/OpenROAD-from-source track, which was abandoned (see tools/wsl/README.md)'],
  ['PDK', 'sky130A via volare', '~/.volare/volare/sky130/versions/0fe599b2... — the copy the flow actually reads; a second copy at ~/eda/pdk is unused'],
  ['synthesis / P&R / STA', 'yosys (nix, with slang+pyosys) / OpenROAD / OpenSTA 2.6.0', 'the distro apt yosys (0.52) cannot run OpenLane\u2019s pyosys steps (-y) — only the nix-provided build works'],
  ['DRC / LVS / GDS', 'Magic 8.3.105 / netgen-lvs 1.5.133 / KLayout 0.30.0', 'all three signed off clean on every completed design so far'],
  ['host', 'WSL Ubuntu 26.04 (D:\\WSL\\Ubuntu)', '925 GB free; nothing installed touches C:'],
] as const

const blocks = [
  ['skid_buffer', '완료 · signoff clean', 'DRC 0 · LVS 0 · XOR 0 · antenna 0 · SYNTH_STRATEGY 탐색 결과 이미 최적'],
  ['cnt_sat', '완료 · signoff clean', 'DRC 0 · LVS 0 · XOR 0 · antenna 0 · AREA 1 전환 후 전체 P&R 재검증'],
  ['chan_ctrl', '완료 · signoff clean (실제 SDC 적용)', '단일 클럭. AREA 2 전환 후 전체 P&R 재검증. 폴백 SDC 대비 setup 여유 4.25→1.98ns로 낮아짐 — IO 제약이 없어서 좋아 보였던 것'],
  ['chan_top', '진행 중 · 셋업 타이밍 완전 클로징, 안테나 1건 재검증 중', 'ch_cause_o 레지스터화(9/20, b02cb4e) + src_period 14ns(9/21, 32a7395) → RUN_2026-09-21_21-20-41에서 전 코너 WNS/TNS 완전 양수/0 달성 — 주기 스윕이 아니라 RTL 파이프라이닝으로 닫힘. 남은 이슈는 안테나 위반 1건(net1314)뿐, DIODE_INSERTION_STRATEGY 4→6으로 재실행 중 (RUN_2026-09-23_12-48-47, 오늘 12:48 시작 · 라이브). 이전 두 검증 시도(9/21 21:22·23:03)는 CTS 이후 로그 없이 정지 — WSL 재시작 추정'],
  ['daq_subsystem (8채널 top)', '진행 중 · worst-corner 부분 검증 (RUN_2026-09-23_12-48-48, 라이브)', '12/48ns 목표로 재실행 중 — chan_top의 14/52ns 갱신은 아직 미반영. `--to OpenROAD.STAMidPNR-3` + DEFAULT_CORNER=nom_ss_100C_1v60로 전체 signoff 대신 worst corner 배치 후 타이밍부터 우선 확보하는 범위. 오늘 12:48 시작, 확인 시점 기준 yosys 합성 단계. ~107k 셀(chan_top의 3.6배)'],
] as const

// 진단(두 병목)은 그대로 유효 — 실패 경로의 시작/끝 신호명이 모든 재실행에서
// 일치. 틀렸던 건 "어느 주기에서 닫히는가"라는 결론 쪽이고, 그 정정 기록은
// 아래 timingHistory 표와 constraints/chan_top.sdc의 CORRECTION 블록 3개에 있음.
const rootCauses = [
  ['axi_clk 도메인', 'pkt_check.sv의 CRC-32가 8단 crc32_byte_step을 조합 로직으로 직렬 연결 (각 단이 내부적으로 8비트 시프트-XOR 재귀) — 사실상 64단 조합 체인, 종점은 ch_cause_o[0]/[2]. 12/48ns 재합성 후에도 남은 5개 위반이 전부 이 경로 (SDC 3차 정정 기준).'],
  ['src_clk 도메인 (별개 원인)', 'skid_buffer.sv의 출력 mux가 pkt_align.sv의 가변 인덱스 바이트 누산기(nxt_data[byte_cnt_q*8+:8])에 물려 있음 — axi_clk와 무관한 src_clk 내부 문제. src_period=12ns에서 모든 코너·모든 실행 0 위반으로 확정.'],
] as const

// 세 번 정정된 chan_top 타이밍 결론 — 매번 "실측"이었지만 무엇을 재는지가 달랐음.
const timingHistory = [
  ['6/10 ns (최초, 시뮬레이션 주기 그대로)', 'RUN_2026-08-28_19-41-37', '전체 완주했으나 signoff 실패', '이 넷리스트가 이후 두 오판의 원인 — 6/10 목표로 과잉 최적화된 레이아웃'],
  ['10/32 ns "closes cleanly" (8/28 주장)', '위 넷리스트 재타이밍', '❌ 오판', '6/10용으로 만든 레이아웃을 느슨한 10/32로 다시 채점하니 여유가 남아 보였을 뿐. 처음부터 10/32로 돌린 RUN_2026-08-30_20-00-29는 worst corner WNS −8.4ns, 926 위반'],
  ['"axi를 아무리 올려도 −3.23ns 플래토" (8/28 주장)', '같은 넷리스트 + 수기 Tcl', '❌ 오판', '같은 오염 + IO delay 예산(주기의 30%)을 빠뜨린 수기 제약. 진짜 10/32 넷리스트로 SDC 원본을 써서 재스윕하니 플래토 없음 — axi 48ns에서 +2.41, src 12ns에서 +0.90, 선형 개선 (9/14, 두 세션 공동)'],
  ['12/48 ns 처음부터 재합성 (9/18)', 'RUN_2026-09-18_21-19-11', '위반 926→5, TNS −150→−3.4ns', '실제 결과. 방향은 맞았으나 WNS −2.73ns로 완전 클로징은 아님. 남은 5개는 전부 axi 도메인'],
  ['12/52 ns 처음부터 재합성 (9/20)', 'RUN_2026-09-20_19-36-35', '❌ 오히려 악화', 'WNS −2.73→−3.38ns, TNS −3.4→−5.3ns (같은 두 신호 ch_cause_o[0]/[2]). 원인: SDC의 clock_uncertainty/transition이 주기의 %로 커져서(axi 48→52ns면 마진도 2.4→2.6ns), 64단 CRC 체인에 누적되며 주기 증가분보다 마진 손해가 더 컸음. 안테나 위반도 새로 발생(핀17·넷16). 주기 스윕으로는 안 닫힘 — RTL 파이프라이닝만 남음'],
  ['ch_cause_o 레지스터화 + antenna strategy 4, 12/52ns 그대로 재실행 (9/20)', 'RUN_2026-09-20_21-14-08', 'WNS −3.38→−0.50ns, antenna 17→0', 'pkt_check.sv 64단 CRC 체인이 ch_cause_o[0]/[2]에 조합으로 물려 있던 것을 레지스터 1단 삽입으로 유효 깊이 절반으로 축소 — 주기 스윕이 아니라 RTL 파이프라이닝으로 실제 개선. 남은 1건은 axi 도메인이 아니라 별개의 src_clk 경로(skid_buffer의 src_ready_o)'],
  ['src_period 12→14ns 재조정 (9/21)', 'RUN_2026-09-21_21-20-41', '셋업 타이밍 전 코너 완전 클로징 (WNS 0.97~4.14ns, TNS=0 전부)', 'src_ready_o 경로 하나만 남아 있었으므로 axi는 그대로 두고 src_period만 소폭 상향 — pkt_align.sv 버퍼링 확장 없이 해결. 대신 새 안테나 위반 1건(net1314, CTS 이후 팬아웃 버퍼 입력, 1.21x 초과) 발생 → DIODE_INSERTION_STRATEGY 4→6으로 대응, RUN_2026-09-23_12-48-47에서 재검증 진행 중(라이브)'],
] as const

// 상용 EDA/파운드리 PDK vs 이 프로젝트가 실제 쓰는 오픈소스 스택.
const eda = [
  ['접근 방법', '상용 (Synopsys Fusion Compiler/PrimeTime, Cadence Innovus/Tempus, Siemens Aprisa/Calibre)', '오픈소스 (yosys, OpenROAD, OpenSTA, Magic, KLayout, netgen)'],
  ['라이선스 비용', '연간 좌석당 수만~수십만 달러. 사내 유지보수 인력도 별도 필요', '무료. 이번 세션 설치 비용은 사람 시간뿐'],
  ['타이밍 signoff 정확도', 'ECSM/CCS 비선형 지연 모델, 통계적(OCV/AOCV/POCV) 변동, IR-drop 인지 타이밍까지 표준 지원', 'OpenSTA는 선형 근사 중심 — 상용 대비 마진을 더 크게 잡아야 안전. 이번 chan_top처럼 실제 위반을 잡아내는 데는 충분했음'],
  ['DFM/수율 최적화', 'CMP dummy fill, 리소그래피 시뮬레이션 기반 OPC 연동, 수율 예측 모델 포함', '기본 fill/DRC만 — 리소 시뮬레이션이나 수율 모델은 없음'],
  ['공정 노드', '고객사 계약에 따라 3~5nm 최신 노드까지 접근 가능', 'sky130(130nm), gf180(180nm) 등 공개된 구세대 노드로 제한'],
  ['IP 생태계', '메모리 컴파일러, 고속 SerDes, 아날로그 매크로 등 파운드리 인증 IP 다수', '거의 없음 — SRAM 매크로 정도만 커뮤니티 제공'],
  ['지원/책임', '파운드리·EDA 벤더의 공식 지원, 문제 발생 시 계약상 책임 소재 명확', '커뮤니티 기반. 이번 세션의 nix store 손상처럼 원인 불명 문제는 직접 복구해야 함'],
] as const

const pdkAccess = [
  ['상용 파운드리 PDK (TSMC, Samsung, GlobalFoundries 등)', '서명된 NDA + 파운드리와의 고객 계약(웨이퍼 발주 약정 포함하는 경우 많음)이 있어야 파일을 받을 수 있습니다. 개인이나 학습 목적으로는 접근 자체가 불가능합니다.'],
  ['sky130 (이 프로젝트가 쓰는 것)', 'SkyWater가 Google 후원으로 2020년 오픈소스화. NDA 없이 누구나 무료로 volare 같은 도구로 즉시 받을 수 있습니다. 대신 130nm — 최신 상용 칩과는 세대 차이가 있는 공정입니다.'],
  ['gf180, ASAP7 등 다른 오픈 PDK', 'gf180(GlobalFoundries 180nm)도 NDA 없이 공개됐고, ASAP7은 실제 파운드리가 아닌 ASU/ARM의 예측 모델(7nm급 특성을 흉내낸 가상 PDK) — 둘 다 실제 최신 상용 제조로 이어지지 않습니다.'],
] as const

// SynthesisExploration 결과 (2026-09-14) — 9개 전략 실측 비교.
const synthExplore = [
  ['chan_ctrl', '789.5 µm² · slack 2.45ns', 'AREA 2', '782.0 µm² (−0.9%) · slack 2.59ns (+5.8%)', '트레이드오프 없이 순수 개선 — 전환 권장'],
  ['cnt_sat', '1975.6 µm² · slack 3.98ns', 'AREA 1', '1911.8 µm² (−3.2%) · slack 3.72ns', '면적↓ 대신 여유 조금↓ (그래도 TNS 0) — 면적 우선이면 전환'],
  ['skid_buffer', '2864.0 µm² · slack 4.82ns', 'AREA 0/1 (동률)', '변화 없음', '이미 면적 최적 — 변경 불필요'],
] as const

// 순차 vs 동시 실행 시간 비교 (같은 3개 블록, 같은 호스트, 같은 세션에서 실측).
const parallelTiming = [
  ['chan_ctrl', '25.0s'],
  ['cnt_sat', '29.6s'],
  ['skid_buffer', '26.2s'],
] as const

// SYNTH_STRATEGY를 실제 config.json에 반영하고 전체 P&R(배치·배선 포함)을
// 재실행해 pre-placement 예측이 실제로 맞는지 검증 (2026-09-14).
const fullPnrVerify = [
  ['chan_ctrl', 'AREA 2', '2887.77 µm² · slack 1.958ns', '2905.29 µm² (+0.6%) · slack 2.211ns (+12.9%)', '면적 −0.9% 예측 → 실제 +0.6%(반전). slack은 +5.8% 예측보다 더 좋게 나옴(+12.9%)'],
  ['cnt_sat', 'AREA 1', '2275.93 µm² · slack 3.772ns', '2128.29 µm² (−6.5%) · slack 4.132ns (+9.6%)', 'slack −6.5%(감수) 예측 → 실제는 +9.6%(반전, 더 좋아짐). 면적도 예측보다 더 줄어듦(−6.5% vs −3.2%)'],
] as const

// 왜 RTL 설계부터 제조까지 오래 걸리는가 — chan_top 경험을 근거로.
const whySlow = [
  ['배치·배선 전에는 진짜 타이밍을 알 수 없다', '배선 지연은 실제 셀 위치와 배선 길이가 정해져야 계산됩니다(RC 추출). 그래서 RTL 시뮬레이션 단계의 클럭 주기(6/10ns)는 "논리적으로 말이 되는가"만 검증했을 뿐, 실제로 그 속도로 동작하는지는 배치·배선을 끝내야 알 수 있었습니다. chan_top이 바로 이 사례 — 시뮬레이션에서는 통과했지만 실제 합성·배치 후에는 10배 가까운 초과 위반이 나왔습니다.'],
  ['클럭 도메인마다, 코너마다 따로 검증해야 한다', 'chan_top 하나에만 클럭 도메인 2개(src_clk/axi_clk)가 있고, 각 도메인을 공정·전압·온도 조합(코너) 9가지에서 전부 확인해야 합니다. 하나라도 위반이면 signoff 실패 — 검증해야 할 조합이 곱셈으로 늘어납니다.'],
  ['원인 진단 자체가 여러 단계를 거칩니다', '이번에 "왜 안 닫히는가"를 알아내는 데 넷리스트에서 실제 신호명 확인 → 배치·배선된 설계 + 기생 성분 추출 → 클럭 주기 스윕까지 여러 단계가 필요했습니다. 코드 버그처럼 한 줄을 고쳐서 되는 게 아니라, 물리적 원인(배선 길이, 셀 지연)을 추적해야 합니다.'],
  ['한 번의 실수를 되돌릴 수 없다', '소프트웨어는 배포 후에도 패치할 수 있지만, 칩은 제조(테이프아웃)가 끝나면 물리적으로 고정됩니다. 최신 공정 마스크 세트 하나가 수백만 달러, 제작 기간이 수개월이라 "일단 만들고 고치자"가 통하지 않습니다 — 그래서 DRC/LVS/타이밍/안테나 등 모든 신호오프 항목이 100% 통과할 때까지 반복합니다.'],
  ['검증 도구가 여러 개, 서로 다른 관점으로 겹쳐서 확인합니다', 'DRC(제조 규칙), LVS(회로도 일치), STA(타이밍), 안테나(플라즈마 손상), IR drop(전원), XOR(레이아웃 회귀) — 이번 chan_ctrl·chan_top 모두 이 항목들을 전부 통과해야 했습니다. 하나의 종합 테스트가 아니라 독립된 여러 게이트를 순서대로 통과해야 하는 구조입니다.'],
] as const

export default function PhysicalDesignStatus() {
  return <>
    <PhysicalDesignLive/>
    <ParsacFloorplan/>
    <section className="card"><div className="card-title"><div><small className="kicker">STATUS SNAPSHOT · 2026-09-18 23:20</small><h2>Sample Test 4 — ASIC 물리 설계 진행 상황</h2></div><span className="warning-badge">chan_top · daq_subsystem 동시 실행 중</span></div>
      <div className="data-table"><table><thead><tr><th>블록</th><th>상태</th><th>근거</th></tr></thead><tbody>{blocks.map(([name, status, note]) => <tr key={name}><td><code>{name}</code></td><td>{status.includes('완료') ? <span className="ok-badge">{status}</span> : <span className="warning-badge">{status}</span>}</td><td>{note}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note">산출물 위치: <code>samples/sample_test_4/asic/&lt;block&gt;/runs/RUN_*/final/</code> (GDS·LEF·netlist·SPEF·5-corner .lib). RTL은 이 작업 중 어느 것도 수정되지 않았습니다.</p>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">TOOLCHAIN — 실제 사용 중</small><h2>WSL 기반 오픈소스 RTL-to-GDS</h2></div></div>
      <div className="data-table"><table><thead><tr><th>영역</th><th>도구</th><th>비고</th></tr></thead><tbody>{toolchain.map(([area, tool, note]) => <tr key={area}><td>{area}</td><td><b>{tool}</b></td><td>{note}</td></tr>)}</tbody></table></div>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">chan_top — 타이밍 실패 원인 규명</small><h2>두 개의 독립된 조합 로직 병목</h2></div></div>
      <div className="check-list">{rootCauses.map(([title, detail]) => <p key={title}><b>{title}</b><span>{detail}</span></p>)}</div>
      <p className="rtl-guide-note">둘 다 실측 기반 진단이고 지금도 유효합니다 — 넷리스트에서 실제 시작점 신호명을 확인하고(<code>fifo_rptr_q[2]</code>, <code>u_pkt_align.u_skid.skid_valid_q</code>), 배치·배선 완료된 설계 + 추출된 SPEF로 주기를 스윕했습니다. <b>하지만 "어느 주기에서 닫히는가"는 두 번 틀렸습니다</b> — 아래 표. <b>최종 결론(9/21 확정)</b>: 주기 스윕만으로는 axi 도메인의 CRC 병목이 안 닫혔고, 실제로 닫은 것은 <code>ch_cause_o</code> 레지스터화(RTL 파이프라이닝) + src_period 14ns 소폭 조정의 조합 — RUN_2026-09-21_21-20-41에서 전 코너 셋업 타이밍 완전 클로징. 남은 유일한 이슈는 안테나 위반 1건(strategy 6으로 재검증 중, 아래 상태 표 참고).</p>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">chan_top — 타이밍 결론이 세 번 바뀐 기록</small><h2>같은 "실측"이라도 무엇을 재는지가 달랐다</h2></div></div>
      <div className="data-table"><table><thead><tr><th>주장 / 시도</th><th>근거 실행</th><th>결과</th><th>왜 그렇게 나왔나</th></tr></thead><tbody>{timingHistory.map(([claim, run, result, why]) => <tr key={claim}><td><b>{claim}</b></td><td><code>{run}</code></td><td>{result.startsWith('❌') ? <span className="warning-badge">{result}</span> : result}</td><td>{why}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note"><b>교훈 두 가지.</b> (1) 이미 배치·배선된 레이아웃을 다른 SDC로 "다시 채점"한 값은 그 레이아웃이 원래 어떤 목표로 최적화됐는지에 종속됩니다 — 툴은 주어진 주기에 맞춰 최적화 노력을 조절하므로, 빡빡한 목표로 만든 레이아웃은 느슨한 요구에 여유가 남아 보이는 게 당연합니다. 처음부터 그 주기로 돌린 실행만이 근거입니다. (2) 주기 스윕 시 수기 Tcl 대신 <b>signoff SDC 원본을 그대로 source</b>해야 합니다 — IO delay 예산, CDC max_delay, driving_cell 같은 예외 하나만 빠져도 결론이 뒤집힙니다. 두 오판 모두 <code>constraints/chan_top.sdc</code>의 CORRECTION 블록 3개와 RESULTS.md에 사후 기록돼 있습니다.</p>
      <p className="rtl-guide-note"><b>비교 기준 실행이 사라진 문제 (원인 미확인)</b>: 12/48 결과의 근거인 <code>RUN_2026-09-18_21-19-11</code> 디렉터리가 디스크에 없습니다. 실행 자체는 실재했고 완주했음이 로그로 확인되지만(<code>tools/wsl/logs/111_chan_top_1248.log</code>에 해당 run 태그와 <code>Flow complete</code>), 8/29 것까지 포함해 다른 run 디렉터리는 모두 남아있는 와중에 이것만 없어졌습니다. <b>러너 스크립트가 지운 것은 아닙니다</b> — <code>111</code>/<code>102</code>의 <code>rm -rf</code>는 shim 경로(<code>~/.cache/openlane-tools-*</code>)에만 적용되고 run 디렉터리는 건드리지 않음을 확인했습니다. 누가/무엇이 지웠는지는 확인되지 않았습니다. 결과적으로 수치는 로그와 RESULTS.md에 남아 신뢰 가능하나 GDS/metrics.json 재검증은 불가 — 기준이 될 실행은 별도 보존(복사 또는 태그)하는 정책이 필요합니다.</p>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">daq_subsystem — 8채널 전체 top</small><h2>주기가 chan_top보다 한 단계 뒤처진 채 재검증 중</h2></div></div>
      <div className="check-list">
        <p><b>왜 계속 재시도하나</b><span>OpenLane 버그가 아니라 실행 환경 문제 — WSL 백그라운드 프로세스는 Claude 세션과 무관하게 살아있지만, PC/전체 Code 세션이 닫히거나 WSL VM이 재시작되면 함께 죽습니다. 매 시도가 처음부터 다시 시작(합성부터). 오늘(9/23 12:48) 새 실행이 라이브 진행 중(<code>RUN_2026-09-23_12-48-48</code>).</span></p>
        <p><b>이번 시도의 범위</b><span><code>--to OpenROAD.STAMidPNR-3</code> + <code>DEFAULT_CORNER=nom_ss_100C_1v60</code> — 전체 signoff가 아니라 worst corner(ss) 기준 배치 후 타이밍 감부터 확보. aca2efd에서 chan_top의 12/48ns로 리타겟됐지만, chan_top 자체는 이후 14/52ns로 한 단계 더 갔음(위 표) — daq_subsystem의 SDC는 아직 그 갱신을 반영하지 않음. chan_ctrl.sv의 ch_cause_o 레지스터화는 공유 RTL이라 이미 반영돼 있음.</span></p>
        <p><b>이미 잡은 RTL 버그 1건</b><span><code>perf_cnt.sv</code>의 <code>$countones()</code>가 OpenLane 합성 프론트엔드를 크래시 — Verilator/sby에선 멀쩡한 합법 SV. <code>daq_pkg::popcount</code> 패키지 함수로 옮겨 해결, TB/mutation 비회귀 확인 (<code>a4dbd21</code>).</span></p>
        <p><b>검증 안 된 첫 추정치</b><span><code>DIE_AREA</code> 3200×3200µm — 실측 전 감. ~107k 셀(chan_top 29.5k의 3.6배)에 P&R 시간은 비선형으로 늘어나므로 전체 signoff는 시간 단위 이상 예산 필요.</span></p>
      </div>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">상용 EDA vs 오픈소스 — 무엇이 다른가</small><h2>왜 실제 반도체 회사는 이 도구들을 안 쓰는가</h2></div></div>
      <div className="data-table"><table><thead><tr><th>항목</th><th>상용 EDA</th><th>이 프로젝트(오픈소스)</th></tr></thead><tbody>{eda.map(([item, commercial, oss]) => <tr key={item}><td><b>{item}</b></td><td>{commercial}</td><td>{oss}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note">오픈소스가 "가짜"라는 뜻이 아닙니다 — 이번에 chan_ctrl과 chan_top(진행 중)에서 나온 DRC/LVS/타이밍 수치는 실제 sky130 공정 규칙 기준으로 계산된 진짜 결과입니다. 다만 상용 도구가 표준으로 갖춘 정확도·자동화·공정 접근 범위가 없어서, 실제 양산칩 signoff에는 아직 못 미칩니다.</p>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">파운드리 PDK 접근 — NDA가 갈라놓는 것</small><h2>왜 sky130으로만 "진짜 제조"를 해볼 수 있는가</h2></div></div>
      <div className="check-list">{pdkAccess.map(([name, detail]) => <p key={name}><b>{name}</b><span>{detail}</span></p>)}</div>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">SYNTH_STRATEGY 탐색 · 2026-09-14</small><h2>9개 전략 실측 비교 — 처음으로 근거 있는 선택</h2></div></div>
      <div className="data-table"><table><thead><tr><th>블록</th><th>현재(AREA 0 기본값)</th><th>최선 전략</th><th>결과</th><th>판단</th></tr></thead><tbody>{synthExplore.map(([name, cur, strat, res, verdict]) => <tr key={name}><td><code>{name}</code></td><td>{cur}</td><td><b>{strat}</b></td><td>{res}</td><td>{verdict}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note"><code>openlane --flow SynthesisExploration</code> — yosys/ABC 전략 9개(AREA 0-3, DELAY 0-4)를 병렬로 돌려 gates/면적/worst slack/TNS를 비교합니다. <b>Pre-placement 단계까지만</b>(합성 + STAPrePNR, 실제 배치·배선 전) — "종이 위에서" 어느 전략이 작고 빠른지 알려주는 것이지 배선 후 결과를 보장하지 않습니다. <code>chan_ctrl</code>의 <code>AREA 1</code>은 이 설계에서 yosys 내부 크래시(capnp schema mismatch)로 실패 — 원인은 더 파지 않음(AREA 2가 이미 더 나아서). 전체 9개 전략 표는 각 <code>asic/&lt;block&gt;/synth_explore_summary.txt</code>에 있습니다. <b>config에 반영하고 전체 P&R로 재검증 완료</b> — 바로 아래 섹션.</p>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">SYNTH_STRATEGY 전체 P&R 재검증 · 2026-09-14</small><h2>예측이 실제로 맞았는가 — 배치·배선 후 다시 측정함</h2></div></div>
      <div className="data-table"><table><thead><tr><th>블록</th><th>적용된 전략</th><th>기존(AREA 0, 배선 완료)</th><th>신규(배선 완료)</th><th>pre-placement 예측과 비교</th></tr></thead><tbody>{fullPnrVerify.map(([name, strat, before, after, note]) => <tr key={name}><td><code>{name}</code></td><td><b>{strat}</b></td><td>{before}</td><td><span className="ok-badge">{after}</span></td><td>{note}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note"><b>둘 다 예측이 방향까지 틀렸는데, 결과는 더 좋게 나왔습니다.</b> <code>chan_ctrl</code>은 면적이 줄 것으로 예측했지만 실제 배치·배선(버퍼 삽입, CTS 리페어)을 거치자 오히려 살짝 늘었고, <code>cnt_sat</code>은 slack이 줄어드는 트레이드오프를 감수하기로 했었는데 실제로는 늘었습니다. 두 경우 다 TNS는 0으로 유지 — 즉 최종 판단(전략을 바꿀지 말지)은 pre-placement 표로도 맞았지만, 그 표에 적힌 <i>수치</i>를 최종 PPA 결과로 보고할 수는 없다는 뜻입니다. 배치·배선을 실제로 돌리기 전까지는 숫자가 확정되지 않습니다. <code>skid_buffer</code>는 <code>SynthesisExploration</code>에서 개선 여지가 없었으므로(위 표) 재실행하지 않았습니다.</p>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">순차 vs 동시 실행 · 2026-09-14</small><h2>1.43배 빨라짐 — 왜 3배가 아닌지도 확인함</h2></div></div>
      <div className="data-table"><table><thead><tr><th>모드</th><th>chan_ctrl</th><th>cnt_sat</th><th>skid_buffer</th><th>합계</th></tr></thead><tbody>
        <tr><td>순차 실행</td>{parallelTiming.map(([name, t]) => <td key={name}>{t}</td>)}<td><b>80.8s</b></td></tr>
        <tr><td>동시 실행(3개 백그라운드)</td><td colSpan={3}>—</td><td><b className="ok-badge">56.4s</b></td></tr>
      </tbody></table></div>
      <p className="rtl-guide-note"><b>왜 3배가 아니라 1.43배인가</b>: 이 호스트는 CPU 8코어인데, <code>SynthesisExploration</code> 실행 하나가 이미 내부적으로 9개 전략을 스레드풀로 병렬 처리합니다 — 즉 3개를 동시에 돌리면 "독립된 기계 3대"가 아니라 "같은 8코어를 두고 경쟁하는 스레드풀 3개"가 됩니다. I/O 대기를 동시성으로 숨기는 상황이 아니라 순수 CPU 경합이라, 코어 수를 넘어서는 배수의 속도 향상은 기대할 수 없습니다. 두 모드의 결과값(전략별 gates/면적/slack 표)은 <b>바이트 단위로 동일함을 확인</b> — 동시 실행이 결과를 바꾸지 않고 시간만 줄인다는 걸 실측으로 검증했습니다.</p>
      <p className="rtl-guide-note"><b>이번에 실제로 고친 것</b>: <code>107_synth_explore.sh</code>의 원래 shim 설정은 매 실행마다 공유 경로(<code>$HOME/.cache/openlane-tools/bin</code>)를 <code>rm -rf</code>하고 새로 만드는 방식이었는데, 이걸 동시에 3개 돌리면 서로 심볼릭 링크를 지웠다 만들었다 하며 레이스가 납니다 — 다른 세션이 2026-09-12에 경고했던 것과 같은 종류의 문제입니다. 블록별로 독립된 shim 경로(<code>openlane-tools-&lt;block&gt;</code>)를 쓰고, 이미 있으면 재생성하지 않도록(idempotent) 고쳐서 해결했습니다.</p>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">왜 RTL→제조가 오래 걸리는가</small><h2>chan_top에서 실제로 겪은 이유들</h2></div></div>
      <div className="check-list">{whySlow.map(([title, detail]) => <p key={title}><b>{title}</b><span>{detail}</span></p>)}</div>
      <p className="rtl-guide-note">요약하면: 소프트웨어는 "짐작 → 실행 → 관찰"이 초 단위로 돌지만, 칩 설계는 "짐작(RTL) → 배치·배선(수십 분~수 시간) → 관찰(신호오프)"의 한 바퀴가 훨씬 느리고, 실패 시 되돌릴 수 없는 제조 단계가 끝에 있어서 그 앞의 모든 검증을 최대한 촘촘히 해야 합니다.</p>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">GDS 레이아웃 보기</small><h2>완성된 블록은 바로 확인 가능</h2></div></div>
      <div className="check-list">
        <p><b>대시보드에서</b><span>Sample Test 4 → Layout 탭 — 렌더링된 이미지 (전체 다이 / 60µm / 20µm 배율), sky130A 레이어 색상 적용.</span></p>
        <p><b>KLayout GUI로 직접</b><span><code>tools\open_layout.bat &lt;design&gt;</code> — WSL의 KLayout이 WSLg를 통해 Windows 화면에 바로 뜹니다. 추가 설치 불필요.</span></p>
      </div>
      <p className="rtl-guide-note">이 페이지의 표들은 스냅샷입니다 — 맨 위 <b>Physical Design Live</b> 패널만 API로 자동 갱신됩니다. 두 실행이 끝나면 상단 상태 표와 타이밍 기록 표를 다시 반영해야 합니다. 실행 중 로그: chan_top <code>tools/wsl/logs/111b_chan_top_1252.log</code>, daq_subsystem <code>tools/wsl/logs/102_daq_subsystem_estimate.log</code>. 살아있는지 확인: <code>wsl -d Ubuntu -- bash -lc "ps aux | grep openroad | grep -v grep"</code>.</p>
    </section>
  </>
}
