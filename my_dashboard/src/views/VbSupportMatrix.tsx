// VB 탭 — SKILL 지원 범위와 "왜 안 되는지". 데이터는 tools/vvirt/examples/support_matrix.py 가 실제 인터프리터에서 뽑는다.
import support from '../data/vbSupport.json'

interface Row { name: string; status: 'supported' | 'unsupported' | 'stub'; kind?: string; why?: string }
const CORE = support.core as unknown as Record<string, Row[]>
const BRIDGE = support.bridge as unknown as Row[]
const S = support.summary as unknown as { core_total: number; core_supported: number; bridge_total: number; bridge: { supported: number; stub: number; unsupported: number }; vvirt_functions: number; special_forms: number }

const KIND: Record<string, { label: string; note: string }> = {
  safety: { label: '의도적 제외', note: '호스트 명령 실행·파일 삭제처럼 안전을 위해 일부러 막음' },
  parser: { label: '파서 한계', note: '배열 a[i] 같은 구문을 파서가 모름 — 구현하려면 파서와 값 타입을 함께 고쳐야 함' },
  evaluator: { label: '평가기 한계', note: '매크로 확장 단계가 없음' },
  semantics: { label: '의미 재현 어려움', note: 'Cadence와 같은 결과를 보장하기 어려움' },
  scope: { label: '범위 밖', note: 'Maestro·스키매틱·GUI 등 레이아웃 도구가 다루지 않는 영역' },
  model: { label: '데이터 모델 없음', note: '넷·핀·선 같은 개념을 저장하지 않음' },
  stub: { label: '빈 껍데기', note: '호출은 받지만 아무 일도 하지 않고 nil 반환' },
  todo: { label: '미구현(가능)', note: '구현은 가능하나 사용 빈도가 낮아 보류' },
}

function groupBridge() {
  const by = new Map<string, { kind: string; why: string; names: string[] }>()
  for (const r of BRIDGE) {
    if (r.status === 'supported') continue
    const key = `${r.kind}|${r.why}`
    if (!by.has(key)) by.set(key, { kind: r.kind ?? 'todo', why: r.why ?? '', names: [] })
    by.get(key)!.names.push(r.name)
  }
  return [...by.values()].sort((a, b) => b.names.length - a.names.length)
}

export default function VbSupportMatrix() {
  const groups = groupBridge()
  const pct = (a: number, b: number) => `${Math.round((a / b) * 100)}%`
  return <section className="card vb-card">
    <div className="card-title"><div><small className="kicker">SKILL COVERAGE</small><h2>SKILL 명령을 어디까지 지원하나, 왜 안 되나</h2></div><span className="connection">2026-10-14</span></div>
    <p className="vb-lead"><b>SKILL 명령을 전부 지원하지는 않습니다.</b> Virtuoso의 SKILL 함수는 수천 개이고, 이 가상 Virtuoso는 레이아웃 편집에 필요한 부분을 구현한 부분집합입니다. 아래 숫자는 인터프리터에 실제로 정의된 이름을 세어서 뽑았습니다.</p>
    <div className="stats ppa-experiment-stats">
      <div className="stat-card"><small>핵심 SKILL 언어 (고른 {S.core_total}개)</small><strong>{S.core_supported} 지원</strong><span>{pct(S.core_supported, S.core_total)} · 미지원 {S.core_total - S.core_supported}개는 아래에 사유 표시</span></div>
      <div className="stat-card"><small>브리지가 LLM에게 쓰라는 Cadence 함수 {S.bridge_total}개</small><strong>{S.bridge.supported} 지원</strong><span>{pct(S.bridge.supported, S.bridge_total)} · 빈 껍데기 {S.bridge.stub} · 미지원 {S.bridge.unsupported}</span></div>
      <div className="stat-card"><small>vvirt가 정의한 것</small><strong>{S.vvirt_functions}개</strong><span>함수 + 특수 형식 {S.special_forms}개</span></div>
    </div>
    <p className="vb-note">핵심 언어 목록은 제가 흔히 쓰는 함수를 골라 만든 것이라 SKILL 전체가 아닙니다. 이 중 상당수는 2026-10-14에 추가한 것이라 비율이 높게 나오는 편향이 있습니다. 브리지 참조 목록(문서·예제·skill 파일에서 뽑은 Cadence 함수)이 실제 사용 범위에 더 가깝습니다.</p>

    <h3 style={{ margin: '14px 0 4px', fontSize: 14 }}>1. 핵심 SKILL 언어 — 그룹별 지원과 미지원 사유</h3>
    <div className="data-table"><table><thead><tr><th>그룹</th><th>지원</th><th>미지원 (사유)</th></tr></thead><tbody>
      {Object.entries(CORE).map(([g, rows]) => {
        const bad = rows.filter(r => r.status !== 'supported')
        return <tr key={g}><td><b>{g}</b></td><td>{rows.length - bad.length} / {rows.length}</td>
          <td>{bad.length === 0 ? <span className="ok-text">모두 지원</span> : bad.map(r => <div key={r.name}><code>{r.name}</code> — <b>{KIND[r.kind ?? 'todo']?.label}</b>: {r.why}</div>)}</td></tr>
      })}
    </tbody></table></div>

    <h3 style={{ margin: '14px 0 4px', fontSize: 14 }}>2. 브리지가 쓰라고 하는 Cadence 함수 중 지원 안 되는 것 ({S.bridge.stub + S.bridge.unsupported}개)</h3>
    <div className="data-table"><table><thead><tr><th>개수</th><th>분류</th><th>이유</th><th>예</th></tr></thead><tbody>
      {groups.map((g, i) => <tr key={i}><td><b>{g.names.length}</b></td><td>{KIND[g.kind]?.label ?? g.kind}</td><td>{g.why}</td>
        <td><small>{g.names.slice(0, 8).map(n => <code key={n} style={{ marginRight: 6 }}>{n}</code>)}{g.names.length > 8 ? '…' : ''}</small></td></tr>)}
    </tbody></table></div>

    <h3 style={{ margin: '14px 0 4px', fontSize: 14 }}>사유 분류 설명</h3>
    <div className="data-table"><table><tbody>
      {Object.values(KIND).map(k => <tr key={k.label}><td><b>{k.label}</b></td><td>{k.note}</td></tr>)}
    </tbody></table></div>
    <p className="vb-note">전체 표와 생성 방법: <code>tools/vvirt/SUPPORT.md</code> · <code>python3 tools/vvirt/examples/support_matrix.py</code>. 추가한 핵심 함수의 동작은 <code>tools/vvirt/tests/test_core_ext.py</code>(78개 예제, 값까지 비교)로 확인했습니다. 실제 Cadence와 같은 결과인지는 비교한 적이 없습니다.</p>
  </section>
}
