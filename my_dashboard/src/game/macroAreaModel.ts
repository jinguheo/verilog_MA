// Macro Area Tetris 모델 — Macro Tetris(macroTetrisModel.ts)와 같은 배치·비용 규칙을
// 다이 크기를 인자로 받는 형태로 다시 쓴 것. 원본 모델은 DIE_W/DIE_H를 모듈 상수로
// 박아 두어 다이를 줄이는 탐색에 쓸 수 없으므로, 상수·타입·기하 함수만 가져오고
// 다이에 의존하는 부분(경계·핀/전원 접근·여유 공간 격자·Rip-up·표준셀 타일)을
// 여기서 다이 인자로 일반화했다.
//
// 면적 탐색: 성공하면 더 줄이고(처음엔 5%씩), 실패하면 그 면적을 하한으로 두고 마지막
// 성공과의 중간으로 다시 키워서 시도한다(이분 탐색). 실패한 후보는 어느 매크로가 어떤
// 규칙으로 막혔는지 진단하고, 실패 종류별 처리 알고리즘(repairFrom)을 거친 뒤에도 안
// 될 때만 실패로 친다. 통과한 배치는 전부 후보가 되고, generateForDie로 같은 다이의
// 다른 배치를 더 만든다.
import {
  DIE_W, DIE_H, MIN_SPACING, UTIL_WARN, impliedUtil, hubDefs, N_HUBS,
  GRID_COLS, GRID_ROWS, HOTSPOT_RATIO, PIN_ESCAPE_MARGIN, POWER_RING_MARGIN,
  LO_CELL, USABLE_SQUARE, GLUE_TILE, GLUE_TILE_CAP, REAL_GLUE, REAL_RUN_MACROS, REAL_RUN_HUBS,
  gapBetween, overlapAmount, rasterizeSegment, mulberry32, internalProjectionGaps, CHANNEL_SAFE_MARGIN,
  STD_CELL_ROW_HEIGHT_UM, STD_CELL_SITE_WIDTH_UM, glueCoverage, GLUE_TILE_MAX_COUNT,
  type Macro, type Pos, type State, type Cost, type GlueTile,
} from './macroTetrisModel'

export type Die = { w: number; h: number }
export const BASE_DIE: Die = { w: DIE_W, h: DIE_H }
// 실제 signoff를 통과한 config_hierarchical.json 격자는 다이 가장자리에서 100µm
// 떨어져 시작한다(전원 링·IO 여유) — 줄이는 동안에도 같은 여유를 강제한다.
export const EDGE_MARGIN = MIN_SPACING
// 다이 한 변을 10µm 단위로 맞춘다.
export const DIE_SNAP = 10
// 한쪽 방향만 계속 줄여 가늘고 긴 다이가 되는 것을 막는다.
export const MAX_ASPECT = 3
export const RIPUP_STEP = MIN_SPACING

// 표준셀 row 용량 모델 상수 — 근거는 아래 rowCapacityD 주석(실측 cutrows DEF).
export const CORE_INSET_X_UM = 5.52
export const CORE_INSET_Y_UM = 10.88
export const MACRO_HALO_UM = 10

// ---- 룰 참조표 ----
// 지금 적용 중인 물리 제약이 gateReason/diagnoseD/repairFrom/generateForDie에
// 흩어져 있어서 "지금 규칙이 뭐지?"를 빠르게 확인할 데가 없었다. 값을 여기서
// 새로 정의하지 않고 원래 상수를 그대로 참조만 한다 — 상수 하나 바뀌면 이 표도
// 같이 바뀌니, 이 객체 하나가 "지금 켜져 있는 규칙 전체"에 대한 단일 진실 공급원.
export const RULES = {
  spacing: { value: MIN_SPACING, unit: 'µm', gate: '항상', desc: '매크로 간 최소 간격 · 다이 가장자리 여유' },
  channel: { value: CHANNEL_SAFE_MARGIN, unit: 'µm', gate: '항상 (하드 게이트)', desc: '매크로 그룹 채널 — 2026-09-26 실측: 300=PASS, 100=FAIL(DPL-0034/0036)' },
  pinEscape: { value: PIN_ESCAPE_MARGIN, unit: 'µm', gate: '엄격 모드만', desc: '핀 escape — 최소 간격×2, 라우팅 채널 하나 지나갈 여유' },
  powerAccess: { value: POWER_RING_MARGIN, unit: 'µm', gate: '엄격 모드만', desc: '전원 접근 — 최소 간격×3, 실제 hierarchical config 행간 채널 폭과 동일' },
  density: { value: REAL_GLUE.targetDensity, unit: '', gate: '항상 (UI에서 40/50/60% 선택)', desc: '필요 밀도(glue 460,614µm² ÷ 실제 row 용량) ≤ 목표 — 기본값은 config의 PL_TARGET_DENSITY_PCT' },
  macroHalo: { value: MACRO_HALO_UM, unit: 'µm', gate: '표준셀 row 용량', desc: '매크로 둘레 row 절단 폭 — 실측 cutrows DEF: 100µm 틈 → row 조각 79.58µm' },
  coreInset: { value: CORE_INSET_Y_UM, unit: 'µm (세로, 가로 5.52)', gate: '표준셀 row 용량', desc: '다이 가장자리에서 코어까지 — 3개 다이 크기의 실측 row 수와 일치' },
  maxAspect: { value: MAX_ASPECT, unit: ':1', gate: '다이 형상 탐색', desc: '다이 종횡비 상한 — 한쪽만 계속 줄어드는 가늘고 긴 다이 방지' },
  dieSnap: { value: DIE_SNAP, unit: 'µm', gate: '항상', desc: '다이 크기 반올림 단위' },
} as const

export function dieArea(d: Die): number { return d.w * d.h }
export function macroArea(macros: Macro[]): number { return macros.reduce((s, m) => s + m.w * m.h, 0) }
// 다이 utilization = (매크로 면적 + 표준셀 실제 셀 면적) / 다이 면적.
export function dieUtil(d: Die, macros: Macro[]): number {
  return (macroArea(macros) + REAL_GLUE.cellArea) / dieArea(d)
}

// ---- 여유 공간 격자 (다이 인자) ----
function loDims(d: Die) { return { cols: Math.floor(d.w / LO_CELL), rows: Math.floor(d.h / LO_CELL) } }

function occupancy(d: Die, rects: { x: number; y: number; w: number; h: number }[]): Uint8Array {
  const { cols, rows } = loDims(d)
  const occ = new Uint8Array(cols * rows)
  for (const m of rects) {
    const c0 = Math.max(0, Math.floor(m.x / LO_CELL)), c1 = Math.min(cols - 1, Math.ceil((m.x + m.w) / LO_CELL) - 1)
    const r0 = Math.max(0, Math.floor(m.y / LO_CELL)), r1 = Math.min(rows - 1, Math.ceil((m.y + m.h) / LO_CELL) - 1)
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) occ[r * cols + c] = 1
  }
  return occ
}

function prefixSum(occ: Uint8Array, cols: number, rows: number): Int32Array {
  const W = cols + 1
  const pre = new Int32Array(W * (rows + 1))
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    pre[(r + 1) * W + (c + 1)] = occ[r * cols + c] + pre[r * W + (c + 1)] + pre[(r + 1) * W + c] - pre[r * W + c]
  }
  return pre
}

function squareFilled(pre: Int32Array, cols: number, r: number, c: number, K: number): number {
  const W = cols + 1
  return pre[(r + K) * W + (c + K)] - pre[r * W + (c + K)] - pre[(r + K) * W + c] + pre[r * W + c]
}

export type LeftoverD = { cellClass: Uint8Array; cols: number; rows: number; usableCells: number; fragmentedCells: number; totalEmptyCells: number }

// tiles: 이미 배치된 표준셀 타일(있으면) — 넘기면 그 자리도 occupied로 쳐서 "진짜
// 아직 안 쓰인" 칸만 usable/fragmented로 분류한다. 기본값 없음(=매크로만 볼 때와
// 동일)이라 costD 등 기존 호출부는 그대로 매크로만 본다.
export function analyzeLeftoverD(d: Die, macros: Macro[], tiles: { x: number; y: number; w: number; h: number }[] = []): LeftoverD {
  const { cols, rows } = loDims(d)
  const occ = occupancy(d, tiles.length ? [...macros, ...tiles] : macros)
  const pre = prefixSum(occ, cols, rows)
  const K = USABLE_SQUARE
  const usable = new Uint8Array(cols * rows)
  for (let r = 0; r + K <= rows; r++) for (let c = 0; c + K <= cols; c++) {
    if (squareFilled(pre, cols, r, c, K) !== 0) continue
    for (let dr = 0; dr < K; dr++) for (let dc = 0; dc < K; dc++) usable[(r + dr) * cols + (c + dc)] = 1
  }
  const cellClass = new Uint8Array(cols * rows)
  let usableCells = 0, fragmentedCells = 0
  for (let i = 0; i < cellClass.length; i++) {
    if (occ[i]) continue
    if (usable[i]) { cellClass[i] = 1; usableCells++ } else { cellClass[i] = 2; fragmentedCells++ }
  }
  return { cellClass, cols, rows, usableCells, fragmentedCells, totalEmptyCells: usableCells + fragmentedCells }
}

// ---- 핀 escape / 전원 접근 (다이 인자) ----
function sideClearancesD(d: Die, idx: number, macros: Macro[]) {
  const m = macros[idx]
  let left = m.x, right = d.w - (m.x + m.w), top = m.y, bottom = d.h - (m.y + m.h)
  for (let j = 0; j < macros.length; j++) {
    if (j === idx) continue
    const o = macros[j]
    const yOverlap = Math.min(m.y + m.h, o.y + o.h) - Math.max(m.y, o.y) > 0
    const xOverlap = Math.min(m.x + m.w, o.x + o.w) - Math.max(m.x, o.x) > 0
    if (yOverlap) {
      if (o.x >= m.x + m.w) right = Math.min(right, o.x - (m.x + m.w))
      if (o.x + o.w <= m.x) left = Math.min(left, m.x - (o.x + o.w))
    }
    if (xOverlap) {
      if (o.y >= m.y + m.h) bottom = Math.min(bottom, o.y - (m.y + m.h))
      if (o.y + o.h <= m.y) top = Math.min(top, m.y - (o.y + o.h))
    }
  }
  return { left, right, top, bottom }
}

function hasPinEscapeD(d: Die, idx: number, macros: Macro[]): boolean {
  const s = sideClearancesD(d, idx, macros)
  return Math.max(s.left, s.right, s.top, s.bottom) >= PIN_ESCAPE_MARGIN
}

function hasPowerAccessD(d: Die, idx: number, macros: Macro[]): boolean {
  const m = macros[idx]
  if (m.x <= POWER_RING_MARGIN || m.y <= POWER_RING_MARGIN || d.w - (m.x + m.w) <= POWER_RING_MARGIN || d.h - (m.y + m.h) <= POWER_RING_MARGIN) return true
  const s = sideClearancesD(d, idx, macros)
  return Math.max(s.left, s.right, s.top, s.bottom) >= POWER_RING_MARGIN
}

// ---- 비용: macroTetrisModel.cost와 같은 항·가중치, 경계만 다이+가장자리 여유 기준 ----
export function costD(state: State, d: Die): Cost {
  const { macros, hubs } = state
  const n = macros.length
  let overlapPenalty = 0, boundsPenalty = 0, spacingViolations = 0, spacingPenalty = 0
  let pinAccessViolations = 0, powerAccessViolations = 0
  let highUtilMacros = 0, infeasibleMacros = 0, utilPenalty = 0
  for (let i = 0; i < n; i++) {
    const p = macros[i]
    const u = impliedUtil(p)
    if (u > 1) infeasibleMacros++
    else if (u > UTIL_WARN) highUtilMacros++
    if (u > UTIL_WARN) utilPenalty += (u - UTIL_WARN) * 100
    if (p.x < EDGE_MARGIN) boundsPenalty += EDGE_MARGIN - p.x
    if (p.y < EDGE_MARGIN) boundsPenalty += EDGE_MARGIN - p.y
    if (p.x + p.w > d.w - EDGE_MARGIN) boundsPenalty += p.x + p.w - (d.w - EDGE_MARGIN)
    if (p.y + p.h > d.h - EDGE_MARGIN) boundsPenalty += p.y + p.h - (d.h - EDGE_MARGIN)
    if (!hasPinEscapeD(d, i, macros)) pinAccessViolations++
    if (!hasPowerAccessD(d, i, macros)) powerAccessViolations++
    for (let j = i + 1; j < n; j++) {
      const ov = overlapAmount(macros[i], macros[j])
      overlapPenalty += ov
      const gap = gapBetween(macros[i], macros[j])
      if (ov === 0 && gap < MIN_SPACING) { spacingViolations++; spacingPenalty += (MIN_SPACING - gap) }
    }
  }

  const density = new Float32Array(GRID_COLS * GRID_ROWS)
  const cellW = d.w / GRID_COLS, cellH = d.h / GRID_ROWS
  let wl = 0
  for (let h = 0; h < N_HUBS; h++) {
    const hub = hubs[h], weight = hubDefs[h].weight
    for (const m of macros) {
      const mcx = m.x + m.w / 2, mcy = m.y + m.h / 2
      wl += weight * (Math.abs(hub.x - mcx) + Math.abs(hub.y - mcy))
      const hubRow = Math.min(GRID_ROWS - 1, Math.max(0, Math.floor(hub.y / cellH)))
      const hubCol = Math.min(GRID_COLS - 1, Math.max(0, Math.floor(hub.x / cellW)))
      const mCol = Math.min(GRID_COLS - 1, Math.max(0, Math.floor(mcx / cellW)))
      const mRow = Math.min(GRID_ROWS - 1, Math.max(0, Math.floor(mcy / cellH)))
      rasterizeSegment(density, hubRow, hubCol, mCol, true, weight)
      rasterizeSegment(density, mCol, hubRow, mRow, false, weight)
    }
  }
  let used = 0, sum = 0
  for (let i = 0; i < density.length; i++) if (density[i] > 0) { used++; sum += density[i] }
  const mean = used > 0 ? sum / used : 0
  let congestionCells = 0, congestionPenalty = 0
  for (let i = 0; i < density.length; i++) {
    const limit = mean * HOTSPOT_RATIO
    if (density[i] > limit) { congestionCells++; congestionPenalty += density[i] - limit }
  }

  // 2026-09-26 실측: macroTetrisModel.ts의 CHANNEL_SAFE_MARGIN 참고 — 매크로 그룹을
  // 가르는, 다이 폭/높이를 완전히 가로지르는 빈 띠가 300µm보다 좁으면 실제 daq_subsystem
  // hierarchical 실행에서 hold 리페어 버퍼가 legal 자리를 못 찾아 Detailed Placement
  // 자체가 실패했다(DPL-0034/0036). 면적 축소가 정확히 이 채널을 줄이는 축이라 이
  // 게이트가 특히 중요 — internalProjectionGaps는 다이 크기에 의존하지 않아 그대로 재사용.
  let channelViolations = 0, channelPenalty = 0
  for (const gap of internalProjectionGaps(macros)) {
    if (gap >= 0 && gap < CHANNEL_SAFE_MARGIN) { channelViolations++; channelPenalty += CHANNEL_SAFE_MARGIN - gap }
  }

  const leftover = analyzeLeftoverD(d, macros)
  const usableLeftoverPct = leftover.totalEmptyCells > 0 ? Math.round(leftover.usableCells / leftover.totalEmptyCells * 100) : 100
  const total = wl + overlapPenalty * 400 + boundsPenalty * 400 + spacingPenalty * 200 + congestionPenalty * 30 + pinAccessViolations * 80 + powerAccessViolations * 70 + leftover.fragmentedCells * 40 + utilPenalty * 200 + channelPenalty * 400
  return { total, wl, overlapPenalty, boundsPenalty, spacingViolations, congestionCells, pinAccessViolations, powerAccessViolations, fragmentedCells: leftover.fragmentedCells, usableLeftoverPct, highUtilMacros, infeasibleMacros, channelViolations }
}

export function isLegalD(c: Cost): boolean {
  return c.overlapPenalty === 0 && c.spacingViolations === 0 && c.boundsPenalty === 0 && c.infeasibleMacros === 0 && c.channelViolations === 0
}

// ---- 위치 후보: 가장자리 여유부터 100µm 격자 + 반대쪽 끝(다이가 100의 배수가 아닐 때도 딱 붙일 수 있게) ----
function positions(lo: number, hi: number, step: number): number[] {
  if (hi < lo) return []
  const out: number[] = []
  for (let v = lo; v <= hi; v += step) out.push(v)
  if (out[out.length - 1] !== hi) out.push(hi)
  return out
}

function fitsAmongD(d: Die, cand: Macro, others: Macro[]): boolean {
  if (cand.x < EDGE_MARGIN || cand.y < EDGE_MARGIN || cand.x + cand.w > d.w - EDGE_MARGIN || cand.y + cand.h > d.h - EDGE_MARGIN) return false
  return others.every(o => gapBetween(cand, o) >= MIN_SPACING)
}

// 남은 매크로가 bottom-left 첫 빈자리에 전부 들어가는지 빠른 선검사(Macro Tetris의 remainingStillFit과 같은 역할).
function remainingFitD(d: Die, placed: Macro[], remaining: Macro[]): boolean {
  const packed = [...placed]
  for (const m of remaining) {
    let spot: Macro | null = null
    const xs = positions(EDGE_MARGIN, d.w - EDGE_MARGIN - m.w, RIPUP_STEP)
    for (const y of positions(EDGE_MARGIN, d.h - EDGE_MARGIN - m.h, RIPUP_STEP)) {
      for (const x of xs) { const c = { ...m, x, y }; if (fitsAmongD(d, c, packed)) { spot = c; break } }
      if (spot) break
    }
    if (!spot) return false
    packed.push(spot)
  }
  return true
}

// 이전 다이의 배치를 새 다이로 비례 축소 — 매크로들의 상대 배치(위상)를 유지한 채
// "벽이 안쪽으로 조여 오는" 첫 시도.
export function squeeze(macros: Macro[], from: Die, to: Die): Macro[] {
  return macros.map(m => {
    const fx = from.w - m.w - 2 * EDGE_MARGIN, tx = to.w - m.w - 2 * EDGE_MARGIN
    const fy = from.h - m.h - 2 * EDGE_MARGIN, ty = to.h - m.h - 2 * EDGE_MARGIN
    const x = fx > 0 ? EDGE_MARGIN + (m.x - EDGE_MARGIN) * Math.max(0, tx) / fx : EDGE_MARGIN
    const y = fy > 0 ? EDGE_MARGIN + (m.y - EDGE_MARGIN) * Math.max(0, ty) / fy : EDGE_MARGIN
    return { ...m, x: Math.round(x), y: Math.round(y) }
  })
}

export function scaleHubs(hubs: Pos[], from: Die, to: Die): Pos[] {
  return hubs.map(h => ({ x: Math.round(h.x * to.w / from.w), y: Math.round(h.y * to.h / from.h) }))
}

// legal한 매크로는 그대로 두고, 위반하는 것만 뽑아 남은 자리 중 비용이 가장 낮은 곳에
// 다시 놓는다(나머지가 계속 들어갈 수 있는 자리만). 매크로 인덱스(=채널 번호)는 유지.
export function legalizeD(d: Die, macros: Macro[], hubs: Pos[]): Macro[] | null {
  const kept: { i: number; m: Macro }[] = []
  const queue: { i: number; m: Macro }[] = []
  macros.forEach((m, i) => {
    if (fitsAmongD(d, m, kept.map(k => k.m))) kept.push({ i, m })
    else queue.push({ i, m })
  })
  for (let q = 0; q < queue.length; q++) {
    const { i, m } = queue[q]
    const placed = kept.map(k => k.m)
    const rest = queue.slice(q + 1).map(r => r.m)
    let best: Macro | null = null, bestTotal = Infinity
    for (const x of positions(EDGE_MARGIN, d.w - EDGE_MARGIN - m.w, RIPUP_STEP)) for (const y of positions(EDGE_MARGIN, d.h - EDGE_MARGIN - m.h, RIPUP_STEP)) {
      const cand = { ...m, x, y }
      if (!fitsAmongD(d, cand, placed)) continue
      const c = costD({ macros: [...placed, cand], hubs }, d)
      if (c.total >= bestTotal) continue
      if (!remainingFitD(d, [...placed, cand], rest)) continue
      bestTotal = c.total; best = cand
    }
    if (!best) return null
    kept.push({ i, m: best })
  }
  const out = new Array<Macro>(macros.length)
  for (const k of kept) out[k.i] = k.m
  return out
}

// 처음부터 bottom-left로 채우기 — squeeze+legalize가 실패했을 때의 대안 출발점.
export function firstFitD(d: Die, macros: Macro[]): Macro[] | null {
  const packed: Macro[] = []
  for (const m of macros) {
    let spot: Macro | null = null
    const xs = positions(EDGE_MARGIN, d.w - EDGE_MARGIN - m.w, RIPUP_STEP)
    for (const y of positions(EDGE_MARGIN, d.h - EDGE_MARGIN - m.h, RIPUP_STEP)) {
      for (const x of xs) { const c = { ...m, x, y }; if (fitsAmongD(d, c, packed)) { spot = c; break } }
      if (spot) break
    }
    if (!spot) return null
    packed.push(spot)
  }
  return packed
}

// Macro Tetris의 Rip-up & Re-place를 다이 인자로 — 하나씩 뽑아 모든 legal 격자 위치를
// 평가하고 비용이 실제로 낮아질 때만 옮긴다. 개선이 없으면 스스로 멈춘다.
// only를 주면 그 매크로들만 옮긴다(실패 부위만 겨냥하는 "대상 Rip-up").
export function ripUpD(d: Die, state: State, passes = 2, only?: number[]): { state: State; before: number; after: number; moves: number } {
  let macros = state.macros.map(p => ({ ...p }))
  const hubs = state.hubs
  const before = costD({ macros, hubs }, d).total
  const targets = only ?? macros.map((_, k) => k)
  let moves = 0
  for (let pass = 0; pass < passes; pass++) {
    let moved = 0
    for (const i of targets) {
      const cur = macros[i]
      let best = cur, bestTotal = costD({ macros, hubs }, d).total
      for (const x of positions(EDGE_MARGIN, d.w - EDGE_MARGIN - cur.w, RIPUP_STEP)) for (const y of positions(EDGE_MARGIN, d.h - EDGE_MARGIN - cur.h, RIPUP_STEP)) {
        if (x === cur.x && y === cur.y) continue
        const cand = { ...cur, x, y }
        const others = macros.filter((_, k) => k !== i)
        if (!fitsAmongD(d, cand, others)) continue
        const c = costD({ macros: macros.map((p, k) => (k === i ? cand : p)), hubs }, d)
        if (c.total < bestTotal - 1e-6) { bestTotal = c.total; best = cand }
      }
      if (best !== cur) { macros = macros.map((p, k) => (k === i ? best : p)); moved++ }
    }
    moves += moved
    if (moved === 0) break
  }
  return { state: { macros, hubs }, before, after: costD({ macros, hubs }, d).total, moves }
}

// ---- 표준셀 타일 (다이 인자, 밀도 인자) ----
export function glueTilesNeeded(density: number): number {
  return Math.ceil(REAL_GLUE.cellArea / (GLUE_TILE * GLUE_TILE * density))
}

// 허브 가중치(3:1:1) 비례로 타일을 나누고, 할당량 대비 가장 뒤처진 허브부터 섞어서 쌓는 순서.
export function glueHubOrder(needed: number): number[] {
  const wsum = hubDefs.reduce((s, h) => s + h.weight, 0)
  const exact = hubDefs.map(h => needed * h.weight / wsum)
  const quota = exact.map(Math.floor)
  let left = needed - quota.reduce((a, b) => a + b, 0)
  exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r).forEach(({ i }) => { if (left > 0) { quota[i]++; left-- } })
  const done = hubDefs.map(() => 0), order: number[] = []
  for (let k = 0; k < needed; k++) {
    let pick = 0, worst = Infinity
    quota.forEach((q, i) => { if (done[i] < q && done[i] / q < worst) { worst = done[i] / q; pick = i } })
    done[pick]++; order.push(pick)
  }
  return order
}

export type GlueResultD = { tiles: GlueTile[]; needed: number; complete: boolean; coverage: number; mode: 'hub' | 'pack' }

// 정사각형(3×3칸) 규칙은 실제 표준셀 row 배치와 안 맞았다 — OpenROAD는 macro와
// 겹치는 row만 잘라내고(cutrows) 남은 조각은 길든 짧든 그대로 다 쓰는데, 정사각형
// 규칙은 "완전히 빈 300×300 정사각형"만 인정해서 남는 공간이 총량은 충분해도
// (이 다이 기준 필요량의 2.3배) 필요한 13개 중 12개만 들어간다고 잘못 나왔다.
// 대신 "한 줄(LO_CELL 높이) 안에서 옆으로 이어진 빈 칸"을 폭 그대로 쓰는 가변
// 폭 조각으로 바꿨다 — macroTetrisModel.ts의 placeGlueTile과 같은 방식.
function freeRunsD(d: Die, macros: Macro[], tiles: GlueTile[]): { row: number; c0: number; len: number }[] {
  const { cols, rows } = loDims(d)
  const occ = occupancy(d, [...macros, ...tiles.map(t => ({ x: t.x, y: t.y, w: t.w, h: LO_CELL }))])
  const runs: { row: number; c0: number; len: number }[] = []
  for (let r = 0; r < rows; r++) {
    let start = -1
    for (let c = 0; c <= cols; c++) {
      const free = c < cols && !occ[r * cols + c]
      if (free && start < 0) start = c
      if (!free && start >= 0) { runs.push({ row: r, c0: start, len: c - start }); start = -1 }
    }
  }
  return runs
}

// 자기 허브에 가장 가까운 빈 조각부터, 턴당 목표 폭(GLUE_TILE_CAP과 같은 면적,
// 기존과 동일 기준)까지 채운다. 짧은 조각밖에 없으면 그만큼만 채우고 다음
// 허브 차례로 넘어간다 — 정사각형이 아니라서 대부분의 자리를 실제로 쓸 수 있다.
export function fillGlueD(d: Die, macros: Macro[], hubs: Pos[], needed: number, density: number = REAL_GLUE.targetDensity): GlueResultD {
  const order = glueHubOrder(needed)
  // 턴당 목표 "면적"은 GLUE_TILE_CAP(고정 기준 밀도)으로 기존과 동일하게 유지하고,
  // 그 면적을 채우는 데 필요한 "폭"만 지금 선택된 density로 환산한다 — density가
  // 높을수록 같은 폭에 더 많은 면적이 들어가므로 필요한 폭(targetCells)은 줄어든다.
  const targetCells = Math.max(1, Math.round(GLUE_TILE_CAP / (LO_CELL * LO_CELL * density)))
  const tiles: GlueTile[] = []
  // 공칭 개수(needed)를 허브 순서로 채운 뒤, 용량이 필요한 glue 면적에 못 미치면 같은
  // 순서로 조각을 더 얹는다 — 완료는 개수가 아니라 면적(coverage ≥ 1)으로 판정한다.
  // (100µm 틈에 들어간 100×100 조각은 공칭 타일의 11%밖에 못 담아서 개수만 맞춰서는 모자란다.)
  for (let i = 0; i < order.length || (glueCoverage(tiles, density) < 1 && tiles.length < GLUE_TILE_MAX_COUNT); i++) {
    const free = freeRunsD(d, macros, tiles)
    if (free.length === 0) break
    const hub = order[i % order.length]
    const t = hubs[hub]
    let best = free[0], bestD = Infinity
    for (const f of free) {
      const cx = (f.c0 + f.len / 2) * LO_CELL, cy = (f.row + 0.5) * LO_CELL
      const dd = Math.abs(cx - t.x) + Math.abs(cy - t.y)
      if (dd < bestD) { bestD = dd; best = f }
    }
    const useCells = Math.min(best.len, targetCells)
    tiles.push({ x: best.c0 * LO_CELL, y: best.row * LO_CELL, w: useCells * LO_CELL, hub })
  }
  const coverage = glueCoverage(tiles, density)
  return { tiles, needed, complete: coverage >= 1, coverage, mode: 'hub' }
}

// ---- 면적 탐색 공통 타입 ----
export type ShapeKind = 'ratio' | 'width' | 'height'
export const SHAPE_LABEL: Record<ShapeKind, string> = { ratio: '비율 유지', width: '가로만', height: '세로만' }
// density: 표준셀 목표 밀도(실제 config의 PL_TARGET_DENSITY_PCT). strict: 핀 escape·전원
// 접근까지 CLEAN이어야 통과(끄면 겹침·간격·경계·용량만 본다).
// shape: 매크로 모양 프리셋 키(RESHAPE_PRESETS). 모델 함수는 쓰지 않고 화면이 시작 배치·저장 키를 고르는 데만 쓴다.
export type AreaOpts = { density: number; strict: boolean; shape?: string }

// ---- 표준셀 row 용량 (실측 cutrows 모델) ----
// 예전엔 "다이 − 매크로 면적"을 표준셀 자리로 쳤는데, 실제 OpenROAD는 (1) 코어를 다이
// 가장자리에서 안쪽으로 들이고 (2) 매크로 둘레 halo까지 row를 잘라내고 (3) 남은 조각을
// site(0.46µm) 단위로 맞춘다. 실제 signoff run(daq_subsystem hierarchical_auto_
// 20260924_142552)의 17-openroad-cutrows DEF ROW 3,180개를 읽어 확인한 값:
//   · 코어 inset: x 5.52µm(12 site), y 10.88µm(4 row) — 다이 800×800·590×1085·3700×2100
//     3개 크기에서 row 수 floor((H−2·10.88)/2.72), site 수 floor((W−2·5.52)/0.46)가 전부 일치
//   · 매크로 halo: 100µm 틈(매크로 x 900→1000)이 row 조각 910.34→989.92(79.58µm)로 줄어듦
//     → 한 변 약 10µm. 세로도 같음(매크로 y 100~900 → row 89.76~908.48이 잘림)
//   · 그 결과 실제 row 용량 2,274,156µm² — 다이−매크로(2,650,000)의 85.8%.
// (CORE_INSET_X_UM · CORE_INSET_Y_UM · MACRO_HALO_UM 정의는 RULES 위쪽 — RULES가 참조해서 먼저 선언)

export type RowCapacity = { capacityUm2: number; rows: number; segments: number; longestSegUm: number; shortestSegUm: number; naiveFreeUm2: number }

export function rowCapacityD(d: Die, macros: Macro[]): RowCapacity {
  const rh = STD_CELL_ROW_HEIGHT_UM, sw = STD_CELL_SITE_WIDTH_UM
  const nRows = Math.max(0, Math.floor((d.h - 2 * CORE_INSET_Y_UM) / rh))
  const nSites = Math.max(0, Math.floor((d.w - 2 * CORE_INSET_X_UM) / sw))
  const x0 = CORE_INSET_X_UM
  let sitesTotal = 0, segments = 0, longest = 0, shortest = Infinity
  for (let r = 0; r < nRows; r++) {
    const y0 = CORE_INSET_Y_UM + r * rh, y1 = y0 + rh
    const cuts: [number, number][] = []
    for (const m of macros) {
      if (y1 <= m.y - MACRO_HALO_UM || y0 >= m.y + m.h + MACRO_HALO_UM) continue
      cuts.push([m.x - MACRO_HALO_UM, m.x + m.w + MACRO_HALO_UM])
    }
    cuts.sort((a, b) => a[0] - b[0])
    let cursor = 0
    const take = (endSite: number) => {
      const n = endSite - cursor
      if (n > 0) { sitesTotal += n; segments++; longest = Math.max(longest, n * sw); shortest = Math.min(shortest, n * sw) }
    }
    for (const [cx0, cx1] of cuts) {
      take(Math.min(nSites, Math.floor((cx0 - x0) / sw)))
      cursor = Math.max(cursor, Math.ceil((cx1 - x0) / sw))
    }
    take(nSites)
  }
  return { capacityUm2: sitesTotal * sw * rh, rows: nRows, segments, longestSegUm: longest, shortestSegUm: shortest === Infinity ? 0 : shortest, naiveFreeUm2: dieArea(d) - macroArea(macros) }
}

// 표준셀이 들어갈 수 있는 자리 = 실제 row 용량(위). 거기에 실제 glue 셀 면적을 넣었을 때의
// 필요 밀도. 이게 목표 밀도 이하여야 한다. (300µm 타일 판정은 좁은 채널을 전부 버려
// 실제로 signoff까지 간 3700×2100 격자조차 12/13으로 실패시키므로 통과 조건에서 뺐고,
// 화면 표시에만 쓴다 — 실제 표준셀은 100µm 틈에도 row 단위로 들어간다.)
export function requiredDensity(d: Die, macros: Macro[]): number {
  const cap = rowCapacityD(d, macros).capacityUm2
  return cap > 0 ? REAL_GLUE.cellArea / cap : Infinity
}

// 이 옵션 기준으로 배치가 통과인지, 아니면 왜 아닌지(한 줄 요약).
export function gateReason(d: Die, state: State, c: Cost, opts: AreaOpts): string | null {
  if (c.channelViolations > 0) return `매크로 그룹 채널(≥${CHANNEL_SAFE_MARGIN}µm) 부족 — 실제 DPL-0034/0036 실패 근거`
  if (!isLegalD(c)) return '매크로 겹침/간격/경계 위반'
  const req = requiredDensity(d, state.macros)
  if (req > opts.density) return `표준셀 필요 밀도 ${(req * 100).toFixed(1)}% > 목표 ${Math.round(opts.density * 100)}%`
  if (opts.strict && c.pinAccessViolations > 0) return `핀 escape(200µm) 막힘 ×${c.pinAccessViolations}`
  if (opts.strict && c.powerAccessViolations > 0) return `전원 접근(300µm) 막힘 ×${c.powerAccessViolations}`
  return null
}

// ---- 진단: 어느 부분이 왜 실패하는가 ----
export type IssueKind = 'overlap' | 'spacing' | 'bounds' | 'channel' | 'pin' | 'power' | 'capacity'
export const ISSUE_LABEL: Record<IssueKind, string> = { overlap: '겹침', spacing: '간격', bounds: '가장자리 여유', channel: '매크로 그룹 채널', pin: '핀 escape', power: '전원 접근', capacity: '표준셀 용량' }
export type Issue = { kind: IssueKind; macros: number[]; detail: string }

export function diagnoseD(d: Die, state: State, opts: AreaOpts): Issue[] {
  const { macros } = state
  const out: Issue[] = []
  for (let i = 0; i < macros.length; i++) for (let j = i + 1; j < macros.length; j++) {
    const ov = overlapAmount(macros[i], macros[j])
    if (ov > 0) { out.push({ kind: 'overlap', macros: [i, j], detail: `ch${i}–ch${j} 겹침` }); continue }
    const gap = gapBetween(macros[i], macros[j])
    if (gap < MIN_SPACING) out.push({ kind: 'spacing', macros: [i, j], detail: `ch${i}–ch${j} 간격 ${Math.round(gap)}µm < ${MIN_SPACING}µm` })
  }
  // 항상 검사(strict 여부 무관) — 실측 OpenLane 실패(DPL-0034/0036)에 근거한 하드 게이트.
  const chGaps = internalProjectionGaps(macros)
  chGaps.forEach((gap, gi) => {
    if (gap >= 0 && gap < CHANNEL_SAFE_MARGIN) out.push({ kind: 'channel', macros: [], detail: `채널 #${gi + 1} 폭 ${Math.round(gap)}µm < ${CHANNEL_SAFE_MARGIN}µm — hold 리페어 버퍼가 못 들어갈 수 있음(실측)` })
  })
  macros.forEach((m, i) => {
    const edge = Math.min(m.x, m.y, d.w - m.x - m.w, d.h - m.y - m.h)
    if (edge < EDGE_MARGIN) out.push({ kind: 'bounds', macros: [i], detail: `ch${i} 가장자리 여유 ${Math.round(edge)}µm < ${EDGE_MARGIN}µm` })
  })
  if (opts.strict) macros.forEach((_, i) => {
    const s = sideClearancesD(d, i, macros)
    const widest = Math.max(s.left, s.right, s.top, s.bottom)
    if (widest < PIN_ESCAPE_MARGIN) out.push({ kind: 'pin', macros: [i], detail: `ch${i} 핀 escape 막힘 — 가장 넓은 면 ${Math.round(widest)}µm < ${PIN_ESCAPE_MARGIN}µm` })
    if (!hasPowerAccessD(d, i, macros)) out.push({ kind: 'power', macros: [i], detail: `ch${i} 전원 접근 막힘 — 가장자리 ${POWER_RING_MARGIN}µm 안도, ${POWER_RING_MARGIN}µm 채널도 없음` })
  })
  const req = requiredDensity(d, macros)
  if (req > opts.density) out.push({ kind: 'capacity', macros: [], detail: `표준셀 필요 밀도 ${(req * 100).toFixed(1)}% > 목표 ${Math.round(opts.density * 100)}% — 다이 − 매크로 면적 부족` })
  return out
}

export function summarizeIssues(issues: Issue[]): string {
  if (issues.length === 0) return '통과'
  const by = new Map<IssueKind, Issue[]>()
  for (const is of issues) by.set(is.kind, [...(by.get(is.kind) ?? []), is])
  return [...by.entries()].map(([k, list]) => {
    const ch = [...new Set(list.flatMap(l => l.macros))].sort((a, b) => a - b)
    return `${ISSUE_LABEL[k]} ×${list.length}${ch.length ? ` (ch${ch.join(',')})` : ''}`
  }).join(' · ')
}

const GEOMETRIC: IssueKind[] = ['overlap', 'spacing', 'bounds']

// ---- 처리 알고리즘 ----
// 행/열 감지: 한 축으로 구간이 겹치는 매크로끼리 같은 띠(행 또는 열)로 묶는다.
function bands(macros: Macro[], axis: 'x' | 'y'): number[][] {
  const lo = (m: Macro) => (axis === 'y' ? m.y : m.x), hi = (m: Macro) => (axis === 'y' ? m.y + m.h : m.x + m.w)
  const order = macros.map((_, i) => i).sort((a, b) => lo(macros[a]) - lo(macros[b]))
  const groups: number[][] = []
  let end = -Infinity
  for (const i of order) {
    if (groups.length && lo(macros[i]) < end) { groups[groups.length - 1].push(i); end = Math.max(end, hi(macros[i])) }
    else { groups.push([i]); end = hi(macros[i]) }
  }
  return groups
}

export type SlackMode = 'channel' | 'even' | 'start' | 'end'
export const SLACK_LABEL: Record<SlackMode, string> = { channel: '채널 우선', even: '균등', start: '앞쪽 붙임', end: '뒤쪽 붙임' }

// 여유 재분배: 한 축의 남는 여유(다이 − 띠 크기 − 가장자리 여유×2)를 띠 사이 채널과
// 양 끝에 다시 나눈다. channel 모드는 채널을 먼저 target(핀 escape 200µm)까지 넓힌다.
// 필요한 최소(간격 100µm × 채널 수)보다 여유가 적으면 이 축으로는 해결 불가.
export function distributeAxis(d: Die, macros: Macro[], axis: 'x' | 'y', mode: SlackMode, target = PIN_ESCAPE_MARGIN): { macros: Macro[]; feasible: boolean; detail: string } {
  const size = axis === 'y' ? d.h : d.w
  const name = axis === 'y' ? '세로' : '가로'
  const groups = bands(macros, axis)
  const lo = (i: number) => (axis === 'y' ? macros[i].y : macros[i].x)
  const hi = (i: number) => (axis === 'y' ? macros[i].y + macros[i].h : macros[i].x + macros[i].w)
  const ext = groups.map(g => ({ min: Math.min(...g.map(lo)), max: Math.max(...g.map(hi)) }))
  const k = groups.length
  const slack = size - ext.reduce((s, e) => s + (e.max - e.min), 0) - 2 * EDGE_MARGIN
  const need = (k - 1) * MIN_SPACING
  if (slack < need) return { macros, feasible: false, detail: `${name} 여유 ${Math.round(slack)}µm < 필요 ${need}µm (띠 ${k}개 사이 간격 ${MIN_SPACING}µm×${k - 1})` }
  let extra = slack - need
  const gaps = new Array(Math.max(0, k - 1)).fill(MIN_SPACING)
  let lead = 0, trail = 0
  if (mode === 'channel' && k > 1) {
    const each = Math.min(target - MIN_SPACING, extra / (k - 1))
    for (let g = 0; g < gaps.length; g++) gaps[g] += each
    extra -= each * (k - 1)
    lead = extra / 2; trail = extra / 2
  } else if (mode === 'even') {
    const each = extra / (k + 1)
    for (let g = 0; g < gaps.length; g++) gaps[g] += each
    lead = each; trail = each
  } else if (mode === 'start') trail = extra
  else if (mode === 'end') lead = extra
  else { lead = extra / 2; trail = extra / 2 }
  const out = macros.map(m => ({ ...m }))
  let cursor = EDGE_MARGIN + lead
  groups.forEach((g, gi) => {
    const delta = Math.floor(cursor) - ext[gi].min
    for (const i of g) { if (axis === 'y') out[i].y += delta; else out[i].x += delta }
    cursor += ext[gi].max - ext[gi].min + (gi < gaps.length ? gaps[gi] : 0)
  })
  return { macros: out, feasible: true, detail: `${name} 여유 ${Math.round(slack)}µm → 띠 ${k}개, 채널 ${gaps.map(g => Math.round(g)).join('/') || '-'}µm, 앞 ${Math.round(EDGE_MARGIN + lead)} / 뒤 ${Math.round(EDGE_MARGIN + trail)}µm` }
}

// 선반 재배치: 매크로를 rows개 행에 왼→오른쪽으로 다시 쌓는다(기존 순서 유지).
export function shelfRepack(d: Die, macros: Macro[], rows: number): Macro[] | null {
  const n = macros.length, perRow = Math.ceil(n / rows)
  const order = macros.map((_, i) => i).sort((a, b) => macros[a].y - macros[b].y || macros[a].x - macros[b].x)
  const out = macros.map(m => ({ ...m }))
  let y = EDGE_MARGIN
  for (let r = 0; r < rows; r++) {
    const slice = order.slice(r * perRow, (r + 1) * perRow)
    if (slice.length === 0) continue
    let x = EDGE_MARGIN, rowH = 0
    for (const i of slice) { out[i] = { ...macros[i], x, y }; x += macros[i].w + MIN_SPACING; rowH = Math.max(rowH, macros[i].h) }
    if (x - MIN_SPACING > d.w - EDGE_MARGIN) return null
    y += rowH + MIN_SPACING
  }
  if (y - MIN_SPACING > d.h - EDGE_MARGIN) return null
  return out
}

function randomLayout(d: Die, macros: Macro[], seed: number): Macro[] | null {
  const rng = mulberry32(seed)
  const order = macros.map((_, i) => i).sort(() => rng() - 0.5)
  const placed: { i: number; m: Macro }[] = []
  for (const i of order) {
    const m = macros[i]
    const xs = positions(EDGE_MARGIN, d.w - EDGE_MARGIN - m.w, RIPUP_STEP)
    const ys = positions(EDGE_MARGIN, d.h - EDGE_MARGIN - m.h, RIPUP_STEP)
    let spot: Macro | null = null
    for (let t = 0; t < 80 && !spot; t++) {
      const c = { ...m, x: xs[Math.floor(rng() * xs.length)], y: ys[Math.floor(rng() * ys.length)] }
      if (fitsAmongD(d, c, placed.map(p => p.m))) spot = c
    }
    if (!spot) return null
    placed.push({ i, m: spot })
  }
  const out = new Array<Macro>(macros.length)
  for (const p of placed) out[p.i] = p.m
  return out
}

// 한 단계의 기록 — 그 시점 배치와 진단 결과를 같이 남겨 화면에서 다시 볼 수 있게 한다.
export type RepairStep = { action: string; why: string; macros: Macro[]; issues: Issue[]; ok: boolean; applied: boolean }
export type RepairResult = { ok: boolean; macros: Macro[]; steps: RepairStep[]; reason: string }

// 진단 → 실패 종류별 처리 알고리즘 → 다시 진단. 실패 종류와 처리 방법의 대응:
//   용량 부족           → 배치로 못 고침. 즉시 실패(면적을 다시 키워야 함)
//   겹침/간격/가장자리  → ① 위반 매크로만 재배치(합법화) → 안 되면 ② 행 재구성(1~4행 선반 재배치)
//   핀 escape/전원 접근 → ③ 여유 재분배(채널을 200µm까지 넓힘) → 남으면 ④ 막힌 매크로만 대상 Rip-up
//   통과 후             → ⑤ Rip-up 다듬기(통과 조건을 유지하는 경우에만 채택)
export function repairFrom(d: Die, init: Macro[], hubs: Pos[], opts: AreaOpts, firstAction: string, firstWhy: string, polish = true): RepairResult {
  const steps: RepairStep[] = []
  const diag = (m: Macro[]) => diagnoseD(d, { macros: m, hubs }, opts)
  const push = (action: string, why: string, m: Macro[], applied = true) => {
    const issues = diag(m)
    steps.push({ action, why, macros: m.map(x => ({ ...x })), issues, ok: issues.length === 0, applied })
    return issues
  }
  let m = init
  let issues = push(firstAction, firstWhy, m)
  if (issues.some(i => i.kind === 'capacity')) return { ok: false, macros: m, steps, reason: '표준셀 용량 부족 — 배치로 해결 불가' }

  if (issues.some(i => GEOMETRIC.includes(i.kind))) {
    const bad = [...new Set(issues.filter(i => GEOMETRIC.includes(i.kind)).flatMap(i => i.macros))].sort((a, b) => a - b)
    const leg = legalizeD(d, m, hubs)
    if (leg) { m = leg; issues = push('① 위반 매크로 재배치', `ch${bad.join(',')}만 뽑아, 나머지가 계속 들어갈 수 있는 legal 자리 중 비용 최저 위치로 이동`, m) }
    else {
      steps.push({ action: '① 위반 매크로 재배치', why: `ch${bad.join(',')}를 놓을 legal 자리가 없음`, macros: m.map(x => ({ ...x })), issues, ok: false, applied: false })
      let packed: Macro[] | null = null, rowsUsed = 0
      for (const rows of [2, 1, 3, 4]) {
        const p = shelfRepack(d, m, rows)
        if (!p) continue
        const spread = distributeAxis(d, p, 'y', 'channel', CHANNEL_SAFE_MARGIN)
        packed = spread.feasible ? distributeAxis(d, spread.macros, 'x', 'even').macros : p
        rowsUsed = rows; break
      }
      if (!packed) {
        steps.push({ action: '② 행 재구성', why: '1~4행 선반 재배치 모두 다이에 안 들어감 — 이 다이에 매크로 8개가 물리적으로 안 들어감', macros: m.map(x => ({ ...x })), issues, ok: false, applied: false })
        return { ok: false, macros: m, steps, reason: '매크로가 물리적으로 안 들어감' }
      }
      m = packed; issues = push('② 행 재구성', `${rowsUsed}행으로 다시 쌓고 남는 여유를 채널에 분배`, m)
    }
  }

  // 채널(300µm, 실측 하드 게이트)이 핀 escape(200µm)보다 넓은 요구치라 이걸 만족시키면
  // 핀 escape도 대개 같이 풀린다 — target을 채널 기준으로 올려서 한 번에 겨냥한다.
  if (issues.some(i => i.kind === 'pin' || i.kind === 'power' || i.kind === 'channel')) {
    const before = issues.length
    const vy = distributeAxis(d, m, 'y', 'channel', CHANNEL_SAFE_MARGIN)
    const vx = vy.feasible ? distributeAxis(d, vy.macros, 'x', 'channel', CHANNEL_SAFE_MARGIN) : vy
    const cand = vx.feasible ? vx.macros : vy.feasible ? vy.macros : null
    const candIssues = cand ? diag(cand) : issues
    if (cand && !candIssues.some(i => GEOMETRIC.includes(i.kind)) && candIssues.length < before) {
      m = cand; issues = push('③ 여유 재분배', `${vy.detail}; ${vx.feasible ? vx.detail : '가로는 그대로'}`, m)
    } else {
      steps.push({ action: '③ 여유 재분배', why: `${vy.detail}${vy.feasible && vx !== vy ? `; ${vx.detail}` : ''} — 적용해도 줄어들지 않아 건너뜀`, macros: (cand ?? m).map(x => ({ ...x })), issues: candIssues, ok: false, applied: false })
    }
    if (issues.some(i => i.kind === 'pin' || i.kind === 'power' || i.kind === 'channel')) {
      const blocked = issues.filter(i => i.kind === 'pin' || i.kind === 'power' || i.kind === 'channel')
      // channel은 특정 매크로가 아니라 그룹 사이 띠라 macros가 비어 있음 — 그 경우 전체를 겨냥한다.
      const hasChannel = blocked.some(i => i.kind === 'channel')
      const targets = hasChannel ? m.map((_, k) => k) : [...new Set(blocked.flatMap(i => i.macros))].sort((a, b) => a - b)
      const label = hasChannel ? '채널이 좁은 그룹 전체' : `막힌 ch${targets.join(',')}`
      const rr = ripUpD(d, { macros: m, hubs }, 2, targets)
      const rrIssues = diag(rr.state.macros)
      if (rrIssues.length < issues.length && !rrIssues.some(i => GEOMETRIC.includes(i.kind))) { m = rr.state.macros; issues = push('④ 대상 Rip-up', `${label}만 100µm 격자 전수 탐색으로 이동`, m) }
      else steps.push({ action: '④ 대상 Rip-up', why: `${label}를 옮겨도 막힘이 줄어드는 자리가 없음`, macros: rr.state.macros.map(x => ({ ...x })), issues: rrIssues, ok: false, applied: false })
    }
  }

  if (issues.length > 0) return { ok: false, macros: m, steps, reason: summarizeIssues(issues) }
  if (polish) {
    const pol = ripUpD(d, { macros: m, hubs }, 2).state.macros
    if (diag(pol).length === 0 && costD({ macros: pol, hubs }, d).total < costD({ macros: m, hubs }, d).total - 1e-6) {
      m = pol; push('⑤ Rip-up 다듬기', '배선·조각난 여유 비용을 낮추는 이동만, 통과 조건 유지 확인 후 채택', m)
    }
  }
  return { ok: true, macros: m, steps, reason: '통과' }
}

// ---- 면적 탐색: 사다리형 — 5%부터 시도하고, 실패하면 같은 배치에서 4%→3%→2%→1%로
// 폭을 줄여 재시도한다. 어느 폭에서든 성공하면 그 결과를 새 기준으로 삼아 다음 시도는
// 다시 5%부터 시작한다. 5%가 다시 실패하면 또 4%로 내려가는 식으로 반복하고, 1%마저
// 실패하면 그 다이가 수렴점(=이 모델 기준 최소 면적)이다.
export const SHRINK_LADDER = [5, 4, 3, 2, 1] as const

export type AreaAccept = { die: Die; state: State; glue: GlueResultD; c: Cost; util: number; reqDensity: number; shape: ShapeKind; steps: RepairStep[] }
export type ShapeAttempt = { shape: ShapeKind; die: Die; ok: boolean; reason: string; steps: RepairStep[]; cost?: number }
export type TrialPlan = { pct: number; targetArea: number }
export type TrialResult = { plan: TrialPlan; attempts: ShapeAttempt[]; accepted: AreaAccept | null; nextPct: number; converged: boolean; note: string }

function snapNear(v: number): number { return Math.round(v / DIE_SNAP) * DIE_SNAP }

export function areaCandidates(d: Die, targetArea: number): { shape: ShapeKind; die: Die }[] {
  const k = Math.sqrt(targetArea / dieArea(d))
  const raw: { shape: ShapeKind; die: Die }[] = [
    { shape: 'ratio', die: { w: snapNear(d.w * k), h: snapNear(d.h * k) } },
    { shape: 'width', die: { w: snapNear(targetArea / d.h), h: d.h } },
    { shape: 'height', die: { w: d.w, h: snapNear(targetArea / d.w) } },
  ]
  const seen = new Set<string>()
  return raw.filter(o => {
    const a = dieArea(o.die), key = `${o.die.w}x${o.die.h}`
    if (seen.has(key)) return false
    seen.add(key)
    return a < dieArea(d) && Math.max(o.die.w / o.die.h, o.die.h / o.die.w) <= MAX_ASPECT
  })
}

export function attemptDie(prev: State, prevDie: Die, d: Die, opts: AreaOpts): { attempt: Omit<ShapeAttempt, 'shape'>; accept: Omit<AreaAccept, 'shape'> | null } {
  const hubs = scaleHubs(prev.hubs, prevDie, d)
  const maxW = Math.max(...prev.macros.map(m => m.w)), maxH = Math.max(...prev.macros.map(m => m.h))
  if (d.w < maxW + 2 * EDGE_MARGIN || d.h < maxH + 2 * EDGE_MARGIN) {
    return { attempt: { die: d, ok: false, reason: '매크로 하나도 안 들어감', steps: [] }, accept: null }
  }
  const r = repairFrom(d, squeeze(prev.macros, prevDie, d), hubs, opts, '비례 축소', `${prevDie.w}×${prevDie.h} 배치를 ${d.w}×${d.h}로 비례해서 좁힘`)
  if (!r.ok) return { attempt: { die: d, ok: false, reason: r.reason, steps: r.steps }, accept: null }
  const state = { macros: r.macros, hubs }
  const c = costD(state, d)
  return {
    attempt: { die: d, ok: true, reason: '통과', steps: r.steps, cost: c.total },
    accept: { die: d, state, glue: fillGlueD(d, r.macros, hubs, glueTilesNeeded(opts.density), opts.density), c, util: dieUtil(d, r.macros), reqDensity: requiredDensity(d, r.macros), steps: r.steps },
  }
}

export function searchTrial(cur: { die: Die; state: State }, pct: number, opts: AreaOpts, onAttempt?: (a: ShapeAttempt) => void): TrialResult {
  const targetArea = dieArea(cur.die) * (1 - pct / 100)
  const plan: TrialPlan = { pct, targetArea }
  const cands = areaCandidates(cur.die, targetArea)
  const attempts: ShapeAttempt[] = []
  let best: AreaAccept | null = null
  for (const { shape, die } of cands) {
    const { attempt, accept } = attemptDie(cur.state, cur.die, die, opts)
    const a = { ...attempt, shape }
    attempts.push(a)
    onAttempt?.(a)
    if (accept && (!best || accept.c.total < best.c.total)) best = { ...accept, shape }
  }
  if (best) return { plan, attempts, accepted: best, nextPct: SHRINK_LADDER[0], converged: false, note: `−${pct}% 성공 → ${best.die.w}×${best.die.h}, 다음 시도는 이 배치에서 다시 −${SHRINK_LADDER[0]}%부터` }
  const idx = SHRINK_LADDER.indexOf(pct as (typeof SHRINK_LADDER)[number])
  if (idx === SHRINK_LADDER.length - 1) {
    return { plan, attempts, accepted: null, nextPct: pct, converged: true, note: `수렴 — ${cur.die.w}×${cur.die.h}에서 −${pct}%도 실패, 더 줄일 수 없음(이 모델 기준 최소 면적)` }
  }
  const nextPct = SHRINK_LADDER[idx + 1]
  return { plan, attempts, accepted: null, nextPct, converged: false, note: `−${pct}% 실패 → 같은 배치에서 −${nextPct}% 재시도` }
}

// ---- 후보 생성: 한 다이에서 서로 다른 배치를 여러 개 ----
export type CandMetrics = { util: number; wl: number; reqDensity: number; pin: number; power: number; congestion: number; fragmented: number; cost: number }
export function metricsOf(d: Die, state: State): CandMetrics {
  const c = costD(state, d)
  return { util: dieUtil(d, state.macros), wl: c.wl, reqDensity: requiredDensity(d, state.macros), pin: c.pinAccessViolations, power: c.powerAccessViolations, congestion: c.congestionCells, fragmented: c.fragmentedCells, cost: c.total }
}
export function layoutSig(d: Die, macros: Macro[]): string {
  return `${d.w}x${d.h}|` + macros.map(m => `${Math.round(m.x / DIE_SNAP)},${Math.round(m.y / DIE_SNAP)}`).join(';')
}

export type Variant = { die: Die; macros: Macro[]; hubs: Pos[]; method: string; seed: number | null; steps: RepairStep[] }
const SLACK_MODES: SlackMode[] = ['channel', 'even', 'start', 'end']
const LEAD_SPLITS = [0.5, 0, 1] as const
const LEAD_LABEL: Record<number, string> = { 0.5: '위아래 균등', 0: '위로 붙임', 1: '아래로 붙임' }
export const CHANNEL_SAMPLES = 8

// 세로 여유를 명시적으로 나눈다: 채널마다 최소 간격 + chExtra, 남는 것은 위(lead)·아래로.
function splitVertical(d: Die, macros: Macro[], chExtra: number, leadFrac: number): Macro[] | null {
  const groups = bands(macros, 'y')
  const ext = groups.map(g => ({ min: Math.min(...g.map(i => macros[i].y)), max: Math.max(...g.map(i => macros[i].y + macros[i].h)) }))
  const k = groups.length
  const slack = d.h - ext.reduce((s, e) => s + e.max - e.min, 0) - 2 * EDGE_MARGIN
  const rest = slack - (k - 1) * (MIN_SPACING + chExtra)
  if (rest < 0) return null
  const out = macros.map(m => ({ ...m }))
  let cursor = EDGE_MARGIN + rest * leadFrac
  groups.forEach((g, gi) => {
    const delta = Math.floor(cursor) - ext[gi].min
    for (const i of g) out[i].y += delta
    cursor += ext[gi].max - ext[gi].min + MIN_SPACING + chExtra
  })
  return out
}

// 한 다이에서 서로 다른 배치를 여러 개 만든다. 각각을 진단→처리 알고리즘(repairFrom)에
// 통과시켜 통과한 것만 후보로 낸다.
//   ① 세로 여유 분할 열거: 채널 추가폭(0 ~ 남는 여유, CHANNEL_SAMPLES단계) × 위/아래 배분 3가지
//      × 가로 여유 분배 4가지 — 다듬기(Rip-up) 없이 모양 그대로 남긴다.
//   ② 무작위 시작 seed개 — 처리 후 Rip-up 다듬기까지.
export function generateForDie(base: { die: Die; state: State }, opts: AreaOpts, seeds: number, seedBase: number, onVariant: (v: Variant) => void, onProgress?: (done: number, total: number) => void) {
  const d = base.die, hubs = base.state.hubs
  const k = bands(base.state.macros, 'y').length
  const rowsH = bands(base.state.macros, 'y').reduce((s, g) => s + Math.max(...g.map(i => base.state.macros[i].y + base.state.macros[i].h)) - Math.min(...g.map(i => base.state.macros[i].y)), 0)
  const extra = Math.max(0, d.h - rowsH - 2 * EDGE_MARGIN - (k - 1) * MIN_SPACING)
  const chSteps = k > 1 ? [...new Set(Array.from({ length: CHANNEL_SAMPLES + 1 }, (_, s) => Math.round(extra / (k - 1) * s / CHANNEL_SAMPLES / DIE_SNAP) * DIE_SNAP))] : [0]
  const total = chSteps.length * LEAD_SPLITS.length * SLACK_MODES.length + seeds
  let done = 0
  for (const ch of chSteps) for (const lead of LEAD_SPLITS) {
    const vm = splitVertical(d, base.state.macros, ch, lead)
    for (const hm of SLACK_MODES) {
      done++
      if (vm) {
        const vx = distributeAxis(d, vm, 'x', hm)
        if (vx.feasible) {
          const label = `채널 ${MIN_SPACING + ch}µm · ${LEAD_LABEL[lead]} · 가로 ${SLACK_LABEL[hm]}`
          const r = repairFrom(d, vx.macros, hubs, opts, `여유 분할: ${label}`, `세로 여유 ${Math.round(extra + (k - 1) * MIN_SPACING)}µm 중 채널에 ${MIN_SPACING + ch}µm, 나머지 ${LEAD_LABEL[lead]}; ${vx.detail}`, false)
          if (r.ok) onVariant({ die: d, macros: r.macros, hubs, method: `여유 분할 (${label})`, seed: null, steps: r.steps })
        }
      }
      onProgress?.(done, total)
    }
  }
  for (let s = 0; s < seeds; s++) {
    const seed = seedBase + s
    const init = randomLayout(d, base.state.macros, seed)
    done++
    if (init) {
      const r = repairFrom(d, init, hubs, opts, `무작위 시작 (seed ${seed})`, '매크로 순서·위치를 무작위로 흩뿌린 legal 배치에서 출발', true)
      if (r.ok) onVariant({ die: d, macros: r.macros, hubs, method: '무작위 시작 → 처리 → 다듬기', seed, steps: r.steps })
    }
    onProgress?.(done, total)
  }
}

// 후보를 만들 다이 목록: 탐색이 찾은 최소 다이부터 원래 다이 높이까지 10µm마다(같은 너비).
// 각 다이의 출발 배치는 가장 가까운 성공 배치를 비례로 늘리거나 줄인 것.
export function candidateDies(minDie: Die, maxH: number): Die[] {
  const out: Die[] = []
  for (let h = minDie.h; h <= maxH; h += DIE_SNAP) out.push({ w: minDie.w, h })
  return out
}

// 2차원 다이 형상 탐색: 세로만 늘리는 candidateDies와 달리 행 수 자체를 바꾼다.
//
// 처음 버전은 "수렴한 면적을 고정한 채 종횡비만 바꾸기"였는데, 실측해 보니 legal
// 후보가 0개 나왔다 — 디버깅해 보니 원인은 면적을 고정한 게 틀린 전제였다. 이
// 8-매크로 위상은 행 수(R)가 바뀌면 필요한 최소 면적 자체가 다르다(직접 계산: 2행
// 7.77mm² < 4행 8.17mm² < 3행 8.96mm²) — 그런데 종횡비 sweep은 모든 형상에 같은
// 면적(2행 기준 7.77mm²)을 강제했으니, 3·4행이 필요한 형상은 애초에 기하학적으로
// 안 들어갈 좁은 다이를 만들고 있었다(예: 2780×2790 면적은 7.76mm²인데 4행에
// 8.17mm²가 필요). squeeze()도 800폭 매크로를 그 좁은 폭에 비례 압축해 넣으려다
// 매크로끼리 겹치는 배치를 만들었다.
//
// 고쳐서: 행 수 R(1~maxRows)마다 shelfRepack(perRow개씩 R행)이 실제로 요구하는
// "빈틈없이 꽉 채운 최소 다이"를 closed form으로 직접 계산한다 — 가로는
// perRow*매크로폭 + (perRow-1)*최소간격 + 가장자리×2, 세로는 R*매크로높이 +
// (R-1)*채널폭(실측 하드 게이트) + 가장자리×2. 이 식 자체가 곧 legal한 배치이므로
// (rows=2를 넣으면 정확히 실제 3700×2100이 나온다), squeeze로 욱여넣지 않고 이
// 치수 그대로 후보 다이로 낸다.
export function shapeVariantDies(macros: Macro[], maxRows = 4): Die[] {
  if (macros.length === 0) return []
  const w0 = macros[0].w, h0 = macros[0].h
  if (!macros.every(m => m.w === w0 && m.h === h0)) return [] // 모든 매크로가 같은 크기라는 전제(현재 chan_top×8만 해당)
  const out: Die[] = []
  const seen = new Set<string>()
  for (let rows = 1; rows <= Math.min(maxRows, macros.length); rows += 1) {
    const perRow = Math.ceil(macros.length / rows)
    const w = Math.ceil((2 * EDGE_MARGIN + perRow * w0 + (perRow - 1) * MIN_SPACING) / DIE_SNAP) * DIE_SNAP
    const h = Math.ceil((2 * EDGE_MARGIN + rows * h0 + (rows - 1) * CHANNEL_SAFE_MARGIN) / DIE_SNAP) * DIE_SNAP
    if (Math.max(w / h, h / w) > MAX_ASPECT) continue
    const key = `${w}x${h}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ w, h })
  }
  return out
}

export function baseFor(d: Die, from: { die: Die; state: State }): { die: Die; state: State } {
  return { die: d, state: { macros: squeeze(from.state.macros, from.die, d), hubs: scaleHubs(from.state.hubs, from.die, d) } }
}

export function realStart(): { die: Die; state: State } {
  return { die: { ...BASE_DIE }, state: { macros: REAL_RUN_MACROS.map(m => ({ ...m })), hubs: REAL_RUN_HUBS.map(h => ({ ...h })) } }
}

// 매크로 모양(재성형) 프리셋. 실제 격자(800×800)에서는 가로 3700·세로 2100이 이미 최소라
// 위치만 바꾸는 면적 탐색이 항상 "변화 없음"으로 끝난다. 같은 면적에서 매크로 모양을
// 바꾸면 다이가 달라지는데, 아래 4개는 2026-09-30~10-03에 chan_top을 그 모양으로 실제
// OpenLane(합성부터 DRC/LVS까지)에 돌려 본 모양이다. evidence의 숫자는 그 run의 실측값
// (config의 axi_clk 52ns 기준 setup WNS, tools/wsl/115_run_chan_top_reshape_full.sh).
export type ReshapePreset = { key: string; w: number; h: number; evidence: string }
export const RESHAPE_PRESETS: ReshapePreset[] = [
  { key: '800x800', w: 800, h: 800, evidence: '현재 · 실제 signoff 통과 (DRC 0 · LVS 0 · setup +0.994ns)' },
  { key: '650x985', w: 650, h: 985, evidence: '실제 P&R: DRC 0 · LVS 0 · setup −0.139ns (axi 54ns로 완화하면 +0.436ns)' },
  { key: '590x1085', w: 590, h: 1085, evidence: '실제 P&R: DRC 0 · LVS 0 · setup −0.179ns · 배선 +4.1%' },
  { key: '500x1280', w: 500, h: 1280, evidence: '실제 P&R: DRC 0 · LVS 0 · setup −2.690ns (타이밍 가장 나쁨)' },
  { key: '450x1422', w: 450, h: 1422, evidence: '실제 P&R: DRC 0 · LVS 0 · setup −0.460ns · 안테나 위반 0' },
]

// 한 모양의 최소 다이: 4×2 격자, 가로 간격 MIN_SPACING, 행 사이 채널 CHANNEL_SAFE_MARGIN,
// 가장자리 EDGE_MARGIN. 800×800이면 정확히 실제 3700×2100(= realStart)이 된다.
export function shapeStart(key: string | undefined): { die: Die; state: State } {
  const p = RESHAPE_PRESETS.find(x => x.key === key)
  if (!p || (p.w === REAL_RUN_MACROS[0].w && p.h === REAL_RUN_MACROS[0].h)) return realStart()
  const perRow = Math.ceil(REAL_RUN_MACROS.length / 2)
  const die: Die = {
    w: Math.ceil((2 * EDGE_MARGIN + perRow * p.w + (perRow - 1) * MIN_SPACING) / DIE_SNAP) * DIE_SNAP,
    h: Math.ceil((2 * EDGE_MARGIN + 2 * p.h + CHANNEL_SAFE_MARGIN) / DIE_SNAP) * DIE_SNAP,
  }
  const macros = REAL_RUN_MACROS.map((m, i) => ({
    ...m, w: p.w, h: p.h,
    x: EDGE_MARGIN + (i % perRow) * (p.w + MIN_SPACING),
    y: i < perRow ? EDGE_MARGIN : EDGE_MARGIN + p.h + CHANNEL_SAFE_MARGIN,
  }))
  return { die, state: { macros, hubs: scaleHubs(REAL_RUN_HUBS.map(h => ({ ...h })), BASE_DIE, die) } }
}

// OpenLane config에 붙일 DIE_AREA + MACROS.chan_top.instances.
export function toAreaCfg(d: Die, macros: Macro[], density: number): string {
  const lines = macros.map((p, i) => `        "gen_chan[${i}].u_chan_top": {"location": [${Math.round(p.x)}, ${Math.round(p.y)}], "orientation": "N"}`)
  return `{\n  "FP_SIZING": "absolute",\n  "DIE_AREA": [0, 0, ${d.w}, ${d.h}],\n  "PL_TARGET_DENSITY_PCT": ${Math.round(density * 100)},\n  "MACROS": {\n    "chan_top": {\n      "instances": {\n${lines.join(',\n')}\n      }\n    }\n  }\n}`
}
