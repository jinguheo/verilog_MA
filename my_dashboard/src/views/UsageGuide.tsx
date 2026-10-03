// Macro Tetris / Macro Area Tetris 상단에 붙는 "어떻게 쓰나" 안내. 버튼이 많아서
// "무엇을 어떤 순서로 누르면 되는지"가 헷갈린다는 피드백으로 추가 — 접어 둘 수 있게
// <details>로 만들었고, 처음 보는 사람이 놓치지 않도록 기본은 펼침.
import type { ReactNode } from 'react'

export type GuideStep = { title: string; body: ReactNode }

export default function UsageGuide({ title, goal, steps, tips, caveats }: {
  title: string
  goal: ReactNode
  steps: GuideStep[]
  tips?: { when: string; what: ReactNode }[]
  caveats?: ReactNode[]
}) {
  return <details className="chip-card" open style={{ margin: '12px 0' }}>
    <summary style={{ cursor: 'pointer', fontWeight: 800, color: 'var(--text)' }}>
      <small style={{ color: 'var(--accent-strong)', letterSpacing: '.1em', marginRight: 8 }}>HOW TO USE</small>{title}
    </summary>
    <p className="chip-note" style={{ marginTop: 8 }}><b>이 탭으로 하는 일</b> — {goal}</p>
    <ol style={{ margin: '8px 0 0', paddingLeft: 20, display: 'grid', gap: 7, fontSize: 12, lineHeight: 1.55, color: 'var(--text-secondary)' }}>
      {steps.map(s => <li key={s.title}><b style={{ color: 'var(--text)' }}>{s.title}</b> — {s.body}</li>)}
    </ol>
    {tips && tips.length > 0 && <div className="data-table" style={{ marginTop: 10 }}><table>
      <thead><tr><th>이럴 때</th><th>이렇게</th></tr></thead>
      <tbody>{tips.map(t => <tr key={t.when}><td><b>{t.when}</b></td><td style={{ fontSize: 12 }}>{t.what}</td></tr>)}</tbody>
    </table></div>}
    {caveats && caveats.length > 0 && <p className="rule-disclaimer" style={{ marginTop: 10 }}>
      <b>알아둘 점</b>
      {caveats.map((c, i) => <span key={i} style={{ display: 'block', marginTop: 3 }}>· {c}</span>)}
    </p>}
  </details>
}
