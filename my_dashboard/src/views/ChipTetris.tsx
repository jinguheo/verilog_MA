import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from 'react'
import {
  applyAiPlan, applyBestReplacement, BLOCKS, BOARD_COLS, BOARD_ROWS, cellsFor, chooseAiPlan, configureBlockSizes, createEliteMutation, createGame, createPpa3SeedGame, DIE_HEIGHT_UM, DIE_WIDTH_UM, evaluatePlacement, getBlockSizes, GRID_UM, movePlacedInstances, placeActive, runReplaceThenAnnealing, TOTAL_REQUIRED_BLOCKS,
  holdActive, measureBoard, moveActive, PLACEMENT_SEQUENCE, preSignoffReport, rotateActive, type ActiveBlock, type BlockCell, type BlockId, type GameState,
} from '../game/chipTetrisEngine'
import ActualLayoutFlow from './ActualLayoutFlow'

type SimpleActionType = 'left' | 'right' | 'down' | 'rotate' | 'place' | 'hold' | 'ai' | 'replace' | 'hybrid' | 'reset'
type Action = { type: SimpleActionType } | { type: 'candidate'; seed: number } | { type: 'mutate'; state: GameState; seed: number } | { type: 'load'; state: GameState } | { type: 'move-group'; instances: number[]; dx: number; dy: number }

function reducer(state: GameState, action: Action): GameState {
  if (action.type === 'reset') return createPpa3SeedGame()
  if (action.type === 'candidate') return createGame(action.seed)
  if (action.type === 'mutate') return createEliteMutation(action.state, action.seed)
  if (action.type === 'load') return action.state
  if (action.type === 'move-group') return movePlacedInstances(state, action.instances, action.dx, action.dy)
  if (action.type === 'left') return moveActive(state, -1, 0)
  if (action.type === 'right') return moveActive(state, 1, 0)
  if (action.type === 'down') return moveActive(state, 0, 1)
  if (action.type === 'rotate') return rotateActive(state)
  if (action.type === 'place') return placeActive(state)
  if (action.type === 'hold') return holdActive(state)
  if (action.type === 'replace') return applyBestReplacement(state)
  if (action.type === 'hybrid') return runReplaceThenAnnealing(state)
  return applyAiPlan(state)
}

function MiniBlock({ id, physicalSize }: { id: BlockId | null; physicalSize?: InitBlockSize }) {
  if (!id) return <div className="chip-mini empty">EMPTY</div>
  const def = BLOCKS[id]
  return <div className={`chip-mini ${def.category}`}><BlockShape id={id} physicalSize={physicalSize}/><span>{def.label}</span><small>{physicalSize && def.physicalKind === 'neighbor-region' ? `${physicalSize.widthUm}×${physicalSize.heightUm} µm` : `${def.category} · ${def.physicalKind}`}</small></div>
}

function BlockShape({ id, compact = false, physicalSize }: { id: BlockId; compact?: boolean; physicalSize?: InitBlockSize }) {
  const defaultRegionShape = STD_REGION_TILES[id]
  const regionShape = physicalSize && BLOCKS[id].physicalKind === 'neighbor-region'
    ? [Math.max(1, Math.round(physicalSize.widthUm / STD_GRID_UM)), Math.max(1, Math.round(physicalSize.heightUm / STD_GRID_UM))] as const
    : defaultRegionShape
  const points = regionShape
    ? Array.from({ length: regionShape[1] }, (_, y) => Array.from({ length: regionShape[0] }, (_, x) => [x, y] as const)).flat()
    : BLOCKS[id].base
  const width = Math.max(...points.map(([x]) => x)) + 1
  const height = Math.max(...points.map(([, y]) => y)) + 1
  return <svg className={`block-shape ${compact ? 'compact' : ''}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${BLOCKS[id].label} ${width} by ${height} grid shape`}>
    {points.map(([x, y]) => <rect key={`${x}-${y}`} x={x + .06} y={y + .06} width=".88" height=".88" rx=".08" fill={BLOCKS[id].color}/>) }
  </svg>
}

const CANDIDATE_COUNT = 8
const STD_SUBDIVISIONS = 5
const STD_GRID_UM = GRID_UM / STD_SUBDIVISIONS
// Real OpenLane evidence for this exact 1250x600um die (samples/sample_test_4/asic/
// ppa3_adc_capture, RUN_2026-09-24_14-07-59, 51-openroad-fillinsertion/or_metrics_out.json):
// even with PL_TARGET_DENSITY_PCT=35 as the RePlAce global-placement bin target, the
// legalized stdcell logic only ended up filling design__instance__utilization__stdcell
// = 0.0784 (~7.8%) of the non-macro core area. The old 0.35 here was carried straight over
// from that placer density KNOB, not the actual outcome, so it overestimated real
// std-cell space demand by ~4.5x for this die.
const STD_CELL_LEFTOVER_FILL_RATIO = 0.078
const STD_REGION_TILES: Partial<Record<BlockId, readonly [number, number]>> = {
  opamp: [10, 10],
  fifo: [10, 5],
  control: [10, 10],
}
const candidateProfiles = ['좌측 압축', '중앙 균형', '하단 압축', '분산 탐색', '좌측 변형', '중앙 변형', '하단 변형', '분산 변형']
type CandidateResult = { generation: number; index: number; profile: string; score: number; violations: number; congestion: number; replacements: number; savedAt: number; state: GameState }
const SAVED_CANDIDATES_KEY = 'chip-tetris-legal-candidates-v2'
const MAX_SAVED_CANDIDATES = 64
const loadSavedCandidates = (): CandidateResult[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_CANDIDATES_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.slice(0, MAX_SAVED_CANDIDATES) : []
  } catch {
    return []
  }
}
type InitBlockId = 'adc' | 'sram' | 'opamp' | 'fifo' | 'control'
type InitBlockSize = { widthUm: number; heightUm: number }
const PPA3_BLOCK_SIZES: Record<InitBlockId, InitBlockSize> = {
  adc: { widthUm: 223.71, heightUm: 293.365 },
  sram: { widthUm: 764.24, heightUm: 460.28 },
  opamp: { widthUm: 100, heightUm: 100 },
  fifo: { widthUm: 100, heightUm: 50 },
  control: { widthUm: 100, heightUm: 100 },
}
const scaledPpa3Sizes = (areaScale: number): Record<InitBlockId, InitBlockSize> => {
  const linearScale = Math.sqrt(areaScale)
  return Object.fromEntries(
    Object.entries(PPA3_BLOCK_SIZES).map(([id, size]) => {
      const scaled = { widthUm: size.widthUm * linearScale, heightUm: size.heightUm * linearScale }
      const stdRegion = id === 'opamp' || id === 'fifo' || id === 'control'
      return [id, stdRegion ? {
        widthUm: Math.max(STD_GRID_UM, Math.round(scaled.widthUm / STD_GRID_UM) * STD_GRID_UM),
        heightUm: Math.max(STD_GRID_UM, Math.round(scaled.heightUm / STD_GRID_UM) * STD_GRID_UM),
      } : {
        widthUm: Number(scaled.widthUm.toFixed(3)),
        heightUm: Number(scaled.heightUm.toFixed(3)),
      }]
    }),
  ) as Record<InitBlockId, InitBlockSize>
}
const initBlocks: Array<{ id: InitBlockId; name: string; source: string }> = [
  { id: 'adc', name: 'ADC hard macro', source: 'LEF 223.710×293.365 µm' },
  { id: 'sram', name: 'SRAM hard macro', source: 'LEF 764.240×460.280 µm' },
  { id: 'opamp', name: 'SAR neighbor region', source: '100×100 µm · 10×10 sub-grid' },
  { id: 'fifo', name: 'CDC boundary region', source: '100×50 µm · 10×5 sub-grid' },
  { id: 'control', name: 'Capture neighbor region', source: '100×100 µm · 10×10 sub-grid' },
]

const architecture = [
  ['analog', 'Sensor / AFE', 'differential input'],
  ['analog', 'S/H + 32-bit ADC', 'sampling & conversion'],
  ['digital', 'CDC FIFO', 'clock boundary'],
  ['memory', '4K × 32 SRAM', '16 KiB capture buffer'],
  ['digital', 'Read DMA', 'read_req → stream'],
] as const

export default function ChipTetris() {
  const [game, dispatch] = useReducer(reducer, undefined, createPpa3SeedGame)
  const [running, setRunning] = useState(false)
  const [sizeDraft, setSizeDraft] = useState<Record<InitBlockId, InitBlockSize>>(() => scaledPpa3Sizes(1))
  const [appliedRegionSizes, setAppliedRegionSizes] = useState<Record<InitBlockId, InitBlockSize>>(() => scaledPpa3Sizes(1))
  const [areaPercent, setAreaPercent] = useState(100)
  const [selectedInstances, setSelectedInstances] = useState<Set<number>>(() => new Set())
  const [initRevision, setInitRevision] = useState(0)
  const [aiEnabled, setAiEnabled] = useState(false)
  const [autoReplace, setAutoReplace] = useState(true)
  const [speed, setSpeed] = useState(20)
  const [stdFillCount, setStdFillCount] = useState(0)
  const [searchPasses, setSearchPasses] = useState(0)
  const [finalCandidate, setFinalCandidate] = useState(false)
  const [candidateIndex, setCandidateIndex] = useState(1)
  const [candidateResults, setCandidateResults] = useState<CandidateResult[]>([])
  const [candidateRecorded, setCandidateRecorded] = useState(false)
  const [generation, setGeneration] = useState(1)
  const [champion, setChampion] = useState<CandidateResult | null>(null)
  const [stagnantGenerations, setStagnantGenerations] = useState(0)
  const [failedAttempts, setFailedAttempts] = useState(0)
  const [savedCandidates, setSavedCandidates] = useState<CandidateResult[]>(loadSavedCandidates)
  const lastReplaceAt = useRef(0)
  const [best, setBest] = useState(() => Number(localStorage.getItem('chip-tetris-best') ?? 0))
  const plan = useMemo(() => chooseAiPlan(game), [game])
  const metrics = useMemo(() => measureBoard(game.board), [game.board])
  const precheck = useMemo(() => preSignoffReport(game.board), [game.board])
  const stdCellCandidates = useMemo(() => {
    const cells: Array<{ x: number; y: number; subX: number; subY: number }> = []
    game.board.forEach((row, y) => row.forEach((cell, x) => {
      if (cell) return
      for (let subY = 0; subY < STD_SUBDIVISIONS; subY += 1) {
        for (let subX = 0; subX < STD_SUBDIVISIONS; subX += 1) cells.push({ x, y, subX, subY })
      }
    }))
    return cells.sort((a, b) =>
      (b.y * STD_SUBDIVISIONS + b.subY) - (a.y * STD_SUBDIVISIONS + a.subY)
      || Math.abs(a.x * STD_SUBDIVISIONS + a.subX - (BOARD_COLS * STD_SUBDIVISIONS - 1) / 2)
        - Math.abs(b.x * STD_SUBDIVISIONS + b.subX - (BOARD_COLS * STD_SUBDIVISIONS - 1) / 2)
      || a.x - b.x
      || a.subX - b.subX,
    )
  }, [game.board])
  const stdFillTarget = Math.ceil(stdCellCandidates.length * STD_CELL_LEFTOVER_FILL_RATIO)
  const standardCellsDone = game.floorplanReady && stdFillCount >= stdFillTarget
  const stdFillDone = standardCellsDone && finalCandidate
  const filledStdCells = useMemo(() => new Set(stdCellCandidates.slice(0, stdFillCount).map(({ x, y, subX, subY }) => `${x}:${y}:${subX}:${subY}`)), [stdCellCandidates, stdFillCount])
  const placedInstances = useMemo(() => {
    const values = new Map<number, BlockCell>()
    game.board.forEach(row => row.forEach(cell => { if (cell && cell.instance > 0) values.set(cell.instance, cell) }))
    return [...values.entries()].sort(([a], [b]) => a - b)
  }, [game.board])
  const remainingRequired = game.floorplanReady ? [] : [game.active.id, ...game.queue]
  const futurePlacementStages = [
    { id: 'std-cells', label: 'STD CELLS', detail: `${STD_GRID_UM}µm sub-grid · 실측 7.8%`, done: standardCellsDone },
    { id: 'replace', label: 'RE-PLACE', detail: 'rip-up 이동', done: searchPasses > 0 || finalCandidate },
    { id: 'sa', label: 'SA SEARCH', detail: 'local 탈출', done: finalCandidate },
    { id: 'score', label: 'CANDIDATE SCORE', detail: `G${generation} #${candidateIndex}`, done: candidateRecorded },
  ]

  const advanceSearch = useCallback((completedResults: CandidateResult[]) => {
    setStdFillCount(0)
    setSearchPasses(0)
    setFinalCandidate(false)
    setCandidateRecorded(false)
    lastReplaceAt.current = 0

    if (candidateIndex < CANDIDATE_COUNT) {
      const nextIndex = candidateIndex + 1
      const nextSeed = (generation - 1) * CANDIDATE_COUNT + candidateIndex
      const parentPool = [champion, ...savedCandidates].filter((item): item is CandidateResult => Boolean(item))
      const parent = parentPool.length ? parentPool[nextSeed % Math.min(parentPool.length, 8)] : null
      if (parent && nextIndex <= 5) dispatch({ type: 'mutate', state: parent.state, seed: nextSeed })
      else dispatch({ type: 'candidate', seed: nextSeed })
      setCandidateIndex(nextIndex)
      setRunning(true)
      return
    }

    const pool = champion ? [champion, ...completedResults] : completedResults
    const winner = [...pool].sort((a, b) => b.score - a.score || a.violations - b.violations)[0]
    if (winner) {
      const improved = !champion || winner.score > champion.score
      setChampion(winner)
      setStagnantGenerations(value => improved ? 0 : value + 1)
    }

    const nextGeneration = generation + 1
    const nextSeed = (nextGeneration - 1) * CANDIDATE_COUNT
    const diverseParents = [winner, ...savedCandidates.filter(item => item.savedAt !== winner?.savedAt)]
      .filter((item): item is CandidateResult => Boolean(item))
      .slice(0, 8)
    const nextParent = diverseParents.length ? diverseParents[nextGeneration % diverseParents.length] : null
    setGeneration(nextGeneration)
    setCandidateIndex(1)
    setCandidateResults([])
    if (nextParent && stagnantGenerations < 3) dispatch({ type: 'mutate', state: nextParent.state, seed: nextSeed })
    else dispatch({ type: 'candidate', seed: nextSeed })
    setRunning(true)
  }, [candidateIndex, champion, generation, savedCandidates, stagnantGenerations])

  useEffect(() => {
    const available = new Set(placedInstances.map(([instance]) => instance))
    setSelectedInstances(current => new Set([...current].filter(instance => available.has(instance))))
  }, [placedInstances])

  useEffect(() => {
    if (!champion && savedCandidates.length) setChampion(savedCandidates[0])
  }, [champion, savedCandidates])

  useEffect(() => {
    if (!running || game.gameOver || stdFillDone) return
    const timer = window.setInterval(() => {
      if (game.floorplanReady) {
        if (!standardCellsDone) {
          setStdFillCount(stdFillTarget)
        } else if (!finalCandidate && searchPasses === 0) {
          setSearchPasses(1)
          dispatch({ type: 'hybrid' })
        }
        return
      }
      if (!aiEnabled) return
      if (autoReplace && game.placements - lastReplaceAt.current >= 6) {
        lastReplaceAt.current = game.placements
        dispatch({ type: 'replace' })
      } else dispatch({ type: 'ai' })
    }, aiEnabled ? speed : Math.max(140, 850 - game.level * 55))
    return () => window.clearInterval(timer)
  }, [aiEnabled, autoReplace, finalCandidate, game.floorplanReady, game.gameOver, game.level, game.placements, running, searchPasses, speed, standardCellsDone, stdFillDone, stdFillTarget])

  useEffect(() => {
    if (game.floorplanReady && searchPasses > 0 && game.lastEvent.startsWith('Hybrid complete')) setFinalCandidate(true)
  }, [game.floorplanReady, game.lastEvent, searchPasses])

  useEffect(() => {
    if (!running || !aiEnabled || !game.gameOver) return
    setFailedAttempts(value => value + 1)
    advanceSearch(candidateResults)
  }, [advanceSearch, aiEnabled, candidateResults, game.gameOver, running])

  useEffect(() => {
    if (!stdFillDone || candidateRecorded) return
    const result: CandidateResult = {
      generation,
      index: candidateIndex,
      profile: `${generation > 1 && candidateIndex <= 4 ? 'ELITE 변형' : 'RANDOM 시작'} · ${candidateProfiles[game.candidateSeed % candidateProfiles.length]}`,
      score: Math.round(100000 + evaluatePlacement(game.board) * 100),
      violations: metrics.violations,
      congestion: metrics.congestion,
      replacements: game.replacements,
      savedAt: Date.now(),
      state: game,
    }
    if (result.violations > 0) {
      setFailedAttempts(value => value + 1)
      setCandidateRecorded(true)
      advanceSearch(candidateResults)
      return
    }
    const updated = [...candidateResults, result]
    setCandidateResults(updated)
    setSavedCandidates(current => {
      const next = [result, ...current]
        .sort((a, b) => b.score - a.score || b.savedAt - a.savedAt)
        .slice(0, MAX_SAVED_CANDIDATES)
      localStorage.setItem(SAVED_CANDIDATES_KEY, JSON.stringify(next))
      return next
    })
    setCandidateRecorded(true)
    advanceSearch(updated)
  }, [advanceSearch, candidateRecorded, candidateResults, game, generation, metrics, stdFillDone])

  useEffect(() => {
    if (game.score <= best) return
    setBest(game.score)
    localStorage.setItem('chip-tetris-best', String(game.score))
  }, [best, game.score])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'p') { setRunning(value => !value); return }
      if (selectedInstances.size && !running) {
        const groupMoves: Record<string, readonly [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
        const delta = groupMoves[event.key]
        if (delta) { event.preventDefault(); dispatch({ type: 'move-group', instances: [...selectedInstances], dx: delta[0], dy: delta[1] }); return }
      }
      if (aiEnabled || !running) return
      const actions: Record<string, SimpleActionType> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'down', ArrowUp: 'rotate', ' ': 'place', c: 'hold', C: 'hold' }
      const type = actions[event.key]
      if (type) { event.preventDefault(); dispatch({ type }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [aiEnabled, running, selectedInstances])

  const previewBlock: ActiveBlock = aiEnabled && plan ? { id: plan.id, rotation: plan.rotation, x: plan.x, y: plan.y } : game.active
  const activeCells = useMemo(() => game.floorplanReady ? new Map<string, BlockCell>() : new Map(cellsFor(previewBlock).map(([x, y]) => [`${x}:${y}`, { id: previewBlock.id, category: BLOCKS[previewBlock.id].category, instance: -1 } as BlockCell])), [game.floorplanReady, previewBlock.id, previewBlock.rotation, previewBlock.x, previewBlock.y])
  const instanceBounds = useMemo(() => {
    const bounds = new Map<number, { minX: number; minY: number; maxX: number; maxY: number }>()
    game.board.forEach((row, y) => row.forEach((cell, x) => {
      if (!cell) return
      const current = bounds.get(cell.instance)
      if (current) {
        current.minX = Math.min(current.minX, x)
        current.minY = Math.min(current.minY, y)
        current.maxX = Math.max(current.maxX, x)
        current.maxY = Math.max(current.maxY, y)
      } else bounds.set(cell.instance, { minX: x, minY: y, maxX: x, maxY: y })
    }))
    return bounds
  }, [game.board])
  const activeBounds = useMemo(() => {
    const points = cellsFor(previewBlock)
    return {
      minX: Math.min(...points.map(([x]) => x)),
      minY: Math.min(...points.map(([, y]) => y)),
      maxX: Math.max(...points.map(([x]) => x)),
      maxY: Math.max(...points.map(([, y]) => y)),
    }
  }, [previewBlock])
  const cellAt = (x: number, y: number) => activeCells.get(`${x}:${y}`) ?? game.board[y][x]
  const stepAi = () => {
    if (!game.floorplanReady) { dispatch({ type: 'ai' }); return }
    if (!standardCellsDone) { setStdFillCount(stdFillTarget); return }
    if (!finalCandidate && searchPasses === 0) { setSearchPasses(1); dispatch({ type: 'hybrid' }) }
  }
  const reset = () => { lastReplaceAt.current = 0; setStdFillCount(0); setSearchPasses(0); setFinalCandidate(false); setCandidateIndex(1); setCandidateResults([]); setCandidateRecorded(false); setGeneration(1); setChampion(null); setStagnantGenerations(0); setFailedAttempts(0); setSelectedInstances(new Set()); dispatch({ type: 'reset' }); setAiEnabled(false); setRunning(false) }
  const startAi = () => {
    setAiEnabled(true)
    setRunning(true)
  }

  const appliedSizes = useMemo(() => getBlockSizes(), [initRevision])
  const requiredGridCells = initBlocks.reduce((sum, { id }) => sum + Math.ceil(sizeDraft[id].widthUm / GRID_UM) * Math.ceil(sizeDraft[id].heightUm / GRID_UM), 0)
  const availableGridCells = Math.max(0, BOARD_COLS * BOARD_ROWS - requiredGridCells)
  const estimatedStdBlocks = Math.ceil(availableGridCells * STD_SUBDIVISIONS * STD_SUBDIVISIONS * STD_CELL_LEFTOVER_FILL_RATIO)
  const estimatedTotalBlocks = TOTAL_REQUIRED_BLOCKS + estimatedStdBlocks
  const updateSize = (id: InitBlockId, key: 'widthUm' | 'heightUm', value: number) => setSizeDraft(current => {
    if (BLOCKS[id].physicalKind !== 'neighbor-region') return { ...current, [id]: { ...current[id], [key]: value } }
    const areaCells = Math.max(1, Math.round(current[id].widthUm / STD_GRID_UM) * Math.round(current[id].heightUm / STD_GRID_UM))
    const requestedCells = Math.max(1, Math.round(value / STD_GRID_UM))
    const factors = Array.from({ length: areaCells }, (_, index) => index + 1)
      .filter(candidate => areaCells % candidate === 0)
      .filter(candidate => candidate * STD_GRID_UM <= (key === 'widthUm' ? DIE_WIDTH_UM : DIE_HEIGHT_UM))
      .filter(candidate => areaCells / candidate * STD_GRID_UM <= (key === 'widthUm' ? DIE_HEIGHT_UM : DIE_WIDTH_UM))
    const selected = factors.sort((a, b) => Math.abs(a - requestedCells) - Math.abs(b - requestedCells))[0] ?? 1
    const paired = areaCells / selected
    return {
      ...current,
      [id]: key === 'widthUm'
        ? { widthUm: selected * STD_GRID_UM, heightUm: paired * STD_GRID_UM }
        : { widthUm: paired * STD_GRID_UM, heightUm: selected * STD_GRID_UM },
    }
  })
  const setAreaScale = (value: number) => {
    const next = Math.max(1, Math.min(100, Math.round(value)))
    setAreaPercent(next)
    setSizeDraft(scaledPpa3Sizes(next / 100))
  }
  const applyInitialization = () => {
    configureBlockSizes(Object.fromEntries(initBlocks.map(({ id }) => [id, { width: Math.ceil(sizeDraft[id].widthUm / GRID_UM), height: Math.ceil(sizeDraft[id].heightUm / GRID_UM) }])))
    setAppliedRegionSizes(structuredClone(sizeDraft))
    setInitRevision(value => value + 1)
    reset()
  }
  const togglePlacedInstance = (instance: number) => {
    if (instance <= 0) return
    setRunning(false)
    setSelectedInstances(current => {
      const next = new Set(current)
      if (next.has(instance)) next.delete(instance)
      else next.add(instance)
      return next
    })
  }
  const moveGroup = (dx: number, dy: number) => dispatch({ type: 'move-group', instances: [...selectedInstances], dx, dy })

  return <div className="chip-tetris-page">
    <section className="chip-game-hero">
      <div><small>EMPTY-SPACE FILL · FUNCTION CLUSTERING · REPLACE → SA</small><h2>AI Chip Tetris</h2><p>블록을 위에서 떨어뜨리지 않고 모든 legal 빈 공간을 직접 탐색해 채웁니다. legal 후보는 자동 저장하고, 실패한 seed는 건너뛰며 Pause할 때까지 새 후보를 계속 탐색합니다.</p></div>
      <div className={`ai-status ${running && aiEnabled ? 'live' : ''}`}><i/><span>{game.gameOver && running ? `RETRYING · FAILED ${failedAttempts + 1}` : !running ? 'PRESS AI START' : !game.floorplanReady ? game.placements < 2 ? `G${generation} · ${candidateIndex}/8 · MACROS` : `G${generation} · ${candidateIndex}/8 · STD REGIONS` : !standardCellsDone ? `G${generation} · ${candidateIndex}/8 · STD CELLS` : `G${generation} · ${candidateIndex}/8 · FINAL SEARCH`}</span></div>
    </section>

    <ActualLayoutFlow/>

    <section className="chip-init-panel">
      <div className="chip-card-title"><div><small>PPA3 INITIALIZATION</small><h3>크기·블록 수 초기화</h3></div><span>{DIE_WIDTH_UM}×{DIE_HEIGHT_UM} µm · grid {GRID_UM} µm</span></div>
      <div className="init-facts">
        <div><span>필수 블록</span><b>5</b><small>hard macro 2 + 이웃 region 3</small></div>
        <div><span>예상 STD 조각</span><b>{estimatedStdBlocks}</b><small>{STD_GRID_UM}×{STD_GRID_UM} µm · 빈 영역 실측 7.8%</small></div>
        <div><span>예상 총 블록</span><b>{estimatedTotalBlocks}</b><small>필수 5 + STD cluster</small></div>
        <div><span>배치 격자</span><b>{GRID_UM} / {STD_GRID_UM} µm</b><small>macro / STD sub-grid</small></div>
      </div>
      <div className="init-presets area-percent-control"><button onClick={() => setAreaScale(100)} disabled={running}>PPA3 실제값 · 100%</button><div className="area-stepper"><button aria-label="면적 1% 감소" onClick={() => setAreaScale(areaPercent - 1)} disabled={running || areaPercent <= 1}>−</button><label><span>기준 면적</span><input type="number" min="1" max="100" step="1" value={areaPercent} disabled={running} onChange={event => setAreaScale(Number(event.target.value))}/><b>%</b></label><button aria-label="면적 1% 증가" onClick={() => setAreaScale(areaPercent + 1)} disabled={running || areaPercent >= 100}>+</button></div><small>1~100% · 1% 단위 · aspect ratio 유지</small></div>
      <div className="init-size-grid">
        <div className="init-size-head"><span>Block</span><span>Width µm</span><span>Height µm</span><span>적용 격자</span></div>
        {initBlocks.map(({ id, name, source }) => {
          const stdRegion = BLOCKS[id].physicalKind === 'neighbor-region'
          const unit = stdRegion ? STD_GRID_UM : GRID_UM
          const maxWidth = DIE_WIDTH_UM
          const maxHeight = DIE_HEIGHT_UM
          return <div className="init-size-row" key={id}><label><b>{name}</b><small>{source}</small></label><input type="number" min={unit} max={maxWidth} step={unit} value={sizeDraft[id].widthUm} disabled={running} onChange={event => updateSize(id, 'widthUm', Number(event.target.value))}/><input type="number" min={unit} max={maxHeight} step={unit} value={sizeDraft[id].heightUm} disabled={running} onChange={event => updateSize(id, 'heightUm', Number(event.target.value))}/><span>{stdRegion ? `${sizeDraft[id].widthUm / STD_GRID_UM}×${sizeDraft[id].heightUm / STD_GRID_UM} sub-grid · 면적 ${(sizeDraft[id].widthUm * sizeDraft[id].heightUm).toLocaleString()} µm² 고정` : `${Math.ceil(sizeDraft[id].widthUm / GRID_UM)}×${Math.ceil(sizeDraft[id].heightUm / GRID_UM)} macro grid`} · 예약 {appliedSizes[id].width}×{appliedSizes[id].height}</span></div>
        })}
      </div>
      <div className="init-actions"><p><b>면적 비율 조절:</b> PPA3 실제 면적의 1~100%를 선택합니다. 블록 수와 aspect ratio는 그대로이며 가로·세로에 동일하게 √(면적 비율)을 적용합니다. 격자 올림 후에는 작은 오차가 생길 수 있습니다.</p><button onClick={applyInitialization} disabled={running || requiredGridCells > BOARD_COLS * BOARD_ROWS}>이 값으로 초기화</button></div>
      {requiredGridCells > BOARD_COLS * BOARD_ROWS && <p className="init-error">필수 블록 면적이 다이 격자 {BOARD_COLS * BOARD_ROWS}개를 초과했습니다. 크기를 줄여야 합니다.</p>}
    </section>

    <section className="chip-scorebar">
      <div><span>SCORE</span><b>{game.score.toLocaleString()}</b></div><div><span>BEST</span><b>{best.toLocaleString()}</b></div><div><span>GEN / CANDIDATE</span><b>{generation} · {candidateIndex}/{CANDIDATE_COUNT}</b></div><div><span>PRE-SIGNOFF</span><b className={precheck.confidence >= 90 ? 'pass' : 'warn'}>{precheck.confidence}%</b></div><div><span>REQUIRED / RE-PLACE</span><b>{game.placements} / {TOTAL_REQUIRED_BLOCKS} · {game.replacements}</b></div><div><span>RULE FLAGS</span><b className={metrics.violations ? 'warn' : 'pass'}>{metrics.violations}</b></div>
    </section>

    <section className="chip-game-layout">
      <div className="chip-board-wrap">
        <div className="zone-headings"><span>ANALOG<br/>ISLAND</span><span>DIGITAL<br/>FABRIC</span><span>MEMORY<br/>BANKS</span></div>
        <div className="chip-board" style={{ '--cols': BOARD_COLS, '--rows': BOARD_ROWS } as CSSProperties} role="grid" aria-label="AI chip tetris board">
          {Array.from({ length: BOARD_ROWS * BOARD_COLS }, (_, index) => {
            const x = index % BOARD_COLS, y = Math.floor(index / BOARD_COLS), cell = cellAt(x, y)
            const zone = x < Math.floor(BOARD_COLS * 0.32) ? 'analog-zone' : x >= Math.floor(BOARD_COLS * 0.6) ? 'memory-zone' : 'digital-zone'
            const active = activeCells.has(`${x}:${y}`)
            const standardCellSlots = game.floorplanReady && !cell
              ? Array.from({ length: STD_SUBDIVISIONS * STD_SUBDIVISIONS }, (_, subIndex) => {
                  const subX = subIndex % STD_SUBDIVISIONS
                  const subY = Math.floor(subIndex / STD_SUBDIVISIONS)
                  return filledStdCells.has(`${x}:${y}:${subX}:${subY}`)
                })
              : []
            const standardCell = standardCellSlots.some(Boolean)
            const standardCellOpen = game.floorplanReady && !cell
            const selected = Boolean(cell && selectedInstances.has(cell.instance))
            const cellStyle = cell ? { '--block-color': BLOCKS[cell.id].color } as CSSProperties : undefined
            const regionSize = cell && BLOCKS[cell.id].physicalKind === 'neighbor-region' ? appliedRegionSizes[cell.id as InitBlockId] : null
            const bounds = cell?.instance === -1 ? activeBounds : cell ? instanceBounds.get(cell.instance) : undefined
            const configuredCols = regionSize ? Math.ceil(regionSize.widthUm / GRID_UM) : 0
            const boundsWidth = bounds ? bounds.maxX - bounds.minX + 1 : 0
            const boundsHeight = bounds ? bounds.maxY - bounds.minY + 1 : 0
            const expectedRatio = regionSize ? regionSize.widthUm / regionSize.heightUm : 1
            const boundsRatio = boundsHeight ? boundsWidth / boundsHeight : expectedRatio
            const rotated = Boolean(regionSize && Math.abs(Math.log(boundsRatio / (1 / expectedRatio))) < Math.abs(Math.log(boundsRatio / expectedRatio)))
            const regionCols = regionSize ? Math.round((rotated ? regionSize.heightUm : regionSize.widthUm) / STD_GRID_UM) : 0
            const regionRows = regionSize ? Math.round((rotated ? regionSize.widthUm : regionSize.heightUm) / STD_GRID_UM) : 0
            const localTileX = bounds ? x - bounds.minX : 0
            const localTileY = bounds ? y - bounds.minY : 0
            const regionSlots = regionSize ? Array.from({ length: STD_SUBDIVISIONS * STD_SUBDIVISIONS }, (_, subIndex) => {
              const subX = subIndex % STD_SUBDIVISIONS
              const subY = Math.floor(subIndex / STD_SUBDIVISIONS)
              return localTileX * STD_SUBDIVISIONS + subX < regionCols && localTileY * STD_SUBDIVISIONS + subY < regionRows
            }) : []
            return <div key={index} role="gridcell" onClick={() => cell && togglePlacedInstance(cell.instance)} className={`chip-cell ${zone} ${cell ? `filled ${cell.category} ${BLOCKS[cell.id].physicalKind}` : ''} ${selected ? 'group-selected' : ''} ${active ? game.placements < 2 ? 'macro-preview' : 'gap-fill' : ''} ${standardCell ? 'std-cell-fill' : ''} ${standardCellOpen ? 'std-cell-open' : ''}`} style={cellStyle} title={cell ? `${BLOCKS[cell.id].label} · #${cell.instance} · ${regionSize ? `${regionSize.widthUm}×${regionSize.heightUm} µm` : 'macro'} · 클릭하여 그룹 선택` : standardCell ? `Placed ${STD_GRID_UM}µm standard-cell clusters` : standardCellOpen ? `Available ${STD_GRID_UM}µm standard-cell sub-grid` : `${zone.replace('-', ' ')} empty`}>{regionSize ? <><span className="neighbor-subcell-grid" aria-hidden="true">{regionSlots.map((occupied, subIndex) => <i key={subIndex} className={occupied ? 'occupied' : ''}/>)}</span>{localTileX === 0 && localTileY === 0 && <b className="neighbor-region-label">{BLOCKS[cell!.id].label}</b>}</> : cell ? <span>{BLOCKS[cell.id].label}</span> : standardCellOpen ? <span className="std-subcell-grid" aria-hidden="true">{standardCellSlots.map((filled, subIndex) => <i key={subIndex} className={filled ? 'placed' : ''}/>)}</span> : null}</div>
          })}
          {game.gameOver && running && <div className="game-over"><b>AUTO RETRY</b><span>이 seed는 legal 배치를 만들지 못했습니다. 저장된 후보는 유지하고 다음 후보를 자동 탐색합니다.</span></div>}
        </div>
      </div>

      <aside className="chip-control-panel">
        <section className="placed-group-editor"><div className="placed-group-head"><div><span className="panel-label">MANUAL GROUP MOVE</span><b>{selectedInstances.size}개 블록 선택</b></div><div><button onClick={() => setSelectedInstances(new Set(placedInstances.map(([instance]) => instance)))} disabled={!placedInstances.length}>전체</button><button onClick={() => setSelectedInstances(new Set())} disabled={!selectedInstances.size}>해제</button></div></div><div className="placed-instance-list">{placedInstances.map(([instance, cell]) => <button key={instance} className={selectedInstances.has(instance) ? 'selected' : ''} onClick={() => togglePlacedInstance(instance)}><BlockShape id={cell.id} compact physicalSize={BLOCKS[cell.id].physicalKind === 'neighbor-region' ? appliedRegionSizes[cell.id as InitBlockId] : undefined}/><span>#{instance} {BLOCKS[cell.id].label}</span></button>)}</div><div className="group-move-pad"><span/><button onClick={() => moveGroup(0, -1)} disabled={!selectedInstances.size}>↑</button><span/><button onClick={() => moveGroup(-1, 0)} disabled={!selectedInstances.size}>←</button><button className="center" disabled>{GRID_UM}µm</button><button onClick={() => moveGroup(1, 0)} disabled={!selectedInstances.size}>→</button><span/><button onClick={() => moveGroup(0, 1)} disabled={!selectedInstances.size}>↓</button><span/></div><small>보드에서 여러 블록을 클릭한 뒤 함께 이동합니다. 상대 배치는 유지되며 경계·충돌 시 이동하지 않습니다.</small></section>
        <div className="next-grid"><div><span>{!game.floorplanReady ? game.placements < 2 ? 'MACRO' : 'STD REGION' : !standardCellsDone ? 'STD CELLS' : 'SEARCH PASS'}</span>{game.floorplanReady ? <div className="chip-mini"><b>{!standardCellsDone ? `${stdFillCount}/${stdFillTarget}` : searchPasses}</b><small>{!standardCellsDone ? 'PLACING' : finalCandidate ? 'CONVERGED' : 'SEARCHING'}</small></div> : <MiniBlock id={game.active.id} physicalSize={BLOCKS[game.active.id].physicalKind === 'neighbor-region' ? appliedRegionSizes[game.active.id as InitBlockId] : undefined}/>}</div><div><span>CANDIDATE PROFILE</span><div className="chip-mini"><b>G{generation} #{candidateIndex} · {candidateProfiles[game.candidateSeed % candidateProfiles.length]}</b><small>ELITE {champion ? champion.score.toLocaleString() : 'NONE'} · SAVED {savedCandidates.length} · FAILED {failedAttempts}</small></div></div></div>
        <div className="full-next-queue"><span className="panel-label">ALL REMAINING PLACEMENT</span><div className="next-row all-items">{remainingRequired.map((id, index) => <div className={`queued-block ${index === 0 ? 'current' : ''}`} key={`${id}-${index}`}><em>{index === 0 ? 'NOW' : `NEXT ${index}`}</em><MiniBlock id={id} physicalSize={BLOCKS[id].physicalKind === 'neighbor-region' ? appliedRegionSizes[id as InitBlockId] : undefined}/></div>)}{futurePlacementStages.map((stage, index) => <div className={`queued-stage ${stage.done ? 'done' : !game.floorplanReady && index === 0 ? 'waiting' : ''}`} key={stage.id}><em>{stage.done ? 'DONE' : `STEP ${remainingRequired.length + index + 1}`}</em><b>{stage.label}</b><small>{stage.detail}</small></div>)}</div><small className="queue-note">현재 블록부터 필수 영역, 표준셀 채우기, Re-place, SA, 후보 평가까지 모두 표시합니다.</small></div>
        <div className="placement-progress">{PLACEMENT_SEQUENCE.map((id, index) => <div key={id} className={index < game.placements ? 'done' : index === game.placements && !game.floorplanReady ? 'current' : ''}><i>{index < game.placements ? '✓' : index + 1}</i><span>{BLOCKS[id].label}</span><small>{index < 2 ? 'MACRO' : 'STD REGION'}</small></div>)}</div>
        {(champion || savedCandidates.length > 0) && <div className="candidate-results">{champion && <div className="winner"><b>ELITE</b><span>G{champion.generation} #{champion.index}</span><strong>{champion.score.toLocaleString()}</strong><small>현재 실행 최고</small></div>}{savedCandidates.slice(0, 7).map(result => <div key={result.savedAt}><b>G{result.generation}</b><span>#{result.index} · {result.profile}</span><strong>{result.score.toLocaleString()}</strong><small>LEGAL · C{result.congestion}</small></div>)}</div>}
        <div className="ai-decision"><span className="panel-label">NOW / NEXT</span>{game.gameOver && running ? <><b>illegal 후보 자동 폐기</b><p>저장된 legal 후보는 유지한 채 다음 seed로 즉시 넘어갑니다.</p></> : game.floorplanReady ? !standardCellsDone ? <><b>후보 #{candidateIndex} · 표준셀 자동 배치</b><p>{stdFillCount}/{stdFillTarget} · 목표 이용률 실측 7.8%</p></> : <><b>후보 #{candidateIndex} · 최종 탐색 pass {searchPasses + 1}</b><p>Replace→SA로 탐색하고, legal 후보를 저장한 뒤 다음 후보를 계속 만듭니다.</p></> : plan ? <><b>{running ? '배치 중' : '대기 중'} · {BLOCKS[plan.id].label} → ({plan.x + 1}, {plan.y + 1})</b><p>{game.placements < 2 ? '매크로를 하나씩 완료합니다.' : '매크로 완료 후 표준셀 이웃 영역을 직접 배치합니다.'}</p></> : <b>legal move 없음</b>}<small>{running ? game.lastEvent : 'AI START를 누르면 저장된 후보를 유지하며 탐색을 계속합니다.'}</small></div>
        <div className="chip-switches"><button className={running && aiEnabled ? 'active' : ''} onClick={startAi}>{running && aiEnabled ? 'FAST EVOLUTION' : 'START EVOLUTION'}</button><button className="active replace" disabled>REPLACE → SA</button><button onClick={() => setRunning(false)} disabled={!running}>Pause</button><button onClick={stepAi} disabled={game.gameOver}>AI step</button><button onClick={() => dispatch({ type: 'replace' })} disabled={game.gameOver || game.placements < 2}>Re-place now</button><button onClick={reset}>Reset</button></div>
        <label className="speed-control">빠른 자동 간격 <input type="range" min="10" max="200" step="10" value={speed} onChange={event => setSpeed(Number(event.target.value))}/><b>{speed} ms</b></label>
        <p className="key-help"><b>Continuous evolution:</b> 저장된 상위 후보를 번갈아 변형하고 정체되면 랜덤 시작으로 탐색 영역을 넓힙니다. legal 후보는 상위 {MAX_SAVED_CANDIDATES}개까지 브라우저에 저장되며, 실패해도 Restart 없이 다음 seed를 계속 탐색합니다.</p>
      </aside>
    </section>

    <section className="chip-analysis-grid">
      <article className="chip-card"><div className="chip-card-title"><div><small>SIGNAL TO MEMORY</small><h3>Analog + memory 구조</h3></div><span>32-bit × 4096</span></div><div className="signal-chain">{architecture.map(([category, name, detail], index) => <div key={name} className={category}><i>{index + 1}</i><b>{name}</b><small>{detail}</small></div>)}</div><p className="chip-note">ADC 변환값은 FIFO로 clock-domain crossing 후 4K×32 SRAM에 순환 저장됩니다. 특정 시점의 <code>read_req</code>가 오면 read DMA가 지정 주소부터 스트림으로 전송합니다.</p></article>
      <article className="chip-card"><div className="chip-card-title"><div><small>HEURISTIC SEARCH</small><h3>AI가 하는 일</h3></div><span>빈 공간 전수 평가</span></div><ol className="strategy-list"><li><b>모든 빈 좌표 후보 생성</b><span>중력이나 낙하 경로 없이 legal한 (x, y) 영역을 직접 탐색</span></li><li><b>같은 기능군 응집</b><span>analog끼리, digital끼리, memory 관련 블록끼리 가까울수록 높은 점수</span></li><li><b>신호 경로 단축</b><span>ADC→CDC와 capture control→SRAM의 필수 이웃 관계를 유지</span></li><li><b>자동 rip-up &amp; re-place</b><span>기존 블록을 빈 공간으로 다시 옮겨 비용이 실제 개선될 때만 채택</span></li><li><b>최고 점수 배치 실행</b><span>빈 공간을 직접 채우고 Replace→SA로 수렴</span></li></ol></article>
      <article className="chip-card"><div className="chip-card-title"><div><small>PRE-SIGNOFF PROXY</small><h3>후보 사전 검사</h3></div><span>{precheck.confidence}% confidence</span></div><div className="precheck-gates"><span className={precheck.hardDrcClean ? 'clean' : 'risk'}>Boundary / overlap <b>{precheck.hardDrcClean ? 'CLEAN' : 'RISK'}</b></span><span className={precheck.zoneClean ? 'clean' : 'risk'}>Voltage / macro zone <b>{precheck.zoneClean ? 'CLEAN' : 'RISK'}</b></span><span className={precheck.spacingClean ? 'clean' : 'risk'}>Keep-out / spacing <b>{precheck.spacingClean ? 'CLEAN' : 'RISK'}</b></span><span className={precheck.powerAccessible ? 'clean' : 'risk'}>Power stripe access <b>{precheck.powerAccessible ? 'CLEAN' : 'RISK'}</b></span><span className={precheck.pinAccessible ? 'clean' : 'risk'}>Pin escape access <b>{precheck.pinAccessible ? 'CLEAN' : 'RISK'}</b></span><span className={precheck.structuralLvsClean ? 'clean' : 'risk'}>Structural LVS proxy <b>{precheck.structuralLvsClean ? 'CLEAN' : 'RISK'}</b></span><span className={precheck.routabilityRisk === 'low' ? 'clean' : 'risk'}>Routability risk <b>{precheck.routabilityRisk.toUpperCase()}</b></span></div><dl className="metric-list"><div><dt>Function cluster distance</dt><dd>{metrics.functionalClusterPenalty.toFixed(1)}</dd></div><div><dt>Internal holes</dt><dd>{metrics.holes}</dd></div><div><dt>Analog coupling</dt><dd>{metrics.isolationPenalty.toFixed(1)}</dd></div><div><dt>Macro spacing</dt><dd>{metrics.macroSpacingPenalty.toFixed(1)}</dd></div><div><dt>Power access</dt><dd>{metrics.powerAccessPenalty}</dd></div><div><dt>Pin access</dt><dd>{metrics.pinAccessPenalty}</dd></div><div><dt>Instance integrity</dt><dd>{metrics.integrityViolations}</dd></div></dl><p className="rule-disclaimer">실제 LVS는 추출 layout과 source netlist의 connectivity 비교가 필요합니다. 이 검사는 툴 실행 전에 실패 가능성을 줄이는 structural proxy이며 signoff를 보장하지 않습니다.</p></article>
    </section>
  </div>
}
