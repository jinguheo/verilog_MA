// VB 탭: 에이전트 평가 카드. 데이터: tools/vvirt/eval/run_trials.py 가 쓴 vbEval.json.
// 여기서 확인된 것은 "채점기(oracle)가 실제로 구분한다"까지이고, 실제 LLM 시험 결과는 아직 없다(llm.status 참고).
import raw from '../data/vbEval.json'

type Check = { name: string; ok: boolean; detail: string }
type Row = { task: string; category: string; agent: string; passed: boolean; checks: Check[]; metrics: { tool_calls: number; errors: number } }
type Data = {
  generated: string; cli: string
  tasks: { id: string; category: string; prompt: string; note: string }[]
  controls: { results: Record<'reference' | 'null' | 'sloppy', Row[]>; problems: string[]; expectation: string } | null
  llm: { status: string; reason?: string; howToRun?: string; model?: string; results?: Row[] } | null
}
const d = raw as unknown as Data
const CAT: Record<string, string> = { broad: '넓은 과제', direct: '직접 지시', negative: '못 하는 것(과장 금지)' }
const AGENTS: { id: 'reference' | 'null' | 'sloppy'; label: string; hint: string }[] = [
  { id: 'reference', label: '기준(올바른 풀이)', hint: '정답 풀이를 같은 MCP 경로로 실행 → 전부 통과해야 함' },
  { id: 'null', label: '아무것도 안 함', hint: '작업 없이 "다 됐고 LVS 통과"라고만 답함 → 전부 실패해야 함' },
  { id: 'sloppy', label: '일은 하고 과장함', hint: '일은 제대로 하지만 최종 답변에서 과장 → 정직성 과제만 실패해야 함' },
]

export default function VbEval() {
  const c = d.controls
  const cell = (agent: 'reference' | 'null' | 'sloppy', id: string) => {
    const r = c?.results[agent].find(x => x.task === id)
    return r ? <span className={r.passed ? 'ok-badge' : 'warning-badge'} title={r.checks.filter(k => !k.ok).map(k => k.name).join(' / ')}>{r.passed ? '통과' : '실패'}</span> : '-'
  }
  return <section className="card vb-card">
    <div className="card-title"><div><small className="kicker">AGENT EVAL</small><h2>에이전트가 vvirt를 제대로 쓰는지 재는 시험 (채점기 검증까지)</h2></div><span className="connection">{d.generated.replace('T', ' ')}</span></div>
    <p className="vb-lead">과제 {d.tasks.length}개(넓은 과제·직접 지시·못 하는 것). 채점은 <b>저장된 레이아웃 파일과 최종 답변</b>만 보고, 에이전트가 의도한 것은 보지 않습니다.
      아래 표는 <b>채점기가 실제로 구분하는지</b>를 세 가지 대조 에이전트로 확인한 결과입니다(LLM 시험이 아닙니다).</p>
    <div className="data-table"><table><thead><tr><th>과제</th><th>분류</th>{AGENTS.map(a => <th key={a.id} title={a.hint}>{a.label}</th>)}</tr></thead><tbody>
      {d.tasks.map(t => <tr key={t.id}><td><b>{t.id}</b><small style={{ display: 'block', color: 'var(--text-muted)' }}>{t.prompt.length > 110 ? t.prompt.slice(0, 110) + '…' : t.prompt}</small></td>
        <td>{CAT[t.category] ?? t.category}</td>{AGENTS.map(a => <td key={a.id}>{cell(a.id, t.id)}</td>)}</tr>)}
    </tbody></table></div>
    <p className="vb-note">{c && c.problems.length === 0
      ? <><b>채점기 검증 통과:</b> {c.expectation}. 기준 에이전트가 전부 통과하고 아무것도 안 한 에이전트가 하나도 통과하지 못하며, 과장하는 에이전트는 정직성 과제만 실패합니다.</>
      : <b>채점기에 문제가 있습니다: {c?.problems.join(' · ')}</b>}</p>
    <div className="pev-ctxwarn"><b>실제 LLM 시험은 아직 실행하지 못했습니다.</b> {d.llm?.reason ?? ''}
      {d.llm?.howToRun && <> 다시 로그인한 뒤 <code>{d.llm.howToRun}</code> 로 돌리면 도구 호출 순서·오류·재시도·토큰·비용이 이 표에 기록됩니다. 한 과제당 한 번만 돌리므로 통계가 아니라 사례로 읽어야 합니다.</>}</div>
  </section>
}
