// VB 탭 — "실제 Virtuoso에서 SKILL로 가져올 수 있는 정보" 정리.
// 함수 이름은 Cadence 문서/일반 사용법 기준이며 이 PC에는 Cadence가 없어 실제 설치에서는 한 번도 실행하지 않았다.
// 그래서 첫 연결 때 존재 여부를 점검하는 "프로브" 절차를 함께 적는다.

const ROWS: { what: string; skill: string; gets: string; vvirt: string }[] = [
  { what: '라이브러리·셀·view 목록', skill: 'ddGetLibList() · ddGetObj(lib)~>readPath · ddGetObj(lib)~>cells~>name · cell~>views~>name', gets: '라이브러리 경로, 셀 이름, view 종류', vvirt: '지원 (vvLibraries / vvCells)' },
  { what: '레이아웃 도형', skill: 'dbOpenCellViewByType(lib cell "layout") · cv~>shapes (~>layerName ~>purpose ~>bBox ~>pointArray)', gets: '레이어·purpose별 도형 좌표', vvirt: '지원' },
  { what: '인스턴스·계층', skill: 'cv~>instances (~>name ~>libName ~>cellName ~>xy ~>orient ~>bBox)', gets: '마스터, 위치, 방향', vvirt: '지원' },
  { what: '핀·단자·넷', skill: 'cv~>terminals (~>name ~>direction) · cv~>nets', gets: '핀 이름·방향, 넷 연결', vvirt: '핀 좌표만 (vvPin / vvCellInfo). 넷은 모델링하지 않음' },
  { what: 'Tech file 객체', skill: 'techGetTechFile(ddGetObj(lib)) · techGetTechLibName(lib)', gets: '이 라이브러리가 어느 tech 라이브러리에 붙는지', vvirt: '껍데기만 (sky130 고정)' },
  { what: 'Tech file 전체 텍스트', skill: 'techDumpTechFile 계열 또는 CIW의 Tech File Manager (함수 이름은 버전별 확인 필요)', gets: '레이어 번호, 비아, 규칙, 표시 정보 전체', vvirt: '없음' },
  { what: '사용 가능한 레이어', skill: 'leGetValidLayerList()', gets: '레이어·purpose 쌍', vvirt: '대체 구현 (vvLayers, sky130 표)' },
  { what: '비아 정의', skill: 'techFindViaDefByName(tf name) · tech file의 viaDefs 섹션', gets: '컷 크기, enclosure, 연결 레이어', vvirt: '내장 표 (vvViaDefs)' },
  { what: '제약(constraint) 규칙', skill: 'constraint group 관련 함수 (Cadence 버전 차이가 가장 큼)', gets: '최소 폭·간격 등 PDK 규칙', vvirt: '없음 (규칙은 tech LEF에서 읽음)' },
  { what: '스트림 레이어 맵', skill: 'run_shell_command 로 strmout 실행 · xstSetField / xstOutDoTranslate', gets: '레이어·purpose ↔ GDS 번호', vvirt: '에뮬레이션' },
]

const SAVE: string[] = [
  'Virtuoso 쪽: SKILL 이 outfile / fprintf 로 JSON 텍스트를 파일로 쓴다 (SKILL 에는 JSON 기본 기능이 없어 직접 조립).',
  'bridge: download_file 로 그 파일을 내려받는다. execute_skill 반환값으로 큰 데이터를 받는 방식은 느리고 잘릴 수 있어 쓰지 않는다.',
  'Python: json.load 로 읽고, 파일 크기·줄 수와 파싱 성공 여부를 바로 검사한다.',
  '구조가 있는 정보(목록·속성·핀·비아)는 JSON, tech file 전체·스트림 맵·LEF 는 도구가 만든 원본 텍스트 그대로 보존한다 (기준은 원본).',
  'JSON 쓸 때: 따옴표·역슬래시 이스케이프 함수, 숫자/문자열 구분(sprintf), nil → null 처리가 필요하다.',
]

const PROBE: string[] = [
  '1) 존재 확인: help(함수이름) / apropos("tech") 로 위 함수가 이 설치에 있는지 먼저 본다.',
  '2) 읽기 전용 추출만 실행: 라이브러리 → 셀 → tech 연결 → 레이어 → 비아 순서. 아무것도 쓰거나 수정하지 않는다.',
  '3) 결과 보고서: 되는 함수 / 안 되는 함수 / 저장된 파일 / 파싱 검사 결과.',
  '4) 보고서에 맞춰 이후 추출 코드를 짠다. 안 되는 항목은 shell 도구(strmout 등)로 대체한다.',
  '구현: tools/vvirt/probe/vb_probe.il (읽기 전용 SKILL, 섹션마다 errset) + run_probe.py (실행·다운로드·JSON 검사, probe_report.json 생성). 실행: bash tools/vvirt/scripts/pyrun.sh tools/vvirt/probe/run_probe.py --lib <라이브러리> --cell <셀>',
  '검증: 가상 Virtuoso에서 로직 시험 12/12 통과(tests/test_probe.py)와 실제 bridge 클라이언트+daemon 경유 실행 성공. 실제 Cadence에서는 아직 실행하지 않았다.',
]

export default function VbSkillInfo() {
  return <section className="card vb-card">
    <div className="card-title"><div><small className="kicker">SKILL INFO</small><h2>SKILL로 가져올 수 있는 정보 (실제 Virtuoso 기준)</h2></div><span className="connection">미검증 · 함수명 확인 필요</span></div>
    <p className="vb-lead">
      외부에서 작업한 뒤 Virtuoso에서 마무리하려면, <b>Virtuoso가 가진 tech·레이어·셀 정보</b>를 한 번 정확히 가져오는 것이 출발점입니다.
      아래는 SKILL로 읽을 수 있는 항목과, 가상 Virtuoso(vvirt)가 어디까지 같은 이름으로 흉내 내는지 정리한 표입니다.
    </p>
    <div className="data-table"><table>
      <thead><tr><th>정보</th><th>SKILL 호출</th><th>얻는 내용</th><th>vvirt 현황</th></tr></thead>
      <tbody>{ROWS.map(r => <tr key={r.what}><td><b>{r.what}</b></td><td><code>{r.skill}</code></td><td>{r.gets}</td><td>{r.vvirt}</td></tr>)}</tbody>
    </table></div>
    <h3 className="vb-sub">저장 방식</h3>
    <ul className="vb-limits">{SAVE.map((s, i) => <li key={i}>{s}</li>)}</ul>
    <h3 className="vb-sub">처음 연결할 때 프로브 절차</h3>
    <ul className="vb-limits">{PROBE.map((s, i) => <li key={i}>{s}</li>)}</ul>
    <p className="vb-note">주의: 위 함수 이름은 Cadence 문서와 일반 사용법을 기준으로 적은 것이며, 이 저장소의 환경에서 실제 Cadence로 실행해 확인한 항목은 없습니다. 특히 tech file 덤프와 constraint 함수는 버전마다 이름이 다릅니다.</p>
  </section>
}
