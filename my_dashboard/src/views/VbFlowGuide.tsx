import { useState } from 'react'

// VB 탭 — 칩 설계 파일·흐름 개념 정리(2026-10-17 대화)와 vvirt 가 지금 어디까지 하는지.
// 개념 부분은 일반 지식이다: 이 PC 의 PDK 파일을 세어 확인한 것이 아니다(레이어 수 등 숫자는 대략값).
// vvirt 범위 부분은 tools/vvirt/README.md 와 다른 VB 카드(compose, pnr_est, 지원 매트릭스)에 적힌 내용을 옮긴 것이다.

const FORMATS: { f: string; has: string; use: string; vv: string }[] = [
  { f: 'GDS', has: '레이어별 폴리곤(실제 도형), 셀 계층. 바이너리. 연결 의미·신호 이름은 거의 없음', use: '마스크 제작(테이프아웃), DRC, LVS 의 레이아웃 쪽', vv: '읽기·쓰기·요약·비교 (vvImportGds / vvExportGds / vvGdsSummary / vvGdsCompare)' },
  { f: 'LEF', has: '셀 추상 뷰: 크기, 핀 위치·레이어, 블록키지. 기술 LEF 는 배선 레이어·비아·간격', use: 'P&R 이 셀 내부 없이 배치·배선할 때', vv: '셀 LEF 로 크기·핀을 읽고, 기술 LEF 에서 규칙을 읽음 (techlef)' },
  { f: 'DEF', has: '한 설계의 다이 크기, 행, 배치된 인스턴스 좌표, 핀, 넷과 배선 경로 (셀 내부 도형 없음)', use: 'P&R 단계 간 인계, 중간 결과 점검', vv: '읽어서 점검(pnr_estimate), 넷리스트와 핀 집합 비교(conn_check), SKILL 로 변환(pnr_export)' },
  { f: '게이트 Verilog (.v)', has: '합성 결과: 표준 셀 인스턴스와 넷 연결. 셀 내부 트랜지스터는 안 보임', use: '합성 → P&R 입력, 게이트 시뮬레이션', vv: 'DEF 와 대조하는 기준. compose 가 Verilog 도 출력' },
  { f: 'SPICE / CDL', has: '트랜지스터·소자 단위 연결과 W/L 등 파라미터', use: 'LVS 의 기준, 트랜지스터 수준 시뮬레이션', vv: '가져오기와 ngspice 시뮬레이션만. LVS 는 안 함' },
  { f: '.lib (Liberty)', has: '셀의 타이밍(지연 표)·전력·면적·setup/hold. PVT 코너별 파일', use: '합성, 정적 타이밍 분석, P&R 최적화', vv: '쓰지 않음 (타이밍 미지원)' },
  { f: 'tech 파일 · 레이어맵', has: '레이어 번호↔이름, 연결(비아), 일부 규칙, 소자 정의, 표시 속성. 도구마다 형식이 다름', use: 'GDS 입출력, DRC, 추출', vv: 'layers 모듈(번호 매핑), techlef(규칙). Virtuoso 의 .tf 형식은 없음' },
]

const ROLE: { who: string; what: string }[] = [
  { who: '제작(파운드리)에 들어가는 것', what: 'GDS 하나(+요구하는 검증 리포트). 넷리스트·회로도·.lib 는 제작에 쓰이지 않는다.' },
  { who: '검증에 쓰는 것', what: 'GDS 에서 추출한 넷리스트 ↔ 스키매틱/Verilog 에서 나온 SPICE 를 비교(LVS). 기준이 없으면 "의도대로 그렸는지" 판단할 수 없다.' },
  { who: '새 GDS 가 만들어지는 방식', what: '셀 GDS 를 배치 위치에 참조(SREF)로 끼우고, 툴이 그린 셀 사이 배선·비아·전원망을 더한다. 셀을 모으기만 하는 것이 아니다.' },
  { who: '조합 후 주의', what: '셀 단독으로 DRC 가 맞아도 이웃과 붙으면 간격·웰·밀도 문제가 생길 수 있다. 배치된 상태에서 다시 검사한다.' },
]

const LAYERS: { g: string; what: string; eg: string }[] = [
  { g: 'FEOL', what: '트랜지스터를 만드는 앞쪽 공정', eg: 'nwell, diff, tap, poly, nsdm/psdm, 문턱전압층' },
  { g: 'MEOL', what: '소자와 첫 배선 사이 연결', eg: 'licon1, li1, mcon' },
  { g: 'BEOL', what: '금속 배선과 비아', eg: 'met1~met5, via~via4' },
]

const EDA: { tool: string; role: string; note: string }[] = [
  { tool: 'Virtuoso', role: '아날로그·커스텀: 스키매틱 → 사람이 하는 반자동 레이아웃(Layout XL/GXL, 라인스, 인터랙티브/VSR 배선)', note: '셀 몇 개~수백 개 규모. SKILL 로 자동화' },
  { tool: 'Innovus', role: '디지털 자동 P&R (넷리스트+LEF+.lib → 배치·배선·CTS·최적화)', note: '상용. 수억 게이트, 타이밍 닫기 강함' },
  { tool: 'OpenLane', role: '오픈소스 디지털 흐름 (Yosys + OpenROAD + Magic/KLayout)', note: '무료, 내부를 열어볼 수 있음. 큰 설계·타이밍 닫기는 약함' },
]

type Level = '가능' | '부분' | '불가'
const SCOPE: { item: string; level: Level; detail: string }[] = [
  { item: '라이브러리 셀(LEF/GDS) 읽기·배치·수정', level: '가능', detail: 'sky130_fd_sc_hd 437개, PDK 셀 복사 후 편집(vvCopyCell). SKILL 로 인스턴스·도형·핀 조작' },
  { item: 'GDS 내보내기·가져오기·요약·비교', level: '가능', detail: '내보내기는 vvExportGds. 가져오기는 매핑 안 된 레이어와 AREF 를 건너뛰고 개수를 알려줌. identical 은 같은 도형이라는 뜻이지 전기적 동등이 아님' },
  { item: '여러 셀을 조합해 새 표준 셀 만들기', level: '가능', detail: 'compose: 스펙(JSON) → GDS·LEF·Verilog + 검토 목록. 라이브러리 셀마다 SREF 1개. 작은 설계 한정' },
  { item: '이미 있는 배치(DEF) 점검', level: '가능', detail: '겹침·격자·다이 밖·탭 거리·선 길이·혼잡 후보를 몇 초에. 최소 수정(ECO) 제안과 마커 SKILL' },
  { item: '넷리스트 ↔ DEF 연결 대조', level: '가능', detail: '핀 집합 비교(net 이름 무시, 신호 net 만). LVS 가 아님' },
  { item: '밖에서 만든 P&R 결과를 Virtuoso 로 넘기기', level: '가능', detail: 'pnr_export: 인스턴스·배선·비아를 SKILL 로 변환, 가상 Virtuoso 에 적재해 DEF 와 비교. 넷·핀 연결, 전원 스트라이프는 안 넘김' },
  { item: '스키매틱 + 시뮬레이션', level: '부분', detail: '넷리스트 수준(인스턴스, 핀→net)과 SPICE/xschem 가져오기. 그린 배선·심볼 없음. ngspice 이지 Spectre 가 아님' },
  { item: 'DRC', level: '부분', detail: 'tech LEF 기반 자체 규칙과 KLayout sky130A 덱의 BEOL 일부. 결과 nil 은 "돌린 규칙에서는 없음"이지 DRC clean 이 아님. FEOL·antenna·density 미검증' },
  { item: '배선', level: '부분', detail: 'vvRoute 는 단일 레이어·단일 넷. compose 는 핀마다 met3 까지 비아 스택 + met2 트렁크 1개. 일반 다중 넷 라우터 없음' },
  { item: 'RTL/넷리스트 합성', level: '불가', detail: 'OpenLane(Yosys) 쪽 일. vvirt 는 합성하지 않음' },
  { item: '자동 배치·배선(P&R) 전체', level: '불가', detail: 'OpenLane/OpenROAD 가 하고, vvirt 는 그 결과를 읽고 점검·변환' },
  { item: 'LVS · 기생 RC 추출', level: '불가', detail: '실제 추출 기반이 아님. 연결 일치는 핀 집합 대조뿐' },
  { item: '타이밍·전력 분석', level: '불가', detail: '.lib 를 쓰지 않음. setup/hold 는 OpenLane 사인오프 쪽' },
  { item: 'PDK 생성', level: '불가', detail: 'volare 로 받은 sky130 PDK 를 읽어서 씀. 만들지 않음' },
  { item: '실제 Cadence 에서의 동작', level: '불가', detail: '실제 Virtuoso 에서는 한 번도 실행하지 않음. 가상 Virtuoso 와의 일치는 같은 모델끼리의 일관성' },
]

const INNOVUS_STEPS: { step: string; what: string }[] = [
  { step: '1. 초기화', what: '넷리스트 · LEF · .lib · SDC 를 읽고 타이밍 뷰(코너 × 모드)를 정의' },
  { step: '2. 플로어플랜', what: '다이 크기, 매크로 배치, 핀 배치, 행 생성' },
  { step: '3. 전원 계획', what: '전원 링 · 스트라이프 · 레일, 탭 셀과 엔드캡' },
  { step: '4. 배치', what: '셀 위치 결정. 타이밍과 혼잡을 함께 고려(GigaPlace)' },
  { step: '5. 사전 CTS 최적화', what: '버퍼 삽입, 셀 사이징으로 setup 정리' },
  { step: '6. 클럭 트리 합성', what: '클럭 분배. CCOpt 가 스큐와 지연을 최적화' },
  { step: '7. 사후 CTS 최적화', what: 'setup 과 hold 를 함께 수정. hold 는 지연 버퍼로' },
  { step: '8. 배선', what: '전역 배선 후 상세 배선(NanoRoute), DRC 위반 정리' },
  { step: '9. 사후 배선 최적화', what: '실제 배선 RC 로 타이밍 재수렴, 안테나 · 크로스토크(SI) 수정' },
  { step: '10. 마무리', what: '필러 · 디캡 · 더미 필, DEF / GDS / SPEF / SDF 출력' },
]

const INNOVUS_FEATURES: { name: string; what: string }[] = [
  { name: '멀티 코너 · 멀티 모드 (MMMC)', what: 'PVT 코너와 동작 모드를 여러 개 동시에 만족. setup 과 hold 를 서로 다른 코너에서 한 번에 최적화' },
  { name: '통합 엔진', what: '배치 · 최적화 · 배선이 같은 타이밍 · 추출 엔진을 공유해 단계 사이 결과가 덜 어긋남' },
  { name: '계층 설계', what: '블록을 따로 만들고 상위에서 통합. 파티셔닝과 타임 버짓 지원' },
  { name: '저전력', what: '전원 도메인, 레벨시프터, 아이솔레이션, 파워 게이팅을 UPF 로 처리' },
  { name: '물리 인식 최적화', what: '혼잡 · IR drop · 전자이동(EM)을 최적화에 반영' },
  { name: 'ECO', what: '셀 교체 · 버퍼 삽입 · 이동 같은 작은 변경을 스크립트로 반영' },
  { name: '생태계 연계', what: 'Genus(합성), Quantus(RC 추출), Tempus(타이밍), Voltus(전력), Pegasus(DRC/LVS), Virtuoso(OA 공유)' },
]

const LEVEL_CLS: Record<Level, string> = { 가능: 'ok-text', 부분: '', 불가: 'bad-text' }

const TABS = [
  { id: 'formats', label: '파일 포맷' },
  { id: 'flow', label: '제작·검증 흐름' },
  { id: 'layers', label: '층 구조' },
  { id: 'eda', label: 'EDA 도구' },
  { id: 'scope', label: 'vvirt 범위' },
] as const
type TabId = typeof TABS[number]['id']

export default function VbFlowGuide() {
  const [tab, setTab] = useState<TabId>('formats')
  return <section className="card vb-card">
    <div className="card-title"><div><small className="kicker">FLOW GUIDE</small><h2>파일 포맷과 칩 제작 흐름 정리 + vvirt 가 하는 범위</h2></div><span className="connection">2026-10-17</span></div>
    <p className="vb-lead">
      핵심은 <b>GDS 는 만드는 데 쓰고, 넷리스트·회로도는 맞게 만들었는지 확인하는 데 쓴다</b>는 점입니다.
      아래 탭에서 주제별로 볼 수 있습니다.
    </p>
    <div className="vb-chips">{TABS.map(t => <button key={t.id} className={t.id === tab ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}</div>

    {tab === 'formats' && <>
      <div className="data-table"><table>
        <thead><tr><th>포맷</th><th>담는 것</th><th>쓰는 곳</th><th>vvirt 에서</th></tr></thead>
        <tbody>{FORMATS.map(r => <tr key={r.f}><td><b>{r.f}</b></td><td>{r.has}</td><td>{r.use}</td><td>{r.vv}</td></tr>)}</tbody>
      </table></div>
      <p className="vb-note">한 줄 비유: LEF 는 부품 카탈로그(크기·핀), DEF 는 그 부품을 실제로 놓은 도면(좌표), GDS 는 실제 도형 전체, 넷리스트는 연결 명세서입니다.
        셀 하나에는 .gds(도형) · .lef(P&amp;R용 약도) · .v(동작 모델) · .spice(트랜지스터 연결) · .lib(타이밍) 가 따로 있고, DRC 룰은 셀마다가 아니라 공정 단위로 하나입니다.</p>
    </>}

    {tab === 'flow' && <>
      <div className="data-table"><table>
        <thead><tr><th>구분</th><th>내용</th></tr></thead>
        <tbody>{ROLE.map(r => <tr key={r.who}><td><b>{r.who}</b></td><td>{r.what}</td></tr>)}</tbody>
      </table></div>
      <pre className="vb-run">{`디지털:  RTL → 합성 → P&R → 스트림아웃(셀 GDS 참조 + 배선 도형) → DRC/LVS/타이밍 → GDS
아날로그: 스키매틱 → 레이아웃(사람, 반자동) → DRC/LVS → GDS
혼성:    디지털 블록은 P&R 로, 아날로그는 Virtuoso 로 만든 뒤 Virtuoso 최상위에서 stream-in 으로 합침`}</pre>
    </>}

    {tab === 'layers' && <>
      <div className="data-table"><table>
        <thead><tr><th>구분</th><th>무엇</th><th>레이어 예</th></tr></thead>
        <tbody>{LAYERS.map(r => <tr key={r.g}><td><b>{r.g}</b></td><td>{r.what}</td><td><code>{r.eg}</code></td></tr>)}</tbody>
      </table></div>
      <ul className="vb-limits">
        <li><b>배선 층</b>은 li1 + met1~met5 로 6개. 설계자는 이 안에서 몇 층까지 쓸지 고른다(층 수 자체는 공정 옵션이라 더 못 넣는다).</li>
        <li><b>마스크 층 전체</b>는 약 25~30개(대략값). 소자 형성용이 배선 아래에 더 있다. GDS 레이어(drawing/pin/label 등 조합)는 100개 이상으로 보이지만 마스크와 1:1 이 아니다.</li>
        <li>파운드리는 GDS 를 받아 OPC · 더미 필 · 층 조합을 내부에서 처리해 마스크를 만든다.</li>
        <li><b>FEOL 룰</b>은 poly 폭·게이트 연장·웰 탭 간격처럼 여러 레이어의 조합 관계가 많다. BEOL 룰은 금속 폭·간격·비아 덮임 같은 단순한 기하 룰이다. 표준 셀을 그대로 배치만 하면 FEOL 은 셀 안에서 이미 해결돼 있다.</li>
      </ul>
    </>}

    {tab === 'eda' && <>
      <div className="data-table"><table>
        <thead><tr><th>도구</th><th>하는 일</th><th>특징</th></tr></thead>
        <tbody>{EDA.map(r => <tr key={r.tool}><td><b>{r.tool}</b></td><td>{r.role}</td><td>{r.note}</td></tr>)}</tbody>
      </table></div>
      <p className="vb-note">Virtuoso 는 Innovus 처럼 완전 자동 P&amp;R 을 하지 않습니다. 디지털 블록은 Innovus/OpenLane 에서 P&amp;R 한 뒤 GDS(또는 DEF)를 Virtuoso 로 가져와 상위에 통합하는 것이 혼성 칩의 표준 흐름입니다.
        이 프로젝트에서는 OpenLane 이 앞부분, vvirt 가 가져와서 다루는 부분을 가상으로 맡습니다.</p>

      <h3 className="vb-sub">Innovus 자세히</h3>
      <p className="vb-note">Cadence 의 디지털 자동 P&amp;R 툴(이전 제품 Encounter 의 후속). 합성된 넷리스트를 받아 칩 레이아웃을 만들고 타이밍을 맞춥니다.
        아래는 일반 지식이며, 이 PC 에는 Innovus 가 없어 직접 실행해 확인한 것이 아닙니다.</p>
      <div className="data-table"><table>
        <thead><tr><th>구분</th><th>파일</th></tr></thead>
        <tbody>
          <tr><td><b>입력</b></td><td>게이트레벨 Verilog 넷리스트, SDC(타이밍 제약), LEF(기술 + 셀), .lib(코너별), 기생 RC 추출 파일(QRC tech 등), 전원 의도(UPF/CPF, 선택)</td></tr>
          <tr><td><b>출력</b></td><td>DEF, GDS(또는 OA), 배선 포함 넷리스트, SPEF(기생 RC), SDF(지연), 각종 리포트</td></tr>
        </tbody>
      </table></div>
      <h3 className="vb-sub">표준 흐름</h3>
      <div className="data-table"><table>
        <thead><tr><th>단계</th><th>하는 일</th></tr></thead>
        <tbody>{INNOVUS_STEPS.map(r => <tr key={r.step}><td><b>{r.step}</b></td><td>{r.what}</td></tr>)}</tbody>
      </table></div>
      <h3 className="vb-sub">핵심 기능</h3>
      <div className="data-table"><table>
        <thead><tr><th>기능</th><th>내용</th></tr></thead>
        <tbody>{INNOVUS_FEATURES.map(r => <tr key={r.name}><td><b>{r.name}</b></td><td>{r.what}</td></tr>)}</tbody>
      </table></div>
      <ul className="vb-limits">
        <li><b>사용 방식</b>: TCL 스크립트 중심(<code>init_design</code>, <code>place_design</code>, <code>ccopt_design</code>, <code>routeDesign</code>, <code>optDesign</code> 등). GUI 도 있으나 실무에서는 스크립트로 자동화.</li>
        <li><b>설계자가 하는 일</b>: SDC · 전원 의도 작성, 플로어플랜과 매크로 배치 결정, 리포트(타이밍 · 혼잡 · DRC)를 읽고 설정을 바꿔 반복. 대부분의 시간이 이 반복.</li>
        <li><b>장점</b>: 타이밍 · 면적 · 전력 결과가 좋은 편, 대규모 설계에서 안정적, 선진 공정 룰 지원, 사인오프 툴과 연결.</li>
        <li><b>단점</b>: 라이선스가 매우 비쌈, 설정 항목이 많아 숙련 필요, 내부가 닫혀 있어 동작을 열어볼 수 없음.</li>
        <li><b>이 프로젝트와의 관계</b>: OpenLane 이 같은 단계 구조에서 Innovus 자리를 맡습니다. 매크로 전원 미연결, 홀드 버퍼 배치 실패, 라우팅 혼잡, 계층 설계의 setup/hold 미해결은 Innovus 에서는 전원 계획 · CCOpt · 사후 배선 최적화가 다루는 영역이지만, Innovus 로 바꾸면 사라진다고 단정할 수는 없습니다(같은 설계로 실제로 돌려 봐야 앎).</li>
        <li><b>vvirt 와의 관계</b>: Innovus 가 낸 DEF / GDS 도 표준 포맷이라 같은 방식으로 읽고 점검할 수 있어 보이지만, Innovus 출력으로는 실행해 본 적이 없습니다.</li>
      </ul>
    </>}

    {tab === 'scope' && <>
      <div className="data-table"><table>
        <thead><tr><th>항목</th><th>수준</th><th>설명</th></tr></thead>
        <tbody>{SCOPE.map(r => <tr key={r.item}><td><b>{r.item}</b></td><td><b className={LEVEL_CLS[r.level]}>{r.level}</b></td><td>{r.detail}</td></tr>)}</tbody>
      </table></div>
      <p className="vb-note"><b>한 문장 요약.</b> vvirt 는 "기존 sky130 셀을 가져다 배치·수정·조합하고 GDS 로 내보내며, 이미 있는 배치를 빠르게 점검하는 것"까지 합니다.
        합성 · 전체 P&amp;R · LVS · 타이밍 · FEOL DRC · 실제 Cadence 검증은 하지 않으므로, 여기서 나온 "문제 없음"은 사인오프를 대신하지 않습니다.</p>
    </>}
  </section>
}
