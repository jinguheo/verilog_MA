// 하네스 평가 탭 — 하네스–모델 궁합(model-harness fit)에 대한 공개 자료 정리. 우리가 측정한 값이 아니다.
// 점수 출처: Snorkel Terminal-Bench 2.1(PublicBenchmarks.tsx 와 같은 행), Terminal-Bench 2.0 2026-04-30 스냅샷(Bustamante 글이 옮긴 표, 2차 자료).
// 두 벤치마크는 버전이 달라 서로의 점수를 섞어 비교하지 않는다. 모델 이름은 출처에 적힌 그대로이며 검증하지 않았다.

type Pair = { model: string; native: string; nativeScore: number; base: string; baseScore: number; note?: string }

// Terminal-Bench 2.1: 같은 모델을 회사 자체 하네스와 기준 하네스(Terminus 2)에서 잰 경우
const NATIVE: Pair[] = [
  { model: 'Claude Fable 5', native: 'Claude Code', nativeScore: 83.8, base: 'Terminus 2', baseScore: 80.4 },
  { model: 'GPT-5.5', native: 'Codex CLI', nativeScore: 83.1, base: 'Terminus 2', baseScore: 78.0 },
  { model: 'Claude Opus 4.7', native: 'Claude Code', nativeScore: 68.9, base: 'Terminus 2', baseScore: 66.1 },
  { model: 'Gemini 3.1 Pro', native: 'Gemini CLI', nativeScore: 65.8, base: 'Terminus 2', baseScore: 65.6, note: '차이가 신뢰구간(±1.7) 안' },
  { model: 'Gemini 3 Pro', native: 'Gemini CLI', nativeScore: 65.8, base: 'Terminus 2', baseScore: 73.9, note: '2025-11 제출. CLI가 이후 개선됐을 수 있음' },
]

// Terminal-Bench 2.0 (2026-04-30 스냅샷, 2차 자료): 같은 모델의 하네스별 점수
const SPREAD: { model: string; rows: [string, number][] }[] = [
  { model: 'Claude Opus 4.6', rows: [['ForgeCode', 79.8], ['Capy', 75.3]] },
  { model: 'Gemini 3.1 Pro', rows: [['TongAgents', 80.2], ['ForgeCode', 78.4], ['Terminus-KIRA', 74.8]] },
  { model: 'GPT-5.3-Codex', rows: [['SageAgent', 78.4], ['Droid', 77.3], ['Simple Codex', 75.1]] },
]

const FINDINGS: { claim: string; evidence: string; strength: string }[] = [
  { claim: 'closed 모델은 자기 회사 하네스에서 대체로 잘 나온다', evidence: '위 표 5건 중 3건에서 자체 하네스가 기준 하네스보다 +2.8~+5.1점 높음', strength: '보통' },
  { claim: '모델 중립 서드파티 하네스(ForgeCode, TongAgents)가 최상위권에 있다', evidence: '2.0 스냅샷에서 ForgeCode가 GPT-5.4 81.8, Opus 4.6 79.8, Gemini 3.1 Pro 78.4. 자체 하네스(Codex + GPT-5.5 82.0)와 근접', strength: '보통 (벤치마크 버전이 2.1과 다름)' },
  { claim: '같은 모델도 하네스에 따라 3~8점 달라진다', evidence: '위 표들. 모델 간 차이(같은 하네스 안에서 최대 약 25점)보다는 작다', strength: '보통' },
  { claim: 'open-weight 모델은 편집 도구 형식에 민감하다', evidence: '한 블로그 실험: replace 대신 hashline 사용 시 GLM-4.7 +8.3, MiniMax M2.1 +10, Kimi K2.5 +5', strength: '약함 (블로그 단일 실험)' },
  { claim: 'open-weight(Kimi, GLM, Qwen)의 하네스별 최적 조합', evidence: '엄밀한 자료를 찾지 못함. OpenBench 가 같은 모델을 여러 하네스에 고정해 비교하도록 만들어져 있으나 게시된 결과는 확인하지 못함', strength: '알려진 답 없음' },
]

const COUNTER: string[] = [
  'OpenCode 비교 리뷰(2차 자료, 통계적으로 유의하지 않음): GPT-5.6은 OpenCode 34/42, Claude Code 32/42, Codex CLI 31/42, DeepSeek V4 Flash는 Claude Code 30/37, OpenCode 26/37, Codex CLI 24/37. 자체 하네스(Codex + GPT)가 가장 낮게 나와 "자체 하네스가 최적"과 어긋난다.',
  '시점에 따라 달라진다: 한 블로그는 Opus 4.6이 Claude Code에서 58.0%로 Terminus-KIRA 74.7%보다 낮다고 하지만(미확인), 2.1 표에서는 이후 모델이 Claude Code에서 더 높았다. 하네스와 모델이 모두 갱신되므로 궁합도 변한다.',
  '궁합이 생기는 이유로 "모델이 특정 하네스의 도구와 함께 사후 학습된다"(OpenAI는 패치 기반, Anthropic은 문자열 치환 편집에 익숙)는 설명이 있다. 이는 GitHub·Microsoft 소속 저자의 주장이며 통제된 측정이 아니다. "모델은 편집 방식 전환을 어렵지 않게 해낸다"는 반론도 인용돼 있다.',
]

const gap = (p: Pair) => p.nativeScore - p.baseScore
const sign = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`

export default function HarnessFit() {
  return <section className="card vb-card">
    <div className="card-title"><div><small className="kicker">MODEL–HARNESS FIT</small><h2>어떤 하네스에 어떤 모델이 잘 맞나 (공개 자료)</h2></div><span className="connection">우리가 측정한 값 아님 · 2026-10-17 조사</span></div>
    <p className="vb-lead"><b>결론:</b> 궁합을 통제된 실험으로 확정한 자료는 찾지 못했습니다. 공개 점수에서는 closed 모델이 자기 회사 하네스 또는 모델 중립 상위 하네스에서 대체로 좋았고,
      하네스 차이(한 모델 안에서 3~8점)는 모델 차이보다 작았습니다. open-weight 모델의 최적 하네스는 알려진 답이 없습니다.</p>

    <h3 className="vb-sub">자체 하네스 대 기준 하네스 (Terminal-Bench 2.1)</h3>
    <div className="data-table"><table>
      <thead><tr><th>모델</th><th>자체 하네스</th><th>Terminus 2 (기준)</th><th>차이</th><th>비고</th></tr></thead>
      <tbody>{NATIVE.map(p => <tr key={p.model}><td><b>{p.model}</b></td><td>{p.native} {p.nativeScore.toFixed(1)}%</td><td>{p.baseScore.toFixed(1)}%</td>
        <td><b>{sign(gap(p))}</b></td><td>{p.note ?? ''}</td></tr>)}</tbody>
    </table></div>

    <h3 className="vb-sub">같은 모델의 하네스별 점수 (Terminal-Bench 2.0, 2026-04-30 스냅샷, 2차 자료)</h3>
    <div className="data-table"><table>
      <thead><tr><th>모델</th><th>하네스별 점수</th><th>최고와 최저 차이</th></tr></thead>
      <tbody>{SPREAD.map(s => <tr key={s.model}><td><b>{s.model}</b></td><td>{s.rows.map(([h, v]) => `${h} ${v.toFixed(1)}%`).join(' · ')}</td>
        <td>{(s.rows[0][1] - s.rows[s.rows.length - 1][1]).toFixed(1)}점</td></tr>)}</tbody>
    </table></div>
    <p className="vb-note">위 두 표는 벤치마크 버전(2.1 / 2.0)이 달라 점수를 섞어 비교하면 안 됩니다.</p>

    <h3 className="vb-sub">정리: 무엇이 말할 수 있고 무엇이 아직 모르는가</h3>
    <div className="data-table"><table>
      <thead><tr><th>경향</th><th>근거</th><th>강도</th></tr></thead>
      <tbody>{FINDINGS.map(f => <tr key={f.claim}><td><b>{f.claim}</b></td><td>{f.evidence}</td><td>{f.strength}</td></tr>)}</tbody>
    </table></div>

    <h3 className="vb-sub">반대 증거와 한계</h3>
    <ul className="vb-limits">{COUNTER.map((s, i) => <li key={i}>{s}</li>)}</ul>
    <p className="vb-note">출처: <a href="https://snorkel.ai/leaderboard/terminal-bench-2-1/" target="_blank" rel="noreferrer">Snorkel Terminal-Bench 2.1</a> · <a href="https://nicolasbustamante.com/blog/model-harness-fit" target="_blank" rel="noreferrer">Model-Harness-Fit (Bustamante)</a> · <a href="https://github.com/minghinmatthewlam/openbench" target="_blank" rel="noreferrer">OpenBench</a>.
      Bustamante 글의 저자는 GitHub·Microsoft 소속이며 Copilot CLI에 우호적으로 서술합니다. 이 점수는 vvirt 과제나 사용자님의 업무 과제에 그대로 적용되지 않으며, 업무에서의 궁합은 위 격자(모델 × 하네스)에 직접 측정해야 알 수 있습니다.</p>
  </section>
}
