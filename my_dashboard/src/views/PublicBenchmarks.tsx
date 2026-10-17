// 하네스 평가 탭 — 공개 벤치마크 결과(Terminal-Bench). 우리가 직접 측정한 값이 아니다.
// 출처 1: Snorkel Terminal-Bench 2.1 리더보드(https://snorkel.ai/leaderboard/terminal-bench-2-1/), 2026-10-17 에 페이지 요약 도구로 읽은 18행.
// 출처 2: BenchLM Terminal-Bench 2.0 open-weight 순위(2026-10-16 자 스냅샷), 검색 결과 요약으로만 확인했고 페이지는 열지 못했다.
// 모델 이름은 출처에 적힌 그대로이며 따로 검증하지 않았다. 두 출처는 벤치마크 버전(2.1 / 2.0)이 달라 점수를 섞어 비교하면 안 된다.

type Row = { harness: string; model: string; date: string; score: number; ci: number }

const TB21: Row[] = [
  { harness: 'Codex CLI', model: 'GPT-6 Astra', date: '2026-09-03', score: 87.4, ci: 0.9 },
  { harness: 'Claude Code', model: 'Claude Fable 5', date: '2026-06-09', score: 83.8, ci: 1.2 },
  { harness: 'Codex CLI', model: 'GPT-5.5', date: '2026-04-23', score: 83.1, ci: 1.1 },
  { harness: 'Terminus 2', model: 'Claude Fable 5', date: '2026-06-09', score: 80.4, ci: 1.2 },
  { harness: 'Cursor CLI', model: 'Grok 4.5', date: '2026-07-08', score: 79.3, ci: 1.5 },
  { harness: 'Claude Code', model: 'Claude Opus 4.8', date: '2026-05-28', score: 78.9, ci: 1.3 },
  { harness: 'Codex CLI', model: 'GPT-5.6 Terra', date: '2026-06-26', score: 78.4, ci: 1.3 },
  { harness: 'Terminus 2', model: 'GPT-5.5', date: '2026-04-23', score: 78.0, ci: 1.2 },
  { harness: 'mini-SWE-agent', model: 'Muse Spark 1.1', date: '2026-07-09', score: 76.2, ci: 1.2 },
  { harness: 'Codex CLI', model: 'GPT-5.6 Luna', date: '2026-06-26', score: 75.7, ci: 1.3 },
  { harness: 'Claude Code', model: 'Claude Sonnet 5', date: '2026-06-30', score: 74.6, ci: 1.6 },
  { harness: 'Terminus 2', model: 'Gemini 3 Pro', date: '2025-11-18', score: 73.9, ci: 1.3 },
  { harness: 'Claude Code', model: 'Claude Opus 4.7', date: '2026-04-16', score: 68.9, ci: 1.4 },
  { harness: 'Terminus 2', model: 'Claude Opus 4.7', date: '2026-04-16', score: 66.1, ci: 1.4 },
  { harness: 'Gemini CLI', model: 'Gemini 3 Pro', date: '2025-11-18', score: 65.8, ci: 1.4 },
  { harness: 'Gemini CLI', model: 'Gemini 3.1 Pro', date: '2026-02-19', score: 65.8, ci: 1.7 },
  { harness: 'Terminus 2', model: 'Gemini 3.1 Pro', date: '2026-02-19', score: 65.6, ci: 1.7 },
  { harness: 'Claude Code', model: 'GLM-5.1', date: '2026-03-27', score: 58.7, ci: 1.2 },
]

// 같은 모델이 둘 이상의 하네스에서 측정된 경우만 모은다 (모델 고정 · 하네스 변경)
const SAME_MODEL = (() => {
  const by = new Map<string, Row[]>()
  TB21.forEach(r => by.set(r.model, [...(by.get(r.model) ?? []), r]))
  return [...by.entries()].filter(([, rs]) => rs.length > 1).map(([model, rs]) => ({ model, rows: [...rs].sort((a, b) => b.score - a.score) }))
})()

// 같은 하네스에서 모델을 바꾼 경우 (하네스 고정 · 모델 변경)
const SAME_HARNESS = (() => {
  const by = new Map<string, Row[]>()
  TB21.forEach(r => by.set(r.harness, [...(by.get(r.harness) ?? []), r]))
  return [...by.entries()].filter(([, rs]) => rs.length > 1).map(([harness, rs]) => ({ harness, rows: [...rs].sort((a, b) => b.score - a.score) }))
    .sort((a, b) => b.rows.length - a.rows.length)
})()

const OPEN: { model: string; score: number }[] = [
  { model: 'DeepSeek V4 Pro 0813', score: 67.9 },
  { model: 'Kimi K2.6', score: 66.7 },
  { model: 'GLM-5.1', score: 63.5 },
  { model: 'DeepSeek V4 Pro (High)', score: 63.3 },
  { model: 'Qwen3.6-27B', score: 59.3 },
  { model: 'DeepSeek V4 Pro', score: 59.1 },
  { model: 'MiniMax M2.7', score: 57.0 },
]

const NOTES: string[] = [
  '이 점수는 공개 리더보드의 값이며 우리가 돌린 것이 아니다. 제출한 곳, 날짜(2025-11 ~ 2026-09), 하네스 버전이 행마다 달라 통제된 실험이 아니다. 신뢰구간이 ±0.9~1.7점이라 그보다 작은 차이는 의미가 없다.',
  '모델 고정 비교에서는 모델 회사의 자체 하네스가 기준 하네스(Terminus 2)보다 +2.8~+5.1점 높았지만, Gemini 3 Pro에서는 Terminus 2가 +8.1점 높았다. 자체 하네스가 항상 낫지는 않다.',
  '하네스 고정 비교에서 같은 하네스 안의 모델 차이는 최대 약 25점(Claude Code: 83.8 vs 58.7)으로, 모델 고정 비교에서 본 하네스 차이(약 3~8점)보다 크다. 이 표만 보면 모델 선택의 영향이 더 크다.',
  'pi 와 Hermes 는 확인한 리더보드 행에 없다. 이 자료로는 우리가 궁금한 4종(Claude Code, Codex, Hermes, pi) 비교를 할 수 없고 Claude Code 와 Codex 만 있다.',
  'open-weight 순위는 벤치마크 버전이 2.0 이고 하네스 조건이 행마다 달라(논문에 따르면 mini-swe-agent 나 Terminus-2 중 가장 좋은 실행을 쓰는 경우가 있음) 위 2.1 표와 같은 기준이 아니다. 방향만 참고한다: closed 모델(Claude Code 기준 83.8, 78.9)이 open 최상위(약 68)보다 10~15점 높다.',
  '다른 순위표와 값이 다르다(llm-stats 는 MiniMax M2.1 47.9%를 open 1위로, Benchlist 는 Kimi K2 Thinking 36%). 더 오래된 스냅샷이거나 다른 변형으로 보이며 이 카드는 최신으로 보이는 값을 썼다.',
  '정정: "오픈소스 하네스 평균 41.6% vs closed 하네스 71.2%"(2026-04-27 스냅샷)는 하네스 효과가 아니다. 그 open 행은 OpenHands·Mini-SWE-Agent·CAMEL-AI 에 구형 closed 모델(2025-11 ~ 2026-01)을 얹은 것이라 모델 세대 차이가 섞여 있다.',
  '공개 벤치마크 순위가 실제 업무 순위와 같지 않을 수 있다. TerminalWorld 논문(검색 요약)은 Terminal-Bench 2.0 의 57.0~82.7% 가 실제 터미널 과제 검증 세트에서는 49.0~62.5% 로 내려가고, open-weight Kimi K2.6 이 그 세트에서 GPT-5.5 보다 앞섰다고 보고한다.',
]

const SRC: { label: string; href: string; note: string }[] = [
  { label: 'Snorkel Terminal-Bench 2.1 리더보드', href: 'https://snorkel.ai/leaderboard/terminal-bench-2-1/', note: '위 18행. 페이지 요약 도구로 읽음 — 원본 대조 필요' },
  { label: 'BenchLM Terminal-Bench 2.0', href: 'https://benchlm.ai/benchmarks/terminal-bench-2', note: 'open-weight 순위. 검색 결과 요약으로만 확인' },
  { label: 'TerminalWorld (arXiv 2605.22535)', href: 'https://arxiv.org/pdf/2605.22535', note: '실제 과제와의 괴리. 검색 요약으로만 확인' },
  { label: 'Codesota Terminal-Bench 2 (2026-04-27)', href: 'https://www.codesota.com/benchmark/terminal-bench', note: 'open 하네스 행 9개 직접 확인' },
  { label: 'Terminal-Bench 공식', href: 'https://tbench.ai', note: '최신 값은 여기서 확인' },
]

const fmt = (n: number) => n.toFixed(1)

export default function PublicBenchmarks() {
  return <section className="card vb-card">
    <div className="card-title"><div><small className="kicker">PUBLIC BENCHMARK</small><h2>공개 벤치마크 결과 — Terminal-Bench</h2></div><span className="connection">우리가 측정한 값 아님 · 2026-10-17 조사</span></div>
    <p className="vb-lead">모델 고정·하네스 변경과 하네스 고정·모델 변경 결과가 공개 리더보드에 있습니다. 아래는 Terminal-Bench 2.1(Snorkel) 18행에서 같은 모델 또는 같은 하네스가 둘 이상 나온 경우만 모은 것입니다.</p>

    <h3 className="vb-sub">A. 모델 고정 · 하네스 변경</h3>
    <div className="data-table"><table>
      <thead><tr><th>모델</th><th>하네스별 점수 (높은 순)</th><th>최고와 최저 차이</th></tr></thead>
      <tbody>{SAME_MODEL.map(m => <tr key={m.model}><td><b>{m.model}</b></td>
        <td>{m.rows.map(r => `${r.harness} ${fmt(r.score)}% (±${r.ci})`).join(' · ')}</td>
        <td>{fmt(m.rows[0].score - m.rows[m.rows.length - 1].score)}점</td></tr>)}</tbody>
    </table></div>

    <h3 className="vb-sub">B. 하네스 고정 · 모델 변경</h3>
    <div className="data-table"><table>
      <thead><tr><th>하네스</th><th>모델별 점수 (높은 순)</th><th>최고와 최저 차이</th></tr></thead>
      <tbody>{SAME_HARNESS.map(h => <tr key={h.harness}><td><b>{h.harness}</b></td>
        <td>{h.rows.map(r => `${r.model} ${fmt(r.score)}`).join(' · ')}</td>
        <td>{fmt(h.rows[0].score - h.rows[h.rows.length - 1].score)}점</td></tr>)}</tbody>
    </table></div>

    <h3 className="vb-sub">C. open-weight 모델 (Terminal-Bench 2.0, BenchLM 2026-10-16)</h3>
    <div className="data-table"><table>
      <thead><tr><th>순위</th><th>모델</th><th>점수</th></tr></thead>
      <tbody>{OPEN.map((o, i) => <tr key={o.model}><td>{i + 1}</td><td><b>{o.model}</b></td><td>{fmt(o.score)}%</td></tr>)}</tbody>
    </table></div>
    <p className="vb-note">벤치마크 버전(2.0)과 하네스 조건이 위 A·B(2.1)와 다르므로 숫자를 섞어 비교하지 마세요.</p>

    <h3 className="vb-sub">읽을 때 주의할 점</h3>
    <ul className="vb-limits">{NOTES.map((s, i) => <li key={i}>{s}</li>)}</ul>

    <h3 className="vb-sub">출처 (확인 정도 포함)</h3>
    <ul className="vb-limits">{SRC.map(s => <li key={s.href}><a href={s.href} target="_blank" rel="noreferrer">{s.label}</a> — {s.note}</li>)}</ul>
    <p className="vb-note">모델 이름은 출처에 적힌 그대로이며 검증하지 않았습니다. 이 카드의 점수는 vvirt 과제나 사용자님의 업무 과제에 그대로 적용되지 않습니다.</p>
  </section>
}
