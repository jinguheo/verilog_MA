// N-cell row placement + routing with simulated annealing (SA), checked against exhaustive search
// where that is still feasible. Same virtual rules and cost model as the 2-cell experiment:
// placement = cell order × N/FN per cell × gap 0..2 sites; each 2-pin net is routed on its best
// met1 track (pin → jog only if the track misses the pin shape → track → pin), nets independent.
import { useEffect, useMemo, useRef, useState } from 'react'

type Rect = [string, number, number, number, number]
type Pin = { n: string; use: string; rects: Rect[] }
type SourceCell = { devices: unknown[]; info: { size: [number, number] | null; pins: Pin[] } }
export type SaRules = { site: number; row: number; m1Pitch: number; m1Width: number; railHalf: number }
export type SaWeights = { bend: number; vertical: number; area: number }

const SOURCE_SITE = 0.46
const MAX_GAP = 2
const MAX_EXHAUSTIVE_N = 6
const round = (n: number) => Number(n.toFixed(3))
const fmtN = (n: number) => n.toLocaleString()

// A fixed small circuit made of real sky130_fd_sc_hd cells. Choosing n uses the first n instances and
// only the nets whose both ends are among them; the netlist order is NOT a good placement order.
const INSTS: { name: string; cell: string }[] = [
  { name: 'u0', cell: 'nand2_1' }, { name: 'u1', cell: 'inv_1' }, { name: 'u2', cell: 'mux2_1' }, { name: 'u3', cell: 'and2_1' },
  { name: 'u4', cell: 'xor2_1' }, { name: 'u5', cell: 'nor2_1' }, { name: 'u6', cell: 'or2_1' }, { name: 'u7', cell: 'a21oi_1' },
  { name: 'u8', cell: 'buf_1' }, { name: 'u9', cell: 'nand2_1' },
]
const NETS: { name: string; from: [number, string]; to: [number, string] }[] = [
  { name: 'n1', from: [0, 'Y'], to: [1, 'A'] }, { name: 'n2', from: [1, 'Y'], to: [2, 'A0'] }, { name: 'n3', from: [0, 'Y'], to: [2, 'S'] },
  { name: 'n4', from: [2, 'X'], to: [3, 'A'] }, { name: 'n5', from: [1, 'Y'], to: [3, 'B'] }, { name: 'n6', from: [3, 'X'], to: [4, 'A'] },
  { name: 'n7', from: [2, 'X'], to: [4, 'B'] }, { name: 'n8', from: [4, 'X'], to: [5, 'A'] }, { name: 'n9', from: [0, 'Y'], to: [5, 'B'] },
  { name: 'n10', from: [5, 'Y'], to: [6, 'A'] }, { name: 'n11', from: [3, 'X'], to: [6, 'B'] }, { name: 'n12', from: [6, 'X'], to: [7, 'A1'] },
  { name: 'n13', from: [4, 'X'], to: [7, 'B1'] }, { name: 'n14', from: [7, 'Y'], to: [8, 'A'] }, { name: 'n15', from: [8, 'X'], to: [9, 'A'] },
  { name: 'n16', from: [5, 'Y'], to: [9, 'B'] },
]
const NET_COLORS = ['#b45f06', '#7F77DD', '#1D9E75', '#c0392b', '#378ADD', '#C0A02B', '#8e44ad', '#16a085']

type NRect = { cx: number; y1: number; y2: number } // normalised to the cell (0..1)
type Ctx = {
  n: number; sites: number[]; W: number[]; nets: { name: string; s: number; d: number; sr: NRect[]; dr: NRect[] }[]
  tracks: number[]; rules: SaRules; w: SaWeights
}
type State = { order: number[]; flip: boolean[]; gaps: number[] }
type Route = { net: string; ax: number; ay: number; bx: number; by: number; t: number }

function met1Tracks(r: SaRules): number[] {
  const out: number[] = []
  if (r.m1Pitch <= r.m1Width) return out
  const clear = r.railHalf + (r.m1Pitch - r.m1Width)
  for (let y = r.m1Pitch / 2; y < r.row; y += r.m1Pitch) if (y - r.m1Width / 2 >= clear - 1e-9 && y + r.m1Width / 2 <= r.row - clear + 1e-9) out.push(round(y))
  return out
}

function buildCtx(data: Record<string, SourceCell>, n: number, rules: SaRules, w: SaWeights): Ctx | null {
  const insts = INSTS.slice(0, n)
  const norm = (cell: SourceCell, pin: string): NRect[] => {
    const [cw, ch] = cell.info.size!
    return (cell.info.pins.find(p => p.n === pin)?.rects ?? []).map(r => ({ cx: (r[1] + r[3]) / 2 / cw, y1: r[2] / ch, y2: r[4] / ch }))
  }
  if (insts.some(i => !data[i.cell]?.info.size)) return null
  const sites = insts.map(i => Math.round(data[i.cell].info.size![0] / SOURCE_SITE))
  const nets = NETS.filter(e => e.from[0] < n && e.to[0] < n).map(e => ({ name: e.name, s: e.from[0], d: e.to[0],
    sr: norm(data[insts[e.from[0]].cell], e.from[1]), dr: norm(data[insts[e.to[0]].cell], e.to[1]) }))
  return { n, sites, W: sites.map(s => s * rules.site), nets, tracks: met1Tracks(rules), rules, w }
}

// Cost of one placement; when `routes` is given, also records each net's chosen route for drawing.
function evaluate(ctx: Ctx, st: State, X: number[], routes?: Route[]): number {
  const { n, W, rules, w, tracks } = ctx
  let x = 0
  for (let k = 0; k < n; k++) { const i = st.order[k]; X[i] = x; x += W[i] + (k < n - 1 ? st.gaps[k] * rules.site : 0) }
  let cost = w.area * x * rules.row
  if (!tracks.length) return Infinity
  for (const net of ctx.nets) {
    let best = Infinity, br: Route | null = null
    for (const a of net.sr) {
      const ax = X[net.s] + (st.flip[net.s] ? 1 - a.cx : a.cx) * W[net.s], ay1 = a.y1 * rules.row, ay2 = a.y2 * rules.row
      for (const b of net.dr) {
        const bx = X[net.d] + (st.flip[net.d] ? 1 - b.cx : b.cx) * W[net.d], by1 = b.y1 * rules.row, by2 = b.y2 * rules.row
        const h = Math.abs(ax - bx)
        for (const t of tracks) {
          const va = t < ay1 ? ay1 - t : t > ay2 ? t - ay2 : 0, vb = t < by1 ? by1 - t : t > by2 ? t - by2 : 0
          const segs = (va > 1e-6 ? 1 : 0) + (h > 1e-6 ? 1 : 0) + (vb > 1e-6 ? 1 : 0)
          const c = h + va + vb + w.bend * Math.max(0, segs - 1) + w.vertical * (va + vb)
          if (c < best) { best = c; if (routes) br = { net: net.name, ax, ay: Math.min(Math.max(t, ay1), ay2), bx, by: Math.min(Math.max(t, by1), by2), t } }
        }
      }
    }
    if (best === Infinity) return Infinity
    cost += best
    if (routes && br) routes.push(br)
  }
  return cost
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const clone = (s: State): State => ({ order: [...s.order], flip: [...s.flip], gaps: [...s.gaps] })
const fact = (n: number): number => n <= 1 ? 1 : n * fact(n - 1)
const placementsOf = (n: number) => fact(n) * 2 ** n * (MAX_GAP + 1) ** Math.max(0, n - 1)

function permutations(n: number): number[][] {
  const out: number[][] = []
  const rec = (cur: number[], rest: number[]) => { if (!rest.length) { out.push(cur); return } rest.forEach((v, i) => rec([...cur, v], [...rest.slice(0, i), ...rest.slice(i + 1)])) }
  rec([], Array.from({ length: n }, (_, i) => i))
  return out
}

// One random neighbour: swap two cells, move one cell, mirror one cell, or widen/narrow one gap.
function neighbour(s: State, rnd: () => number): State {
  const t = clone(s), n = t.order.length
  const r = rnd()
  if (n > 1 && r < 0.35) { const a = Math.floor(rnd() * n), b = Math.floor(rnd() * n); [t.order[a], t.order[b]] = [t.order[b], t.order[a]] }
  else if (n > 2 && r < 0.55) { const a = Math.floor(rnd() * n), b = Math.floor(rnd() * n); const [v] = t.order.splice(a, 1); t.order.splice(b, 0, v) }
  else if (r < 0.85 || n < 2) { const i = Math.floor(rnd() * n); t.flip[i] = !t.flip[i] }
  else { const g = Math.floor(rnd() * (n - 1)); t.gaps[g] = Math.max(0, Math.min(MAX_GAP, t.gaps[g] + (rnd() < 0.5 ? -1 : 1))) }
  return t
}

export const SA_ALPHA = 0.93
export const SA_FINAL_RATIO = 1e-4
export const saStages = () => Math.ceil(Math.log(SA_FINAL_RATIO) / Math.log(SA_ALPHA))
export const saMovesPerStage = (n: number) => Math.max(100, 40 * n)
export const saMoves = (n: number) => saStages() * saMovesPerStage(n)
export const netCount = (n: number) => NETS.filter(e => e.from[0] < n && e.to[0] < n).length
export { placementsOf }

let benchSink = 0
// Measured time to evaluate one placement (all of its nets routed on their best track), in µs.
export function benchPlacement(data: Record<string, SourceCell>, n: number, rules: SaRules, w: SaWeights, samples = 500): number | null {
  const ctx = buildCtx(data, n, rules, w)
  if (!ctx) return null
  const rnd = mulberry32(n * 104729)
  const X = new Array(n).fill(0)
  let st: State = { order: Array.from({ length: n }, (_, i) => i), flip: new Array(n).fill(false), gaps: new Array(Math.max(0, n - 1)).fill(0) }
  const states: State[] = []
  for (let i = 0; i < samples; i++) { st = neighbour(st, rnd); states.push(st) }
  let sink = 0
  for (const s of states) sink += evaluate(ctx, s, X) // JIT warm-up
  // repeat until at least 25 ms has elapsed so timer resolution and GC noise stay small
  let evals = 0
  const t0 = performance.now()
  while (performance.now() - t0 < 25) { for (const s of states) sink += evaluate(ctx, s, X); evals += states.length }
  const us = (performance.now() - t0) * 1000 / evals
  benchSink = sink // keep the loop observable so it is not optimised away
  return us
}

type SaTrace = { move: number; T: number; cur: number; best: number }
type SaResult = { seed: number; moves: number; accepted: number; ms: number; best: number; bestState: State; trace: SaTrace[] }
type ExResult = { key: string; total: number; ms: number; best: number; bestState: State; optimaCount: number }

const ALPHA = SA_ALPHA
const FINAL_RATIO = SA_FINAL_RATIO

export default function CellSaExperiment({ data, rules, weights, exhaustiveSec }: { data: Record<string, SourceCell> | null; rules: SaRules; weights: SaWeights; exhaustiveSec?: (n: number) => number | undefined }) {
  const [n, setN] = useState(10)
  const [seeds, setSeeds] = useState(5)
  const [results, setResults] = useState<SaResult[]>([])
  const [live, setLive] = useState<{ seed: number; stage: number; stages: number; T: number; cur: number; best: number; moves: number; trace: SaTrace[]; bestState: State } | null>(null)
  const [ex, setEx] = useState<ExResult | null>(null)
  const [exLive, setExLive] = useState<{ done: number; total: number; best: number } | null>(null)
  const [view, setView] = useState<'sa' | 'ex'>('sa')
  const cancel = useRef(false)
  const ctx = useMemo(() => data ? buildCtx(data, n, rules, weights) : null, [data, n, rules, weights])
  const key = `${n}|${JSON.stringify(rules)}|${JSON.stringify(weights)}`
  const running = !!live || !!exLive

  useEffect(() => { cancel.current = true; setResults([]); setLive(null); setExLive(null); setView('sa') }, [n, rules, weights])
  useEffect(() => () => { cancel.current = true }, [])

  const runSA = async () => {
    if (!ctx) return
    cancel.current = false
    setResults([]); setView('sa')
    const X = new Array(ctx.n).fill(0)
    const out: SaResult[] = []
    for (let s = 1; s <= seeds && !cancel.current; s++) {
      const rnd = mulberry32(s * 7919)
      const order = Array.from({ length: ctx.n }, (_, i) => i)
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
      let cur: State = { order, flip: order.map(() => rnd() < 0.5), gaps: new Array(Math.max(0, ctx.n - 1)).fill(0) }
      let curC = evaluate(ctx, cur, X), best = clone(cur), bestC = curC
      // T0: an average uphill move is accepted with probability 0.8 at the start
      let up = 0, ups = 0
      for (let i = 0; i < 200; i++) { const d = evaluate(ctx, neighbour(cur, rnd), X) - curC; if (d > 0 && Number.isFinite(d)) { up += d; ups++ } }
      const T0 = ups ? (up / ups) / Math.log(1 / 0.8) : 1
      const stages = saStages()
      const perStage = saMovesPerStage(ctx.n)
      let T = T0, moves = 0, accepted = 0, ms = 0
      const trace: SaTrace[] = []
      for (let stage = 0; stage < stages && !cancel.current; stage++) {
        const t0 = performance.now()
        for (let m = 0; m < perStage; m++) {
          const cand = neighbour(cur, rnd)
          const c = evaluate(ctx, cand, X)
          moves++
          if (c <= curC || rnd() < Math.exp(-(c - curC) / T)) { cur = cand; curC = c; accepted++; if (c < bestC) { bestC = c; best = clone(cand) } }
        }
        ms += performance.now() - t0
        trace.push({ move: moves, T, cur: curC, best: bestC })
        T *= ALPHA
        if (stage % 4 === 0 || stage === stages - 1) {
          setLive({ seed: s, stage: stage + 1, stages, T, cur: curC, best: bestC, moves, trace: [...trace], bestState: clone(best) })
          await new Promise(r => setTimeout(r, 0))
        }
      }
      if (cancel.current) break
      out.push({ seed: s, moves, accepted, ms, best: bestC, bestState: best, trace })
      setResults([...out])
    }
    setLive(null)
  }

  const runExhaustive = async () => {
    if (!ctx || ctx.n > MAX_EXHAUSTIVE_N) return
    cancel.current = false
    setView('ex')
    const perms = permutations(ctx.n), F = 2 ** ctx.n, G = (MAX_GAP + 1) ** Math.max(0, ctx.n - 1)
    const total = perms.length * F * G
    const X = new Array(ctx.n).fill(0)
    let best = Infinity, bestState: State | null = null, optima = 0, ms = 0, i = 0
    const st: State = { order: perms[0], flip: new Array(ctx.n).fill(false), gaps: new Array(Math.max(0, ctx.n - 1)).fill(0) }
    while (i < total && !cancel.current) {
      const t0 = performance.now()
      while (i < total && performance.now() - t0 < 40) {
        let r = i
        const g = r % G; r = (r - g) / G
        const f = r % F; r = (r - f) / F
        st.order = perms[r]
        for (let k = 0; k < ctx.n; k++) st.flip[k] = ((f >> k) & 1) === 1
        let gg = g
        for (let k = 0; k < ctx.n - 1; k++) { st.gaps[k] = gg % (MAX_GAP + 1); gg = Math.floor(gg / (MAX_GAP + 1)) }
        const c = evaluate(ctx, st, X)
        if (c < best - 1e-9) { best = c; bestState = clone(st); optima = 1 } else if (Math.abs(c - best) <= 1e-9) optima++
        i++
      }
      ms += performance.now() - t0
      setExLive({ done: i, total, best })
      await new Promise(r => setTimeout(r, 0))
    }
    if (!cancel.current && bestState) setEx({ key, total, ms, best, bestState, optimaCount: optima })
    setExLive(null)
  }

  const exKnown = ex && ex.key === key ? ex : null
  const bestRun = results.length ? results.reduce((a, b) => b.best < a.best ? b : a) : null
  const hits = exKnown ? results.filter(r => Math.abs(r.best - exKnown.best) < 1e-6).length : results.filter(r => bestRun && Math.abs(r.best - bestRun.best) < 1e-6).length
  const shownState = view === 'ex' && exKnown ? exKnown.bestState : live?.bestState ?? bestRun?.bestState ?? null
  const shownTitle = view === 'ex' && exKnown ? '전수 탐색 최적' : live ? `SA 진행 중 · seed ${live.seed} 지금까지 최선` : bestRun ? `SA 최선 (seed ${bestRun.seed})` : ''
  const avgMs = results.length ? results.reduce((s, r) => s + r.ms, 0) / results.length : 0
  const avgMoves = results.length ? results.reduce((s, r) => s + r.moves, 0) / results.length : 0
  const exEstimateSec = (m: number) => exhaustiveSec?.(m) ?? null
  const usPerEval = results.length ? avgMs * 1000 / avgMoves : null

  return <div className="card" style={{ padding: 12, marginBottom: 12 }}>
    <div className="card-title" style={{ marginBottom: 6 }}><div><small className="kicker">SIMULATED ANNEALING · 실측</small><h3>셀 n개를 SA로 배치·배선 — 전수 탐색과 대조</h3></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
        <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>셀 수 n<select value={n} disabled={running} onChange={e => setN(Number(e.target.value))}>{Array.from({ length: 9 }, (_, i) => i + 2).map(v => <option key={v} value={v}>{v}셀</option>)}</select></label>
        <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>seed 수<select value={seeds} disabled={running} onChange={e => setSeeds(Number(e.target.value))}>{[1, 3, 5, 10].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
        <button type="button" disabled={!ctx || running} onClick={runSA}>SA 실행</button>
        <button type="button" disabled={!ctx || running || n > MAX_EXHAUSTIVE_N} onClick={runExhaustive} title={n > MAX_EXHAUSTIVE_N ? `${MAX_EXHAUSTIVE_N}셀까지만 전수 검증` : ''}>전수 탐색으로 검증</button>
        {running && <button type="button" onClick={() => { cancel.current = true }}>중지</button>}
      </div></div>
    {!ctx && <p className="chip-note">셀 데이터를 불러오는 중입니다.</p>}
    {ctx && <>
      <div className="data-table"><table><thead><tr><th>회로 ({n}셀 · 넷 {ctx.nets.length}개)</th><th>탐색 공간</th></tr></thead><tbody><tr>
        <td style={{ fontSize: 11 }}>{INSTS.slice(0, n).map((it, i) => <span key={it.name} style={{ marginRight: 8 }}><code>{it.name}</code>={it.cell} ({ctx.sites[i]} site)</span>)}<br/>
          {ctx.nets.map(e => <span key={e.name} style={{ marginRight: 8 }}>{e.name}: {INSTS[e.s].name}→{INSTS[e.d].name}</span>)}</td>
        <td style={{ fontSize: 12 }}>배치 {fmtN(placementsOf(n))}가지 = {n}!·2<sup>{n}</sup>·3<sup>{n - 1}</sup><br/>배선은 넷마다 핀 사각형 × 트랙 {ctx.tracks.length}개 중 최선</td>
      </tr></tbody></table></div>
      <p className="chip-note" style={{ margin: '6px 0 10px' }}>실제 sky130 hd 셀로 만든 고정 회로이며 n을 고르면 앞의 n개 셀과 그 사이 넷만 씁니다. SA는 무작위 배치에서 시작해 이동(두 셀 교환 · 한 셀 옮기기 · 좌우 뒤집기 · 간격 ±1)을 반복합니다. 나빠지는 이동도 확률 e<sup>−Δ/T</sup>로 받아들이고, 온도 T를 단계마다 ×{ALPHA}씩 낮춰 처음 온도의 {FINAL_RATIO}배가 되면 멈춥니다. 비용 모델과 목표 규칙은 위의 2셀 실험과 같습니다.</p>

      {live && <div style={{ marginBottom: 10 }}>
        <div style={{ height: 8, borderRadius: 4, background: 'var(--surface-muted)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${((live.seed - 1) + live.stage / live.stages) / seeds * 100}%`, background: '#7F77DD' }}/></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 13, marginTop: 6 }}>
          <span>seed <b>{live.seed}</b>/{seeds}</span><span>단계 {live.stage}/{live.stages}</span><span>이동 {fmtN(live.moves)}</span><span>온도 T {live.T.toExponential(2)}</span>
          <span>현재 비용 {round(live.cur)}</span><span>지금까지 최선 <b>{round(live.best)}</b></span></div>
      </div>}
      {exLive && <div style={{ marginBottom: 10 }}>
        <div style={{ height: 8, borderRadius: 4, background: 'var(--surface-muted)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${exLive.done / exLive.total * 100}%`, background: '#1D9E75' }}/></div>
        <div style={{ fontSize: 13, marginTop: 6 }}>전수 탐색 {fmtN(exLive.done)} / {fmtN(exLive.total)} 배치 · 지금까지 최선 <b>{round(exLive.best)}</b></div>
      </div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 10 }}>
        <div style={{ minWidth: 0 }}><small><b>비용 변화</b> (보라 = 현재, 초록 = 지금까지 최선{exKnown ? ', 점선 = 전수 최적' : ''})</small>
          <CostChart traces={live ? [...results.map(r => r.trace), live.trace] : results.map(r => r.trace)} optimum={exKnown?.best ?? null}/></div>
        <div style={{ minWidth: 0, gridColumn: '1 / -1' }}><small><b>{shownTitle || '실행 결과 배치'}</b> (실제 비율 · 옆으로 스크롤)</small>{shownState ? <RowView ctx={ctx} st={shownState}/> : <p className="chip-note">SA를 실행하면 최선 배치가 여기에 그려집니다.</p>}</div>
      </div>

      {results.length > 0 && <div className="data-table" style={{ marginTop: 10 }}><table><thead><tr><th>seed</th><th>이동 수</th><th>수용률</th><th>계산 시간</th><th>최선 비용</th><th>{exKnown ? '전수 최적과 비교' : '다른 seed 최선과 비교'}</th></tr></thead><tbody>
        {results.map(r => { const ref = exKnown?.best ?? bestRun!.best; const ok = Math.abs(r.best - ref) < 1e-6
          return <tr key={r.seed}><td>{r.seed}</td><td>{fmtN(r.moves)}</td><td>{Math.round(r.accepted / r.moves * 100)}%</td><td>{round(r.ms)} ms</td><td><b>{round(r.best)}</b></td>
            <td style={{ color: ok ? '#1D9E75' : '#C0A02B', fontWeight: 700 }}>{ok ? (exKnown ? '전역 최적 찾음' : '최선과 같음') : `+${round((r.best / ref - 1) * 100)}%`}</td></tr> })}
      </tbody></table></div>}

      {exKnown && <p className="chip-note" style={{ marginTop: 8 }}><b>전수 탐색 ({n}셀):</b> 배치 {fmtN(exKnown.total)}가지를 {exKnown.ms < 1000 ? `${round(exKnown.ms)} ms` : `${round(exKnown.ms / 1000)} 초`}에 모두 평가 · 최적 비용 <b>{round(exKnown.best)}</b> (같은 비용의 최적 배치 {exKnown.optimaCount}개 — 좌우 대칭 등).</p>}

      {results.length > 0 && !live && <div className="card" style={{ padding: 10, marginTop: 10, borderLeft: `4px solid ${exKnown && hits === results.length ? '#1D9E75' : '#7F77DD'}` }}>
        <b style={{ fontSize: 13 }}>결론 ({n}셀)</b>
        <p style={{ margin: '4px 0 0', fontSize: 12, lineHeight: 1.7 }}>
          SA는 seed {results.length}회 평균 <b>{fmtN(Math.round(avgMoves))}번 이동, {round(avgMs)} ms</b>(평가 1회 {usPerEval ? round(usPerEval) : '—'} µs)로 끝났습니다. {avgMoves >= placementsOf(n) ? <>가능한 배치는 {fmtN(placementsOf(n))}가지뿐이라 <b>SA가 전체 배치 수보다 더 많이 평가</b>했습니다 — 이 크기에서는 전수 탐색이 더 빠르고 최적도 보장합니다.{' '}</> : <>배치 {fmtN(placementsOf(n))}가지 중 {(() => { const r = avgMoves / placementsOf(n) * 100; return r < 0.01 ? r.toExponential(1) : round(r) })()}%만 평가했습니다.{' '}</>}
          {exKnown
            ? <>전수 탐색으로 확인한 전역 최적을 <b>{results.length}회 중 {hits}회</b> 찾았습니다.{hits < results.length ? ' 못 찾은 seed는 국소 최적에 머문 경우라 여러 seed 중 최선을 씁니다.' : ''}</>
            : <><b>{results.length}회 중 {hits}회</b>가 같은 최선 비용에 도달했습니다. 이 크기는 전수 탐색으로 확인할 수 없어 최적이라고 보장할 수는 없지만, 서로 다른 출발점에서 같은 답에 모이면 최적에 가깝다는 근거가 됩니다.</>}
          {!exKnown && exEstimateSec(n) !== null && Number.isFinite(exEstimateSec(n)!) && <> 같은 {n}셀을 전수 탐색하면 약 <b>{(() => { const s = exEstimateSec(n)!; return s < 120 ? `${round(s)} 초` : s < 3600 ? `${round(s / 60)} 분` : s < 86400 * 2 ? `${round(s / 3600)} 시간` : s < 86400 * 365 ? `${round(s / 86400)} 일` : `${round(s / 86400 / 365)} 년` })()}</b> 걸립니다(위 시간 분석 표의 실측 기반 값). SA는 그 대신 {round(avgMs)} ms였습니다.</>}
        </p></div>}
    </>}
  </div>
}

function CostChart({ traces, optimum }: { traces: SaTrace[][]; optimum: number | null }) {
  const W = 360, H = 170, pad = 44
  const all = traces.flat()
  if (!all.length) return <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%' }} role="img" aria-label="SA 비용 변화 (아직 없음)"><text x={W / 2} y={H / 2} textAnchor="middle" fontSize={11} fill="currentColor" opacity={0.6}>SA 실행 전</text></svg>
  const maxMove = Math.max(...all.map(t => t.move)), vals = all.flatMap(t => [t.cur, t.best]).concat(optimum ?? [])
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const X = (m: number) => pad + m / maxMove * (W - pad - 8), Y = (v: number) => H - 20 - (hi === lo ? 0.5 : (v - lo) / (hi - lo)) * (H - 34)
  return <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%' }} role="img" aria-label="SA 이동 수에 따른 현재 비용과 최선 비용">
    <line x1={pad} y1={H - 20} x2={W - 8} y2={H - 20} stroke="currentColor" opacity={0.3}/><line x1={pad} y1={8} x2={pad} y2={H - 20} stroke="currentColor" opacity={0.3}/>
    <text x={pad - 4} y={Y(hi) + 4} fontSize={9} textAnchor="end" fill="currentColor">{round(hi)}</text><text x={pad - 4} y={Y(lo) + 4} fontSize={9} textAnchor="end" fill="currentColor">{round(lo)}</text>
    <text x={W - 8} y={H - 6} fontSize={9} textAnchor="end" fill="currentColor">이동 {fmtN(maxMove)}</text>
    {optimum !== null && <line x1={pad} x2={W - 8} y1={Y(optimum)} y2={Y(optimum)} stroke="#1D9E75" strokeDasharray="4 3"/>}
    {traces.map((tr, i) => <g key={i} opacity={i === traces.length - 1 ? 1 : 0.35}>
      <polyline points={tr.map(t => `${X(t.move)},${Y(t.cur)}`).join(' ')} fill="none" stroke="#7F77DD" strokeWidth={1}/>
      <polyline points={tr.map(t => `${X(t.move)},${Y(t.best)}`).join(' ')} fill="none" stroke="#1D9E75" strokeWidth={1.6}/>
    </g>)}
  </svg>
}

function RowView({ ctx, st }: { ctx: Ctx; st: State }) {
  const X = new Array(ctx.n).fill(0)
  const routes: Route[] = []
  evaluate(ctx, st, X, routes)
  const width = st.order.reduce((s, i, k) => s + ctx.W[i] + (k < ctx.n - 1 ? st.gaps[k] * ctx.rules.site : 0), 0)
  const S = 36, pad = 10, row = ctx.rules.row // fixed px/µm keeps the true aspect ratio; wide rows scroll
  const px = (x: number) => pad + x * S, py = (y: number) => pad + (row - y) * S
  const VW = width * S + pad * 2, VH = row * S + pad * 2 + 12
  return <div style={{ overflowX: 'auto' }}><svg viewBox={`0 0 ${VW} ${VH}`} width={VW} height={VH} style={{ display: 'block', color: 'var(--text-primary)' }} role="img" aria-label="배치된 셀과 넷 경로">
    {ctx.tracks.map(t => <line key={t} x1={px(0)} x2={px(width)} y1={py(t)} y2={py(t)} stroke="#378ADD" opacity={0.2}/>)}
    {st.order.map(i => <g key={i}>
      <rect x={px(X[i])} y={py(row)} width={ctx.W[i] * S} height={row * S} fill="#378ADD" fillOpacity={0.08} stroke="currentColor" strokeOpacity={0.5}/>
      <text x={px(X[i] + ctx.W[i] / 2)} y={py(row) + 12} textAnchor="middle" fontSize={9} fontWeight={700} fill="currentColor">{INSTS[i].name}{st.flip[i] ? '·FN' : ''}</text>
      <text x={px(X[i] + ctx.W[i] / 2)} y={py(0) - 4} textAnchor="middle" fontSize={8} fill="currentColor" opacity={0.7}>{INSTS[i].cell.replace('_1', '')}</text>
    </g>)}
    {routes.map((r, k) => <path key={r.net} d={`M ${px(r.ax)} ${py(r.ay)} V ${py(r.t)} H ${px(r.bx)} V ${py(r.by)}`} fill="none" stroke={NET_COLORS[k % NET_COLORS.length]} strokeWidth={1.8} opacity={0.85}><title>{r.net}</title></path>)}
    <text x={pad} y={row * S + pad * 2 + 8} fontSize={9} fill="currentColor">{round(width)} × {row} µm · 넷 {routes.length}개</text>
  </svg></div>
}
