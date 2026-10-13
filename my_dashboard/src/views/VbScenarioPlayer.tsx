// VB 탭의 시나리오 재생기. 데이터는 tools/vvirt/examples/make_scenarios.py 가 실제 실행하며 기록한 JSON이다
// (각 단계의 SKILL 명령, 가상 Virtuoso의 응답, 단계 직후 레이아웃 스냅샷).
// 명령은 이 세션의 Claude가 사람의 요청을 읽고 손으로 작성했다 — API로 LLM을 자동 호출한 기록이 아니다.
import { useEffect, useMemo, useState } from 'react'
import raw from '../data/vbScenarios.json'

type Step = { kind: 'query' | 'edit' | 'verify'; note: string; skill: string; ok: boolean; output: string; error: string; ms: number; svg: string | null }
type Check = { name: string; ok: boolean; detail: string }
type Scenario = { id: string; title: string; prompt: string; goal: string; cell: string; lib: string; steps: Step[]; checks: Check[]; finalSvg: string | null }
const data = raw as unknown as { generated: string; scenarios: Scenario[] }

const KIND: Record<Step['kind'], { label: string; color: string }> = {
  query: { label: '조회', color: '#378ADD' },
  edit: { label: '편집', color: '#1D9E75' },
  verify: { label: '확인', color: '#C0A02B' },
}
// 같은 요청을 다른 프로필로 돌린 쌍은 나란히 볼 수 있게 한다
const PAIR: Record<string, string> = { habit_default: 'habit_analog', habit_analog: 'habit_default' }

export default function VbScenarioPlayer() {
  const scenarios = data.scenarios
  const [sid, setSid] = useState(scenarios[0]?.id ?? '')
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const sc = useMemo(() => scenarios.find(s => s.id === sid) ?? scenarios[0], [sid, scenarios])
  const step = sc.steps[Math.min(idx, sc.steps.length - 1)]
  const pair = scenarios.find(s => s.id === PAIR[sc.id])
  // 이 단계까지 가장 최근에 만들어진 스냅샷
  const svgAt = (s: Scenario, i: number) => { for (let k = Math.min(i, s.steps.length - 1); k >= 0; k--) if (s.steps[k].svg) return s.steps[k].svg; return null }
  const svg = svgAt(sc, idx)

  useEffect(() => { setIdx(0); setPlaying(false) }, [sid])
  useEffect(() => {
    if (!playing) return
    const t = window.setInterval(() => setIdx(i => { if (i >= sc.steps.length - 1) { setPlaying(false); return i } return i + 1 }), 1600)
    return () => window.clearInterval(t)
  }, [playing, sc])

  const passed = sc.checks.filter(c => c.ok).length
  return <section className="card vb-card">
    <div className="card-title"><div><small className="kicker">LIVE TRACE</small><h2>요청 → SKILL 명령 → 가상 Virtuoso 실행 과정</h2></div><span className="connection">{scenarios.length}개 시나리오 · {data.generated}</span></div>
    <p className="vb-lead">사람이 말로 요청하면, LLM이 SKILL을 <b>한 단계씩</b> 보내고 가상 Virtuoso의 <b>응답을 읽으며</b> 다음 명령을 정합니다. 아래는 실제로 실행하며 기록한 내용입니다(명령 작성은 이 세션의 Claude가 직접 했고, 별도 API 자동 루프는 아닙니다).</p>
    <div className="vb-chips" role="tablist">
      {scenarios.map(s => <button key={s.id} role="tab" aria-selected={s.id === sid} className={s.id === sid ? 'on' : ''} onClick={() => setSid(s.id)}>{s.title}</button>)}
    </div>

    <div className="vb-prompt"><small>사람의 요청</small><p>“{sc.prompt}”</p><em>{sc.goal}</em></div>

    <div className="vb-player">
      <ol className="vb-steps" aria-label="단계 목록">
        {sc.steps.map((s, i) => <li key={i} className={`${i === idx ? 'cur' : ''} ${i < idx ? 'past' : ''} ${s.ok ? '' : 'bad'}`}>
          <button onClick={() => { setIdx(i); setPlaying(false) }}>
            <span className="vb-kind" style={{ background: KIND[s.kind].color }}>{KIND[s.kind].label}</span>
            <span className="vb-note">{i + 1}. {s.note}</span>{!s.ok && <b className="vb-err-tag">오류</b>}
          </button>
        </li>)}
      </ol>
      <div className="vb-detail">
        <div className="vb-ctrl">
          <button onClick={() => { setIdx(i => Math.max(0, i - 1)); setPlaying(false) }} disabled={idx === 0}>◀ 이전</button>
          <button onClick={() => setPlaying(p => !p)}>{playing ? '❚❚ 정지' : '▶ 자동 재생'}</button>
          <button onClick={() => { setIdx(i => Math.min(sc.steps.length - 1, i + 1)); setPlaying(false) }} disabled={idx >= sc.steps.length - 1}>다음 ▶</button>
          <span>{idx + 1} / {sc.steps.length}</span>
        </div>
        <div className="vb-io">
          <div><small>LLM → 가상 Virtuoso (SKILL)</small><pre className="vb-code">{step.skill}</pre></div>
          <div><small>가상 Virtuoso 응답 · {step.ms} ms</small>
            {step.ok ? <pre className="vb-code reply">{step.output || 'nil'}</pre> : <pre className="vb-code reply err">{step.error || 'error'}</pre>}
          </div>
        </div>
        <div className="vb-canvas">
          <small>이 단계 직후의 레이아웃 ({sc.lib}/{sc.cell})</small>
          {svg ? <a href={svg} target="_blank" rel="noreferrer"><img src={svg} alt={`${sc.title} ${idx + 1}단계 결과`}/></a> : <div className="vb-empty">아직 만들어진 레이아웃이 없습니다 (셀뷰를 열기 전)</div>}
        </div>
      </div>
    </div>

    {pair && <div className="vb-pair"><small>같은 요청, 다른 프로필 — 최종 결과 비교</small>
      <div className="vb-figs">{[sc, pair].map(s => <figure key={s.id}>{s.finalSvg && <img src={s.finalSvg} alt={s.title}/>}<figcaption><b>{s.title}</b></figcaption></figure>)}</div>
    </div>}

    <div className="vb-checks"><small>자동 점검 {passed}/{sc.checks.length} 통과 (실행 후 읽어서 확인한 값)</small>
      <ul>{sc.checks.map((c, i) => <li key={i} className={c.ok ? 'ok' : 'no'}><b>{c.ok ? '✓' : '✗'}</b> {c.name}{c.detail && <code>{c.detail.length > 110 ? c.detail.slice(0, 110) + '…' : c.detail}</code>}</li>)}</ul>
    </div>
  </section>
}
