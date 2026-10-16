// 하네스 평가 탭: "모델 고정/하네스 변경"과 "하네스 고정/모델 변경" 두 평가 방식, 비교 대상, vvirt 과제로의 적용 계획.
// 격자는 vbEval.json 의 grid(run_trials.py + eval/stats.py 가 (harness, model)마다 1칸씩 씀)를 읽는다. 아직 비어 있으면 "미실행".
// 대조군(reference/null/sloppy)으로 채점기가 구분하는지까지는 VB 탭의 AGENT EVAL 카드에서 확인됨.
import raw from '../data/vbEval.json'

type Task = { id: string; category: string; prompt: string }
type Cell = { harness: string; model: string; generated: string; tasks: number; trials: number; repeat_min: number
  passed_tasks_all_trials: number; pass_at_k: Record<string, number>; pass_hat_k: Record<string, number>
  tool_calls: number; errors: number; cost_usd: number | null; duration_s: number | null; api_errors: number }
const tasks = (raw as unknown as { tasks: Task[]; llm: { status: string; reason?: string; howToRun?: string } | null; grid?: Cell[] })
const llm = tasks.llm
const grid: Cell[] = tasks.grid ?? []
// 결과 파일의 harness 값 ↔ 표의 하네스 이름
const HARNESS_ID: Record<string, string> = { 'Claude Code': 'claude-code', Codex: 'codex', Hermes: 'hermes', pi: 'pi' }
const pct = (v: number | undefined) => v === undefined ? '-' : `${Math.round(v * 100)}%`

const MODES: { name: string; fixed: string; varies: string; asks: string; example: string; caution: string }[] = [
  { name: 'A. 모델 고정 · 하네스 변경', fixed: '모델, 과제, MCP 서버, 채점기', varies: '하네스(도구 구성, 프롬프트, 컨텍스트 처리, 권한)',
    asks: '이 모델을 어디에 얹어야 잘 되나', example: '같은 모델을 Claude Code · Codex · pi · Hermes 에 연결',
    caution: '모델이 특정 하네스에 맞춰 학습돼 있으면 그 조합이 유리할 수 있음' },
  { name: 'B. 하네스 고정 · 모델 변경', fixed: '하네스, 과제, MCP 서버, 채점기', varies: '모델(추론, 도구 호출 정확도, 정직성)',
    asks: '이 환경에서 어떤 모델이 잘 되나', example: '같은 하네스에서 모델만 교체',
    caution: '하네스를 바꾸면 결과가 그대로 성립하지 않을 수 있음' },
]

const HARNESSES: { name: string; philosophy: string; pros: string; cons: string; mcp: string }[] = [
  { name: 'Claude Code', philosophy: '기능이 풍부한 올인원', pros: '서브에이전트, 훅, 스킬, MCP, 플랜 모드, 권한, IDE 통합 기본 제공', cons: 'Claude 모델 중심, 컨텍스트 처리가 내부에 숨어 있음', mcp: '지원' },
  { name: 'Codex', philosophy: '저장소 안에서 일을 끝내는 코딩 에이전트', pros: '코딩 작업에 집중, 샌드박스 실행', cons: 'OpenAI 모델 중심, 코딩 밖 기능은 적음', mcp: '확인 필요' },
  { name: 'Hermes', philosophy: '코딩은 일부인 범용 에이전트', pros: '성공 작업에서 스킬 자동 생성, 세션 영속화, 크론·메신저 연동, 모델 자유 선택(MIT)', cons: '코딩 특화로는 덜 다듬어짐, 하위 실행 오케스트레이션은 발전 중', mcp: '확인 필요' },
  { name: 'pi', philosophy: '최소주의 (도구 4개 + 짧은 프롬프트)', pros: '컨텍스트 통제, TypeScript 확장, 가볍고 해킹하기 쉬움', cons: '샌드박스·권한 없음, 서브에이전트·플랜·MCP를 기본으로 넣지 않음', mcp: '기본 미지원 (어댑터/확장 필요)' },
]

const MODELS = grid.length ? [...new Set(grid.map(g => g.model))] : ['(모델 미정)']

function GridCell({ c }: { c: Cell | undefined }) {
  if (!c) return <span style={{ color: 'var(--text-muted)' }}>미실행</span>
  const k = String(c.repeat_min)
  return <span title={`${c.generated} · 시도 ${c.trials}회 · 도구 호출 ${c.tool_calls} · 오류 ${c.errors}${c.api_errors ? ` · API 오류 ${c.api_errors}` : ''}`}>
    <b>{c.passed_tasks_all_trials}/{c.tasks}</b> 과제 매번 통과<br/>
    <small>pass@1 {pct(c.pass_at_k['1'])} · pass^{k} {pct(c.pass_hat_k[k])} (n={c.repeat_min}){c.cost_usd != null ? ` · $${c.cost_usd}` : ''}{c.duration_s != null ? ` · ${c.duration_s}s` : ''}</small>
  </span>
}

const PLAN: string[] = [
  '고정: tools/vvirt/eval/tasks.py 의 과제 8개, vvirt MCP 서버(mcp_server.py), 채점기(저장된 레이아웃 + 최종 답변만 봄). 채점기는 하네스에 독립적이다.',
  '바꿈: run_trials.py 의 에이전트 실행부만. 하네스마다 같은 MCP 서버를 연결하는 어댑터를 둔다.',
  '구현됨(2026-10-16): 결과 행마다 harness · model · trial 을 기록하고, (하네스, 모델)마다 1칸을 vbEval.json 의 grid 에 쓴다(eval/stats.py, tests/test_eval_stats.py 16/16).',
  'LLM 결과는 매번 달라서 과제당 3회 이상 반복한다(--repeat n, 구현됨: pass@k · pass^k 계산). 도구 호출 수·오류·비용·시간은 함께 기록되며, 재시도·토큰 세부는 아직 집계하지 않는다.',
  '대조군(기준·아무것도 안 함·과장)은 매 실행 전에 돌려 채점기가 아직 구분하는지 먼저 확인한다.',
]

const METRICS: { name: string; why: string }[] = [
  { name: '통과율', why: '과제별 oracle 통과 여부 (반복 횟수 대비 비율)' },
  { name: '정직성', why: 'd2·n1·n2: 못 하는 것을 했다고 하지 않는가 (과장 금지 과제)' },
  { name: '도구 호출 수 · 오류 · 재시도', why: '같은 결과에 도달하는 효율, 하네스의 오류 복구 차이가 드러남' },
  { name: '토큰 · 비용 · 시간', why: '하네스별 컨텍스트 낭비와 모델별 단가 차이' },
]

// 조사 출처: Terminal-Bench 2.1, HAL(Holistic Agent Leaderboard), τ-bench(pass^k), Anthropic "Demystifying evals for AI agents" 요약글 (2차 자료)
const HOW: { step: string; detail: string }[] = [
  { step: '1. 조건을 전부 고정하고 기록', detail: '모델, effort(추론 강도), 예산, 시간 제한, 과제 버전, 채점기를 하네스 카드로 적는다. 같은 모델이라도 effort가 다르면 비교가 무의미하다. 벤치 버전을 섞지 않는다(Terminal-Bench 2.0과 2.1 점수는 서로 바꿔 쓸 수 없음).' },
  { step: '2. 하네스는 "각자의 기본 설정"으로', detail: '하네스를 비교할 때는 각 에이전트의 native 설정으로 돌린다. 모델을 비교할 때만 하나의 기준 하네스(Terminal-Bench는 Terminus 2)로 고정한다. 같은 모델에서 하네스만 바꿔도 점수가 수 점씩 달라진다는 보고가 있다(GPT-5.5: Codex 83.1 vs Terminus 2 78.0, Claude Code와 Terminus 2는 2.8점 차).' },
  { step: '3. 결과(outcome)로 채점', detail: '에이전트가 어떤 경로를 택했는지가 아니라 최종 산출물과 환경 상태를 코드로 채점한다(우리 oracle 방식). 경로 채점은 취약하고 창의적인 풀이를 벌한다. 대신 트랜스크립트를 직접 읽어 채점기가 불공정하지 않은지 검증한다.' },
  { step: '4. 같은 과제를 여러 번 반복', detail: 'LLM은 매번 결과가 달라서 과제당 n회 실행한다. pass@1(첫 시도 통과율), pass@k(k번 중 한 번이라도), pass^k(k번 모두 성공)를 같이 본다. pass^k 불편 추정량은 평균 C(c,k)/C(n,k)이며 n ≥ k가 필요하다. 예: 시도당 75% 성공이면 pass@3 ≈ 98%, pass^3 ≈ 42%(0.75³).' },
  { step: '5. 정확도와 비용을 함께', detail: '통과율만 보지 않고 토큰, 달러, 시간, 도구 호출 수, 오류·재시도를 같이 기록해 정확도 대 비용 그래프(파레토)로 본다(HAL 방식). 스캐폴드에 따라 정확도와 비용이 모두 크게 달라진다.' },
  { step: '6. 과제별 짝지은 비교', detail: '총점 차이가 아니라 같은 과제에서 하네스 A와 B의 통과 여부를 짝지어 본다. 어느 과제에서 일관되게 앞서는지, 우연인지 구분한다. 과제를 늘려도 하네스 종류가 적으면 순위 신뢰도가 크게 좋아지지 않는다는 분석이 있다.' },
  { step: '7. 한계를 명시', detail: '벤치마크용으로 튜닝된 하네스는 점수가 부풀 수 있다(Terminal-Bench 2.1에서 하네스를 키워 95.3%까지 올린 사례). 우리 업무 과제 10여 개 × 하네스 4개 × 반복 3~5회는 사례 분석이지 통계적 결론이 아니다.' },
]

const BATCH: string[] = [
  '설치·세팅은 한 번만: 4개 하네스를 설치하고 버전을 고정하는 스크립트 1개(또는 컨테이너 이미지 1개)로 만들어, 새 PC에서도 한 명령으로 같은 환경이 되게 한다. 이미 있는 tools/vvirt/scripts/doctor.sh · setup_env.sh 방식(점검 → 계획 출력 → --yes 로 적용)을 따른다.',
  '인증·모델 설정은 파일 1개(.env 같은 한 곳)에 모으고 4개 하네스가 모두 거기서 읽게 한다. 키 값은 저장소에 올리지 않는다.',
  '러너 1개: 하네스 4개 × 과제 N개 × 반복 r회의 조합을 목록으로 만들고 순서대로(또는 제한된 병렬로) 실행한다.',
  '하네스마다 어댑터 1개: 같은 프롬프트와 같은 MCP 서버(vvirt)를 연결하고, 비대화형 모드(예: claude -p, codex exec 등 각 CLI의 headless 실행)로 호출한다. 어댑터가 없는 기능(pi의 MCP)은 확장이나 CLI 브리지로 보완한다.',
  '실행마다 깨끗한 작업 폴더/워크스페이스를 새로 만들어 이전 실행의 흔적이 섞이지 않게 한다. 시간 제한과 예산 상한(토큰/달러)을 하네스에 똑같이 건다.',
  '같은 모델: 4개 하네스가 모두 지원하는 공급자(예: OpenAI 호환 또는 Anthropic 호환 엔드포인트를 가진 게이트웨이/라우터)로 같은 모델 ID를 지정한다. 하네스마다 모델 호출 설정 방법이 다르다.',
  '저장: 실행 1건 = harness, model, task, trial, passed, checks, tool_calls, errors, tokens, cost, seconds 를 JSON으로 기록하고 이 탭의 격자와 카드가 그 파일을 읽는다.',
  '시작 전에 대조군(기준·아무것도 안 함·과장)을 한 번 돌려 채점기가 아직 구분하는지 확인한다.',
]

export default function HarnessEval() {
  return <>
    <section className="card vb-card">
      <div className="card-title"><div><small className="kicker">HARNESS EVAL</small><h2>하네스 평가 — 무엇을 고정하고 무엇을 바꿀까</h2></div><span className="connection">실제 시험 미실행</span></div>
      <p className="vb-lead">에이전트 성능은 모델만이 아니라 <b>하네스</b>(도구 구성, 프롬프트, 컨텍스트 관리, 재시도, 권한)에도 크게 좌우됩니다.
        그래서 평가는 무엇을 고정하느냐에 따라 서로 다른 질문에 답합니다. 두 방식을 합쳐 모델 × 하네스 격자로 돌리는 것이 가장 정확합니다.</p>
      <div className="data-table"><table>
        <thead><tr><th>방식</th><th>고정</th><th>변경</th><th>답하는 질문</th><th>예</th><th>주의</th></tr></thead>
        <tbody>{MODES.map(m => <tr key={m.name}><td><b>{m.name}</b></td><td>{m.fixed}</td><td>{m.varies}</td><td>{m.asks}</td><td>{m.example}</td><td>{m.caution}</td></tr>)}</tbody>
      </table></div>
    </section>

    <section className="card vb-card">
      <div className="card-title"><div><small className="kicker">CANDIDATES</small><h2>비교 대상 하네스</h2></div><span className="connection">2차 자료 + 일반 지식 · 버전별로 다를 수 있음</span></div>
      <div className="data-table"><table>
        <thead><tr><th>하네스</th><th>철학</th><th>강점</th><th>약점</th><th>MCP</th></tr></thead>
        <tbody>{HARNESSES.map(h => <tr key={h.name}><td><b>{h.name}</b></td><td>{h.philosophy}</td><td>{h.pros}</td><td>{h.cons}</td><td>{h.mcp}</td></tr>)}</tbody>
      </table></div>
      <p className="vb-note">Hermes와 pi는 검색으로 얻은 2차 자료(리뷰, 블로그)에 기반한 요약입니다. 세부 기능은 각 공식 문서로 확인하세요.</p>
    </section>

    <section className="card vb-card">
      <div className="card-title"><div><small className="kicker">GRID</small><h2>모델 × 하네스 결과 격자 (vvirt 과제 {tasks.tasks.length}개)</h2></div><span className="connection">{grid.length ? `측정 ${grid.length}칸` : '전부 미실행'}</span></div>
      <div className="data-table"><table>
        <thead><tr><th>하네스 \ 모델</th>{MODELS.map(m => <th key={m}>{m}</th>)}</tr></thead>
        <tbody>{HARNESSES.map(h => <tr key={h.name}><td><b>{h.name}</b></td>{MODELS.map(m => <td key={m}><GridCell c={grid.find(g => g.harness === HARNESS_ID[h.name] && g.model === m)}/></td>)}</tr>)}</tbody>
      </table></div>
      <p className="vb-note">한 칸 = (하네스, 모델) 한 쌍의 모든 시도. "매번 통과"는 반복한 모든 시도에서 통과한 과제 수, pass@1은 첫 시도 통과율, pass^k는 k번 모두 성공할 확률(과제 평균, 불편 추정 C(c,k)/C(n,k)).
        반복: <code>run_trials.py --agent claude --model sonnet --repeat 3</code>. 지금 어댑터는 Claude Code 하나뿐이라 나머지 하네스 행은 어댑터가 생겨야 채워집니다.</p>
      {!grid.length && <div className="pev-ctxwarn"><b>아직 측정값이 없습니다.</b> 모델 열은 첫 실행 때 결과 파일의 모델 이름으로 채워집니다.
        {llm?.reason && <> 막힌 이유: {llm.reason}.</>}
        {llm?.howToRun && <> 실행: <code>{llm.howToRun}</code></>}</div>}
    </section>

    <section className="card vb-card">
      <div className="card-title"><div><small className="kicker">HOW TO</small><h2>구체적으로 어떻게 평가하나 (조사 요약)</h2></div><span className="connection">2차 자료 요약</span></div>
      <div className="data-table"><table>
        <thead><tr><th>단계</th><th>내용</th></tr></thead>
        <tbody>{HOW.map(h => <tr key={h.step}><td><b>{h.step}</b></td><td>{h.detail}</td></tr>)}</tbody>
      </table></div>
      <p className="vb-note">출처: Terminal-Bench 2.1, Holistic Agent Leaderboard(HAL), τ-bench, Anthropic의 에이전트 평가 가이드 요약글. 수치는 2차 자료이므로 원문으로 확인하세요.</p>
      <h3 className="vb-sub">한꺼번에 설치하고 일괄 실행하는 구조 (계획)</h3>
      <ol className="vb-limits">{BATCH.map((s, i) => <li key={i}>{s}</li>)}</ol>
    </section>

    <section className="card vb-card">
      <div className="card-title"><div><small className="kicker">PROTOCOL</small><h2>평가 방법 (vvirt 적용 계획)</h2></div></div>
      <ol className="vb-limits">{PLAN.map((s, i) => <li key={i}>{s}</li>)}</ol>
      <h3 className="vb-sub">측정 항목</h3>
      <div className="data-table"><table>
        <thead><tr><th>항목</th><th>의미</th></tr></thead>
        <tbody>{METRICS.map(m => <tr key={m.name}><td><b>{m.name}</b></td><td>{m.why}</td></tr>)}</tbody>
      </table></div>
      <h3 className="vb-sub">과제 목록</h3>
      <ul className="vb-limits">{tasks.tasks.map(t => <li key={t.id}><b>{t.id}</b> <small>({t.category})</small> — {t.prompt.length > 120 ? t.prompt.slice(0, 120) + '…' : t.prompt}</li>)}</ul>
    </section>
  </>
}
