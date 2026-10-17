// 하네스 평가 탭 — 통합 비교(공개 자료). 우리가 측정한 값이 아니다.
// 출처마다 벤치마크 버전·조건이 달라 점수를 하나로 합산하지 않는다. 칸마다 출처를 적고, 자료가 없으면 "-" 로 둔다.
//   TB21 = Snorkel Terminal-Bench 2.1 리더보드(2026-10-17 에 페이지 요약 도구로 읽음)
//   HT   = HarnessTax(Arena, 2026-09-16; 원문 대신 인용 글 howardism.dev 로 확인, 독립 검증·재현 없음, 과제 30개 × 3회)
//   PRICE= 서드파티 가격 집계(공식 요금표 미확인, 출처끼리 충돌하는 값은 범위로 표기)
// 유형(open/closed)은 출처에 없는 것이 많아 개발사·모델 이름으로 추정한 값이다. 모델 이름은 출처에 적힌 그대로이며 검증하지 않았다.

type HarnessRow = { name: string; tools: string; ctx: string; cost: string; success: string; mcp: string; fit: string; strength: string }
const HARNESSES: HarnessRow[] = [
  { name: 'Claude Code', tools: '23개 (HT)', ctx: '첫 호출 약 27,000토큰 (HT)', cost: '기준: pi의 약 2.0배(SWE-bench Lite), 약 1.5배(Terminal-Bench 2.0), Codex CLI의 약 1.6배 (HT)',
    success: '하네스 효과 ±2%(SWE-bench Lite) / ±5%(TB 2.0) 이내 (HT)', mcp: '지원', fit: '자체 모델이 기준 하네스보다 +2.8~+3.4 (TB21: Fable 5, Opus 4.7)', strength: '보통' },
  { name: 'Codex CLI', tools: '미확인', ctx: '미확인', cost: 'Claude Code의 약 1/1.6. pi 대비로는 약 1.25배(위 두 비율에서 내가 나눈 값, 원문에 없음)',
    success: '위와 같음 (HT)', mcp: '확인 필요', fit: 'GPT-5.5가 기준 하네스보다 +5.1 (TB21)', strength: '보통' },
  { name: 'pi', tools: '4개: read, write, edit, bash (HT)', ctx: '첫 호출 약 1,970토큰 (HT, Claude Code의 약 1/13.7)', cost: '가장 쌈. 비용-성공 경계(파레토)의 7점 중 5점 (HT)',
    success: '위와 같음. GPT-5.6 Sol은 TB 2.0에서 pi 83.3% 대 Codex CLI 78.9%이고 비용 약 절반 (HT)', mcp: '기본 미지원', fit: '자료 없음 (TB21 리더보드에 행 없음)', strength: '약함~보통 (단일 연구)' },
  { name: 'Hermes', tools: '-', ctx: '-', cost: '자료 없음', success: '자료 없음', mcp: '확인 필요', fit: '자료 없음', strength: '-' },
  { name: 'Terminus 2 (기준)', tools: '-', ctx: '-', cost: '-', success: '모든 모델을 같은 조건으로 잰 기준선 (TB21)', mcp: '-', fit: '모델 비교의 기준 하네스', strength: '-' },
]

type ModelRow = { name: string; kind: string; price: string; best: string; note: string }
const MODELS: ModelRow[] = [
  { name: 'Claude Fable 5', kind: 'closed', price: '$10 / $50', best: 'Claude Code 83.8 (TB21)', note: '' },
  { name: 'GPT-5.5', kind: 'closed', price: '$5 / $30 (캐시 입력 $0.50)', best: 'Codex CLI 83.1 (TB21)', note: '' },
  { name: 'Claude Opus 4.8', kind: 'closed', price: '$5 / $25', best: 'Claude Code 78.9 (TB21)', note: '' },
  { name: 'Claude Sonnet 5', kind: 'closed', price: '$2 / $10 (다른 출처 $3 / $15)', best: 'Claude Code 74.6 (TB21)', note: '가격 출처 충돌' },
  { name: 'Claude Opus 4.7', kind: 'closed', price: '미확인', best: 'Claude Code 68.9 (TB21)', note: '' },
  { name: 'Gemini 3 Pro', kind: 'closed', price: '미확인', best: 'Terminus 2 73.9 (TB21)', note: '자체 CLI(65.8)가 더 낮음. 2025-11 제출' },
  { name: 'Kimi K2.6', kind: 'open-weight', price: '$0.95 / $4', best: '66.7 (BenchLM, TB 2.0, 하네스 미상)', note: '하네스별 자료 없음' },
  { name: 'DeepSeek V4 Pro', kind: 'open-weight', price: '출처마다 다름: 입력 $0.44~1.74 / 출력 $0.87~3.96', best: '67.9 (BenchLM, TB 2.0, 하네스 미상)', note: '가격 미확정' },
  { name: 'GLM-5.1', kind: 'open-weight', price: '찾지 못함', best: 'Claude Code 58.7 (TB21) · 63.5 (BenchLM 2.0)', note: '버전이 달라 비교 불가' },
  { name: 'Qwen3.6-27B', kind: 'open-weight 추정', price: '찾지 못함', best: '59.3 (BenchLM, TB 2.0, 하네스 미상)', note: '' },
  { name: 'MiniMax M2.7', kind: 'open-weight', price: '찾지 못함', best: '57.0 (BenchLM, TB 2.0, 하네스 미상)', note: '' },
]

type Combo = { harness: string; model: string; kind: string; tb21: string; ht: string; cost: string; read: string }
const COMBOS: Combo[] = [
  { harness: 'Claude Code', model: 'Claude Fable 5', kind: 'closed', tb21: '83.8%', ht: '97.8% (SWE-bench Lite)', cost: '$1.33 / 시도', read: '비용이 pi의 약 2배, 성공률 차이는 1.1점' },
  { harness: 'pi', model: 'Claude Fable 5', kind: 'closed', tb21: '-', ht: '96.7% (SWE-bench Lite)', cost: '$0.67 / 시도', read: '' },
  { harness: 'Terminus 2', model: 'Claude Fable 5', kind: 'closed', tb21: '80.4%', ht: '-', cost: '-', read: '' },
  { harness: 'Codex CLI', model: 'GPT-5.5', kind: 'closed', tb21: '83.1%', ht: '-', cost: '-', read: '기준 하네스보다 +5.1' },
  { harness: 'Terminus 2', model: 'GPT-5.5', kind: 'closed', tb21: '78.0%', ht: '-', cost: '-', read: '' },
  { harness: 'pi', model: 'GPT-5.6 Sol', kind: 'closed', tb21: '-', ht: '83.3% (Terminal-Bench 2.0)', cost: 'Codex CLI의 약 1/2', read: '성공률도 pi가 4.4점 높음' },
  { harness: 'Codex CLI', model: 'GPT-5.6 Sol', kind: 'closed', tb21: '-', ht: '78.9% (Terminal-Bench 2.0)', cost: '-', read: '' },
  { harness: 'Claude Code', model: 'GPT-5.6 Luna', kind: 'closed', tb21: '-', ht: '-', cost: '$0.15 / 시도', read: '벤치마크 미확인. pi는 $0.03 (최대 격차 사례)' },
  { harness: 'Claude Code', model: 'Claude Opus 4.7', kind: 'closed', tb21: '68.9%', ht: '-', cost: '-', read: '기준 하네스보다 +2.8' },
  { harness: 'Terminus 2', model: 'Claude Opus 4.7', kind: 'closed', tb21: '66.1%', ht: '-', cost: '-', read: '' },
  { harness: 'Claude Code', model: 'GLM-5.1', kind: 'open-weight', tb21: '58.7%', ht: '-', cost: '-', read: 'open 모델의 하네스 조합 중 확인된 거의 유일한 행' },
]

const TAKEAWAYS: string[] = [
  '성공률은 주로 모델이 정한다: 같은 하네스 안에서 모델에 따라 최대 약 25점(Claude Code: 83.8 대 58.7), 같은 모델에서 하네스에 따라 약 3~8점. HarnessTax는 하네스 효과를 ±2~5%로 본다.',
  '비용은 주로 하네스가 정한다: Claude Code가 pi의 약 1.5~2.0배, 조합별로는 최대 약 5배. 원인은 턴 수가 아니라 매 호출에 얹히는 컨텍스트(첫 호출 약 27,000 대 약 1,970토큰)로 보인다(턴 수는 15.3 대 15.4로 거의 같음).',
  '그래서 공개 자료만 보면 선택 순서는 "먼저 모델로 성공률을 정하고, 같은 수준이면 하네스로 비용을 줄인다"이다. 이는 단일 연구와 리더보드에서 읽은 경향이며 확정이 아니다.',
  'open-weight 모델은 비용(가격)은 낮지만 성공률이 closed 최상위보다 약 14점 낮고(67.9 대 82), 하네스별 성공률·비용 자료는 사실상 없다.',
  '합산하지 못한 이유: Terminal-Bench 2.1(Snorkel), 2.0(BenchLM·HarnessTax), SWE-bench Lite는 버전과 과제가 다르고, 많은 순위표가 하네스를 적지 않았다. 점수를 한 숫자로 섞으면 오해가 생기므로 칸마다 출처를 적었다.',
]

const SRC: { label: string; href: string; note: string }[] = [
  { label: 'HarnessTax (Arena 블로그)', href: 'https://arena.ai/blog/coding-agents-harness-tax', note: '비용·토큰·성공률. 원문은 열지 못하고 인용 글로 확인. 상업 평가사, 독립 검증 없음, 오염 가능성 명시' },
  { label: 'HarnessTax 인용 글 (Howardism)', href: 'https://www.howardism.dev/articles/harness-tax', note: '위 수치를 직접 읽은 곳' },
  { label: 'Snorkel Terminal-Bench 2.1', href: 'https://snorkel.ai/leaderboard/terminal-bench-2-1/', note: 'TB21 점수. 페이지 요약 도구로 읽음' },
  { label: 'BenchLM Terminal-Bench 2.0', href: 'https://benchlm.ai/benchmarks/terminal-bench-2', note: 'open 모델 점수. 하네스·open 여부 표기 없음' },
  { label: 'LLM 가격 집계 (예: BenchLM Claude API pricing)', href: 'https://benchlm.ai/anthropic/api-pricing', note: '가격은 서드파티 집계이고 출처끼리 충돌. 공식 요금표로 재확인 필요' },
]

const kindColor = (k: string) => k.startsWith('open') ? '#1D9E75' : undefined

export default function HarnessCompare() {
  return <section className="card vb-card">
    <div className="card-title"><div><small className="kicker">INTEGRATED COMPARISON</small><h2>통합 비교 — 하네스 · 모델 · 조합 (성공률 · 비용 · 토큰)</h2></div><span className="connection">우리가 측정한 값 아님 · 2026-10-17 조사</span></div>
    <p className="vb-lead">앞의 공개 벤치마크와 궁합, 비용·토큰 자료를 한곳에 모았습니다. 출처마다 조건이 달라 <b>한 점수로 합산하지 않고</b>, 칸마다 출처(TB21 · HT · BenchLM)와 근거 강도를 적었습니다. 자료가 없는 칸은 "-" 입니다.</p>

    <h3 className="vb-sub">읽은 경향</h3>
    <ul className="vb-limits">{TAKEAWAYS.map((s, i) => <li key={i}>{s}</li>)}</ul>

    <h3 className="vb-sub">1. 하네스 단위</h3>
    <div className="data-table"><table>
      <thead><tr><th>하네스</th><th>도구 수</th><th>토큰 부하</th><th>비용</th><th>성공률 영향</th><th>MCP</th><th>자체 모델 궁합</th><th>근거</th></tr></thead>
      <tbody>{HARNESSES.map(h => <tr key={h.name}><td><b>{h.name}</b></td><td>{h.tools}</td><td>{h.ctx}</td><td>{h.cost}</td><td>{h.success}</td><td>{h.mcp}</td><td>{h.fit}</td><td>{h.strength}</td></tr>)}</tbody>
    </table></div>

    <h3 className="vb-sub">2. 모델 단위</h3>
    <div className="data-table"><table>
      <thead><tr><th>모델</th><th>유형(추정)</th><th>가격 (1M 토큰당 입력 / 출력)</th><th>확인된 최고 점수</th><th>비고</th></tr></thead>
      <tbody>{MODELS.map(m => <tr key={m.name}><td><b>{m.name}</b></td><td style={{ color: kindColor(m.kind) }}>{m.kind}</td><td>{m.price}</td><td>{m.best}</td><td>{m.note}</td></tr>)}</tbody>
    </table></div>

    <h3 className="vb-sub">3. 조합 단위 (하네스 × 모델)</h3>
    <div className="data-table"><table>
      <thead><tr><th>하네스</th><th>모델</th><th>유형</th><th>TB 2.1 (Snorkel)</th><th>HarnessTax 성공률</th><th>HarnessTax 비용</th><th>읽는 법</th></tr></thead>
      <tbody>{COMBOS.map((c, i) => <tr key={i}><td><b>{c.harness}</b></td><td>{c.model}</td><td style={{ color: kindColor(c.kind) }}>{c.kind}</td><td>{c.tb21}</td><td>{c.ht}</td><td>{c.cost}</td><td>{c.read}</td></tr>)}</tbody>
    </table></div>
    <p className="vb-note">같은 모델에서 하네스만 바뀐 행끼리만 비교하세요. 행 사이에 TB 2.1 점수와 HarnessTax 점수를 섞어 비교하면 안 됩니다(벤치마크와 과제가 다름). 자료가 없는 조합은 표에 넣지 않았으므로, 표에 없다는 것이 "나쁘다"는 뜻은 아닙니다.</p>

    <h3 className="vb-sub">출처와 확인 정도</h3>
    <ul className="vb-limits">{SRC.map(s => <li key={s.href}><a href={s.href} target="_blank" rel="noreferrer">{s.label}</a> — {s.note}</li>)}</ul>
    <p className="vb-note">이 카드의 점수·비용·토큰은 vvirt 과제나 사용자님의 업무 과제에 그대로 적용되지 않습니다. 업무에서의 성공률과 비용은 위쪽 격자(모델 × 하네스)에 직접 측정해야 알 수 있습니다. 가격은 변동이 크므로 사용 전에 공식 요금표를 확인하세요.</p>
  </section>
}
