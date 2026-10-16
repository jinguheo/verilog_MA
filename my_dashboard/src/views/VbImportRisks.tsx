// VB 탭 — 외부에서 만든 GDS를 실제 Virtuoso로 import 할 때 틀어지기 쉬운 곳과, 필요한 정보·확인 순서.
// 실제 Cadence 에서는 한 번도 실행하지 않았다. 가상 Virtuoso(vvirt)와 KLayout 으로만 검증한 상태를 그대로 적는다.

const RISKS: { where: string; why: string; check: string }[] = [
  { where: '레이어맵', why: 'GDS layer/datatype 이 PDK tech 의 layer/purpose 로 정확히 매핑돼야 한다. 어긋나면 도형이 사라지거나 purpose 가 바뀐다. pin/label purpose 가 틀리면 LVS 연결이 끊긴다.', check: '사내 layermap 파일을 받아 tools/vvirt/src/vvirt/layers.py 의 번호와 대조' },
  { where: '셀 참조 (SREF)', why: 'stream-in 때 참조 라이브러리를 지정하지 않으면 같은 이름의 빈 셀이 생기거나 기존 셀이 덮어써질 수 있다. compose 결과는 라이브러리 셀을 SREF 로 쓴다.', check: 'stream-in 로그에서 skipped / unmapped / 새로 생성된 셀 확인' },
  { where: 'prBoundary · well 경계', why: 'abutment 와 P&R 인식에 필요한 레이어. 아직 검증하지 않았다.', check: '샘플 셀 stream-out 과 비교' },
  { where: 'dbu · 그리드', why: '산출물은 0.005 um 그리드. PDK 의 dbu 와 맞아야 한다.', check: 'probe 의 tech 섹션에서 dbu 확인' },
]

const NOT_VERIFIED: { what: string; state: string }[] = [
  { what: 'DRC', state: 'KLayout sky130A 덱 중 BEOL 만 통과. FEOL · antenna · density 미검증. Assura/Pegasus 등 사인오프 덱과 룰 해석이 다를 수 있음' },
  { what: 'LVS', state: '연결성은 우리 체커가 스펙 대비 기하로 본 것뿐. 실제 추출 기반 LVS 아님' },
  { what: 'LEF', state: 'compose 가 만든 LEF 가 Virtuoso 쪽 abstract 와 일치하는지 미확인' },
]

const NEED: { group: string; items: string[] }[] = [
  { group: '실제 Virtuoso 에서 받을 것', items: ['probe_*.json 5개 + probe_report.json', 'PDK 종류·버전, tech 라이브러리 이름, dbu', 'Stream 레이어맵 파일', '기존 stream-in 설정 (참조 라이브러리, 이름 충돌, 텍스트/핀 처리)'] },
  { group: '검증 기준', items: ['사인오프 DRC/LVS 덱 종류와 룰 파일', '샘플 셀 1~2개의 stream-out GDS + LEF, 핀 레이어/purpose', 'LVS 용 네트리스트 형식 (CDL/SPICE 또는 schematic 추출)'] },
  { group: '정할 것', items: ['"문제 없음"의 기준: DRC clean / LVS clean, antenna·density 포함 여부'] },
]

const STEPS: string[] = [
  '실제 Virtuoso 에서 probe 실행 (probe/run_probe.py) — 사용 가능한 함수, 라이브러리, tech 정보 확인',
  '가장 단순한 셀(inv 하나)로 참조 라이브러리를 지정해 stream-in, 로그의 skipped/unmapped 확인',
  '다시 stream-out 해서 원본 GDS 와 examples/roundtrip_check.py (vvGdsCompare) 로 비교',
  '실제 DRC · LVS 실행, compose 의 review.md 항목 확인',
  '여기까지 통과하면 compose 결과물로 같은 순서를 반복 (문제가 생기면 원인을 나누기 쉬움)',
]

export default function VbImportRisks() {
  return <section className="card vb-card">
    <div className="card-title"><div><small className="kicker">IMPORT RISKS</small><h2>외부 GDS를 Virtuoso에 import 할 때 틀어지기 쉬운 곳</h2></div><span className="connection">실제 Virtuoso 미검증</span></div>
    <p className="vb-lead">
      "똑같이 만들었다"와 "검증됐다"는 별개입니다. 지금까지는 가상 Virtuoso와 KLayout으로만 확인했고, 실제 Virtuoso에서 해 본 것은 없습니다.
      변환 설정(레이어맵, 참조 라이브러리)은 한 번 맞추면 이후 셀에 재사용되므로, 처음 한두 번 고치면서 진행하면 됩니다.
    </p>
    <div className="data-table"><table>
      <thead><tr><th>위치</th><th>왜 틀어지나</th><th>확인 방법</th></tr></thead>
      <tbody>{RISKS.map(r => <tr key={r.where}><td><b>{r.where}</b></td><td>{r.why}</td><td>{r.check}</td></tr>)}</tbody>
    </table></div>
    <h3 className="vb-sub">아직 검증되지 않은 것</h3>
    <div className="data-table"><table>
      <thead><tr><th>항목</th><th>현재 상태</th></tr></thead>
      <tbody>{NOT_VERIFIED.map(r => <tr key={r.what}><td><b>{r.what}</b></td><td>{r.state}</td></tr>)}</tbody>
    </table></div>
    <h3 className="vb-sub">더 필요한 정보</h3>
    {NEED.map(n => <div key={n.group}><b style={{ fontSize: 13 }}>{n.group}</b>
      <ul className="vb-limits">{n.items.map((s, i) => <li key={i}>{s}</li>)}</ul></div>)}
    <p className="vb-note">사내 PDK 파일은 이 저장소에 올리지 않는 것이 좋습니다. 레이어 번호 표처럼 민감한 부분을 가린 요약만으로도 대조할 수 있습니다.</p>
    <h3 className="vb-sub">확인 순서</h3>
    <ol className="vb-limits">{STEPS.map((s, i) => <li key={i}>{s}</li>)}</ol>
  </section>
}
