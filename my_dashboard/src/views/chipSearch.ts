// Chip Tetris 배치 탐색 공용 모듈 (SA·beam search 결과 비교 화면용). 엔진 함수만 사용하며 엔진은 수정하지 않는다.
// 화면이 멈추지 않도록 오래 걸리는 탐색은 작은 조각으로 나눠 setTimeout으로 양보한다.
import * as E from '../game/chipTetrisEngine'

export type P = { r: number; x: number; y: number }
export const SEQ = E.PLACEMENT_SEQUENCE
export const COLS = E.BOARD_COLS, ROWS = E.BOARD_ROWS
export type Found = { ps: P[]; board: E.Board; value: number }

export function rngOf(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const yieldUi = () => new Promise<void>(r => setTimeout(r, 0))

// 게임 점수의 항목별 가중치 (chipTetrisEngine의 placementValue와 같은 식). 화면에서 합계가 evaluatePlacement와 일치하는지 검증한다.
// 마지막 값은 '위반이 0이어도 남는 항'(true)인지 여부.
export const TERMS: Array<[keyof E.BoardMetrics, number, string, boolean]> = [
  ['adjacencyPenalty', 180, '필수 이웃 인접', false], ['functionalClusterPenalty', 45, '기능 클러스터', true], ['aggregateHeight', 0.12, '높이 합', true], ['maxHeight', 0.2, '최대 높이', true], ['holes', 3.2, '빈 구멍', true],
  ['bumpiness', 0.1, '울퉁불퉁함', true], ['zonePenalty', 40, '영역(zone)', false], ['isolationPenalty', 45, '아날로그 격리', false], ['macroSpacingPenalty', 35, '매크로 간격', false], ['powerAccessPenalty', 18, '전원 접근', false],
  ['pinAccessPenalty', 25, '핀 접근', false], ['integrityViolations', 100, '구조 무결성', false], ['congestion', 12, '혼잡', false], ['macroClearancePenalty', 6, '매크로 여유(벌점)', true], ['macroClearanceRisk', 90, '매크로 여유(위험)', false], ['wirelengthPenalty', 2.5, '배선 길이 proxy', true],
]

// 필수 이웃이 있는 블록의 후보 위치: 이웃 블록 바로 바깥 칸을 모양의 한 칸이 덮는 위치(엔진의 합법 위치를 놓치지 않음)
export function ringList(board: E.Board, id: E.BlockId): Array<[number, number, number]> | null {
  const req = E.BLOCKS[id].requiredNeighbor; if (!req) return null
  const occ = new Set<string>(), rg = new Set<string>()
  board.forEach((row, y) => row.forEach((c, x) => { if (c?.id === req) occ.add(`${x},${y}`) }))
  for (const k of occ) { const [x, y] = k.split(',').map(Number); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (!occ.has(`${nx},${ny}`) && nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS) rg.add(`${nx},${ny}`) } }
  const out: Array<[number, number, number]> = [], seen = new Set<string>()
  E.rotationsFor(id).forEach((shape, r) => { for (const k of rg) { const [nx, ny] = k.split(',').map(Number); for (const [sx, sy] of shape) { const x = nx - sx, y = ny - sy, kk = `${r}:${x}:${y}`; if (!seen.has(kk) && x >= 0 && y >= 0) { seen.add(kk); out.push([r, x, y]) } } } })
  return out
}
export function allCells(id: E.BlockId): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  E.rotationsFor(id).forEach((_, r) => { for (let x = 0; x < COLS; x++) for (let y = 0; y < ROWS; y++) out.push([r, x, y]) })
  return out
}
export function drawLegal(s: E.GameState, id: E.BlockId, rnd: () => number): { p: P; s2: E.GameState } | null {
  const ring = ringList(s.board, id), nrot = E.rotationsFor(id).length
  for (let t = 0; t < 400; t++) {
    let r: number, x: number, y: number
    if (ring) { if (!ring.length) return null; [r, x, y] = ring[Math.floor(rnd() * ring.length)] } else { r = Math.floor(rnd() * nrot); x = Math.floor(rnd() * COLS); y = Math.floor(rnd() * ROWS) }
    const ac = { id, rotation: r, x, y } as E.ActiveBlock
    if (E.isLegalPlacement(s.board, ac)) return { p: { r, x, y }, s2: E.lockActive(s, ac, s.queue, s.hold) }
  }
  return null
}
export function buildFrom(ps: P[], upto: number): E.GameState | null {
  let s = E.createGame(0)
  for (let i = 0; i < upto; i++) { const ac = { id: SEQ[i], rotation: ps[i].r, x: ps[i].x, y: ps[i].y } as E.ActiveBlock; if (!E.isLegalPlacement(s.board, ac)) return null; s = E.lockActive(s, ac, s.queue, s.hold) }
  return s
}

// ---- beam search (상태 키 = 블록별 (모양, x/bucket, y/bucket)) ----
type Node = { s: E.GameState; v: number; ps: P[] }
// order = 블록을 놓는 순서(기본 SEQ). 반환 ps[i]는 order[i] 블록의 위치다. 어떤 단계에서 합법 위치가 하나도 없으면 top이 비고 stoppedAt에 그 블록이 들어간다.
export async function beamAsync(K: number, bucket: number, onProgress?: (msg: string) => void, order: readonly E.BlockId[] = SEQ, cancel?: () => boolean): Promise<{ top: Found[]; ms: number; legalChecks: number; stoppedAt?: E.BlockId }> {
  const t0 = performance.now(); let legalChecks = 0
  let layer: Node[] = [{ s: E.createGame(0), v: 0, ps: [] }]
  for (let li = 0; li < order.length; li++) {
    const id = order[li]; const seen = new Map<string, Node>()
    for (let pi = 0; pi < layer.length; pi++) {
      if (cancel?.()) return { top: [], ms: performance.now() - t0, legalChecks }
      const n = layer[pi]
      for (const [r, x, y] of ringList(n.s.board, id) ?? allCells(id)) {
        legalChecks++
        const ac = { id, rotation: r, x, y } as E.ActiveBlock
        if (!E.isLegalPlacement(n.s.board, ac)) continue
        const s2 = E.lockActive(n.s, ac, n.s.queue, n.s.hold)
        const c: Node = { s: s2, v: E.evaluatePlacement(s2.board), ps: [...n.ps, { r, x, y }] }
        const key = bucket <= 0 ? E.placementSignature(s2.board) : c.ps.map((q, i) => `${i}:${q.r}:${Math.floor(q.x / bucket)}:${Math.floor(q.y / bucket)}`).join('|')
        const o = seen.get(key); if (!o || c.v > o.v) seen.set(key, c)
      }
      onProgress?.(`${li + 1}/${order.length}단계 · 부모 ${pi + 1}/${layer.length}`)
      await yieldUi()
    }
    layer = [...seen.values()].sort((a, b) => b.v - a.v).slice(0, K)
    if (!layer.length) return { top: [], ms: performance.now() - t0, legalChecks, stoppedAt: id }
  }
  return { top: layer.map(n => ({ ps: n.ps, board: n.s.board, value: n.v })), ms: performance.now() - t0, legalChecks }
}

// ---- SA: 무작위 합법 시작, 블록 하나(50%는 뒤 블록 전부)를 합법 위치로 다시 뽑는 이동, 지수 냉각 ----
export async function saTimed(seed: number, budgetMs: number, T0: number, T1: number, onProgress?: (elapsed: number, best: number) => void, cancel?: () => boolean): Promise<{ start: Found; best: Found; moves: number; acc: number; illegal: number; trace: Array<[number, number]>; ms: number } | null> {
  const rnd = rngOf(seed), t0 = performance.now()
  // 막다른 길(다음 블록의 합법 위치 없음)이면 같은 난수열로 처음부터 다시 뽑는다
  let s = E.createGame(0); let ps0: P[] = []
  for (let attempt = 0; attempt < 60; attempt++) {
    s = E.createGame(0); ps0 = []; let ok = true
    for (const id of SEQ) { const d = drawLegal(s, id, rnd); if (!d) { ok = false; break } ps0.push(d.p); s = d.s2 }
    if (ok) break
    if (attempt === 59) return null
  }
  let cur = ps0, curV = E.evaluatePlacement(s.board)
  const start: Found = { ps: ps0, board: s.board, value: curV }
  let best: Found = start, moves = 0, acc = 0, illegal = 0
  const trace: Array<[number, number]> = [[performance.now() - t0, curV]]
  let slice = performance.now()
  while (true) {
    const el = performance.now() - t0; if (el >= budgetMs || cancel?.()) break
    const T = T0 * Math.pow(T1 / T0, el / budgetMs)
    const i = Math.floor(rnd() * SEQ.length), suffix = rnd() < 0.5
    let st = buildFrom(cur, i); moves++
    if (!st) { illegal++; continue }
    const np = cur.slice(0, i); let ok = true
    for (let j = i; j < SEQ.length; j++) {
      if (j === i || suffix) { const d = drawLegal(st!, SEQ[j], rnd); if (!d) { ok = false; break } np.push(d.p); st = d.s2 }
      else { const ac = { id: SEQ[j], rotation: cur[j].r, x: cur[j].x, y: cur[j].y } as E.ActiveBlock; if (!E.isLegalPlacement(st!.board, ac)) { ok = false; break } np.push(cur[j]); st = E.lockActive(st!, ac, st!.queue, st!.hold) }
    }
    if (!ok) { illegal++ } else {
      const v = E.evaluatePlacement(st!.board)
      if (v >= curV || rnd() < Math.exp((v - curV) / T)) { cur = np; curV = v; acc++; if (v > best.value) best = { ps: np, board: st!.board, value: v } }
    }
    if (performance.now() - slice > 80) { slice = performance.now(); trace.push([performance.now() - t0, best.value]); onProgress?.(performance.now() - t0, best.value); await yieldUi() }
  }
  trace.push([performance.now() - t0, best.value])
  return { start, best, moves, acc, illegal, trace, ms: performance.now() - t0 }
}

// Guided SA: hard legality is checked before scoring; DRC/STA hypotheses remain soft.
export type GuidedResult = {
  start: Found; best: Found; diverse: Found[]; moves: number; accepted: number
  evaluated: number; legalChecks: number; duplicates: number; deadEnds: number
  restarts: number; trace: Array<[number, number]>; ms: number
}
const pkey = (p: P) => `${p.r}:${p.x}:${p.y}`
const macroBin = (ps: P[]) => ps.slice(0, 2).map(p =>
  `${p.r}:${Math.floor(p.x / 4)}:${Math.floor(p.y / 3)}`).join('|')

export async function saGuidedTimed(
  seed: number, budgetMs: number, T0: number, T1: number,
  onProgress?: (elapsed: number, best: number) => void,
  initialPool: Found[] = [],
  cancel?: () => boolean,
): Promise<GuidedResult | null> {
  const rnd = rngOf(seed), t0 = performance.now()
  let legalChecks = 0, duplicates = 0, deadEnds = 0
  let moves = 0, accepted = 0, evaluated = 0, restarts = 0
  const legalCache = new Map<string, P[]>(), allCache = new Map<E.BlockId, Array<[number, number, number]>>()
  const seen = new Set<string>(), archive = new Map<string, Found>()
  const legal = (s: E.GameState, id: E.BlockId, anchor?: P, local = false): P[] => {
    const key = `${id}:${E.placementSignature(s.board)}:${local && anchor ? pkey(anchor) : 'global'}`
    const cached = legalCache.get(key)
    if (cached) return cached
    let positions: Array<[number, number, number]> | null | undefined = ringList(s.board, id)
    if (!positions) {
      positions = allCache.get(id)
      if (!positions) { positions = allCells(id); allCache.set(id, positions) }
    }
    if (local && anchor) {
      const nearby = positions.filter(([, x, y]) => Math.abs(x - anchor.x) <= 2 && Math.abs(y - anchor.y) <= 2)
      if (nearby.length) positions = nearby
    }
    const choices: P[] = [], limit = Math.min(positions.length, 40)
    const used = new Set<number>()
    while (used.size < limit) {
      const index = Math.floor(rnd() * positions.length)
      if (used.has(index)) continue
      used.add(index)
      const [r, x, y] = positions[index]
      legalChecks++
      if (E.isLegalPlacement(s.board, { id, rotation: r, x, y } as E.ActiveBlock))
        choices.push({ r, x, y })
    }
    if (legalCache.size >= 1024) legalCache.clear()
    legalCache.set(key, choices)
    return choices
  }
  const place = (s: E.GameState, id: E.BlockId, p: P) =>
    E.lockActive(s, { id, rotation: p.r, x: p.x, y: p.y } as E.ActiveBlock, s.queue, s.hold)
  const construct = (prefix: P[], changed: number, local: boolean, reuseTail: boolean):
    { ps: P[]; state: E.GameState } | null => {
    let state = E.createGame(0)
    const ps: P[] = []
    for (let j = 0; j < SEQ.length; j++) {
      const id = SEQ[j]
      let p: P | undefined
      if (j < changed) {
        p = prefix[j]
        if (!p || !E.isLegalPlacement(state.board, { id, rotation: p.r, x: p.x, y: p.y } as E.ActiveBlock)) return null
      } else {
        if (j > changed && reuseTail && prefix[j] &&
          E.isLegalPlacement(state.board, { id, rotation: prefix[j].r, x: prefix[j].x, y: prefix[j].y } as E.ActiveBlock))
          p = prefix[j]
        if (!p) {
          let choices = legal(state, id, prefix[j], j === changed && local)
          if (j === changed && prefix[j]) choices = choices.filter(q => pkey(q) !== pkey(prefix[j]))
          if (!choices.length) return null
          p = choices[Math.floor(rnd() * choices.length)]
        }
      }
      ps.push(p)
      state = place(state, id, p)
    }
    return { ps, state }
  }
  const remember = (found: Found) => {
    const bin = macroBin(found.ps), old = archive.get(bin)
    if (!old || found.value > old.value) archive.set(bin, found)
  }
  let current: Found | null = null
  for (const seedFound of initialPool) {
    const rebuilt = buildFrom(seedFound.ps, SEQ.length)
    if (!rebuilt) continue
    const signature = E.placementSignature(rebuilt.board)
    if (seen.has(signature)) continue
    const found: Found = { ps: seedFound.ps, board: rebuilt.board, value: E.evaluatePlacement(rebuilt.board) }
    evaluated++
    seen.add(signature)
    remember(found)
    if (!current || found.value > current.value) current = found
  }
  let randomStarts = 0
  for (let tries = 0; tries < 16 && randomStarts < 5; tries++) {
    const initial = construct([], 0, false, false)
    if (!initial) continue
    const signature = E.placementSignature(initial.state.board)
    if (seen.has(signature)) continue
    const found: Found = { ps: initial.ps, board: initial.state.board, value: E.evaluatePlacement(initial.state.board) }
    randomStarts++; evaluated++
    seen.add(signature)
    remember(found)
    if (!current || found.value > current.value) current = found
  }
  if (!current) return null
  const start = current
  let best = current
  const trace: Array<[number, number]> = [[performance.now() - t0, best.value]]
  let lastYield = performance.now(), stagnant = 0
  while (performance.now() - t0 < budgetMs && !cancel?.()) {
    moves++
    const i = Math.floor(rnd() * SEQ.length), local = rnd() < 0.7, reuseTail = rnd() < 0.7
    let next: ReturnType<typeof construct> = null
    for (let tries = 0; tries < 4 && !next; tries++)
      next = construct(current.ps, i, local && tries < 2, reuseTail && tries < 2)
    if (!next) { deadEnds++; continue }
    const signature = E.placementSignature(next.state.board)
    if (seen.has(signature)) { duplicates++; continue }
    if (seen.size >= 20000) seen.clear()
    seen.add(signature)
    const value = E.evaluatePlacement(next.state.board)
    evaluated++
    const found: Found = { ps: next.ps, board: next.state.board, value }
    remember(found)
    const elapsed = performance.now() - t0
    const T = T0 * Math.pow(T1 / T0, Math.min(1, elapsed / budgetMs))
    if (value >= current.value || rnd() < Math.exp((value - current.value) / T)) {
      current = found; accepted++
      if (value > best.value) { best = found; stagnant = 0 } else stagnant++
    } else stagnant++
    if (stagnant >= 120 && archive.size > 1) {
      const fresh = rnd() < 0.3 ? construct([], 0, false, false) : null
      if (fresh) {
        const value = E.evaluatePlacement(fresh.state.board)
        const found: Found = { ps: fresh.ps, board: fresh.state.board, value }
        current = found; evaluated++; remember(found)
        if (value > best.value) best = found
      } else {
        const pool = [...archive.values()].sort((a, b) => b.value - a.value).slice(0, 12)
        current = pool[Math.floor(rnd() * pool.length)]
      }
      restarts++; stagnant = 0
    }
    if (performance.now() - lastYield > 80) {
      lastYield = performance.now()
      trace.push([lastYield - t0, best.value])
      onProgress?.(lastYield - t0, best.value)
      await yieldUi()
    }
  }
  trace.push([performance.now() - t0, best.value])
  return { start, best, diverse: [...archive.values()].sort((a, b) => b.value - a.value).slice(0, 12),
    moves, accepted, evaluated, legalChecks, duplicates, deadEnds, restarts, trace, ms: performance.now() - t0 }
}
