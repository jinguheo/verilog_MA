// Macro Tetris 순수 모델 — 상수·타입·비용 함수·솔버(SA/RePlAce 스타일/Rip-up).
// React/캔버스에 의존하지 않아 뷰(views/MacroTetris.tsx)와 Web Worker
// (game/macroTetrisWorker.ts)가 같은 코드를 공유한다. 수치 근거와 변경 이력은
// views/MacroTetris.tsx 상단 주석 참고.

export const DIE_W = 3700
export const DIE_H = 2100
export const MSZ = 800
export const N = 8
// 2026-09-24: 40 -> 100um. RUN_2026-09-23_12-48-47가 실제로 쓰고 signoff까지
// 통과한 config_hierarchical.json 격자 배치의 최소 간격(100um)과 맞춤 -
// "legal"이 실제 성공 사례와 같은 수준의 여유를 의미하도록.
export const MIN_SPACING = 100
// 크기 조절 범위 — 너무 작으면 chan_top 로직이 물리적으로 안 들어가고, 너무
// 크면 3700×2100 다이에 8개가 legal하게 들어갈 수 없다.
export const MACRO_MIN_SIDE = 300
export const MACRO_MAX_SIDE = 1400
// 실제 chan_top 크기 — RUN_2026-09-23_12-48-47/final/lef/chan_top.lef의
// "SIZE 800.000 BY 800.000"과 final/metrics.json(design__die__area,
// design__core__area, design__instance__area__stdcell, design__instance__count,
// design__instance__utilization)에서 그대로 가져온 값.
export const REAL_CHAN_TOP = { w: 800, h: 800, dieArea: 640000, coreArea: 613701, cellArea: 319066, cellCount: 46009, util: 0.519905 } as const
// 코어/다이 비율(=IO·전원링 여백을 뺀 비율)은 크기가 바뀌어도 같다고 근사.
export const CORE_RATIO = REAL_CHAN_TOP.coreArea / REAL_CHAN_TOP.dieArea
// 이 활용률을 넘으면 라우팅이 어려워질 가능성이 큼 — 실제 PL_TARGET_DENSITY 계열 설정의 통상 상한.
export const UTIL_WARN = 0.7
export function impliedUtil(m: { w: number; h: number }): number {
  return REAL_CHAN_TOP.cellArea / (m.w * m.h * CORE_RATIO)
}
export const GRID_COLS = 20
export const GRID_ROWS = 12
// A cell is a congestion hot spot when its bus-weighted track demand exceeds
// this multiple of the average over all cells that carry any routing. Relative,
// not an absolute track-capacity number - see the tab's own caveat text.
export const HOTSPOT_RATIO = 2


// daq_subsystem.sv 174~199행의 실제 per-channel 신호 그룹을 그대로 가중치
// 있는 넷 3개로 단순화. dma_sched가 가장 넓은 버스(beat_data/strb)를
// 나르므로 가중치가 가장 크다.
export const hubDefs = [
  { name: 'dma_sched', weight: 3, color: '#185FA5', desc: 'beat_valid/ready/data/strb/sop/eop, desc_valid/addr/maxlen — 가장 넓은 데이터 버스' },
  { name: 'csr', weight: 1, color: '#0F6E56', desc: 'ch_enable/abort/desc_base/desc_go — 제어 신호' },
  { name: 'irq_perf', weight: 1, color: '#993C1D', desc: 'ch_stream_busy/err/cause — irq_ctrl·perf_cnt로 가는 상태 신호' },
] as const
export const N_HUBS = hubDefs.length

export type Pos = { x: number; y: number }
// 매크로는 점이 아니라 크기가 있는 사각형이다 - 2026-09-25: "크기와 너비도
// 변경 가능하게" 요청에 맞춰 고정 MSZ 정사각형 대신 매크로별 w/h를 갖도록
// 일반화했다. 허브(hubs)는 여전히 점(Pos)이라 별도 타입으로 유지.
// soft=false: HARD 매크로 — 이미 GDS/LEF로 하드닝돼 크기가 고정(위치만 이동).
// soft=true: SOFT 블록 — 아직 하드닝 전이라 모양(너비·높이)을 바꿀 수 있음.
// 실제 floorplanning의 hard macro / soft block 구분과 같다.
export type Macro = { x: number; y: number; w: number; h: number; soft: boolean }

// 지금 실제로 돌고 있는(또는 완료된) OpenLane hierarchical 실행이 쓰는 실제
// 좌표 (config_hierarchical.json의 MACROS.chan_top.instances 그대로) —
// 4x2 격자, 100um 여백/간격, 행 사이 300um 채널. 이 컴포넌트의 초기 배치.
// 8개 모두 같은 chan_top GDS의 인스턴스라 실제로는 전부 HARD 800×800이다.
export const REAL_RUN_MACROS: Macro[] = [
  { x: 100, y: 100, w: MSZ, h: MSZ, soft: false }, { x: 1000, y: 100, w: MSZ, h: MSZ, soft: false }, { x: 1900, y: 100, w: MSZ, h: MSZ, soft: false }, { x: 2800, y: 100, w: MSZ, h: MSZ, soft: false },
  { x: 100, y: 1200, w: MSZ, h: MSZ, soft: false }, { x: 1000, y: 1200, w: MSZ, h: MSZ, soft: false }, { x: 1900, y: 1200, w: MSZ, h: MSZ, soft: false }, { x: 2800, y: 1200, w: MSZ, h: MSZ, soft: false },
]

// what-if 혼합 시나리오 — ch0~3은 실제 하드닝된 HARD 800×800 그대로, ch4~7은
// "아직 하드닝 전인 SOFT 블록"이라고 가정하고 서로 다른 모양으로 시작한다.
// 모든 SOFT 모양은 실제 chan_top 셀 면적(319,066µm²)이 활용률 70% 이하로
// 들어가는 크기다. 초기 좌표는 그대로 legal하도록 맞춤(행간 ≥100µm).
export const MIXED_MACROS: Macro[] = [
  { x: 100, y: 100, w: MSZ, h: MSZ, soft: false }, { x: 1000, y: 100, w: MSZ, h: MSZ, soft: false }, { x: 1900, y: 100, w: MSZ, h: MSZ, soft: false }, { x: 2800, y: 100, w: MSZ, h: MSZ, soft: false },
  { x: 100, y: 1300, w: 1000, h: 700, soft: true }, { x: 1200, y: 1000, w: 700, h: 1000, soft: true }, { x: 2000, y: 1400, w: 900, h: 600, soft: true }, { x: 3000, y: 1100, w: 600, h: 900, soft: true },
]

// AI가 SOFT 블록에 시도해 보는 모양 후보 — 100µm 단위, 가로세로비 1:2~2:1,
// 실제 셀 면적이 활용률 UTIL_WARN(70%) 이하로 들어가는 것만.
export const SHAPE_SIDES = [600, 700, 800, 900, 1000, 1100, 1200]
export const SOFT_SHAPES: { w: number; h: number }[] = SHAPE_SIDES.flatMap(w => SHAPE_SIDES.map(h => ({ w, h })))
  .filter(s => s.w / s.h <= 2 && s.h / s.w <= 2 && impliedUtil(s) <= UTIL_WARN)
export const REAL_RUN_HUBS: Pos[] = [{ x: 1850, y: 1050 }, { x: 1200, y: 1050 }, { x: 2500, y: 1050 }]

export type Cost = {
  total: number
  wl: number
  overlapPenalty: number
  boundsPenalty: number
  spacingViolations: number
  congestionCells: number
  pinAccessViolations: number
  powerAccessViolations: number
  fragmentedCells: number
  usableLeftoverPct: number
  highUtilMacros: number
  infeasibleMacros: number
  channelViolations: number
}
export type State = { macros: Macro[]; hubs: Pos[] }
export type Candidate = { id: string; label: string; state: State; c: Cost }

// Legal = no overlap, no spacing violation, fully inside the die, every macro
// big enough to physically hold chan_top's real cell area (util <= 100%), and
// every macro-facing channel wide enough for real hold/timing-repair buffer
// insertion (CHANNEL_SAFE_MARGIN - see its own comment for the real OpenLane
// failure that grounds this number). This last one is a hard gate, not just a
// cost term, because it's an observed real placement failure, not a heuristic.
export function isLegal(c: Cost): boolean {
  return c.overlapPenalty === 0 && c.spacingViolations === 0 && c.boundsPenalty === 0 && c.infeasibleMacros === 0 && c.channelViolations === 0
}

// Candidates are ranked legality first, wirelength second - a short-wire
// layout that breaks a design rule is not a "better" candidate than a longer
// legal one.
export function compareCandidates(a: Candidate, b: Candidate): number {
  const la = isLegal(a.c), lb = isLegal(b.c)
  if (la !== lb) return la ? -1 : 1
  return a.c.total - b.c.total
}

export function overlapAmount(a: Macro, b: Macro): number {
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return ox > 0 && oy > 0 ? ox + oy : 0
}

// 두 사각형 사이의 실제 간격(겹치면 0) — 최소 spacing DRC 체크용
export function gapBetween(a: Macro, b: Macro): number {
  const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0)
  const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0)
  if (dx === 0 && dy === 0) return 0
  return Math.max(dx, dy)
}

// AI Chip Tetris의 pin/power 체크(hasEscape, power-column 근접)를 연속
// 좌표로 옮긴 것 — legal(간격 위반 0건)해도 "바로 옆이 겨우 100µm 떨어져
// 있을 뿐"인 매크로는 핀을 뺄 실질적인 여유가 없을 수 있다. spacingViolations
// 와는 별도의, 더 엄격한 체크.
export const PIN_ESCAPE_MARGIN = MIN_SPACING * 2 // 200µm — legal 최소 간격의 2배는 실제 라우팅 채널 하나가 지나갈 여유
export const POWER_RING_MARGIN = MIN_SPACING * 3 // 300µm — 이 설계의 실제 hierarchical config가 쓰는 행간 채널 폭과 같은 수준

// 2026-09-26 실측 근거: daq_subsystem hierarchical 실행에서 위 두 행을 200µm
// 좁혀 채널을 300µm→100µm로 줄인 "실제→향상" 후보를 실제 OpenLane으로 돌렸더니
// ResizerTimingPostCTS의 hold 위반(6301건) 리페어가 hold 버퍼 300개를 legal하게
// 못 앉혀 Detailed Placement 자체가 실패했다(DPL-0034/DPL-0036). 반면 채널
// 300µm인 격자 baseline(hierarchical_auto_20260924_142552)은 이 단계를 실제로
// 통과했다. 이전의 `usableLeftoverPct`(다이 전체에서 300µm 정사각형이 있는지만
// 봄)는 이 둘을 구분 못 했다(둘 다 42%, 154칸으로 동일) — 위쪽 여백이 늘어난
// 만큼 채널이 줄어든 걸 상쇄해버렸기 때문. 실제로 중요한 건 "다이 어딘가"가
// 아니라 "매크로 그룹 사이를 다이 전체 폭/높이만큼 완전히 가로지르는 빈 띠"가
// 넓은가이다 - 이게 실제 hold 버퍼가 몰리는 "채널"이다.
export const CHANNEL_SAFE_MARGIN = 300 // µm — 실측 경계값(300=통과, 100=실패)을 그대로 하한으로 쓴다

// 매크로들을 한 축(axis)에 투영해 겹치는 구간을 합치고, 그 사이(내부) 간격만
// 돌려준다 - 다이 가장자리 여백(첫 구간 앞/마지막 구간 뒤)은 제외한다. 처음엔
// "마주보는 매크로 쌍의 간격"으로 쟀더니 같은 행 안의 정상적인 100µm 이웃 간격
// (예: 격자 baseline의 매크로0↔매크로1)까지 채널로 오인해 baseline 자체를
// illegal로 만드는 버그가 있었다 - 그건 "채널"이 아니라 그냥 같은 행 안의 패킹
// 간격이라, 투영이 다이 전체 폭/높이를 가로지르는지까지 봐야 한다.
function mergedIntervals(macros: Macro[], axis: 'x' | 'y'): [number, number][] {
  const intervals = macros
    .map(m => (axis === 'y' ? [m.y, m.y + m.h] : [m.x, m.x + m.w]) as [number, number])
    .sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const [s, e] of intervals) {
    const last = merged[merged.length - 1]
    if (last && s <= last[1]) last[1] = Math.max(last[1], e)
    else merged.push([s, e])
  }
  return merged
}

// 격자(4열×2행)에서 Y축(행 간)으로 투영하면 2개 그룹(위/아래 행)으로 깔끔하게
// 나뉘고 그 사이 간격(300µm)이 바로 "진짜 채널"이지만, X축(열 간)으로 투영하면
// 4개 그룹(각 열)으로 나뉘고 그 사이 100µm 간격들은 그냥 같은 행 안의 정상
// 패킹 간격이다(둘 다 실측 baseline에서 legal). 두 축을 똑같이 검사하면 이
// 정상 패킹 간격까지 "채널 부족"으로 오판한다 - 실제로 "채널"인 축은 매크로를
// 더 적은 수의 큰 그룹으로 가르는 축(=더 굵直게 나뉘는 쪽)이므로, 그 축의
// 내부 간격만 확인한다. 두 축의 그룹 수가 같으면(예: 정사각형에 가까운 배치)
// 모호하니 둘 다 본다 - 놓치는 것보다 과검출이 낫다.
function internalProjectionGaps(macros: Macro[]): number[] {
  const mx = mergedIntervals(macros, 'x'), my = mergedIntervals(macros, 'y')
  const pick: Array<[number, number][]> = mx.length < my.length ? [mx] : my.length < mx.length ? [my] : [mx, my]
  const gaps: number[] = []
  for (const merged of pick) for (let i = 1; i < merged.length; i++) gaps.push(merged[i][0] - merged[i - 1][1])
  return gaps
}

export function sideClearances(idx: number, macros: Macro[]): { left: number; right: number; top: number; bottom: number } {
  const m = macros[idx]
  let left = m.x, right = DIE_W - (m.x + m.w), top = m.y, bottom = DIE_H - (m.y + m.h)
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

// 4면 중 최소 한 면이 실질적인 라우팅 채널(200µm) 이상 열려 있는가.
export function hasPinEscape(idx: number, macros: Macro[]): boolean {
  const s = sideClearances(idx, macros)
  return Math.max(s.left, s.right, s.top, s.bottom) >= PIN_ESCAPE_MARGIN
}

// 다이 가장자리(전원 링) 또는 다른 매크로와 300µm 이상 열린 면(행간 채널
// 수준) 중 하나에 닿아 있는가 — 전원 스트랩이 다른 매크로를 넘지 않고
// 도달할 수 있다는 근사치.
export function hasPowerAccess(idx: number, macros: Macro[]): boolean {
  const m = macros[idx]
  const nearEdge = m.x <= POWER_RING_MARGIN || m.y <= POWER_RING_MARGIN ||
    (DIE_W - (m.x + m.w)) <= POWER_RING_MARGIN || (DIE_H - (m.y + m.h)) <= POWER_RING_MARGIN
  if (nearEdge) return true
  const s = sideClearances(idx, macros)
  return Math.max(s.left, s.right, s.top, s.bottom) >= POWER_RING_MARGIN
}

export function rasterizeSegment(density: Float32Array, row: number, colFrom: number, colTo: number, horizontal: boolean, weight: number) {
  const lo = Math.max(0, Math.min(colFrom, colTo))
  const hi = Math.min(horizontal ? GRID_COLS - 1 : GRID_ROWS - 1, Math.max(colFrom, colTo))
  for (let i = lo; i <= hi; i++) {
    const idx = horizontal ? row * GRID_COLS + i : i * GRID_COLS + row
    if (idx >= 0 && idx < density.length) density[idx] += weight
  }
}

// "남아있는 영역이 standard cell을 넣기 좋게" — 다이를 100µm(=MIN_SPACING)
// 칸으로 나누고, 매크로가 조금이라도 걸친 칸은 점유로 본다. 빈 칸 중에서
// 300µm×300µm(=실제 hierarchical config의 행간 채널 폭) 크기의 완전히 빈
// 정사각형 안에 들어가는 칸만 "표준셀을 넣기 좋은" 여유 공간으로 친다.
// 매크로 사이 100µm 틈이나 다이 가장자리 100µm 띠처럼 가로·세로 중 한쪽이
// 좁은 공간은 legal(간격 위반 0건)해도 표준셀 행을 제대로 앉히기 어려운
// "조각난" 공간으로 분류한다. (연결 성분의 바운딩박스로 판정하면 얇은
// 가장자리 띠가 모든 빈 공간을 하나로 이어버려 전부 쓸만하다고 잘못
// 나오므로, 국소 정사각형 판정을 쓴다.)
export type LeftoverGrid = { cellClass: Uint8Array; usableCells: number; fragmentedCells: number; totalEmptyCells: number }
export const LO_CELL = MIN_SPACING
export const LO_COLS = Math.floor(DIE_W / LO_CELL)
export const LO_ROWS = Math.floor(DIE_H / LO_CELL)
export const USABLE_SQUARE = 3
// 사각형이 조금이라도 걸친 100µm 칸을 1로 표시한 점유 격자.
export function occupancyGrid(rects: { x: number; y: number; w: number; h: number }[]): Uint8Array {
  const occ = new Uint8Array(LO_COLS * LO_ROWS)
  for (const m of rects) {
    const c0 = Math.max(0, Math.floor(m.x / LO_CELL)), c1 = Math.min(LO_COLS - 1, Math.ceil((m.x + m.w) / LO_CELL) - 1)
    const r0 = Math.max(0, Math.floor(m.y / LO_CELL)), r1 = Math.min(LO_ROWS - 1, Math.ceil((m.y + m.h) / LO_CELL) - 1)
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) occ[r * LO_COLS + c] = 1
  }
  return occ
}

export function analyzeLeftover(macros: Macro[]): LeftoverGrid {
  const occ = occupancyGrid(macros)
  // 2D 누적합으로 K×K 정사각형 안의 점유 칸 수를 O(1)에 구한다.
  const W = LO_COLS + 1
  const pre = new Int32Array(W * (LO_ROWS + 1))
  for (let r = 0; r < LO_ROWS; r++) for (let c = 0; c < LO_COLS; c++) {
    pre[(r + 1) * W + (c + 1)] = occ[r * LO_COLS + c] + pre[r * W + (c + 1)] + pre[(r + 1) * W + c] - pre[r * W + c]
  }
  const K = USABLE_SQUARE
  const usable = new Uint8Array(LO_COLS * LO_ROWS)
  for (let r = 0; r + K <= LO_ROWS; r++) for (let c = 0; c + K <= LO_COLS; c++) {
    const filled = pre[(r + K) * W + (c + K)] - pre[r * W + (c + K)] - pre[(r + K) * W + c] + pre[r * W + c]
    if (filled !== 0) continue
    for (let dr = 0; dr < K; dr++) for (let dc = 0; dc < K; dc++) usable[(r + dr) * LO_COLS + (c + dc)] = 1
  }
  const cellClass = new Uint8Array(LO_COLS * LO_ROWS) // 0=매크로 점유, 1=쓸만한 여유, 2=조각난 여유
  let usableCells = 0, fragmentedCells = 0
  for (let i = 0; i < cellClass.length; i++) {
    if (occ[i]) continue
    if (usable[i]) { cellClass[i] = 1; usableCells++ } else { cellClass[i] = 2; fragmentedCells++ }
  }
  return { cellClass, usableCells, fragmentedCells, totalEmptyCells: usableCells + fragmentedCells }
}

export function cost(state: State): Cost {
  const { macros, hubs } = state
  const n = macros.length
  let overlapPenalty = 0, boundsPenalty = 0, spacingViolations = 0, spacingPenalty = 0
  let pinAccessViolations = 0, powerAccessViolations = 0
  let highUtilMacros = 0, infeasibleMacros = 0, utilPenalty = 0
  let channelViolations = 0, channelPenalty = 0
  for (let i = 0; i < n; i++) {
    const p = macros[i]
    const u = impliedUtil(p)
    if (u > 1) infeasibleMacros++
    else if (u > UTIL_WARN) highUtilMacros++
    if (u > UTIL_WARN) utilPenalty += (u - UTIL_WARN) * 100
    if (p.x < 0) boundsPenalty += -p.x
    if (p.y < 0) boundsPenalty += -p.y
    if (p.x + p.w > DIE_W) boundsPenalty += p.x + p.w - DIE_W
    if (p.y + p.h > DIE_H) boundsPenalty += p.y + p.h - DIE_H
    if (!hasPinEscape(i, macros)) pinAccessViolations++
    if (!hasPowerAccess(i, macros)) powerAccessViolations++
    for (let j = i + 1; j < n; j++) {
      const ov = overlapAmount(macros[i], macros[j])
      overlapPenalty += ov
      // 겹침은 overlapPenalty가 따로 잡으므로 여기선 겹치지 않는 쌍만 본다.
      // 딱 맞닿은(gap=0) 쌍도 최소 간격 위반 — 예전엔 gap>0 조건 때문에 빠져서
      // 솔버가 매크로를 간격 0으로 붙여 버리는 결과를 legal로 냈었다.
      const gap = gapBetween(macros[i], macros[j])
      if (ov === 0 && gap < MIN_SPACING) { spacingViolations++; spacingPenalty += (MIN_SPACING - gap) }
    }
  }
  // 매크로 그룹을 가르는, 다이 전체 폭/높이를 가로지르는 완전히 빈 띠(진짜
  // "채널")만 검사한다 - legal(간격 위반 0건)해도 이게 300µm보다 좁으면 실제로
  // hold 버퍼가 못 들어갈 수 있다(위 CHANNEL_SAFE_MARGIN 주석의 실측 근거).
  for (const gap of internalProjectionGaps(macros)) {
    if (gap >= 0 && gap < CHANNEL_SAFE_MARGIN) {
      channelViolations++
      channelPenalty += CHANNEL_SAFE_MARGIN - gap
    }
  }

  const density = new Float32Array(GRID_COLS * GRID_ROWS)
  const cellW = DIE_W / GRID_COLS, cellH = DIE_H / GRID_ROWS
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

  // Overlap / spacing / bounds dominate wirelength so both algorithms treat
  // them as near-hard design rules instead of trading them away for shorter wire.
  // pin/power access는 legal 여부에는 안 넣는다 — 격자 탐색 중간 후보들이
  // 이 항만으로 통째로 illegal 취급되면 탐색 공간이 지나치게 좁아진다. 대신
  // pre-signoff 체크리스트의 별도 risk 항목으로만 노출한다(preSignoffProxy).
  // 조각난 여유 공간(fragmentedCells)도 같은 이유로 legal 판정엔 안 넣고
  // 비용에만 넣는다 - SA/RePlAce/Rip-up이 배선 길이뿐 아니라 "남은 공간이
  // 표준셀을 넣기 좋은 모양인가"까지 같이 최적화하게 된다.
  const leftover = analyzeLeftover(macros)
  const usableLeftoverPct = leftover.totalEmptyCells > 0 ? Math.round(leftover.usableCells / leftover.totalEmptyCells * 100) : 100
  const total = wl + overlapPenalty * 400 + boundsPenalty * 400 + spacingPenalty * 200 + congestionPenalty * 30 + pinAccessViolations * 80 + powerAccessViolations * 70 + leftover.fragmentedCells * 40 + utilPenalty * 200 + channelPenalty * 400
  return { total, wl, overlapPenalty, boundsPenalty, spacingViolations, congestionCells, pinAccessViolations, powerAccessViolations, fragmentedCells: leftover.fragmentedCells, usableLeftoverPct, highUtilMacros, infeasibleMacros, channelViolations }
}

export type PreSignoffProxy = {
  overlapClean: boolean
  spacingClean: boolean
  boundsClean: boolean
  pinAccessClean: boolean
  powerAccessClean: boolean
  leftoverClean: boolean
  utilClean: boolean
  channelClean: boolean
  routabilityRisk: 'low' | 'medium' | 'high'
  confidence: number
}

// 쓸만한 여유 공간 비율이 이 이상이면 "표준셀 넣기 좋은 모양"으로 친다.
// 8개 매크로 사이의 필수 100µm 간격만으로 빈 칸의 약 20~25%가 항상 조각난
// 공간이 되므로 100%는 불가능하다 — 실제 격자는 42%, 혼합 시나리오 +
// Rip-up+모양은 67%, 쌓기 플레이 결과는 68~78%.
export const LEFTOVER_CLEAN_PCT = 70

// AI Chip Tetris(chipTetrisEngine.ts의 preSignoffReport)와 같은 형태의
// 체크리스트+confidence% — "legal/illegal" 한 줄 대신 어떤 항목이 왜
// risk인지 구분해서 보여준다.
export function preSignoffProxy(c: Cost): PreSignoffProxy {
  const overlapClean = c.overlapPenalty === 0
  const spacingClean = c.spacingViolations === 0
  const boundsClean = c.boundsPenalty === 0
  const pinAccessClean = c.pinAccessViolations === 0
  const powerAccessClean = c.powerAccessViolations === 0
  const leftoverClean = c.usableLeftoverPct >= LEFTOVER_CLEAN_PCT
  const utilClean = c.highUtilMacros === 0 && c.infeasibleMacros === 0
  const channelClean = c.channelViolations === 0
  const routabilityRisk: 'low' | 'medium' | 'high' = c.congestionCells > 4 ? 'high' : c.congestionCells > 1 ? 'medium' : 'low'
  const checks = [overlapClean, spacingClean, boundsClean, pinAccessClean, powerAccessClean, leftoverClean, utilClean, channelClean]
  const confidence = Math.round((checks.filter(Boolean).length / checks.length) * 85 + (routabilityRisk === 'low' ? 15 : routabilityRisk === 'medium' ? 7 : 0))
  return { overlapClean, spacingClean, boundsClean, pinAccessClean, powerAccessClean, leftoverClean, utilClean, channelClean, routabilityRisk, confidence }
}

export function mulberry32(seed: number) {
  let s = seed
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function cloneState(s: State): State {
  return { macros: s.macros.map(p => ({ ...p })), hubs: s.hubs.map(p => ({ ...p })) }
}

// 허브(점) 전용 — 기존 동작 그대로 유지.
export function clamp(p: Pos): Pos {
  return { x: Math.min(DIE_W - MSZ, Math.max(0, p.x)), y: Math.min(DIE_H - MSZ, Math.max(0, p.y)) }
}

// 매크로(사각형) 전용 — 매크로마다 w/h가 다를 수 있으므로 자기 크기만큼 빼서 가둔다.
export function clampMacro(m: Macro): Macro {
  return { ...m, x: Math.min(DIE_W - m.w, Math.max(0, m.x)), y: Math.min(DIE_H - m.h, Math.max(0, m.y)) }
}

// ---- SA: stochastic single-move proposal, one tick per call so it can drive
// a continuous, pausable, speed-controlled autopilot instead of a one-shot batch. ----
export function stepSA(state: State, rng: () => number, T: number): State {
  const nMovable = N + N_HUBS
  const idx = Math.floor(rng() * nMovable)
  const jitter = Math.max(80, T * 0.6)
  const next = cloneState(state)
  if (idx < N) {
    const m = next.macros[idx]
    next.macros[idx] = clampMacro({ ...m, x: m.x + (rng() - 0.5) * jitter * 2, y: m.y + (rng() - 0.5) * jitter * 2 })
  } else {
    const hi = idx - N
    next.hubs[hi] = { x: Math.min(DIE_W, Math.max(0, next.hubs[hi].x + (rng() - 0.5) * jitter * 2)), y: Math.min(DIE_H, Math.max(0, next.hubs[hi].y + (rng() - 0.5) * jitter * 2)) }
  }
  return { ...next, macros: idx < N ? next.macros : next.macros, hubs: next.hubs }
}

// 병렬 탐색의 "처음부터 랜덤" 레인용 출발점 — 모양(w/h/HARD·SOFT)은 그대로 두고
// 위치만 다이 안 아무 곳에나 흩뿌린다. 겹침은 이어지는 RePlAce 합법화가 푼다.
export function randomStart(shapesFrom: State, seed: number): State {
  const rng = mulberry32(seed)
  return {
    macros: shapesFrom.macros.map(m => ({ ...m, x: rng() * (DIE_W - m.w), y: rng() * (DIE_H - m.h) })),
    hubs: REAL_RUN_HUBS.map(p => ({ ...p })),
  }
}

// ---- RePlAce 결과를 출발점으로, SA가 그보다 좋아질 때까지 ----
// RePlAce 스타일은 빠르지만 국소 최적에 갇히기 쉽고, SA는 확률적으로 그걸
// 빠져나올 수 있다. 출발점(target)보다 legal하면서 비용이 낮은 배치를 찾으면
// "이김"으로 표시하고, 그 뒤로 SA_STALL_ITERS번 연속 더 나아지지 않으면 멈춘다
// (한 번 겨우 이긴 지점에서 바로 멈추지 않고 조금 더 다듬기 위해). 끝까지
// 못 이기면 maxIters에서 멈추고 출발점을 그대로 돌려준다.
export const SA_T0 = 1500
export const SA_T_MIN = 20
export const SA_COOL_ITERS = 5000
export const SA_STALL_ITERS = 4000
export type AnnealProgress = { iters: number; best: number; T: number; state: State }
export type AnnealResult = { state: State; target: number; best: number; iters: number; beatenAt: number | null; accepted: number }
export function annealUntilBetter(start: State, target: number, seed: number, maxIters: number, onProgress?: (p: AnnealProgress) => void): AnnealResult {
  const rng = mulberry32(seed)
  const alpha = Math.pow(SA_T_MIN / SA_T0, 1 / SA_COOL_ITERS)
  let cur = cloneState(start), curC = cost(cur)
  let best = cloneState(start), bestTotal = target
  let T = SA_T0, accepted = 0, beatenAt: number | null = null, lastImprove = 0, it = 0
  for (; it < maxIters; it++) {
    const next = stepSA(cur, rng, T)
    const c = cost(next)
    const d = c.total - curC.total
    if (d < 0 || rng() < Math.exp(-d / T)) {
      cur = next; curC = c; accepted++
      if (isLegal(c) && c.total < bestTotal - 1e-6) {
        bestTotal = c.total; best = cloneState(cur); lastImprove = it
        if (beatenAt === null) beatenAt = it
      }
    }
    T = T > SA_T_MIN ? T * alpha : SA_T0 // 식으면 다시 데워 국소 최적에서 빠져나올 기회를 준다
    if (onProgress && it % 1000 === 0) onProgress({ iters: it, best: bestTotal, T, state: best })
    if (beatenAt !== null && it - lastImprove > SA_STALL_ITERS) break
  }
  return { state: best, target, best: bestTotal, iters: it, beatenAt, accepted }
}

// ---- RePlAce 스타일: 결정론적 경사 완화 + 겹침 밀어내기, 즉시 완료 ----
// 실제 RePlAce(전역 배치)는 정전기 밀도 모델 + Nesterov 경사하강으로, 확률적
// 탐색 없이 빠르게 수렴하지만 국소 최적(local optimum)에 갇히기 쉽다 — 그
// 성격을 그대로 흉내: "허브 쪽으로 당기고 서로 밀어낸다"를 반복하는 전역
// 배치 단계 다음에, 당기는 힘을 끄고 순수하게 밀어내기만 반복하는 별도
// 합법화 단계를 거친다 (실제 GlobalPlacement -> DetailedPlacement 순서).
export function runReplaceStyle(seed: number, from?: State): Candidate {
  const rng = mulberry32(seed)
  let state: State
  if (from) {
    state = cloneState(from)
  } else {
    const cols = 4, rows = 2, marginX = 100, marginY = 100, gapX = 100, gapY = 300
    const macros: Macro[] = []
    for (let r = 0; r < rows; r++) for (let cIdx = 0; cIdx < cols; cIdx++) {
      macros.push({ x: marginX + cIdx * (MSZ + gapX) + (rng() - 0.5) * 30, y: marginY + r * (MSZ + gapY) + (rng() - 0.5) * 30, w: MSZ, h: MSZ, soft: false })
    }
    const hubs: Pos[] = []
    for (let i = 0; i < N_HUBS; i++) hubs.push({ x: DIE_W / 2 + (rng() - 0.5) * 200, y: DIE_H / 2 + (rng() - 0.5) * 200 })
    state = { macros, hubs }
  }

  const GP_ITERS = 300
  for (let it = 0; it < GP_ITERS; it++) {
    const pullStep = 30 * (1 - it / GP_ITERS) + 3
    const nextHubs = state.hubs.map(hub => {
      let tx = 0, ty = 0
      for (const m of state.macros) { tx += m.x + m.w / 2; ty += m.y + m.h / 2 }
      tx /= N; ty /= N
      return clamp({ x: hub.x + (tx - hub.x) * 0.15, y: hub.y + (ty - hub.y) * 0.15 })
    })
    let hcx = 0, hcy = 0, wsum = 0
    for (let h = 0; h < N_HUBS; h++) { hcx += nextHubs[h].x * hubDefs[h].weight; hcy += nextHubs[h].y * hubDefs[h].weight; wsum += hubDefs[h].weight }
    hcx /= wsum; hcy /= wsum

    const nextMacros = state.macros.map((m, i) => {
      const cx = m.x + m.w / 2, cy = m.y + m.h / 2
      const dx = hcx - cx, dy = hcy - cy
      const attractDist = Math.hypot(dx, dy) || 1
      let fx = (dx / attractDist) * Math.min(pullStep, attractDist * 0.05)
      let fy = (dy / attractDist) * Math.min(pullStep, attractDist * 0.05)
      for (let j = 0; j < N; j++) {
        if (j === i) continue
        const o = state.macros[j]
        const ocx = o.x + o.w / 2, ocy = o.y + o.h / 2
        const rdx = cx - ocx, rdy = cy - ocy
        const dist = Math.max(Math.hypot(rdx, rdy), 1)
        // 두 매크로 크기에 비례한 반발 반경 — 800×800 고정일 때의 MSZ*1.4와 같은 값이 나오도록.
        const radius = (Math.max(m.w, m.h) + Math.max(o.w, o.h)) / 2 * 1.4
        const repel = Math.min(pullStep * 1.5, radius * radius / (dist * dist))
        fx += (rdx / dist) * repel
        fy += (rdy / dist) * repel
      }
      return clampMacro({ ...m, x: m.x + fx, y: m.y + fy })
    })
    state = { macros: nextMacros, hubs: nextHubs }
  }

  const LEGALIZE_ITERS = 200
  for (let it = 0; it < LEGALIZE_ITERS; it++) {
    let anyViolation = false
    const nextMacros = state.macros.map(p => ({ ...p }))
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      const a = nextMacros[i], b = nextMacros[j]
      const gap = gapBetween(a, b)
      if (gap < MIN_SPACING) {
        anyViolation = true
        const acx = a.x + a.w / 2, acy = a.y + a.h / 2, bcx = b.x + b.w / 2, bcy = b.y + b.h / 2
        let dx = bcx - acx, dy = bcy - acy
        let dist = Math.hypot(dx, dy)
        if (dist < 1) { dx = (i % 2 === 0 ? 1 : -1); dy = (j % 2 === 0 ? 1 : -1); dist = Math.hypot(dx, dy) }
        const push = (MIN_SPACING - gap) / 2 + 3
        nextMacros[i] = clampMacro({ ...a, x: a.x - (dx / dist) * push, y: a.y - (dy / dist) * push })
        nextMacros[j] = clampMacro({ ...b, x: b.x + (dx / dist) * push, y: b.y + (dy / dist) * push })
      }
    }
    state = { macros: nextMacros, hubs: state.hubs }
    if (!anyViolation) break
  }

  const c = cost(state)
  return { id: 'replace-' + seed + '-' + Date.now(), label: `RePlAce 스타일 (seed ${seed})`, state, c }
}

// AI Chip Tetris(chipTetrisEngine.ts의 applyBestReplacement)와 같은 원리의
// "전수 탐색 rip-up & re-place" — 매크로 하나를 뽑아 100µm 격자(=MIN_SPACING,
// 이 프로젝트가 실제로 쓰는 legal 최소 단위) 위 모든 legal 위치에서 비용을
// 재계산하고, 실제로 낮아질 때만 옮긴다. SA/RePlAce 스타일과 달리 확률적
// 탐색이 없어 국소 최적을 탈출하지 못할 수 있지만, 개선이 없으면 스스로
// 멈추는 결정론적 종료가 보장된다 — 8개뿐인 이 문제 규모에서는 패스당 최대
// 8×420회 비용 평가로 이 정도 전수 탐색이 실제로 감당 가능하다.
// withShapes=true면 SOFT 블록은 위치와 함께 SOFT_SHAPES의 모양 후보까지
// 탐색한다. 후보가 수십 배로 늘어나므로 이때는 200µm 격자로 먼저 찾고,
// 마지막에 위치만 100µm 격자로 한 번 더 다듬는다. HARD 매크로는 언제나
// 크기를 건드리지 않는다.
export const RIPUP_GRID_STEP = MIN_SPACING
export const SHAPE_GRID_STEP = MIN_SPACING * 2
export type RipUpResult = { state: State; log: string[]; before: number; after: number; reshaped: number }
export function ripUpReplace(state: State, passes = 3, withShapes = false): RipUpResult {
  let macros = state.macros.map(p => ({ ...p }))
  const hubs = state.hubs
  const n = macros.length // 쌓기 플레이 중의 부분 배치(8개 미만)에서도 불릴 수 있다 - N(=8) 고정 금지.
  const log: string[] = []
  const before = cost({ macros, hubs }).total
  let reshaped = 0

  for (let pass = 0; pass < passes; pass++) {
    let movedInPass = 0
    for (let i = 0; i < n; i++) {
      const cur = macros[i]
      const startTotal = cost({ macros, hubs }).total
      let best = cur, bestTotal = startTotal
      const searchShapes = withShapes && cur.soft
      const shapes = searchShapes ? [{ w: cur.w, h: cur.h }, ...SOFT_SHAPES] : [{ w: cur.w, h: cur.h }]
      const step = searchShapes ? SHAPE_GRID_STEP : RIPUP_GRID_STEP
      for (const s of shapes) {
        for (let x = 0; x <= DIE_W - s.w; x += step) for (let y = 0; y <= DIE_H - s.h; y += step) {
          if (x === cur.x && y === cur.y && s.w === cur.w && s.h === cur.h) continue
          const cand = { ...cur, x, y, w: s.w, h: s.h }
          const trial = macros.map((p, k) => (k === i ? cand : p))
          const c = cost({ macros: trial, hubs })
          if (!isLegal(c)) continue
          if (c.total < bestTotal - 1e-6) { bestTotal = c.total; best = cand }
        }
      }
      if (best !== cur) {
        const shapeChanged = best.w !== cur.w || best.h !== cur.h
        if (shapeChanged) reshaped++
        macros = macros.map((p, k) => (k === i ? best : p))
        movedInPass++
        log.push(`pass ${pass + 1}: 매크로 ${i} ${shapeChanged ? `모양 ${cur.w}×${cur.h} → ${best.w}×${best.h} + ` : ''}재배치 — 비용 ${Math.round(startTotal)} → ${Math.round(bestTotal)}`)
      }
    }
    if (movedInPass === 0) { log.push(`pass ${pass + 1}: 더 개선되는 이동 없음 — 조기 종료`); break }
  }
  if (withShapes) {
    const refined = ripUpReplace({ macros, hubs }, 1, false)
    macros = refined.state.macros
    log.push(...refined.log)
  }
  const after = cost({ macros, hubs }).total
  return { state: { macros, hubs }, log, before, after, reshaped }
}

export function referenceCandidate(): Candidate {
  const state: State = { macros: REAL_RUN_MACROS.map(p => ({ ...p })), hubs: REAL_RUN_HUBS.map(p => ({ ...p })) }
  return { id: 'real-run', label: '실제 실행 (RUN_2026-09-23_12-48-47 격자)', state, c: cost(state) }
}

// 지금 배치를 daq_subsystem의 실제 config_hierarchical.json이 쓰는
// MACROS.chan_top.instances 형식으로 내보낸다 — PnrResearch.tsx의
// hierarchicalTodo 3~4단계("ParSAC 출력 → MACRO_PLACEMENT_CFG 변환")와
// 같은 다리 역할. 좌표만 옮겨주는 것이고, 이 값을 실제 config에 붙여넣고
// OpenLane을 다시 돌려야 signoff가 확정된다.
export function toMacroPlacementCfg(macros: Macro[]): string {
  const lines = macros.map((p, i) => `    "gen_chan[${i}].u_chan_top": {"location": [${Math.round(p.x)}, ${Math.round(p.y)}], "orientation": "N"}`)
  return `{\n  "MACROS": {\n    "chan_top": {\n      "instances": {\n${lines.join(',\n')}\n      }\n    }\n  }\n}`
}

// ---- 표준셀(glue) 단계 ----
// 수치 근거: 격자 baseline(runs/hierarchical_auto_20260924_142552)의 라우팅 후
// metrics — design__instance__area__stdcell 460,614µm²(74,975셀: 탭셀 32,798 ·
// 타이밍 리페어 버퍼 21,492 · hold 버퍼 19,835 포함), 합성 직후 glue 면적
// 194,797µm²(15,152셀, 06-yosys-synthesis/reports/stat.rpt). config의
// PL_TARGET_DENSITY_PCT=40.
// 모듈별 면적은 합성이 flatten돼 남아 있지 않으므로, glue 전체를 300µm×300µm
// 타일(=쓸만한 여유 공간 판정과 같은 크기)로 나눈다. 타일 하나에 40% 밀도로
// 36,000µm²가 들어가 460,614µm²에는 13개가 필요하다. 타일을 어느 신호 그룹
// 허브(dma_sched/csr/irq_perf)에 붙일지는 허브 가중치(3:1:1)로 나눈 근사다.
export const REAL_GLUE = { cellArea: 460614, cellCount: 74975, synthArea: 194797, synthCells: 15152, targetDensity: 0.4 } as const
export const GLUE_TILE = USABLE_SQUARE * LO_CELL
export const GLUE_TILE_CAP = GLUE_TILE * GLUE_TILE * REAL_GLUE.targetDensity
export const GLUE_TILES_NEEDED = Math.ceil(REAL_GLUE.cellArea / GLUE_TILE_CAP)

// 가중치 비례(최대 잉여법)로 허브별 타일 수를 정하고, 쌓는 순서는 매번 "할당량
// 대비 가장 뒤처진 허브"를 골라 섞는다 — 게임에서 한 허브만 몰아서 쌓이지 않도록.
export const GLUE_TILE_HUBS: number[] = (() => {
  const wsum = hubDefs.reduce((s, h) => s + h.weight, 0)
  const exact = hubDefs.map(h => GLUE_TILES_NEEDED * h.weight / wsum)
  const quota = exact.map(Math.floor)
  let left = GLUE_TILES_NEEDED - quota.reduce((a, b) => a + b, 0)
  exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r).forEach(({ i }) => { if (left > 0) { quota[i]++; left-- } })
  const done = hubDefs.map(() => 0), order: number[] = []
  for (let k = 0; k < GLUE_TILES_NEEDED; k++) {
    let pick = 0, worst = Infinity
    quota.forEach((q, i) => { if (done[i] < q && done[i] / q < worst) { worst = done[i] / q; pick = i } })
    done[pick]++; order.push(pick)
  }
  return order
})()

export type GlueTile = { x: number; y: number; hub: number }

// 매크로·기존 타일과 겹치지 않는 300µm 빈 정사각형 중 자기 허브에 가장 가까운 곳.
export function placeGlueTile(macros: Macro[], tiles: GlueTile[], hub: number, hubs: Pos[]): GlueTile | null {
  const occ = occupancyGrid([...macros, ...tiles.map(t => ({ x: t.x, y: t.y, w: GLUE_TILE, h: GLUE_TILE }))])
  const W = LO_COLS + 1
  const pre = new Int32Array(W * (LO_ROWS + 1))
  for (let r = 0; r < LO_ROWS; r++) for (let c = 0; c < LO_COLS; c++) {
    pre[(r + 1) * W + (c + 1)] = occ[r * LO_COLS + c] + pre[r * W + (c + 1)] + pre[(r + 1) * W + c] - pre[r * W + c]
  }
  const K = USABLE_SQUARE, target = hubs[hub]
  let best: GlueTile | null = null, bestD = Infinity
  for (let r = 0; r + K <= LO_ROWS; r++) for (let c = 0; c + K <= LO_COLS; c++) {
    if (pre[(r + K) * W + (c + K)] - pre[r * W + (c + K)] - pre[(r + K) * W + c] + pre[r * W + c] !== 0) continue
    const x = c * LO_CELL, y = r * LO_CELL
    const d = Math.abs(x + GLUE_TILE / 2 - target.x) + Math.abs(y + GLUE_TILE / 2 - target.y)
    if (d < bestD) { bestD = d; best = { x, y, hub } }
  }
  return best
}

export type GlueResult = { tiles: GlueTile[]; needed: number; wl: number; complete: boolean }

export function glueWirelength(tiles: GlueTile[], hubs: Pos[]): number {
  return tiles.reduce((s, t) => s + Math.abs(t.x + GLUE_TILE / 2 - hubs[t.hub].x) + Math.abs(t.y + GLUE_TILE / 2 - hubs[t.hub].y), 0)
}

// 13개를 순서대로 한 번에 채운다. 들어갈 자리가 없으면 거기서 멈춘다(complete=false).
export function fillGlue(macros: Macro[], hubs: Pos[]): GlueResult {
  const tiles: GlueTile[] = []
  for (const hub of GLUE_TILE_HUBS) {
    const t = placeGlueTile(macros, tiles, hub, hubs)
    if (!t) break
    tiles.push(t)
  }
  return { tiles, needed: GLUE_TILES_NEEDED, wl: glueWirelength(tiles, hubs), complete: tiles.length === GLUE_TILES_NEEDED }
}

// ---- 하나씩 쌓기(자동 플레이) ----
function fitsAmong(cand: Macro, others: Macro[]): boolean {
  if (cand.x < 0 || cand.y < 0 || cand.x + cand.w > DIE_W || cand.y + cand.h > DIE_H) return false
  return others.every(o => gapBetween(cand, o) >= MIN_SPACING)
}

// 남은 매크로들을 위→아래, 왼→오른쪽 첫 빈자리(bottom-left 계열)에 빠르게 채워
// 보고 전부 들어가는지만 본다. 정확한 판정이 아니라 "이 자리에 두면 판이
// 막히는가"를 거르는 빠른 선검사다. 자동 정리(auto-tidy)가 이미 놓인 것들을
// 재배치한 뒤에도 이 조건을 다시 확인해 "정리 때문에 게임 오버"를 막는 데도 쓴다.
export function remainingStillFit(placed: Macro[], remaining: Macro[]): boolean {
  const packed = [...placed]
  for (const m of remaining) {
    let spot: Macro | null = null
    for (let y = 0; y <= DIE_H - m.h && !spot; y += RIPUP_GRID_STEP) for (let x = 0; x <= DIE_W - m.w; x += RIPUP_GRID_STEP) {
      const cand = { ...m, x, y }
      if (fitsAmong(cand, packed)) { spot = cand; break }
    }
    if (!spot) return false
    packed.push(spot)
  }
  return true
}

// 이미 놓인 매크로들은 고정한 채, 다음 매크로를 100µm 격자의 모든 legal 위치에
// 놓아 보고 부분 배치 비용이 가장 낮은 곳을 고른다(탐욕적). 모양은 그대로.
// 순수 탐욕은 첫 매크로들을 허브 근처 가운데에 몰아 판을 막아 버리므로(실제로
// 매크로 3에서 GAME OVER), 남은 매크로가 더 이상 안 들어가는 자리는 제외한다.
export function bestMacroSpot(placed: Macro[], next: Macro, hubs: Pos[], remaining: Macro[] = []): Macro | null {
  let best: Macro | null = null, bestTotal = Infinity
  for (let x = 0; x <= DIE_W - next.w; x += RIPUP_GRID_STEP) for (let y = 0; y <= DIE_H - next.h; y += RIPUP_GRID_STEP) {
    const cand = { ...next, x, y }
    if (!fitsAmong(cand, placed)) continue
    const c = cost({ macros: [...placed, cand], hubs })
    if (!isLegal(c) || c.total >= bestTotal) continue
    if (!remainingStillFit([...placed, cand], remaining)) continue
    bestTotal = c.total; best = cand
  }
  return best
}

export function macrosSignature(macros: Macro[]): string {
  return macros.map(m => `${Math.round(m.x)},${Math.round(m.y)},${Math.round(m.w)},${Math.round(m.h)}`).join('|')
}
