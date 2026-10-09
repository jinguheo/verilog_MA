// beam search → LNS-SA → 간격 DP 결합 탐색 (결합 설계 화면용). 엔진 함수만 사용하며 엔진·chipSearch.ts는 수정하지 않는다.
//  - lnsSaTimed: 일부 블록을 걷어내고 작은 beam으로 다시 놓는 큰 이동(large neighborhood search)을 SA로 받아들이거나 거절한다.
//  - gapDpFine: ADC–SRAM 행의 µm 간격을 규칙(0 또는 ≥ T) 아래 정확히 최적화한다 (DpStepByStep.tsx의 gapDp와 같은 모델).
import * as E from '../game/chipTetrisEngine'
import { SEQ, ringList, allCells, rngOf, type P, type Found } from './chipSearch'

type Id = E.BlockId
const tick = () => new Promise<void>(r => setTimeout(r, 0))
const lock = (s: E.GameState, id: Id, p: P) => E.lockActive(s, { id, rotation: p.r, x: p.x, y: p.y } as E.ActiveBlock, s.queue, s.hold)
const legalAt = (s: E.GameState, id: Id, p: P) => E.isLegalPlacement(s.board, { id, rotation: p.r, x: p.x, y: p.y } as E.ActiveBlock)

// 블록 의존: A를 걷어내면 A에 의존하는 블록도 함께 다시 놓는다(필수 이웃 규칙)
const DEPS: Record<string, Id[]> = { adc: ['opamp', 'fifo'], sram: ['control'], opamp: ['fifo'], fifo: [], control: [] }
const PREREQ: Record<string, Id | null> = { adc: null, sram: null, opamp: 'adc', fifo: 'opamp', control: 'sram' }
const closure = (id: Id): Id[] => [id, ...DEPS[id].flatMap(closure)]
function randomValidOrder(set: Id[], rnd: () => number): Id[] {
  const left = [...set], out: Id[] = []
  while (left.length) {
    const ok = left.filter(id => { const q = PREREQ[id]; return !q || !left.includes(q) })
    const pick = ok[Math.floor(rnd() * ok.length)]; out.push(pick); left.splice(left.indexOf(pick), 1)
  }
  return out
}

export type LnsResult = { best: Found; moves: number; accepted: number; trace: Array<[number, number]>; ms: number }
// start: beam이 만든 완성 배치(SEQ 순서). S = 부모 하나당 뽑는 후보 수(절반은 현재 위치 ±2칸 근처), kb = 작은 beam 폭
export async function lnsSaTimed(seed: number, budgetMs: number, T0: number, T1: number, start: Found, S = 40, kb = 3,
  onProgress?: (elapsed: number, best: number) => void): Promise<LnsResult> {
  const rnd = rngOf(seed), cache = new Map<string, P[]>()
  const legalList = (s: E.GameState, id: Id): P[] => {
    const key = id + '|' + E.placementSignature(s.board)
    const c = cache.get(key); if (c) return c
    const out: P[] = []
    for (const [r, x, y] of ringList(s.board, id) ?? allCells(id)) if (E.isLegalPlacement(s.board, { id, rotation: r, x, y } as E.ActiveBlock)) out.push({ r, x, y })
    if (cache.size > 3000) cache.clear()
    cache.set(key, out); return out
  }
  const pick = <T,>(a: T[], n: number): T[] => { if (a.length <= n) return a; const idx = new Set<number>(); while (idx.size < n) idx.add(Math.floor(rnd() * a.length)); return [...idx].map(i => a[i]) }
  const replay = (pos: Record<string, P>) => { let s = E.createGame(0); for (const id of SEQ) { if (!legalAt(s, id, pos[id])) return null; s = lock(s, id, pos[id]) } return s }
  let cur: Record<string, P> = {}; SEQ.forEach((id, i) => { cur[id] = start.ps[i] })
  const startState = replay(cur)!
  let curV = E.evaluatePlacement(startState.board), best: Found = { ps: start.ps, board: startState.board, value: curV }
  let moves = 0, accepted = 0
  const t0 = performance.now(); let slice = t0
  const trace: Array<[number, number]> = [[0, curV]]
  while (true) {
    const el = performance.now() - t0; if (el >= budgetMs) break
    const T = T0 * Math.pow(T1 / T0, el / budgetMs)
    moves++
    const R = new Set<Id>(closure(SEQ[Math.floor(rnd() * SEQ.length)]))
    if (rnd() < 0.5) closure(SEQ[Math.floor(rnd() * SEQ.length)]).forEach(x => R.add(x))
    let base = E.createGame(0), okBase = true
    for (const id of SEQ.filter(i => !R.has(i))) { if (!legalAt(base, id, cur[id])) { okBase = false; break } base = lock(base, id, cur[id]) }
    if (okBase) {
      const order = randomValidOrder([...R], rnd)
      let layer: Array<{ s: E.GameState; pos: Record<string, P> }> = [{ s: base, pos: {} }]
      for (const id of order) {
        const nxt: Array<{ s: E.GameState; pos: Record<string, P>; v: number }> = []
        for (const par of layer) {
          const all = legalList(par.s, id)
          const near = all.filter(p => Math.abs(p.x - cur[id].x) <= 2 && Math.abs(p.y - cur[id].y) <= 2)
          const cs = new Map<string, P>()
          for (const p of [...pick(near, Math.ceil(S / 2)), ...pick(all, Math.floor(S / 2))]) cs.set(`${p.r}:${p.x}:${p.y}`, p)
          for (const p of cs.values()) { const s2 = lock(par.s, id, p); nxt.push({ s: s2, pos: { ...par.pos, [id]: p }, v: E.evaluatePlacement(s2.board) }) }
        }
        nxt.sort((a, b) => b.v - a.v); layer = nxt.slice(0, kb)
        if (!layer.length) break
      }
      if (layer.length && Object.keys(layer[0].pos).length === order.length) {
        const full = { ...cur, ...layer[Math.floor(rnd() * layer.length)].pos }, fs = replay(full)
        if (fs) {
          const v = E.evaluatePlacement(fs.board)
          if (v >= curV || rnd() < Math.exp((v - curV) / T)) { cur = full; curV = v; accepted++; if (v > best.value) best = { ps: SEQ.map(i => full[i]), board: fs.board, value: v } }
        }
      }
    }
    if (performance.now() - slice > 200) { slice = performance.now(); trace.push([slice - t0, best.value]); onProgress?.(slice - t0, best.value); await tick() }
  }
  trace.push([performance.now() - t0, best.value])
  return { best, moves, accepted, trace, ms: performance.now() - t0 }
}

// ---- 간격 DP (정확): 단위 u µm 칸, 규칙 = 간격은 0 또는 ≥ T µm ----
export const GAP_G = { coreLeft: 20.24, coreRight: 1229.6, halo: 10, macros: [{ n: 'ADC', w: 223.71 }, { n: 'SRAM', w: 764.24 }], strapPitch: 40, strapOffset: 22.66 }
export function gapCostOf(gaps: number[]): number {
  const G = GAP_G, strap = (x: number) => { const d = (((x - G.strapOffset) % G.strapPitch) + G.strapPitch) % G.strapPitch; return Math.min(d, G.strapPitch - d) * 0.05 }
  const x0 = G.coreLeft + gaps[0] + G.halo, x1 = G.coreLeft + gaps[0] + G.macros[0].w + 2 * G.halo + gaps[1] + G.halo
  return Math.max(0, 300 - (gaps[1] + 2 * G.halo)) * 0.01 + strap(x0) + strap(x1)
}
export function gapDpFine(u: number, T: number): { best: number; gaps: number[]; L: number; ms: number } {
  const t0 = performance.now(), G = GAP_G, k = G.macros.length, INF = Infinity
  const L = (G.coreRight - G.coreLeft) - G.macros.reduce((a, m) => a + m.w, 0) - 2 * G.halo * k
  const LU = Math.round(L / u), Tu = Math.ceil(T / u), allowed = (g: number) => g === 0 || g >= Tu
  const gapCost = (i: number, gum: number) => (i > 0 && i < k) ? Math.max(0, 300 - (gum + 2 * G.halo)) * 0.01 : 0
  const leftEdge = (i: number, s: number) => G.coreLeft + s * u + G.macros.slice(0, i).reduce((a, m) => a + m.w + 2 * G.halo, 0) + G.halo
  const macroCost = (x: number) => { const d = (((x - G.strapOffset) % G.strapPitch) + G.strapPitch) % G.strapPitch; return Math.min(d, G.strapPitch - d) * 0.05 }
  const f = Array.from({ length: k + 1 }, () => Array<number>(LU + 1).fill(INF)), from = Array.from({ length: k + 1 }, () => Array<number>(LU + 1).fill(-1))
  f[0][0] = 0
  for (let i = 0; i < k; i++) for (let s = 0; s <= LU; s++) { if (f[i][s] === INF) continue
    for (let g = 0; g <= LU - s; g++) { if (!allowed(g)) continue; const s2 = s + g, c = f[i][s] + gapCost(i, g * u) + macroCost(leftEdge(i, s2)); if (c < f[i + 1][s2]) { f[i + 1][s2] = c; from[i + 1][s2] = s } } }
  let best = INF, bs = -1; for (let s = 0; s <= LU; s++) { const r = LU - s; if (f[k][s] === INF || !allowed(r)) continue; const c = f[k][s] + gapCost(k, r * u); if (c < best) { best = c; bs = s } }
  const path = [bs]; let s = bs; for (let i = k; i > 0; i--) { s = from[i][s]; path.push(s) }; path.reverse()
  return { best, gaps: [path[1] - path[0], path[2] - path[1], LU - path[2]].map(g => g * u), L, ms: performance.now() - t0 }
}

// 거친 배치(50 µm 칸)의 ADC–SRAM 행 종류와 µm 간격 환산
export function rowKind(board: E.Board): { sameRow: boolean; adcLeft: boolean; gaps: [number, number, number] } {
  const box = (id: Id) => { let a = 99, c = -1, b = 99, d = -1; board.forEach((row, y) => row.forEach((cell, x) => { if (cell?.id === id) { a = Math.min(a, x); c = Math.max(c, x); b = Math.min(b, y); d = Math.max(d, y) } })); return { a, c, b, d } }
  const A = box('adc'), S = box('sram')
  return { sameRow: !(A.d < S.b || S.d < A.b), adcLeft: A.c < S.a, gaps: [A.a * E.GRID_UM, (S.a - A.c - 1) * E.GRID_UM, (E.BOARD_COLS - 1 - S.c) * E.GRID_UM] }
}
