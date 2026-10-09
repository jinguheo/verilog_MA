// SA(simulated annealing) 단계별 그림 설명.
// 실제 Chip Tetris 엔진을 이 화면에서 돌려, "기존 배치 없이" 무작위 합법 배치에서 시작해 이동을 하나씩 제안·판정하는 과정을 그린다.
// 이동: 블록 하나를 골라 합법 위치로 다시 뽑고(50%는 그 뒤 블록도 모두 다시 뽑음), 점수 변화로 수락 여부를 정한다.
// 그림의 배치·점수·확률·난수는 모두 렌더링할 때 계산한 실제 값이다(손으로 쓴 숫자 없음).
import { useEffect, useState } from 'react'
import * as E from '../game/chipTetrisEngine'
import { SEQ, COLS, ROWS, rngOf, drawLegal, buildFrom, type P } from './chipSearch'

const p = { margin: '4px 0 8px', fontSize: 13, lineHeight: 1.8 } as const
const ul = { margin: '0 0 8px 18px', padding: 0, fontSize: 13, lineHeight: 1.8 } as const
const box = { padding: 10, borderRadius: 8, border: '1px solid var(--border-strong)', background: 'var(--surface)' } as const
const NAME: Record<string, string> = { adc: 'ADC MACRO', sram: 'SRAM MACRO', opamp: 'SAR NEAR', fifo: 'CDC EDGE', control: 'CAPTURE NEAR' }
const f1 = (x: number) => x.toFixed(1)
const f3 = (x: number) => x.toFixed(3)

type Result = 'accept' | 'accept-worse' | 'reject' | 'illegal'
type Step = {
  t: number; block: number; suffix: boolean; T: number; curV: number; propV: number | null; delta: number | null; prob: number | null; u: number | null
  result: Result; bestV: number; before: E.Board; after: E.Board | null; moved: E.BlockId[]; curAfter: number
}

function runSa(seed: number, N: number, T0: number): { startBoard: E.Board; startV: number; steps: Step[] } | null {
  const rnd = rngOf(seed)
  // 무작위로 놓다가 다음 블록이 놓일 합법 위치가 없는 막다른 길에 들어가면, 같은 난수열로 처음부터 다시 뽑는다(seed마다 결과는 결정적)
  let s = E.createGame(0); let ps: P[] = []
  for (let attempt = 0; attempt < 60; attempt++) {
    s = E.createGame(0); ps = []; let ok = true
    for (const id of SEQ) { const d = drawLegal(s, id, rnd); if (!d) { ok = false; break } ps.push(d.p); s = d.s2 }
    if (ok) break
    if (attempt === 59) return null
  }
  let cur = ps, curState = s, curV = E.evaluatePlacement(s.board)
  const startBoard = s.board, startV = curV
  let best = curV
  const T1 = 1.5, steps: Step[] = []
  for (let t = 1; t <= N; t++) {
    const T = T0 * Math.pow(T1 / T0, (t - 1) / Math.max(1, N - 1))
    const i = Math.floor(rnd() * SEQ.length), suffix = rnd() < 0.5
    let st = buildFrom(cur, i); const before = curState.board
    const base: Step = { t, block: i, suffix, T, curV, propV: null, delta: null, prob: null, u: null, result: 'illegal', bestV: best, before, after: null, moved: [], curAfter: curV }
    if (!st) { steps.push(base); continue }
    const np = cur.slice(0, i); let ok = true
    for (let j = i; j < SEQ.length; j++) {
      if (j === i || suffix) { const d = drawLegal(st!, SEQ[j], rnd); if (!d) { ok = false; break } np.push(d.p); st = d.s2 }
      else { const ac = { id: SEQ[j], rotation: cur[j].r, x: cur[j].x, y: cur[j].y } as E.ActiveBlock; if (!E.isLegalPlacement(st!.board, ac)) { ok = false; break } np.push(cur[j]); st = E.lockActive(st!, ac, st!.queue, st!.hold) }
    }
    if (!ok) { steps.push(base); continue }
    const v = E.evaluatePlacement(st!.board), delta = v - curV
    const prob = delta >= 0 ? 1 : Math.exp(delta / T)
    const u = delta >= 0 ? null : rnd()
    const accepted = delta >= 0 || (u as number) < prob
    const moved = SEQ.filter((_, j) => np[j].r !== cur[j].r || np[j].x !== cur[j].x || np[j].y !== cur[j].y)
    const result: Result = !accepted ? 'reject' : delta >= 0 ? 'accept' : 'accept-worse'
    if (accepted) { cur = np; curState = st!; curV = v; if (v > best) best = v }
    steps.push({ ...base, propV: v, delta, prob, u, result, bestV: best, after: st!.board, moved, curAfter: curV })
  }
  return { startBoard, startV, steps }
}

function Board({ board, width, hi, title }: { board: E.Board; width: number; hi?: E.BlockId[]; title?: string }) {
  const outlines = (hi ?? []).map(id => { let a = 99, b = 99, c = -1, d = -1; board.forEach((row, y) => row.forEach((cell, x) => { if (cell?.id === id) { a = Math.min(a, x); c = Math.max(c, x); b = Math.min(b, y); d = Math.max(d, y) } })); return c >= 0 ? { id, a, b, c, d } : null }).filter(Boolean) as Array<{ id: string; a: number; b: number; c: number; d: number }>
  return <svg viewBox={`0 0 ${COLS} ${ROWS}`} width={width} height={width * ROWS / COLS} style={{ display: 'block', borderRadius: 4, border: '1px solid var(--border-strong)', background: 'var(--surface-muted)' }} role="img" aria-label={title ?? '25×12 배치 보드'}>
    {board.flatMap((row, y) => row.map((c, x) => c ? <rect key={`${x}-${y}`} x={x + 0.04} y={y + 0.04} width={0.92} height={0.92} rx={0.08} fill={E.BLOCKS[c.id].color}/> : null))}
    {outlines.map(o => <rect key={o.id} x={o.a - 0.05} y={o.b - 0.05} width={o.c - o.a + 1.1} height={o.d - o.b + 1.1} fill="none" stroke="var(--text)" strokeWidth={0.28}/>)}
  </svg>
}

const RES_COLOR: Record<Result, string> = { accept: '#1D9E75', 'accept-worse': '#e67e22', reject: '#8a94a6', illegal: '#d64545' }
const RES_LABEL: Record<Result, string> = { accept: '수락 (좋아짐)', 'accept-worse': '수락 (나빠졌지만 확률로 받아들임)', reject: '거절 (나빠졌고 확률에서 탈락)', illegal: '불법 (합법 위치를 못 찾아 버림)' }

function Chart({ start, steps, idx, onPick }: { start: number; steps: Step[]; idx: number; onPick: (i: number) => void }) {
  const W = 680, H = 170, L = 44, R = 10, Tp = 10, B = 24
  const cur = [start, ...steps.map(s => s.curAfter)], best = [start, ...steps.map(s => s.bestV)]
  const all = [...cur, ...best]; const lo = Math.min(...all), hi = Math.max(...all)
  const X = (i: number) => L + i / Math.max(1, steps.length) * (W - L - R), Y = (v: number) => Tp + (1 - (v - lo) / Math.max(1e-9, hi - lo)) * (H - Tp - B)
  const Tmax = Math.max(...steps.map(s => s.T)), Tmin = Math.min(...steps.map(s => s.T))
  return <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: 'block' }} role="img" aria-label="단계별 점수와 온도">
    <polyline points={steps.map((s, i) => `${X(i + 1)},${Tp + (1 - (s.T - Tmin) / Math.max(1e-9, Tmax - Tmin)) * (H - Tp - B) * 0.35 + (H - Tp - B) * 0.65}`).join(' ')} fill="none" stroke="#c0a02b" strokeWidth={1} strokeDasharray="3 3" opacity={0.7}/>
    <polyline points={cur.map((v, i) => `${X(i)},${Y(v)}`).join(' ')} fill="none" stroke="#5a8dee" strokeWidth={1.6}/>
    <polyline points={best.map((v, i) => `${X(i)},${Y(v)}`).join(' ')} fill="none" stroke="#1D9E75" strokeWidth={2}/>
    {steps.map((s, i) => <circle key={i} cx={X(i + 1)} cy={Y(s.curAfter)} r={i + 1 === idx ? 4.5 : 2.2} fill={RES_COLOR[s.result]} stroke={i + 1 === idx ? 'var(--text)' : 'none'} strokeWidth={1.2} onClick={() => onPick(i + 1)} style={{ cursor: 'pointer' }}/>)}
    <text x={4} y={14} fontSize={10} fill="currentColor">점수 {f1(hi)}</text><text x={4} y={H - B + 2} fontSize={10} fill="currentColor">{f1(lo)}</text>
    <text x={L} y={H - 6} fontSize={10} fill="currentColor">이동 번호 0 → {steps.length}</text>
    <text x={W - R} y={H - 6} textAnchor="end" fontSize={10} fill="currentColor">파랑 = 현재 점수 · 초록 = 지금까지 최선 · 노랑 점선 = 온도 T</text>
  </svg>
}

export default function SaStepByStep() {
  const [seed, setSeed] = useState(2), [N, setN] = useState(120), [T0, setT0] = useState(60)
  const [run, setRun] = useState<ReturnType<typeof runSa>>(null)
  const [busy, setBusy] = useState(true)
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    setBusy(true); setRun(null); setIdx(0)
    const h = setTimeout(() => { setRun(runSa(seed, N, T0)); setBusy(false) }, 30)
    return () => clearTimeout(h)
  }, [seed, N, T0])
  const steps = run?.steps ?? []
  const cur = idx === 0 ? null : steps[idx - 1]
  const count = (r: Result) => steps.filter(s => s.result === r).length
  const accepted = steps.filter(s => s.result === 'accept' || s.result === 'accept-worse')

  return <div>
    <p style={p}>SA를 <b>기존 배치 없이</b> 시작합니다. 시작 배치는 <b>무작위로 만든 합법 배치</b>이고, 이동을 하나씩 제안해 점수 변화로 받아들일지 정합니다. 아래는 <b>이 화면에서 실제 엔진을 돌려</b> 그린 과정입니다.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', margin: '4px 0 8px' }}>
      <label style={{ fontSize: 12 }}>seed <select value={seed} onChange={e => setSeed(Number(e.target.value))}>{[1, 2, 3, 4].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
      <label style={{ fontSize: 12 }}>이동 횟수 <select value={N} onChange={e => setN(Number(e.target.value))}>{[60, 120, 250].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
      <label style={{ fontSize: 12 }}>시작 온도 T0 <select value={T0} onChange={e => setT0(Number(e.target.value))}>{[5, 20, 60].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
      {busy && <span style={{ fontSize: 12, color: 'var(--warning)' }}>엔진 계산 중…</span>}
    </div>
    {!run && !busy && <p style={p}>합법 시작 배치를 만들지 못했습니다. seed를 바꿔 보세요.</p>}
    {run && <>
      <div style={box}>
        <b style={{ fontSize: 13 }}>한 장으로 보기 — 점수가 이동마다 어떻게 변하나</b>
        <Chart start={run.startV} steps={steps} idx={idx} onPick={setIdx}/>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12, margin: '4px 0' }}>
          {(['accept', 'accept-worse', 'reject', 'illegal'] as Result[]).map(r => <span key={r}><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: RES_COLOR[r], marginRight: 4 }}/>{RES_LABEL[r].split(' (')[0]} {count(r)}회</span>)}
          <span>시작 {f1(run.startV)} → 최선 <b>{f1(steps[steps.length - 1]?.bestV ?? run.startV)}</b></span>
        </div>
        <p style={p}><b>읽는 법:</b> 점은 이동 하나이고 색이 결과입니다. 초록 = 좋아져서 수락, 주황 = <b>나빠졌지만 확률로 수락</b>, 회색 = 거절, 빨강 = 불법. 점을 누르면 그 이동의 상세로 넘어갑니다. 온도 T(노랑 점선)가 낮아질수록 주황 점(나빠지는 수락)이 줄어드는 것이 SA의 핵심입니다.</p>
      </div>

      <div style={{ ...box, marginTop: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 8 }}>
          <b style={{ fontSize: 13, marginRight: 8 }}>이동 하나씩 따라가기</b>
          <button type="button" disabled={idx === 0} onClick={() => setIdx(0)}>시작</button>
          <button type="button" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>← 이전</button>
          <button type="button" className="active" disabled={idx === steps.length} onClick={() => setIdx(idx + 1)}>다음 이동 →</button>
          <button type="button" disabled={idx >= steps.length} onClick={() => setIdx(Math.min(steps.length, idx + 10))}>10개 뒤로</button>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{idx} / {steps.length}</span>
        </div>

        {idx === 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <div><Board board={run.startBoard} width={340}/><div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>시작 배치 (무작위 합법)</div></div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <b>0. 시작: 기존 배치 없이 무작위 합법 배치</b>
            <p style={p}>블록 5개를 순서대로 <b>무작위 합법 위치</b>에 놓았습니다(beam search처럼 점수를 보지 않고 합법이기만 하면 됩니다). 점수는 <b>{f1(run.startV)}</b>로 아직 좋지 않습니다. SA는 이 배치를 이동 {steps.length}번으로 고쳐 나갑니다.</p>
            <ul style={ul}>
              <li><b>이동:</b> 블록 하나를 골라 합법 위치로 다시 뽑습니다(50%는 그 뒤 블록들도 모두 다시 뽑음).</li>
              <li><b>판정:</b> 점수가 좋아지면(Δ ≥ 0) 항상 수락. 나빠지면(Δ &lt; 0) 확률 <b>p = e<sup>Δ/T</sup></b>로 수락 — 난수 u를 뽑아 u &lt; p이면 수락합니다.</li>
              <li><b>온도 T:</b> {f1(steps[0]?.T ?? T0)}에서 시작해 1.5까지 천천히 낮춥니다. T가 크면 나빠지는 이동도 자주 받아들입니다.</li>
            </ul>
          </div>
        </div>}

        {cur && <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            <div><Board board={cur.before} width={290} hi={cur.moved.length ? cur.moved : undefined}/><div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>① 이동 전 (현재 배치, 점수 {f1(cur.curV)})</div></div>
            <div style={{ alignSelf: 'center', fontSize: 22 }}>→</div>
            <div>{cur.after ? <Board board={cur.after} width={290} hi={cur.moved}/> : <div style={{ width: 290, height: 290 * ROWS / COLS, border: '1px dashed var(--danger)', display: 'grid', placeItems: 'center', fontSize: 12, color: 'var(--danger)', textAlign: 'center', padding: 8 }}>합법 위치를 찾지 못해<br/>제안 자체가 불법</div>}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>② 제안 배치{cur.propV !== null ? ` (점수 ${f1(cur.propV)})` : ''} · 검은 테두리 = 바뀐 블록</div></div>
          </div>
          <div className="data-table" style={{ marginTop: 8 }}><table><thead><tr><th>이동 {cur.t}번</th><th>값</th></tr></thead><tbody>
            <tr><td>① 이동 고르기</td><td><b>{NAME[SEQ[cur.block]]}</b>{cur.suffix ? ' + 그 뒤 블록 모두' : ''}를 합법 위치로 다시 뽑음{cur.moved.length ? ` → 실제로 바뀐 블록: ${cur.moved.map(m => NAME[m]).join(', ')}` : ''}</td></tr>
            <tr><td>② 합법 검사</td><td>{cur.after ? <b style={{ color: 'var(--success)' }}>통과</b> : <b style={{ color: 'var(--danger)' }}>실패 → 이 이동은 버림(점수 비교 없음)</b>}</td></tr>
            {cur.propV !== null && <tr><td>③ 점수 변화</td><td>Δ = {f1(cur.propV)} − ({f1(cur.curV)}) = <b>{cur.delta! >= 0 ? '+' : ''}{f1(cur.delta!)}</b></td></tr>}
            {cur.propV !== null && <tr><td>④ 수락 판단 (T = {f1(cur.T)})</td><td>{cur.delta! >= 0 ? <>Δ ≥ 0이라 <b>항상 수락</b>(확률 1)</> : <>p = e<sup>Δ/T</sup> = e<sup>{f1(cur.delta!)}/{f1(cur.T)}</sup> = <b>{f3(cur.prob!)}</b> · 뽑은 난수 u = <b>{f3(cur.u!)}</b> → u {cur.u! < cur.prob! ? '<' : '≥'} p</>}</td></tr>}
            <tr><td>⑤ 결과</td><td><b style={{ color: RES_COLOR[cur.result] }}>{RES_LABEL[cur.result]}</b> · 현재 점수 {f1(cur.curV)} → <b>{f1(cur.curAfter)}</b> · 지금까지 최선 <b>{f1(cur.bestV)}</b></td></tr>
          </tbody></table></div>
        </div>}
      </div>

      <div style={{ ...box, marginTop: 10 }}>
        <b style={{ fontSize: 13 }}>수락된 이동만 이어 보기 — 배치가 이렇게 바뀌어 갔습니다 (최대 12개)</b>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
          <div style={{ textAlign: 'center' }}><Board board={run.startBoard} width={150}/><div style={{ fontSize: 11 }}>시작 {f1(run.startV)}</div></div>
          {accepted.slice(0, 12).map(s => <div key={s.t} style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => setIdx(s.t)}><Board board={s.after!} width={150} hi={s.moved}/><div style={{ fontSize: 11 }}>이동 {s.t} · <b style={{ color: RES_COLOR[s.result] }}>{f1(s.curAfter)}</b></div></div>)}
        </div>
        {accepted.length > 12 && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>수락된 이동은 모두 {accepted.length}개이고 앞 12개만 보여 줍니다.</div>}
      </div>

      <ul style={{ ...ul, marginTop: 10 }}>
        <li><b>beam search와 다른 점이 그림에서 보입니다:</b> beam search는 열마다 후보를 <b>전부</b> 만들어 상위 K개를 고르지만, SA는 <b>이동 하나를 무작위로 제안</b>하고 점수 변화로 받아들일지 정합니다. 나빠지는 이동도 확률로 받아들여 지역 최소를 빠져나오려 하지만, 그 결과는 <b>seed마다 다릅니다</b>(seed를 바꿔 보세요).</li>
        <li>이 그림은 <b>처음 {steps.length}번의 이동</b>입니다. 같은 SA를 15초(약 17,600번 이동) 돌리면 중앙값 −136.4(seed 4개, 최악 −165.8)였고, 같은 문제에서 beam search는 5초에 −132.70이었습니다(배경 지식 4절).</li>
      </ul>
    </>}
  </div>
}
