export const GRID_UM = 50
export const DIE_WIDTH_UM = 1250
export const DIE_HEIGHT_UM = 600
export const BOARD_COLS = DIE_WIDTH_UM / GRID_UM
export const BOARD_ROWS = DIE_HEIGHT_UM / GRID_UM

export type BlockCategory = 'analog' | 'digital' | 'memory'
export type BlockId = 'adc' | 'opamp' | 'sram' | 'fifo' | 'alu' | 'control' | 'dsp'
export type PhysicalKind = 'hard-macro' | 'neighbor-region' | 'standard-cell'
export type Point = readonly [number, number]
export type BlockSize = { width: number; height: number }

export interface BlockCell {
  id: BlockId
  category: BlockCategory
  instance: number
}

export type Board = Array<Array<BlockCell | null>>

export interface ActiveBlock {
  id: BlockId
  rotation: number
  x: number
  y: number
}

export interface GameState {
  board: Board
  active: ActiveBlock
  queue: BlockId[]
  hold: BlockId | null
  canHold: boolean
  score: number
  lines: number
  level: number
  gameOver: boolean
  floorplanReady: boolean
  candidateSeed: number
  placements: number
  replacements: number
  lastEvent: string
}

export interface BoardMetrics {
  aggregateHeight: number
  maxHeight: number
  holes: number
  bumpiness: number
  zonePenalty: number
  isolationPenalty: number
  macroSpacingPenalty: number
  powerAccessPenalty: number
  pinAccessPenalty: number
  integrityViolations: number
  congestion: number
  violations: number
  adjacencyPenalty: number
  functionalClusterPenalty: number
  standardCellArea: number
  macroClearancePenalty: number
  macroClearanceRisk: number
  wirelengthPenalty: number
}

export interface PreSignoffReport {
  hardDrcClean: boolean
  zoneClean: boolean
  spacingClean: boolean
  adjacencyClean: boolean
  powerAccessible: boolean
  pinAccessible: boolean
  structuralLvsClean: boolean
  routabilityRisk: 'low' | 'medium' | 'high'
  confidence: number
}

export interface AiPlan {
  id: BlockId
  rotation: number
  x: number
  y: number
  value: number
  cleared: number
  useHold: boolean
  metrics: BoardMetrics
}

export interface HybridProgress {
  stage: 'replace' | 'sa' | 'complete'
  iteration: number
  total: number
  accepted: number
  attempted: number
  bestValue: number
}

interface ReplacePlan extends AiPlan {
  instance: number
  gain: number
  board: Board
}

const rectangle = (width: number, height: number): Point[] => Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => [x, y] as Point)).flat()

type BlockDefinition = { label: string; category: BlockCategory; physicalKind: PhysicalKind; color: string; base: Point[]; rotatable: boolean; areaFlexible?: boolean; requiredNeighbor?: BlockId }
export const BLOCKS: Record<BlockId, BlockDefinition> = {
  adc: { label: 'ADC MACRO', category: 'analog', physicalKind: 'hard-macro', color: '#f16d8f', base: rectangle(5, 6), rotatable: false, areaFlexible: true },
  opamp: { label: 'SAR NEAR', category: 'analog', physicalKind: 'neighbor-region', color: '#ff9a62', base: rectangle(2, 2), rotatable: true, requiredNeighbor: 'adc' },
  sram: { label: 'SRAM MACRO', category: 'memory', physicalKind: 'hard-macro', color: '#5a8dee', base: rectangle(16, 10), rotatable: false, areaFlexible: true },
  fifo: { label: 'CDC EDGE', category: 'digital', physicalKind: 'neighbor-region', color: '#7e68d7', base: rectangle(2, 1), rotatable: true, requiredNeighbor: 'opamp' },
  control: { label: 'CAPTURE NEAR', category: 'digital', physicalKind: 'neighbor-region', color: '#35a6c8', base: rectangle(2, 2), rotatable: true, requiredNeighbor: 'sram' },
  alu: { label: 'STD CELL', category: 'digital', physicalKind: 'standard-cell', color: '#9c6ade', base: rectangle(1, 1), rotatable: false },
  dsp: { label: 'STD CELL', category: 'digital', physicalKind: 'standard-cell', color: '#62b879', base: rectangle(1, 1), rotatable: false },
}

export const getBlockSizes = (): Record<BlockId, BlockSize> => Object.fromEntries((Object.keys(BLOCKS) as BlockId[]).map(id => {
  const points = BLOCKS[id].base
  return [id, { width: Math.max(...points.map(([x]) => x)) + 1, height: Math.max(...points.map(([, y]) => y)) + 1 }]
})) as Record<BlockId, BlockSize>

export const configureBlockSizes = (sizes: Partial<Record<BlockId, BlockSize>>): Record<BlockId, BlockSize> => {
  for (const [id, requested] of Object.entries(sizes) as Array<[BlockId, BlockSize]>) {
    if (!requested) continue
    const width = Math.max(1, Math.min(BOARD_COLS, Math.round(requested.width)))
    const height = Math.max(1, Math.min(BOARD_ROWS, Math.round(requested.height)))
    BLOCKS[id].base = rectangle(width, height)
  }
  return getBlockSizes()
}

export const PLACEMENT_SEQUENCE: BlockId[] = ['adc', 'sram', 'opamp', 'fifo', 'control']
export const TOTAL_REQUIRED_BLOCKS = PLACEMENT_SEQUENCE.length

// Real-evidence macro clearance thresholds, carried over from the daq_subsystem
// hierarchical macro-placement validation (see macroTetrisModel.ts / NEXT_SESSION.md):
// a ~100um gap between hard macros could not fit the post-CTS hold-repair buffers
// OpenLane inserted (DPL-0036), while a ~300um gap legalized cleanly. These are kept
// as a soft cost (not a hard illegal rule) so the existing PPA3 seed floorplan is not
// invalidated outright; the search is steered toward the proven-safe clearance.
const MACRO_CLEARANCE_FAIL_UM = 100
const MACRO_CLEARANCE_SAFE_UM = 300
const MACRO_CLEARANCE_FAIL_CELLS = Math.ceil(MACRO_CLEARANCE_FAIL_UM / GRID_UM)
const MACRO_CLEARANCE_SAFE_CELLS = Math.ceil(MACRO_CLEARANCE_SAFE_UM / GRID_UM)

// Signal-chain wirelength proxy: the required-neighbor rules only force literal
// adjacency for these three pairs, but the CDC FIFO -> SRAM write-port net (the
// actual async domain-crossing boundary in the PPA3 architecture, see the
// "SIGNAL TO MEMORY" card in ChipTetris.tsx) has no adjacency rule at all today,
// so the search is currently blind to it. Weighted higher than the already-forced pairs.
const WIRELENGTH_NETS: Array<[BlockId, BlockId, number]> = [
  ['adc', 'opamp', 1],
  ['opamp', 'fifo', 1],
  ['fifo', 'sram', 1.4],
  ['sram', 'control', 1],
]

// A hard macro is hardened silicon: a memory compiler or analog macro generator
// offers at most a handful of discrete aspect ratios, never an arbitrary same-area
// rectangle. Without a bound, `rotationsFor`'s areaFlexible search below could
// reshape the ADC (real LEF 223.71x293.365um) or SRAM (764.24x460.28um) into an
// unrealistically thin/long footprint that would never exist in the actual macro.
const MACRO_ASPECT_RATIO_TOLERANCE = 1.5

const normalize = (points: Point[]): Point[] => {
  const minX = Math.min(...points.map(([x]) => x))
  const minY = Math.min(...points.map(([, y]) => y))
  return points.map(([x, y]) => [x - minX, y - minY] as Point).sort(([ax, ay], [bx, by]) => ay - by || ax - bx)
}

const rotate = (points: Point[]): Point[] => normalize(points.map(([x, y]) => [-y, x] as Point))

const neighborRegionShapes = (base: Point[]): Point[][] => {
  const normalized = normalize(base)
  const width = Math.max(...normalized.map(([x]) => x)) + 1
  const height = Math.max(...normalized.map(([, y]) => y)) + 1
  const seeds: Point[][] = [normalized]

  // Preserve occupied area while opening routing channels or distributing the
  // standard-cell region into banks. Gaps are footprint whitespace, not cells.
  for (const gap of [1, 2]) {
    const splitX = Math.ceil(width / 2)
    const splitY = Math.ceil(height / 2)
    seeds.push(normalized.map(([x, y]) => [x >= splitX ? x + gap : x, y] as Point))
    seeds.push(normalized.map(([x, y]) => [x, y >= splitY ? y + gap : y] as Point))
  }
  seeds.push(normalized.map(([x, y]) => [x + (y % 2), y] as Point))
  seeds.push(normalized.map(([x, y]) => [x * 2, y * 2] as Point))

  const shapes: Point[][] = []
  for (const seed of seeds) {
    let current = normalize(seed)
    for (let turn = 0; turn < 4; turn += 1) {
      const shapeWidth = Math.max(...current.map(([x]) => x)) + 1
      const shapeHeight = Math.max(...current.map(([, y]) => y)) + 1
      const key = JSON.stringify(current)
      if (shapeWidth <= BOARD_COLS && shapeHeight <= BOARD_ROWS && !shapes.some(shape => JSON.stringify(shape) === key)) shapes.push(current)
      current = rotate(current)
    }
  }
  return shapes
}

export const rotationsFor = (id: BlockId): Point[][] => {
  if (BLOCKS[id].areaFlexible) {
    const area = BLOCKS[id].base.length
    const baseWidth = Math.max(...BLOCKS[id].base.map(([x]) => x)) + 1
    const baseHeight = Math.max(...BLOCKS[id].base.map(([, y]) => y)) + 1
    const baseRatio = baseWidth / baseHeight
    const shapes: Point[][] = []
    for (let width = 1; width <= BOARD_COLS; width += 1) {
      if (area % width !== 0) continue
      const height = area / width
      if (height > BOARD_ROWS) continue
      const ratio = width / height
      if (ratio < baseRatio / MACRO_ASPECT_RATIO_TOLERANCE || ratio > baseRatio * MACRO_ASPECT_RATIO_TOLERANCE) continue
      shapes.push(rectangle(width, height))
    }
    if (!shapes.length) shapes.push(rectangle(baseWidth, baseHeight))
    return shapes
  }
  if (BLOCKS[id].physicalKind === 'neighbor-region') return neighborRegionShapes(BLOCKS[id].base)
  if (!BLOCKS[id].rotatable) return [normalize(BLOCKS[id].base)]
  const rotations: Point[][] = []
  let current = normalize(BLOCKS[id].base)
  for (let i = 0; i < 4; i += 1) {
    const key = JSON.stringify(current)
    if (!rotations.some(item => JSON.stringify(item) === key)) rotations.push(current)
    current = rotate(current)
  }
  return rotations
}

export const emptyBoard = (): Board => Array.from({ length: BOARD_ROWS }, () => Array<BlockCell | null>(BOARD_COLS).fill(null))

const makeQueue = (): BlockId[] => [...PLACEMENT_SEQUENCE]

const spawn = (id: BlockId): ActiveBlock => {
  const points = rotationsFor(id)[0]
  const width = Math.max(...points.map(([x]) => x)) + 1
  return { id, rotation: 0, x: Math.floor((BOARD_COLS - width) / 2), y: 0 }
}

export const createGame = (candidateSeed = 0): GameState => {
  const queue = makeQueue()
  const id = queue.shift()!
  return { board: emptyBoard(), active: spawn(id), queue, hold: null, canHold: false, score: 0, lines: 0, level: 1, gameOver: false, floorplanReady: false, candidateSeed, placements: 0, replacements: 0, lastEvent: 'PPA3 macro + required-neighbor floorplan ready' }
}

export const cellsFor = (active: ActiveBlock): Point[] => rotationsFor(active.id)[active.rotation % rotationsFor(active.id).length].map(([x, y]) => [x + active.x, y + active.y] as Point)

export const isValid = (board: Board, active: ActiveBlock): boolean => cellsFor(active).every(([x, y]) => x >= 0 && x < BOARD_COLS && y >= 0 && y < BOARD_ROWS && !board[y][x])

const countFullRows = (board: Board): number => board.filter(row => row.every(Boolean)).length

const writeBlock = (board: Board, active: ActiveBlock, instance = 0): Board => {
  const next = board.map(row => [...row])
  const definition = BLOCKS[active.id]
  cellsFor(active).forEach(([x, y]) => { next[y][x] = { id: active.id, category: definition.category, instance } })
  return next
}

export const createPpa3SeedGame = (candidateSeed = 0): GameState => {
  const initial = createGame(candidateSeed)
  const sizes = getBlockSizes()
  const adc: ActiveBlock = { id: 'adc', rotation: rotationsFor('adc').findIndex(shape => Math.max(...shape.map(([x]) => x)) + 1 === sizes.adc.width && Math.max(...shape.map(([, y]) => y)) + 1 === sizes.adc.height), x: 1, y: 3 }
  const adcRotation = adc.rotation < 0 ? 0 : adc.rotation
  const adcPlaced = { ...adc, rotation: adcRotation }
  if (!isValid(initial.board, adcPlaced)) return initial
  const withAdc = writeBlock(initial.board, adcPlaced, 1)
  const sram: ActiveBlock = { id: 'sram', rotation: rotationsFor('sram').findIndex(shape => Math.max(...shape.map(([x]) => x)) + 1 === sizes.sram.width && Math.max(...shape.map(([, y]) => y)) + 1 === sizes.sram.height), x: 9, y: 1 }
  const sramRotation = sram.rotation < 0 ? 0 : sram.rotation
  const sramPlaced = { ...sram, rotation: sramRotation }
  if (!isValid(withAdc, sramPlaced)) return initial
  return {
    ...initial,
    board: writeBlock(withAdc, sramPlaced, 2),
    active: spawn('opamp'),
    queue: ['fifo', 'control'],
    placements: 2,
    score: 80,
    level: 2,
    lastEvent: 'PPA3 seed loaded · ADC (40,150) · SRAM (430,65)',
  }
}

const nextFromQueue = (state: GameState, board: Board, completed: number, queue = state.queue, hold = state.hold): GameState => {
  const nextQueue = [...queue]
  const id = nextQueue.shift()
  const lines = state.lines + completed
  const placements = state.placements + 1
  const score = state.score + (BLOCKS[state.active.id].physicalKind === 'hard-macro' ? 40 : 25)
  if (!id) {
    return { ...state, board, queue: [], hold, score: score + 100, lines, level: 3, gameOver: false, floorplanReady: true, placements, lastEvent: 'Required placement complete - remaining area released to OpenROAD standard cells' }
  }
  const phase = placements < 2 ? 1 : 2
  return { ...state, board, active: spawn(id), queue: nextQueue, hold, canHold: false, score, lines, level: phase, gameOver: false, floorplanReady: false, placements, lastEvent: `${BLOCKS[state.active.id].label} placed; ${BLOCKS[id].label} is next` }
}

export const lockActive = (state: GameState, active = state.active, queue = state.queue, hold = state.hold): GameState => {
  if (!isLegalPlacement(state.board, active)) return { ...state, lastEvent: 'Illegal placement: zone or required-neighbor rule failed' }
  const board = writeBlock(state.board, active, state.placements + 1)
  const completed = Math.max(0, countFullRows(board) - countFullRows(state.board))
  return nextFromQueue({ ...state, active }, board, completed, queue, hold)
}

// The game board uses this exact predicate both for an AI placement and for the
// "real free space" overlay in ChipTetris. A visually empty tile is not free
// unless the whole active shape fits, stays in its allowed zone, and satisfies
// its required-neighbour relation.
export const isLegalPlacement = (board: Board, active: ActiveBlock): boolean =>
  isValid(board, active) && respectsHardPlacementRules(board, active)

export const moveActive = (state: GameState, dx: number, dy: number): GameState => {
  if (state.gameOver || state.floorplanReady) return state
  const moved = { ...state.active, x: state.active.x + dx, y: state.active.y + dy }
  if (isValid(state.board, moved)) return { ...state, active: moved }
  return state
}

export const movePlacedInstances = (state: GameState, instances: number[], dx: number, dy: number): GameState => {
  const selected = new Set(instances.filter(instance => instance > 0))
  if (!selected.size || (!dx && !dy)) return state
  const moving: Array<{ x: number; y: number; cell: BlockCell }> = []
  state.board.forEach((row, y) => row.forEach((cell, x) => {
    if (cell && selected.has(cell.instance)) moving.push({ x, y, cell })
  }))
  if (!moving.length) return { ...state, lastEvent: 'Group move skipped: select placed blocks first' }

  const stationary = state.board.map(row => row.map(cell => cell && selected.has(cell.instance) ? null : cell))
  for (const item of moving) {
    const x = item.x + dx
    const y = item.y + dy
    if (x < 0 || x >= BOARD_COLS || y < 0 || y >= BOARD_ROWS) {
      return { ...state, lastEvent: 'Group move blocked: die boundary' }
    }
    if (stationary[y][x]) return { ...state, lastEvent: 'Group move blocked: collision with unselected block' }
  }

  const board = stationary.map(row => [...row])
  moving.forEach(item => { board[item.y + dy][item.x + dx] = item.cell })
  const metrics = measureBoard(board)
  return {
    ...state,
    board,
    score: state.score - 1,
    lastEvent: `Manual group move · ${selected.size} block${selected.size > 1 ? 's' : ''} · Δ(${dx}, ${dy}) · rule flags ${metrics.violations}`,
  }
}

export const rotateActive = (state: GameState): GameState => {
  if (state.gameOver || state.floorplanReady) return state
  const count = rotationsFor(state.active.id).length
  const rotation = (state.active.rotation + 1) % count
  for (const kick of [0, -1, 1, -2, 2]) {
    const candidate = { ...state.active, rotation, x: state.active.x + kick }
    if (isValid(state.board, candidate)) return { ...state, active: candidate }
  }
  return state
}

export const hardDrop = (state: GameState): GameState => {
  if (state.gameOver || state.floorplanReady) return state
  let active = { ...state.active }
  while (isValid(state.board, { ...active, y: active.y + 1 })) active = { ...active, y: active.y + 1 }
  return lockActive(state, active)
}

export const placeActive = (state: GameState): GameState => lockActive(state)

export const holdActive = (state: GameState): GameState => ({ ...state, lastEvent: 'Hold disabled: macros and neighbor regions use a fixed dependency order' })

const coordsForId = (board: Board, id: BlockId): Point[] => {
  const coords: Point[] = []
  board.forEach((row, y) => row.forEach((cell, x) => { if (cell?.id === id) coords.push([x, y]) }))
  return coords
}

const cellDistance = (a: Point[], b: Point[]): number => {
  if (!a.length || !b.length) return Number.POSITIVE_INFINITY
  return Math.min(...a.flatMap(([ax, ay]) => b.map(([bx, by]) => Math.abs(ax - bx) + Math.abs(ay - by))))
}

const touchesRequiredNeighbor = (board: Board, active: ActiveBlock): boolean => {
  const required = BLOCKS[active.id].requiredNeighbor
  return !required || cellDistance(cellsFor(active), coordsForId(board, required)) === 1
}

const columnHeights = (board: Board): number[] => Array.from({ length: BOARD_COLS }, (_, x) => {
  const first = board.findIndex(row => row[x])
  return first < 0 ? 0 : BOARD_ROWS - first
})

export const measureBoard = (board: Board): BoardMetrics => {
  const heights = columnHeights(board)
  let holes = 0
  let zonePenalty = 0
  let isolationPenalty = 0
  let macroSpacingPenalty = 0
  let powerAccessPenalty = 0
  let pinAccessPenalty = 0
  let integrityViolations = 0
  let adjacencyPenalty = 0
  let functionalClusterPenalty = 0
  let filledCells = 0
  const instances = new Map<number, BlockCell[]>()
  for (let x = 0; x < BOARD_COLS; x += 1) {
    let occupied = false
    for (let y = 0; y < BOARD_ROWS; y += 1) {
      const cell = board[y][x]
      if (cell) {
        filledCells += 1
        if (cell.instance > 0) instances.set(cell.instance, [...(instances.get(cell.instance) ?? []), cell])
        occupied = true
        if (cell.id === 'adc' && x > Math.floor(BOARD_COLS * 0.42)) zonePenalty += 1
        if (cell.id === 'sram' && x < Math.floor(BOARD_COLS * 0.32)) zonePenalty += 1
        if (cell.category === 'analog') {
          for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
            if (nx >= 0 && nx < BOARD_COLS && ny >= 0 && ny < BOARD_ROWS) {
              const neighbour = board[ny][nx]
              if (neighbour && neighbour.category !== 'analog' && !(cell.id === 'opamp' && neighbour.id === 'fifo')) isolationPenalty += 0.25
            }
          }
        }
      } else if (occupied) holes += 1
    }
  }
  const bumpiness = heights.slice(1).reduce((sum, height, index) => sum + Math.abs(height - heights[index]), 0)
  const hardMacroBoxes: Array<{ x0: number; y0: number; x1: number; y1: number }> = []
  instances.forEach((cells, instance) => {
    if (cells.length !== BLOCKS[cells[0].id].base.length || cells.some(cell => cell.id !== cells[0].id || cell.category !== cells[0].category)) integrityViolations += 1
    const coords: Point[] = []
    board.forEach((row, y) => row.forEach((cell, x) => { if (cell?.instance === instance) coords.push([x, y]) }))
    if (BLOCKS[cells[0].id].physicalKind === 'hard-macro') {
      hardMacroBoxes.push({
        x0: Math.min(...coords.map(([x]) => x)),
        x1: Math.max(...coords.map(([x]) => x)),
        y0: Math.min(...coords.map(([, y]) => y)),
        y1: Math.max(...coords.map(([, y]) => y)),
      })
    }
    if (BLOCKS[cells[0].id].physicalKind === 'hard-macro' && !coords.some(([x]) => Array.from({ length: Math.ceil(BOARD_COLS / 5) }, (_, i) => i * 5).some(column => Math.abs(column - x) <= 1))) powerAccessPenalty += 1
    const hasEscape = coords.some(([x, y]) => [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([nx, ny]) => nx < 0 || nx >= BOARD_COLS || ny < 0 || ny >= BOARD_ROWS || !board[ny][nx]))
    if (!hasEscape) pinAccessPenalty += 1
    if (cells[0]?.category === 'memory') {
      for (const [x, y] of coords) {
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          const neighbour = nx >= 0 && nx < BOARD_COLS && ny >= 0 && ny < BOARD_ROWS ? board[ny][nx] : null
          if (neighbour && neighbour.instance !== instance && neighbour.category !== 'memory' && !(cells[0]?.id === 'sram' && neighbour.id === 'control')) macroSpacingPenalty += 0.25
        }
      }
    }
  })
  let macroClearancePenalty = 0
  let macroClearanceRisk = 0
  for (let i = 0; i < hardMacroBoxes.length; i += 1) {
    for (let j = i + 1; j < hardMacroBoxes.length; j += 1) {
      const a = hardMacroBoxes[i]
      const b = hardMacroBoxes[j]
      const dx = Math.max(a.x0 - b.x1 - 1, b.x0 - a.x1 - 1, 0)
      const dy = Math.max(a.y0 - b.y1 - 1, b.y0 - a.y1 - 1, 0)
      const gap = dx > 0 && dy > 0 ? Math.min(dx, dy) : Math.max(dx, dy)
      if (gap < MACRO_CLEARANCE_SAFE_CELLS) macroClearancePenalty += MACRO_CLEARANCE_SAFE_CELLS - gap
      if (gap < MACRO_CLEARANCE_FAIL_CELLS) macroClearanceRisk += 1
    }
  }
  let wirelengthPenalty = 0
  for (const [fromId, toId, weight] of WIRELENGTH_NETS) {
    const fromCoords = coordsForId(board, fromId)
    const toCoords = coordsForId(board, toId)
    if (!fromCoords.length || !toCoords.length) continue
    const centerOf = (coords: Point[]): Point => [coords.reduce((sum, [x]) => sum + x, 0) / coords.length, coords.reduce((sum, [, y]) => sum + y, 0) / coords.length]
    const [fx, fy] = centerOf(fromCoords)
    const [tx, ty] = centerOf(toCoords)
    wirelengthPenalty += weight * (Math.abs(fx - tx) + Math.abs(fy - ty))
  }
  for (const id of PLACEMENT_SEQUENCE) {
    const required = BLOCKS[id].requiredNeighbor
    if (required && coordsForId(board, id).length && cellDistance(coordsForId(board, id), coordsForId(board, required)) !== 1) adjacencyPenalty += 1
  }
  const categoryInstances = new Map<BlockCategory, Point[][]>()
  instances.forEach((cells, instance) => {
    const coords: Point[] = []
    board.forEach((row, y) => row.forEach((cell, x) => { if (cell?.instance === instance) coords.push([x, y]) }))
    const category = cells[0]?.category
    if (category) categoryInstances.set(category, [...(categoryInstances.get(category) ?? []), coords])
  })
  categoryInstances.forEach(groups => {
    if (groups.length < 2) return
    groups.forEach((coords, index) => {
      const nearest = Math.min(...groups.filter((_, other) => other !== index).map(other => cellDistance(coords, other)))
      functionalClusterPenalty += Math.max(0, nearest - 1)
    })
  })
  functionalClusterPenalty /= 2
  const maxHeight = Math.max(...heights)
  const softHeights = Array.from({ length: BOARD_COLS }, (_, x) => board.reduce((count, row) => count + (row[x] && BLOCKS[row[x]!.id].physicalKind !== 'hard-macro' ? 1 : 0), 0))
  const congestion = softHeights.filter(height => height >= Math.ceil(BOARD_ROWS * 0.75)).length
  const violations = Math.ceil(zonePenalty) + Math.ceil(isolationPenalty) + adjacencyPenalty + Math.ceil(macroSpacingPenalty) + powerAccessPenalty + pinAccessPenalty + integrityViolations + congestion + macroClearanceRisk
  return { aggregateHeight: heights.reduce((a, b) => a + b, 0), maxHeight, holes, bumpiness, zonePenalty, isolationPenalty, macroSpacingPenalty, powerAccessPenalty, pinAccessPenalty, integrityViolations, congestion, violations, adjacencyPenalty, functionalClusterPenalty, standardCellArea: BOARD_ROWS * BOARD_COLS - filledCells, macroClearancePenalty, macroClearanceRisk, wirelengthPenalty }
}

export const preSignoffReport = (board: Board): PreSignoffReport => {
  const metrics = measureBoard(board)
  const filled = board.reduce((sum, row) => sum + row.filter(Boolean).length, 0)
  const hardDrcClean = true // boundary and overlap are rejected before placement
  const zoneClean = metrics.zonePenalty === 0
  const spacingClean = metrics.isolationPenalty === 0 && metrics.macroSpacingPenalty === 0 && metrics.macroClearanceRisk === 0
  const adjacencyClean = metrics.adjacencyPenalty === 0
  const powerAccessible = metrics.powerAccessPenalty === 0
  const pinAccessible = metrics.pinAccessPenalty === 0
  const structuralLvsClean = metrics.integrityViolations === 0
  // metrics.congestion only tracks std-cell column stacking; the real GRT-0118
  // failure this project hit came from macro placement itself (see macroClearanceRisk
  // above), so that signal must also escalate routability risk, not just spacingClean.
  const routabilityRisk = metrics.congestion > 1 || metrics.holes > 12 || metrics.macroClearanceRisk > 0
    ? 'high'
    : metrics.congestion > 0 || metrics.holes > 5 || metrics.macroClearancePenalty > 0
      ? 'medium'
      : 'low'
  const checks = [hardDrcClean, zoneClean, spacingClean, adjacencyClean, powerAccessible, pinAccessible, structuralLvsClean]
  const confidence = filled === 0 ? 100 : Math.max(0, Math.round((checks.filter(Boolean).length / checks.length) * 90 + (routabilityRisk === 'low' ? 10 : routabilityRisk === 'medium' ? 5 : 0)))
  return { hardDrcClean, zoneClean, spacingClean, adjacencyClean, powerAccessible, pinAccessible, structuralLvsClean, routabilityRisk, confidence }
}

const respectsHardPlacementRules = (board: Board, active: ActiveBlock): boolean => {
  const cells = cellsFor(active)
  if (!touchesRequiredNeighbor(board, active)) return false
  const centerX = cells.reduce((sum, [x]) => sum + x, 0) / cells.length
  if (active.id === 'adc' && centerX > BOARD_COLS * 0.42) return false
  if (active.id === 'sram' && centerX < BOARD_COLS * 0.55) return false
  if (active.id === 'sram' && cellDistance(cells, coordsForId(board, 'adc')) < 2) return false
  if (active.id !== 'opamp' && active.id !== 'adc' && cellDistance(cells, coordsForId(board, 'adc')) === 1) return false
  return true
}

const placementValue = (board: Board, cleared: number): { value: number; metrics: BoardMetrics } => {
  const metrics = measureBoard(board)
  const value = cleared * 120 - metrics.adjacencyPenalty * 180 - metrics.functionalClusterPenalty * 45 - metrics.aggregateHeight * 0.12 - metrics.maxHeight * 0.2 - metrics.holes * 3.2 - metrics.bumpiness * 0.1 - metrics.zonePenalty * 40 - metrics.isolationPenalty * 45 - metrics.macroSpacingPenalty * 35 - metrics.powerAccessPenalty * 18 - metrics.pinAccessPenalty * 25 - metrics.integrityViolations * 100 - metrics.congestion * 12 - metrics.macroClearancePenalty * 6 - metrics.macroClearanceRisk * 90 - metrics.wirelengthPenalty * 2.5
  return { value, metrics }
}

const candidateBias = (active: ActiveBlock, seed: number): number => {
  const points = cellsFor(active)
  const cx = points.reduce((sum, [x]) => sum + x, 0) / points.length
  const cy = points.reduce((sum, [, y]) => sum + y, 0) / points.length
  const jitter = ((active.x * 17 + active.y * 31 + active.rotation * 13 + seed * 29) % 37) * 0.16
  if (seed % 4 === 0) return -cx * 0.35 + jitter
  if (seed % 4 === 1) return -Math.abs(cx - (BOARD_COLS - 1) / 2) * 0.8 + jitter
  if (seed % 4 === 2) return cy * 0.45 + jitter
  return jitter
}

export const evaluatePlacement = (board: Board): number => placementValue(board, 0).value

export const placementSignature = (board: Board): string => board
  .flat()
  .map(cell => cell ? `${cell.id}:${cell.instance}` : '.')
  .join('|')

const ENUMERATE_BEAM_WIDTH = 2

const enumerate = (board: Board, id: BlockId, useHold: boolean, candidateSeed = 0): AiPlan[] => {
  const coarse: Array<{ active: ActiveBlock; cleared: number; quickValue: number }> = []
  rotationsFor(id).forEach((points, rotation) => {
    const width = Math.max(...points.map(([x]) => x)) + 1
    const height = Math.max(...points.map(([, y]) => y)) + 1
    for (let x = 0; x <= BOARD_COLS - width; x += 1) {
      // This is a macro placer, not a gravity game: inspect every legal empty
      // region, including cavities that cannot be reached by falling from above.
      for (let y = 0; y <= BOARD_ROWS - height; y += 1) {
        const active: ActiveBlock = { id, rotation, x, y }
        if (!isValid(board, active) || !respectsHardPlacementRules(board, active)) continue
        const placed = writeBlock(board, active)
        const completed = Math.max(0, countFullRows(placed) - countFullRows(board))
        const centerX = x + width / 2
        const centerY = y + height / 2
        const edgeDistance = Math.min(centerX, BOARD_COLS - centerX, centerY, BOARD_ROWS - centerY)
        const quickValue = completed * 120 + candidateBias(active, candidateSeed) + edgeDistance * 0.03
        coarse.push({ active, cleared: completed, quickValue })
      }
    }
  })
  return coarse
    .sort((a, b) => b.quickValue - a.quickValue)
    .slice(0, ENUMERATE_BEAM_WIDTH)
    .map(({ active, cleared }) => {
      const placed = writeBlock(board, active)
      const result = placementValue(placed, cleared)
      return { id, rotation: active.rotation, x: active.x, y: active.y, value: result.value + candidateBias(active, candidateSeed) - (useHold ? 0.8 : 0), cleared, useHold, metrics: result.metrics }
    })
    .sort((a, b) => b.value - a.value)
}

export const chooseAiPlan = (state: GameState): AiPlan | null => {
  if (state.floorplanReady || state.gameOver) return null
  const plans = enumerate(state.board, state.active.id, false, state.candidateSeed)
  if (state.canHold) {
    const heldId = state.hold ?? state.queue[0]
    if (heldId) plans.push(...enumerate(state.board, heldId, true, state.candidateSeed))
  }
  return plans.sort((a, b) => b.value - a.value)[0] ?? null
}

export const applyAiPlan = (state: GameState, selectedPlan?: AiPlan): GameState => {
  if (state.gameOver || state.floorplanReady) return state
  const plan = selectedPlan ?? chooseAiPlan(state)
  if (!plan) return { ...state, gameOver: true, lastEvent: 'AI found no legal floorplan' }
  const active: ActiveBlock = { id: plan.id, rotation: plan.rotation, x: plan.x, y: plan.y }
  const mode = state.placements < 2 ? 'macro' : 'gap-fill'
  return lockActive({ ...state, lastEvent: `AI ${mode} selected (${plan.x + 1}, ${plan.y + 1})` }, active)
}

export const createBeamCandidate = (baseSeed: number, poolSize = 2, beamWidth = 2): GameState => {
  const beam: Array<{ state: GameState; score: number }> = []
  const signatures = new Set<string>()
  for (let offset = 0; offset < poolSize; offset += 1) {
    const seed = baseSeed * poolSize + offset
    let state = createGame(seed)
    for (let step = 0; step < TOTAL_REQUIRED_BLOCKS + 2 && !state.floorplanReady && !state.gameOver; step += 1) state = applyAiPlan(state)
    if (!state.floorplanReady || state.gameOver) continue
    const metrics = measureBoard(state.board)
    if (metrics.violations !== 0) continue
    const signature = placementSignature(state.board)
    if (signatures.has(signature)) continue
    signatures.add(signature)
    beam.push({ state, score: evaluatePlacement(state.board) })
    beam.sort((a, b) => b.score - a.score)
    if (beam.length > beamWidth) beam.length = beamWidth
  }
  const selected = beam[baseSeed % Math.max(1, beam.length)]
  if (!selected) return { ...createGame(baseSeed), gameOver: true, lastEvent: `Coarse pool ${poolSize}: legal candidate unavailable` }
  return {
    ...selected.state,
    candidateSeed: baseSeed,
    lastEvent: `Coarse pool ${poolSize} → beam ${beam.length} · rank ${(baseSeed % beam.length) + 1}`,
  }
}

export const createEliteMutation = (elite: GameState, candidateSeed: number): GameState => {
  const instances = new Map<number, BlockId>()
  elite.board.forEach(row => row.forEach(cell => { if (cell && cell.instance > 0) instances.set(cell.instance, cell.id) }))
  const entries = [...instances.entries()]
  if (!entries.length) return { ...elite, candidateSeed, replacements: 0, lastEvent: 'Elite mutation skipped: no placed instances' }

  const [instance, id] = entries[candidateSeed % entries.length]
  const removed = elite.board.map(row => row.map(cell => cell?.instance === instance ? null : cell))
  const oldSignature = elite.board.flat().map(cell => cell?.instance === instance ? '1' : '0').join('')
  const alternatives = enumerate(removed, id, false, candidateSeed)
    .map(plan => {
      const active: ActiveBlock = { id, rotation: plan.rotation, x: plan.x, y: plan.y }
      const board = writeBlock(removed, active, instance)
      return { plan, board, metrics: measureBoard(board), signature: board.flat().map(cell => cell?.instance === instance ? '1' : '0').join('') }
    })
    .filter(item => item.signature !== oldSignature && item.metrics.violations === 0)
    .sort((a, b) => b.plan.value - a.plan.value)

  if (!alternatives.length) return { ...elite, candidateSeed, replacements: 0, lastEvent: `Elite mutation #${instance}: legal alternative unavailable` }
  const choice = alternatives[Math.floor(candidateSeed / 4) % Math.min(6, alternatives.length)]
  return {
    ...elite,
    board: choice.board,
    candidateSeed,
    score: 0,
    replacements: 0,
    gameOver: false,
    floorplanReady: true,
    lastEvent: `Elite-init mutation #${instance} · seed ${candidateSeed}`,
  }
}

export const applyBestReplacement = (state: GameState): GameState => {
  if (state.gameOver || state.placements < 2) return state
  const instances = new Map<number, { id: BlockId; cells: Point[] }>()
  state.board.forEach((row, y) => row.forEach((cell, x) => {
    if (!cell || cell.instance <= 0) return
    const item = instances.get(cell.instance) ?? { id: cell.id, cells: [] }
    item.cells.push([x, y])
    instances.set(cell.instance, item)
  }))
  const baseline = placementValue(state.board, 0).value
  let best: ReplacePlan | null = null
  instances.forEach((item, instance) => {
    // A cleared routing row can cut through a tetromino. Only intact macros are
    // eligible for re-place so the operation never invents missing cells.
    if (item.cells.length !== 4) return
    const removed = state.board.map(row => row.map(cell => cell?.instance === instance ? null : cell))
    const oldFootprint = new Set(item.cells.map(([x, y]) => `${x}:${y}`))
    for (const plan of enumerate(removed, item.id, false, state.candidateSeed)) {
      const active: ActiveBlock = { id: item.id, rotation: plan.rotation, x: plan.x, y: plan.y }
      const newCells = cellsFor(active)
      if (newCells.every(([x, y]) => oldFootprint.has(`${x}:${y}`))) continue
      if (!respectsHardPlacementRules(removed, active)) continue
      const replaced = writeBlock(removed, active, instance)
      const completed = Math.max(0, countFullRows(replaced) - countFullRows(removed))
      const evaluated = placementValue(replaced, completed)
      const gain = evaluated.value - baseline
      if (gain > 1 && (!best || gain > best.gain)) best = { ...plan, value: evaluated.value, metrics: evaluated.metrics, cleared: completed, instance, gain, board: replaced }
    }
  })
  if (!best) return { ...state, lastEvent: 'Re-place scan: current floorplan kept' }
  const selected: ReplacePlan = best
  const lines = state.lines + selected.cleared
  return {
    ...state,
    board: selected.board,
    lines,
    level: Math.floor(lines / 10) + 1,
    score: state.score + 20 + selected.cleared * 100 * state.level,
    replacements: state.replacements + 1,
    lastEvent: `Re-place #${selected.instance}: +${selected.gain.toFixed(1)} cost improvement`,
  }
}


export const runReplaceThenAnnealing = (initial: GameState, iterations = 6, onProgress?: (progress: HybridProgress) => void): GameState => {
  let baseline = initial
  for (let pass = 0; pass < 2; pass += 1) {
    onProgress?.({ stage: 'replace', iteration: pass + 1, total: 2, accepted: 0, attempted: 0, bestValue: evaluatePlacement(baseline.board) })
    const before = baseline.replacements
    const next = applyBestReplacement(baseline)
    baseline = next
    if (next.replacements === before) break
  }

  let randomState = ((initial.candidateSeed + 1) * 2654435761) >>> 0
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
    return randomState / 4294967296
  }

  let currentBoard = baseline.board
  let currentValue = placementValue(currentBoard, 0).value
  let bestBoard = currentBoard
  let bestValue = currentValue
  let accepted = 0
  let attempted = 0
  let staleSteps = 0
  let completedIterations = 0

  for (let step = 0; step < iterations; step += 1) {
    completedIterations = step + 1
    onProgress?.({ stage: 'sa', iteration: completedIterations, total: iterations, accepted, attempted, bestValue })
    const instances = new Map<number, BlockId>()
    currentBoard.forEach(row => row.forEach(cell => { if (cell && cell.instance > 0) instances.set(cell.instance, cell.id) }))
    const entries = [...instances.entries()]
    if (!entries.length) break
    const [instance, id] = entries[Math.floor(random() * entries.length)]
    const removed = currentBoard.map(row => row.map(cell => cell?.instance === instance ? null : cell))
    const plans = enumerate(removed, id, false, initial.candidateSeed + step + 1)
    if (!plans.length) continue
    const plan = plans[Math.floor(random() * plans.length)]
    const active: ActiveBlock = { id, rotation: plan.rotation, x: plan.x, y: plan.y }
    const candidateBoard = writeBlock(removed, active, instance)
    const candidateMetrics = measureBoard(candidateBoard)
    if (candidateMetrics.violations !== 0) continue

    attempted += 1
    const candidateValue = placementValue(candidateBoard, 0).value
    const delta = candidateValue - currentValue
    const progress = step / Math.max(1, iterations - 1)
    const temperature = 18 * Math.pow(0.02 / 18, progress)
    if (delta >= 0 || random() < Math.exp(delta / temperature)) {
      currentBoard = candidateBoard
      currentValue = candidateValue
      accepted += 1
      if (candidateValue > bestValue) {
        bestBoard = candidateBoard
        bestValue = candidateValue
        staleSteps = 0
      } else {
        staleSteps += 1
      }
    } else {
      staleSteps += 1
    }
    if (staleSteps >= 4) break
  }

  onProgress?.({ stage: 'complete', iteration: completedIterations, total: iterations, accepted, attempted, bestValue })

  return {
    ...baseline,
    board: bestBoard,
    replacements: baseline.replacements + accepted,
    lastEvent: `Hybrid complete · Replace baseline · SA ${accepted}/${attempted} accepted · best gain ${(bestValue - placementValue(initial.board, 0).value).toFixed(1)}`,
  }
}
