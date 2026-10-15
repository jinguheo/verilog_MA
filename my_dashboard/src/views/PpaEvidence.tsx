// PPA3 실행 결과의 "근거 기록". 데이터: tools/collect_ppa3_results.py 가 tools/ppa3_evidence.py 로 run 폴더에서 만든 JSON.
// 모든 숫자가 관찰/유도/추론/알 수 없음 중 무엇인지, 어느 파일의 어느 키에서 왔는지(sha256 일부)를 보여 주고
// 두 run 을 비교할 때는 값이 알 수 없는 쪽을 '같다/차이'로 세지 않는다 (tools/evidence.py compare 와 같은 규칙).
import { useMemo, useState } from 'react'
import raw from '../data/ppa3Evidence.json'
import './ppa-evidence.css'

type Claim = {
  id: string; kind: 'observed' | 'derived' | 'inferred' | 'unknown'; name: string; value: unknown
  unit?: string; note?: string; depends_on_context?: string[]; reason?: string; rule?: string; from?: string[]; basis?: string; confidence?: string; limitations?: string[]
  source?: { input?: string | null; tool?: string; key: string; step?: string; first_seen_step?: string }
}
type Bundle = {
  subject: { id: string; label?: string }; produced: { by: string; at: string }; environment: Record<string, unknown>
  inputs: Record<string, { path: string; role: string; sha256: string; bytes: number }>; context: Record<string, unknown>
  claims: Claim[]; limitations: string[]; coverage: Record<Claim['kind'], number>
}
const data = raw as unknown as { generated: string; runs: Record<string, Bundle> }
const names = Object.keys(data.runs)

const KIND: Record<Claim['kind'], { label: string; hint: string; color: string }> = {
  observed: { label: '관찰', hint: '파일에서 직접 읽은 값', color: '#1D9E75' },
  derived: { label: '유도', hint: '관찰한 값에 규칙을 적용해 계산', color: '#378ADD' },
  inferred: { label: '추론', hint: '파일에서 읽은 값이 아닌 해석', color: '#C0A02B' },
  unknown: { label: '알 수 없음', hint: '측정되지 않음 (0도 통과도 아님)', color: '#d4472a' },
}
const fmt = (v: unknown, unit?: string) => v === null || v === undefined ? '—' : typeof v === 'number' ? `${Number.isInteger(v) ? v : Number(v.toPrecision(5))}${unit && unit !== 'count' ? ' ' + unit : ''}` : typeof v === 'object' ? JSON.stringify(v) : String(v)

function compare(l: Bundle, r: Bundle) {
  const m = (bd: Bundle) => new Map(bd.claims.filter(c => c.kind !== 'inferred').map(c => [c.name, c]))
  const lm = m(l), rm = m(r)
  const keys = [...new Set([...Object.keys(l.context), ...Object.keys(r.context)])].sort()
  const ctx = keys.filter(k => JSON.stringify(l.context[k]) !== JSON.stringify(r.context[k])).map(k => ({ k, a: l.context[k], b: r.context[k] }))
  const differing = new Set(ctx.map(c => c.k))
  const rows = [...new Set([...lm.keys(), ...rm.keys()])].sort().map(name => {
    const a = lm.get(name), b = rm.get(name)
    if (a && b && a.kind !== 'unknown' && b.kind !== 'unknown') {
      const num = typeof a.value === 'number' && typeof b.value === 'number'
      const delta = num ? (b.value as number) - (a.value as number) : null
      const hit = [...new Set([...(a.depends_on_context ?? []), ...(b.depends_on_context ?? [])])].filter(k => differing.has(k))
      if (hit.length) return { name, a, b, status: 'not_like_for_like', delta, why: `값의 의미가 달라지는 설정이 다름: ${hit.join(', ')}` }
      return { name, a, b, status: a.value === b.value ? 'equal' : 'changed', delta, why: '' }
    }
    const side = [a?.kind === 'unknown' || !a ? '왼쪽' : '', b?.kind === 'unknown' || !b ? '오른쪽' : ''].filter(Boolean).join('·')
    return { name, a, b, status: 'incomparable', delta: null, why: `${side} 값을 알 수 없음` }
  })
  return { rows, ctx }
}

export default function PpaEvidence() {
  const [run, setRun] = useState(names.includes('ppa3_adcslew2_signoff') ? 'ppa3_adcslew2_signoff' : names[names.length - 1])
  const [left, setLeft] = useState(names.includes('ppa3_antfix4_signoff') ? 'ppa3_antfix4_signoff' : names[0])
  const [right, setRight] = useState(names.includes('ppa3_antfix5_signoff') ? 'ppa3_antfix5_signoff' : names[names.length - 1])
  const [kinds, setKinds] = useState<Record<Claim['kind'], boolean>>({ observed: true, derived: true, inferred: true, unknown: true })
  const b = data.runs[run]
  const cmp = useMemo(() => compare(data.runs[left], data.runs[right]), [left, right])
  const claims = b.claims.filter(c => kinds[c.kind])
  const where = (c: Claim) => {
    if (c.kind === 'observed' && c.source) {
      const f = c.source.input ? b.inputs[c.source.input] : null
      return <>{f ? <code title={f.path}>{f.path.split('/').slice(-2).join('/')}</code> : <code>{c.source.tool}</code>} · <code>{c.source.key}</code>
        {f && <small className="pev-dim"> sha {f.sha256.slice(0, 8)}</small>}
        {c.source.step && <small className="pev-dim"> · {c.source.step.replace(/^\d+-/, '')} 단계 상태</small>}
        {c.source.first_seen_step && c.source.first_seen_step !== c.source.step && <small className="pev-dim"> · {c.source.first_seen_step.replace(/^\d+-/, '')} 부터 같은 값</small>}
        {c.note && <small className="pev-warn"> {c.note}</small>}</>
    }
    if (c.kind === 'derived') return <><code>{c.rule}</code><small className="pev-dim"> ← {c.from?.join(', ')}</small></>
    if (c.kind === 'inferred') return <>{c.basis} <small className="pev-dim">· 신뢰도 {c.confidence}</small>{c.limitations?.map((l, i) => <small key={i} className="pev-warn"> ⚠ {l}</small>)}</>
    return <span className="pev-unknown">{c.reason}</span>
  }
  return <section className="card pev">
    <div className="card-title"><div><small className="kicker">PPA 3 · EVIDENCE</small><h3>이 숫자는 어떻게 알았나 — 근거 기록</h3></div><span className="connection">{data.generated.replace('T', ' ')} 기준</span></div>
    <p className="ppaov-note">위 표의 숫자마다 <b>어느 파일의 어느 키에서 읽었는지</b>, 읽은 파일의 해시, 값이 처음 나타난 단계를 기록했습니다. <b>측정되지 않은 값은 0이나 통과로 채우지 않고 &quot;알 수 없음&quot;과 그 이유</b>로 남깁니다. 기록은 <code>python tools/collect_ppa3_results.py</code> 가 만들고, <code>python tools/evidence.py validate --root .</code> 로 파일이 바뀌었는지(오래된 근거인지) 확인할 수 있습니다.</p>

    <div className="pev-legend">{(Object.keys(KIND) as Claim['kind'][]).map(k => <label key={k} title={KIND[k].hint}>
      <input type="checkbox" checked={kinds[k]} onChange={e => setKinds({ ...kinds, [k]: e.target.checked })}/><i style={{ background: KIND[k].color }}/> {KIND[k].label} <b>{b.coverage[k]}</b></label>)}</div>

    <div className="pev-pick"><label>run <select value={run} onChange={e => setRun(e.target.value)}>{names.map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      <span>{b.subject.label}</span></div>
    <div className="data-table"><table><thead><tr><th>구분</th><th>항목</th><th>값</th><th>근거 / 이유</th></tr></thead><tbody>
      {claims.map(c => <tr key={c.id}>
        <td><span className="pev-kind" style={{ background: KIND[c.kind].color }}>{KIND[c.kind].label}</span></td>
        <td><b>{c.name}</b></td><td className={c.kind === 'unknown' ? 'pev-unknown' : ''}>{c.kind === 'unknown' ? '알 수 없음' : fmt(c.value, c.unit)}</td><td className="pev-src">{where(c)}</td></tr>)}
    </tbody></table></div>
    {b.limitations.length > 0 && <ul className="pev-lims">{b.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>}
    <p className="pev-meta">환경: PDK {String(b.environment.pdk_version ?? '?').slice(0, 10)} · 기록 생성 <code>{b.produced.by}</code> · 읽은 파일 {Object.keys(b.inputs).length}개</p>

    <h4 className="pev-h">두 run 비교 — 알 수 없는 값은 &quot;같다&quot;로도 &quot;차이&quot;로도 세지 않습니다</h4>
    <div className="pev-pick"><label>왼쪽 <select value={left} onChange={e => setLeft(e.target.value)}>{names.map(n => <option key={n}>{n}</option>)}</select></label>
      <label>오른쪽 <select value={right} onChange={e => setRight(e.target.value)}>{names.map(n => <option key={n}>{n}</option>)}</select></label></div>
    {cmp.ctx.length > 0
      ? <p className="pev-ctxwarn"><b>같은 조건의 비교가 아닙니다.</b> 설정이 다른 항목: {cmp.ctx.map(c => <code key={c.k}>{c.k}: {JSON.stringify(c.a)} → {JSON.stringify(c.b)}</code>)}</p>
      : <p className="pev-ctxok">기록된 설정(클럭, 밀도, DRC 방식 등)이 같습니다.</p>}
    <div className="data-table"><table><thead><tr><th>항목</th><th>왼쪽</th><th>오른쪽</th><th>판정</th></tr></thead><tbody>
      {cmp.rows.filter(r => r.status !== 'equal' || r.a?.kind === 'observed').map(r => <tr key={r.name}>
        <td><b>{r.name}</b></td><td>{r.a?.kind === 'unknown' ? <i className="pev-unknown">알 수 없음</i> : fmt(r.a?.value, r.a?.unit)}</td>
        <td>{r.b?.kind === 'unknown' ? <i className="pev-unknown">알 수 없음</i> : fmt(r.b?.value, r.b?.unit)}</td>
        <td>{r.status === 'equal' ? '같음' : r.status === 'changed' ? <b>변함{r.delta !== null ? ` (${r.delta > 0 ? '+' : ''}${Number(r.delta.toPrecision(4))})` : ''}</b>
          : r.status === 'not_like_for_like' ? <span className="pev-warn"><b>같은 조건이 아니라 좋아졌다/나빠졌다고 말할 수 없음</b> — {r.why}</span>
          : <span className="pev-unknown">비교 불가 — {r.why}</span>}</td></tr>)}
    </tbody></table></div>
  </section>
}
