// VB 탭 — compose(라이브러리 셀로 새 표준셀 조립)와 실제 Virtuoso용 읽기 전용 probe.
// compose 데이터: vbCompose.json (tools/vvirt/workspace/_out/compose/review.json 에서 옮김, 2026-10-16 22:12 실행).
// probe 는 가상 Virtuoso에서 로직 시험만 했고 실제 Cadence에서는 실행하지 않았다.
import raw from '../data/vbCompose.json'

type Item = { kind: string; severity: string; msg: string; bbox: number[] | null }
type Data = {
  generated: string; spec: string; cell: string; size_um: number[]; instances: [string, string, number][]
  nets: Record<string, string[]>; ports: Record<string, string>; stats: Record<string, number>; items: Item[]
  wire_shapes: number; drc: { ran: boolean; scope: string; items: number }; verilog: string; svg: string; test: string
}
const d = raw as unknown as Data

const PROBE_SECTIONS: { name: string; gets: string }[] = [
  { name: 'functions', gets: '필요한 SKILL 함수가 이 설치에 있는지 이름별 true/false' },
  { name: 'libraries', gets: '라이브러리 목록과 경로' },
  { name: 'cells', gets: '지정 라이브러리의 셀 수와 이름(최대 개수 제한)' },
  { name: 'tech', gets: 'tech 라이브러리 연결, 레이어, dbu 등' },
  { name: 'cell', gets: '지정 셀의 bBox, 레이어/purpose별 도형 수' },
]

export default function VbCompose() {
  const errors = d.items.filter(i => i.severity === 'error').length
  return <section className="card vb-card">
    <div className="card-title"><div><small className="kicker">COMPOSE · PROBE</small><h2>라이브러리 셀로 새 셀 조립 + 실제 Virtuoso 사전 점검</h2></div><span className="connection">{d.generated.replace('T', ' ')}</span></div>
    <p className="vb-lead">
      <b>compose</b>는 Virtuoso 없이 스펙(JSON)만으로 sky130 라이브러리 셀을 이어 붙이고 배선해 GDS · LEF · Verilog와 검토 목록을 만듭니다.
      계층(라이브러리 셀마다 SREF 1개)과 스펙의 인스턴스 이름을 유지해, 사람이 Virtuoso에서 마무리할 수 있게 하는 것이 목적입니다.
    </p>
    <div className="vb-figs">
      <figure><img src={d.svg} alt={`${d.cell} 배치와 배선`}/>
        <figcaption>{d.cell}: {d.size_um[0].toFixed(2)} × {d.size_um[1].toFixed(2)} µm, 라이브러리 셀 {d.instances.length}개, 배선 도형 {d.wire_shapes}개. 보라 met2 · 초록 met3.</figcaption></figure>
      <div>
        <div className="data-table"><table>
          <thead><tr><th>항목</th><th>결과</th></tr></thead>
          <tbody>
            <tr><td><b>인스턴스</b></td><td>{d.instances.map(i => `${i[0]} = ${i[1].replace('sky130_fd_sc_hd__', '')} @x ${i[2]}`).join(' · ')}</td></tr>
            <tr><td><b>연결 검사</b></td><td>스펙 넷 {Object.keys(d.nets).length}개 중 기하로 연결 확인 {d.stats.nets_connected_ok ?? 0}개</td></tr>
            <tr><td><b>공식 DRC</b></td><td>{d.drc.ran ? `실행함 · ${d.drc.scope} · 항목 ${d.drc.items}건` : '실행 안 함'}</td></tr>
            <tr><td><b>검토 항목</b></td><td>{d.items.length === 0 ? '없음' : `${d.items.length}건 (error ${errors})`}</td></tr>
            <tr><td><b>테스트</b></td><td>{d.test}</td></tr>
          </tbody>
        </table></div>
        <pre className="vb-run">{d.verilog}</pre>
      </div>
    </div>
    <p className="vb-note">
      실행: <code>PYTHONPATH=tools/vvirt/src python3 tools/vvirt/examples/compose_cell.py {d.spec}</code>.
      한계: 배선은 핀마다 met3까지 비아 스택 + met2 트렁크 1개인 작은 설계이고 일반 라우터가 아닙니다. DRC는 BEOL만 봤고 FEOL·antenna·density, prBoundary 출력, 실제 LVS는 확인하지 않았습니다.
      만든 GDS를 다시 읽어 비교하려면 <code>examples/roundtrip_check.py</code>를 씁니다.
    </p>

    <h3 className="vb-sub">probe — 실제 Virtuoso에 처음 붙을 때 돌리는 읽기 전용 점검</h3>
    <div className="data-table"><table>
      <thead><tr><th>섹션</th><th>가져오는 것</th></tr></thead>
      <tbody>{PROBE_SECTIONS.map(s => <tr key={s.name}><td><code>probe_{s.name}.json</code></td><td>{s.gets}</td></tr>)}</tbody>
    </table></div>
    <p className="vb-note">
      섹션마다 errset으로 감싸서 하나가 실패해도 나머지는 계속 돌고, 실패는 <code>status=error</code>로 기록됩니다. 아무것도 쓰거나 수정하지 않습니다.
      검증: 가상 Virtuoso에서 12/12(tests/test_probe.py). <b>실제 Cadence에서는 아직 실행하지 않았습니다.</b>
      실행: <code>bash tools/vvirt/scripts/pyrun.sh tools/vvirt/probe/run_probe.py --lib &lt;라이브러리&gt; --cell &lt;셀&gt;</code>
    </p>
  </section>
}
