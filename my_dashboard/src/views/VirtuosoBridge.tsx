// "VB" 탭 — virtuoso-bridge-lite 와 가상 Virtuoso(vvirt)로 LLM이 SKILL 로 레이아웃을 만들고 고치는 구현을 정리한다.
// 숫자와 결과는 tools/vvirt/examples/{accept_layout,demo_inv_chain}.py 를 실제로 돌린 출력이다(2026-10-13).
// 아직 돌려 보지 않은 것은 "미검증"으로 따로 적는다.
import './vb.css'
import VbScenarioPlayer from './VbScenarioPlayer'
import VbSupportMatrix from './VbSupportMatrix'
import VbPnrEstimate from './VbPnrEstimate'

const FLOW: { who: string; what: string; real: boolean; tag?: string }[] = [
  { who: 'LLM / 에이전트', what: 'SKILL 코드를 만들어 Python 클라이언트로 보냄 (skills/virtuoso 문서 사용)', real: true, tag: '사용자 쪽' },
  { who: 'virtuoso-bridge 클라이언트', what: 'VirtuosoClient: client.layout.create()/modify(), execute_skill()', real: true },
  { who: 'ramic_bridge_daemon (TCP)', what: '인증(HMAC)·재전송 방지·요청 복구 — 원본 그대로 WSL에서 실행', real: true },
  { who: 'vvirt = 가상 Virtuoso', what: 'CIW 대신 요청 한 줄씩 받아 SKILL을 해석하고 \\x02…\\x1e 로 응답', real: false },
  { who: '레이아웃 DB + sky130 표준셀', what: 'rect/path/polygon/label/via/instance/mosaic, LEF·GDS 마스터, JSON 저장', real: false },
  { who: '출력', what: 'GDS(KLayout로 재검증) · SVG 렌더', real: false },
]

const CHECKS: { name: string; result: string; how: string }[] = [
  { name: '브리지 왕복', result: 'eval 1+2 → 3, 오류는 *Error* 형식으로 반환', how: 'virtuoso-bridge eval (실제 클라이언트)' },
  { name: '배포된 예제 01_create_layout.py', result: '수정 없이 통과 (sky130 셀 3개 + rect/path/label)', how: '--layer-map M1=met1,M2=met2' },
  { name: '수락 시험 accept_layout.py', result: '11/11 통과', how: '생성 · 읽기 · 추가 · 레이어 삭제 · 영역 선택 후 삭제 · mosaic · 내보내기' },
  { name: '배포 예제 01~15 + flower.py (사본, sky130 이름으로 치환)', result: '21회 실행 모두 종료코드 0 — 도형·비아·배선·읽기·삭제(dry/--yes)·선택삭제·mosaic·flower(다각형 11+경로 1+라벨 1), 15번 XStream Out 은 GDS+로그 생성 후 success', how: 'tools/vvirt/scripts/run_examples.sh, 원본은 수정하지 않음. 15번 GDS 는 KLayout 판독과 도형 수 일치, 맵 누락/셀 없음/빈 맵은 warning/failure 로 보고됨' },
  { name: '명령형 배치 place_cmd.py', result: 'nand2_1과 dfxtp_1을 폭에 맞춰 맞닿게 배치, 2행째는 MX 반전 (y=5.44)', how: '라이브러리 조회(vvCells/vvCellInfo) → 배치 → 읽기 확인' },
  { name: '시나리오 11개 (아래 재생기)', result: '자동 점검 33개 모두 통과 — 배치·수정·배열·비아·오류 복구·PDK 셀 복사/수정·룰 배선·사용자 룰·습관 프로필', how: 'tools/vvirt/examples/make_scenarios.py (실제 실행 기록)' },
  { name: '룰 검사 교차 검증', result: '내 검사기와 PDK 공식 sky130A_mr.drc 가 같은 met2 간격 위반(m2.2) 2건을 검출, 수정 후 둘 다 0', how: 'vvCheckRules vs vvOfficialDrc (BEOL 룰만)' },
  { name: 'LLM식 시나리오 demo_inv_chain.py', result: '인버터 4개 체인 생성 → inv_4로 교체·재배선 (bbox 5.52 → 6.44 µm)', how: '표준셀 실제 핀 좌표(vvCellInfo)로 li1 배선' },
  { name: 'GDS 독립 검증', result: 'KLayout이 4개 셀·계층·레이어 면적을 정상 판독', how: 'klayout -b 로 읽어 flat 면적 확인' },
]

const FUNCS: { group: string; items: string }[] = [
  { group: '셀뷰', items: 'dbOpenCellViewByType(r/w/a) · dbSave · dbClose · dbValidP · dbGetCellViewDdId' },
  { group: '도형 생성', items: 'dbCreateRect · dbCreatePath · dbCreatePolygon · dbCreateLabel · dbCreateVia(cutRows/cutColumns)' },
  { group: '인스턴스', items: 'dbCreateParamInstByMasterName · dbCreateInst · dbCreateSimpleMosaic (R0/R90/R180/R270/MX/MY/MXR90/MYR90)' },
  { group: '수정', items: 'dbDeleteObject · dbMoveFig · dbCopyFig · dbTransformBBox · geSelectArea/geDeselectArea · leHiDelete' },
  { group: '창·선택', items: 'geOpen · geGetEditCellView · hiGetWindowList · hiGetCurrentWindow · geGetSelSet · hiWindowSaveImage(SVG)' },
  { group: '라이브러리 관리', items: 'ddGetLibList · ddGetObj(~>readPath ~>cells ~>writable) · ddCreateLib(경로 제한) · ddDeleteObj · techBindTechFile/techGetTechLibName · isDir/isFile/isWritable(허용 폴더만)' },
  { group: '실제 PDK 라이브러리 로딩·편집', items: 'vvAttachPdkLib(예: sky130_fd_sc_hvl 69셀) · vvCopyCell/dbCopyCellView(읽기 전용 PDK 셀 → 내 라이브러리, 편집 가능) · vvImportGds(GDS → 라이브러리)' },
  { group: '룰·습관·검사', items: 'vvRuleSource(PDK tech LEF) · vvRules · vvSetRule(내 룰) · vvLoadProfile/vvProfile(습관) · vvRoute(룰 기반 우회 배선, 한계 목록 동봉) · vvViaStack · vvPlaceRow · vvPinXY · vvCheckRules(위반 목록) · vvCheckReport(검사 범위 포함: clean_in_scope / violations / nothing_checked) · vvOfficialDrc · vvOfficialDrcReport(돌린/안 돌린 그룹)' },
  { group: '준비도·설치', items: 'scripts/doctor.sh (읽기 전용 준비도 점검: 항목마다 고치는 명령과 영향받는 기능 표시) · scripts/setup_env.sh (계획만 출력, --yes 로 적용, 멱등) · skills/vvirt/SKILL.md (LLM용 사용 지침)' },
  { group: '테크·라이브러리', items: 'techGetTechFile(lps) · techFindViaDefByName · ddGetObj · ddDeleteObj · ddCreateLib' },
  { group: 'vvirt 전용(탐색·내보내기)', items: 'vvLibraries · vvCells · vvCellInfo(핀 좌표) · vvLayers · vvViaDefs · vvExportGds · vvExportSvg · vvBBox' },
  { group: '언어', items: 'if/when/unless/let/prog/foreach/for/while/case/cond/setof/lambda/procedure/errset/unwindProtect + 리스트·문자열·수치 함수, ~> 속성 접근' },
]

const LIMITS: string[] = [
  '실제 Cadence가 아니다: 확인한 것은 "브리지 프로토콜과 레이아웃 편집 SKILL이 동작한다"까지이며, Cadence의 정확한 동작(예: geSelectArea의 부분 겹침 선택)과 같다고 보장하지 않는다.',
  'SKILL 인터프리터는 부분집합이다(위 "SKILL 명령을 어디까지 지원하나" 표 참고: 핵심 언어 고른 199개 중 184개, 브리지 참조 Cadence 함수 189개 중 45개 지원). 모르는 함수는 "undefined function" 오류로 드러나며 그때마다 추가한다(system/sh 등 호스트에 닿는 함수는 의도적으로 없다).',
  '"위반 없음"은 "검사한 범위 안에서 없음"이다. vvCheckRules 의 nil 은 청결 판정이 아니므로 vvCheckReport 가 검사한 층·룰, 룰 없이 그려진 층, 검사하지 않은 항목(와이드 와이어 간격, 연결성, 밀도·안테나 등)과 룰 출처·내 룰 덮어쓰기를 함께 돌려준다.',
  'LVS·추출은 없다. 규칙 검사(vvCheckRules, 내부에서 klayout -b 호출)·공식 DRC(vvOfficialDrc)·자동 배선(vvRoute)·행 배치(vvPlaceRow)는 2026-10-13에 실행해 확인했다(시나리오 ⑧~⑪). 다만 DRC는 폭·간격·면적·enclosure 범위이므로 제출용 GDS는 KLayout/Magic/OpenLane으로 따로 검사해야 한다.',
  '층 이름은 sky130A(met1, li1, poly …)만 유효하다. 예제 02~15가 쓰는 tsmc식 이름(M1, edgeLayer 등)은 --layer-map 으로 바꿔야 한다.',
  '룰은 PDK tech LEF에서 읽는다(폭·간격·면적·방향·피치·비아 enclosure). 이는 라우팅용 룰이며 전체 signoff DRC가 아니다. 내 검사기는 폭/간격/면적/enclosure만 보고, 공식 덱 교차검증은 BEOL(금속·비아) 룰만 돌렸다. FEOL(poly/diff/well) 룰은 이 시나리오들에서 시험하지 않았다.',
  'vvRoute 는 같은 층에서의 단일 넷 Manhattan 라우터다: 직선/L/Z/S 후보 중 룰을 지키는 가장 짧은 것을 고르며(장애물은 도형의 bbox로 보수적으로 판단), 여러 넷의 동시 최적화·층 전환 자동 선택은 하지 않는다. 막히면 오류로 알려 주고 사람이/LLM이 좌표를 바꾼다.',
  '습관 프로필은 기능을 호출할 때만 적용된다(vvPlaceRow, vvRoute, vvViaStack). 직접 쓴 dbCreate* 는 룰을 강제하지 않으며 vvCheckRules 로 검사해야 한다.',
  '스키매틱·Maestro·CDF·GUI 폼은 구현하지 않았다(폼/메뉴 함수는 아무 일도 안 하고 nil 반환).',
  'XStream Out 은 에뮬레이션이다: xstSetField/xstOutDoTranslate 를 받아 스트림 맵을 읽어 GDS와 XStream 형식 로그를 만들지만 실제 Cadence 변환기가 아니며, PDK 표준셀 내부 도형은 맵을 거치지 않고 PDK GDS 번호 그대로 나간다.',
  '배포 예제는 층·비아·셀 이름을 sky130으로 바꾼 사본으로 전부 종료코드 0이다. 단 12(레이어 표시/숨김)는 화면이 없어 동작이 없고, 14의 넷 하이라이트는 넷을 모델링하지 않아 "net not found"를 돌려준다.',
  '미검증: sky130_fd_sc_hvl 은 붙여서 셀 목록(69개)과 이름 검색만 확인했고 셀 배치는 시험하지 않았다. sram_macros·fd_io·fd_pr 등 다른 PDK 라이브러리는 등록·시험하지 않았다.',
]

const FIGS: { src: string; title: string; note: string }[] = [
  { src: '/vb/place_cmd.svg', title: '명령으로 배치 — nand2_1 + dfxtp_1 (+ 아래 행 뒤집기)', note: '"nand2_1과 dfxtp_1을 맞닿게 놓고 아래 행에 뒤집어 하나 더" 요청의 결과. 점선 상자가 셀 하나, 아래 행 셀은 MX 반전이라 전원 레일 위치(VGND/VPWR)가 위아래로 바뀜' },
  { src: '/vb/inv_chain4_v1.svg', title: 'demo — 생성 (inv_1 ×4)', note: '셀을 맞닿게 배치(전원 레일 연속) → 출력(Y)에서 다음 입력(A)으로 li1 배선' },
  { src: '/vb/inv_chain4_v2.svg', title: 'demo — 수정 (3번째를 inv_4로)', note: '삭제 후 재배치·재배선. 폭 1.38×3 + 2.30 = 6.44 µm' },
  { src: '/vb/accept_inv_chain.svg', title: '수락 시험 결과', note: 'mosaic(2×3 buf_1), MX 반전 nand2, 비아·폴리곤·레이블' },
]

const RUN = [
  'bash tools/vvirt/scripts/vserver.sh start        # 가상 Virtuoso + 실제 daemon 시작 (WSL)',
  'bash tools/vvirt/scripts/vb.sh eval \'1+2\'         # 실제 virtuoso-bridge CLI → 3',
  'bash tools/vvirt/scripts/pyrun.sh tools/vvirt/examples/accept_layout.py',
  'bash tools/vvirt/scripts/pyrun.sh tools/vvirt/examples/demo_inv_chain.py',
]

export default function VirtuosoBridge() {
  return <>
    <section className="card vb-card">
      <div className="card-title"><div><small className="kicker">GOAL</small><h2>Virtuoso 없이 LLM이 SKILL로 레이아웃을 만들고 고친다</h2></div><span className="connection">WSL · D: 드라이브</span></div>
      <p className="vb-lead">
        <b>virtuoso-bridge-lite</b>(MIT)의 클라이언트와 daemon은 <b>그대로</b> 쓰고, 그 뒤의 "Virtuoso 프로세스"만 Python으로 만든 가상 Virtuoso(<code>tools/vvirt</code>)로 바꿨습니다.
        LLM은 진짜 Virtuoso를 쓸 때와 같은 방식(Python API + SKILL)으로 말하고, 셀 라이브러리는 sky130_fd_sc_hd 표준셀(437개)입니다.
      </p>
      <ol className="vb-flow">
        {FLOW.map((s, i) => <li key={i} className={s.real ? 'real' : 'virtual'}><b>{s.who}</b><span>{s.what}</span><em>{s.tag ?? (s.real ? '원본 그대로' : '이번에 구현')}</em></li>)}
      </ol>
    </section>

    <VbScenarioPlayer/>

    <section className="card vb-card">
      <div className="card-title"><div><small className="kicker">VERIFIED</small><h2>실제로 돌려 확인한 것</h2></div><span className="connection">2026-10-13</span></div>
      <div className="data-table"><table><thead><tr><th>항목</th><th>결과</th><th>방법</th></tr></thead>
        <tbody>{CHECKS.map(c => <tr key={c.name}><td><b>{c.name}</b></td><td>{c.result}</td><td>{c.how}</td></tr>)}</tbody></table></div>
    </section>

    <section className="card vb-card">
      <div className="card-title"><div><small className="kicker">RESULT</small><h2>생성된 레이아웃 (SVG 렌더) — 그림 읽는 법</h2></div></div>
      <ul className="vb-readme">
        <li><b>오른쪽 범례</b>: 색 하나가 칩 제조 층 하나입니다. 붉은 세로선 = poly(게이트), 주황 = li1(셀 안 배선·핀), 파랑 = met1(전원 레일), 보라 = met2 …</li>
        <li><b>점선 상자</b>: 배치된 셀 하나. 왼쪽 위 이름표에 인스턴스 이름과 셀 종류(예: <code>U_nand</code> / <code>nand2_1</code>)가 적혀 있습니다.</li>
        <li><b>빨간 원 + 글자</b>: 셀의 핀(A·B 입력, Y 출력). <b>VPWR/VGND</b>는 위·아래 전원 레일입니다.</li>
        <li><b>연한 초록 영역</b>: N-well — PMOS 트랜지스터가 들어가는 구역. 그 반대편이 NMOS 구역입니다.</li>
        <li><b>“met2 배선”, “met1 사각형” 같은 글자</b>와 파란 원: 사용자가 직접 그린 도형의 층, 그리고 라벨(핀 이름)입니다.</li>
      </ul>
      <div className="vb-figs">
        {FIGS.map(f => <figure key={f.src}><a href={f.src} target="_blank" rel="noreferrer" title="새 탭에서 크게 보기"><img src={f.src} alt={f.title} loading="lazy"/></a><figcaption><b>{f.title}</b><br/>{f.note}</figcaption></figure>)}
      </div>
    </section>

    <section className="card vb-card">
      <div className="card-title"><div><small className="kicker">SKILL API</small><h2>구현한 SKILL 함수</h2></div></div>
      <div className="data-table"><table><thead><tr><th>분류</th><th>함수</th></tr></thead>
        <tbody>{FUNCS.map(f => <tr key={f.group}><td><b>{f.group}</b></td><td>{f.items}</td></tr>)}</tbody></table></div>
    </section>

    <VbPnrEstimate/>

    <VbSupportMatrix/>

    <section className="card vb-card">
      <div className="card-title"><div><small className="kicker">LIMITS</small><h2>한계와 미검증 항목</h2></div></div>
      <ul className="vb-limits">{LIMITS.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </section>

    <section className="card vb-card">
      <div className="card-title"><div><small className="kicker">RUN</small><h2>실행 방법</h2></div></div>
      <pre className="vb-run">{RUN.join('\n')}</pre>
      <p className="vb-note">코드: <code>tools/vvirt/src/vvirt</code> (skill_lang · odb · skill_funcs · export · stdcell · gdsio · server), 원본 브리지: <code>tools/virtuoso-bridge-lite</code>.</p>
    </section>
  </>
}
