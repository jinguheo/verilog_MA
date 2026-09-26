// "매크로 테트리스" — daq_subsystem hierarchical 트랙의 매크로 배치 문제를
// 인터랙티브하게 보는 탭. 8개 chan_top 매크로는 언제든 마우스로 옮길 수
// 있고, AI(SA 연속 자동 진행 또는 RePlAce 스타일 즉시 정리)가 대신 배치할
// 수도 있다 — 게임처럼 조각을 큐에 가두고 커밋하는 방식이 아니라, 사람과
// AI가 같은 캔버스를 언제든 번갈아 만질 수 있는 뷰어.
//
// 2026-09-24 확장 이력 (시간순):
// - 단일 허브 대신 daq_subsystem.sv의 실제 per-channel 신호 그룹 3개
//   (dma_sched 데이터 경로, csr 제어, irq_ctrl/perf_cnt 상태)를 가중치
//   있는 넷으로 모델링.
// - 겹침(0건 허용)과는 별개로 최소 spacing DRC 위반, 그리드 래스터화 기반
//   배선 혼잡도 근사치를 추가하고 legality-first로 후보를 정렬.
// - SA(확률적) / RePlAce 스타일(결정론적 경사 완화 + 별도 합법화 단계)
//   두 알고리즘을 선택 가능하게 하고, 처음 버전의 RePlAce가 매번 겹침을
//   못 풀던 버그를 "전역 배치 → 합법화" 2단계로 재설계해 고침.
// - 큐 기반 "조각을 커밋하면 고정" 게임 루프를 한 번 시도했다가, 실제
//   요청("이미 배치된 것도 움직일 수 있어야 한다")에 맞게 되돌림 — 8개
//   전부 항상 드래그 가능한 연속 인터랙티브 모드로 정리.
// - "여기서 뽑은 후보가 실제 DRC/LVS 없이도 통과할 수준이면 좋겠다"는
//   요청에 맞춰 MIN_SPACING을 40→100µm로 올림 — 실제로 성공한
//   RUN_2026-09-23_12-48-47/config_hierarchical.json 격자 배치가 쓰는
//   최소 간격(100µm)과 같은 수준. 다만 이 모델은 매크로를 속이 빈
//   사각형으로만 다뤄서 핀 위치·PDN 정렬 같은 진짜 DRC 요인은 못 본다 —
//   "legal"은 "안전할 가능성이 높다"는 뜻이지 signoff 보장이 아니다.
// - 2026-09-25: AI Chip Tetris(ChipTetris.tsx/game/chipTetrisEngine.ts)에서
//   두 가지를 이 실제 매크로 배치로 옮겨왔다. (1) "전수 탐색 rip-up &
//   re-place" — 매크로를 하나씩 뽑아 100µm 격자의 모든 legal 위치를 평가해
//   실제로 비용이 낮아질 때만 옮기는 결정론적 솔버(chipTetrisEngine의
//   applyBestReplacement와 동일한 원리). "실제 실행 배치로 초기화 →
//   Rip-up & Re-place로 향상" 버튼으로 실제 config_hierarchical.json의
//   그리드 배치에서 바로 실행할 수 있다. (2) pin escape/power access를
//   새 비용 항으로 추가하고, chipTetrisEngine의 PreSignoffReport와 같은
//   형태의 체크리스트+confidence% 섹션을 추가 — legal(간격 위반 0건)해도
//   사방이 다른 매크로로 막혀 핀을 뺄 방향이 없거나 다이 가장자리/채널에서
//   너무 멀면 별도 risk로 표시된다. 결과를 실제 config_hierarchical.json
//   형식(MACROS.chan_top.instances)으로 내보내는 기능도 추가했다 —
//   PnrResearch.tsx의 hierarchicalTodo "ParSAC 출력 → MACRO_PLACEMENT_CFG
//   변환" 단계와 같은 다리 역할.
// - 2026-09-25 (같은 날 이어서): 화면을 AI Chip Tetris와 같은 게임 레이아웃
//   (hero·scorebar·board+control panel·analysis grid)으로 재구성. 매크로를
//   고정 800×800 대신 매크로별 w/h를 가진 사각형으로 일반화해 크기 조절을
//   지원. "남은 영역이 표준셀을 넣기 좋게"를 위해 빈 격자 칸을 연결 성분으로
//   묶어 쓸만한/조각난 여유 공간으로 분류(analyzeLeftover)하고, 조각난 칸을
//   비용에 넣어 AI 솔버들이 이것까지 같이 최적화하게 했다. 표준셀 자체를
//   배치하는 단계는 아직 없다(지금은 8개 매크로만).
// - 2026-09-25 (이어서): 간격 0 맞닿음이 legal로 통과하던 버그 수정(그 전의
//   "실제→향상 −19.7%"는 이 버그 덕이었고, 수정 후엔 −6.7%). 순수 모델을
//   game/macroTetrisModel.ts로 분리하고 무거운 솔버는 game/macroTetrisWorker.ts
//   (Web Worker)에서 돌려 화면이 멈추지 않게 함. HARD/SOFT 매크로, 실제 LEF·
//   metrics 기반 크기·util 표시, 표준셀(glue) 타일 단계(baseline 라우팅 후
//   460,614µm²를 40% 밀도 300µm 타일 13개로), 빈 다이에서 하나씩 쌓는 자동
//   플레이 모드를 추가.
//
// 정직하게 선을 긋는 부분: 실제 TritonRoute 라우팅도, Magic/KLayout DRC도
// 아니다. 허브 위치는 실제 배선 경로가 아니라 신호 그룹의 전기적 중심
// 근사치다. 여기서 찾은 후보는 daq_subsystem/config_hierarchical_parsac.json
// 으로 만들어 실제 OpenLane 실행을 돌려야 최종 확정된다.
import { useEffect, useRef, useState } from 'react'
import { DIE_W, DIE_H, N, MIN_SPACING, MACRO_MIN_SIDE, MACRO_MAX_SIDE, REAL_CHAN_TOP, CORE_RATIO, UTIL_WARN, impliedUtil, hubDefs, N_HUBS, type Pos, type Macro, REAL_RUN_MACROS, MIXED_MACROS, REAL_RUN_HUBS, type Cost, type State, type Candidate, isLegal, compareCandidates, LO_CELL, LO_COLS, LO_ROWS, analyzeLeftover, cost, LEFTOVER_CLEAN_PCT, CHANNEL_SAFE_MARGIN, preSignoffProxy, mulberry32, cloneState, clampMacro, stepSA, type RipUpResult, ripUpReplace, remainingStillFit, referenceCandidate, toMacroPlacementCfg, REAL_GLUE, GLUE_TILE, GLUE_TILE_CAP, GLUE_TILES_NEEDED, GLUE_TILE_HUBS, type GlueTile, placeGlueTile, fillGlue, glueWirelength, bestMacroSpot, macrosSignature } from '../game/macroTetrisModel'
import type { ReplaceSAResult, SolverJob, SolverProgress, SolverRequest } from '../game/macroTetrisWorker'

type Glue = { tiles: GlueTile[]; sig: string }
// 쌓기 플레이 큐의 한 칸: 매크로 하나 또는 표준셀 타일 하나.
type PlayItem = { kind: 'macro'; macro: Macro; idx: number } | { kind: 'glue'; hub: number; idx: number }
type Play = { queue: PlayItem[]; pos: number; result: null | { ok: boolean; message: string } }

// 지금까지 찾은 최고 후보(legal 중 비용 최저)를 매크로 모양 구성별로 저장한다 —
// HARD×8과 혼합(SOFT 포함)은 서로 비교할 수 없는 문제라 따로 둔다.
// 간격 0 맞닿음 버그 수정 이후에 새로 시작하는 키(예전 BEST는 그 버그로 나온 값).
const BEST_CAND_KEY = 'macro-tetris-best-candidate-v1'
type SavedBest = { state: State; total: number; wl: number; leftover: number; foundAt: string; source: string }
function shapeSig(macros: Macro[]): string {
  return macros.map(m => `${Math.round(m.w)}x${Math.round(m.h)}${m.soft ? 'S' : 'H'}`).join(',')
}

// ---- 병렬 탐색 ----
type LaneMode = 'best' | 'random'
type Lane = { id: number; mode: LaneMode; jobs: number; wins: number; status: string; jobBest: number | null; improvedInJob: boolean }
type AttemptLog = { attempt: number; lane: number; mode: LaneMode; result: number | null; improved: boolean }
type SearchView = {
  running: boolean; budget: number; launched: number; attempts: number; startTotal: number
  best: { total: number; attempt: number | null; lane: number | null; mode: LaneMode | null }
  firstFoundAt: number | null; lastImproveAt: number; lanes: Lane[]; log: AttemptLog[]; done: string | null
}
const LANE_MODE_LABEL: Record<LaneMode, string> = { best: '최고에서 재시작', random: '처음부터 랜덤' }
// 개선을 하나도 못 찾은 동안은 '최대 시도' 입력을 무시하고 이 값까지 계속 돈다 —
// 브라우저를 진짜로 영원히 잡아두지 않기 위한 안전장치일 뿐, 평소엔 거의 닿지 않는다.
const SEARCH_SAFETY_CAP = 3000

const problemFacts = [
  ['다이 크기', '3700 × 2100 µm', 'daq_subsystem hierarchical 실행(config_hierarchical.json)에 실제로 쓰는 값'],
  ['매크로', 'chan_top × 8 — 전부 같은 GDS의 인스턴스, HARD 800×800 µm', 'chan_top.lef "SIZE 800.000 BY 800.000" (RUN_2026-09-23_12-48-47). daq_subsystem의 하드 매크로는 이 8개뿐'],
  ['chan_top 내부 실측', '다이 640,000 · 코어 613,701 · 셀 319,066 µm² (46,009셀, util 52%)', 'final/metrics.json의 design__die__area / core__area / instance__area__stdcell / instance__count / instance__utilization'],
  ['표준셀(glue) 면적', `라우팅 후 ${REAL_GLUE.cellArea.toLocaleString()} µm² (${REAL_GLUE.cellCount.toLocaleString()}셀) · 합성 직후 ${REAL_GLUE.synthArea.toLocaleString()} µm²`, '격자 baseline hierarchical_auto_20260924_142552의 design__instance__area__stdcell(탭셀·리페어/hold 버퍼 포함)과 06-yosys-synthesis/reports/stat.rpt'],
  ['표준셀 타일', `${GLUE_TILE}×${GLUE_TILE} µm × ${GLUE_TILES_NEEDED}개`, `PL_TARGET_DENSITY_PCT=40 → 타일당 ${GLUE_TILE_CAP.toLocaleString()} µm². 모듈별 면적은 flatten돼 없어서 전체를 타일로 나누고 허브 가중치(3:1:1)로 배분한 근사`],
  ['신호 그룹(넷)', 'dma_sched(가중치 3) · csr(1) · irq_perf(1)', 'daq_subsystem.sv의 실제 per-channel fan-out 배열을 3그룹으로 단순화'],
  ['최소 spacing', `${MIN_SPACING} µm`, '실제 성공한 config_hierarchical.json 격자 배치와 같은 수준 — "legal"이 실제 signoff 사례와 비슷한 여유를 의미하도록 맞춤'],
  ['배선 층', 'li1 ~ met5 (6개 라우팅 레이어)', 'chan_top 실제 실행의 RT_MIN_LAYER=met1 / RT_MAX_LAYER=met5 (+li1) — resolved.json에서 확인'],
] as const

// Sample Test 4의 실제 signoff 현황 — 2026-09-24 14:5x 기준 최신 확인.
const signoffStatus = [
  ['chan_top', '완료 · 5개 게이트 전부 clean', 'DRC 0 · LVS 0 · Antenna 0/0 · Setup ws +0.99ns(TNS 0) · Hold ws +0.125ns(TNS 0, 전 코너 위반 0건) — RUN_2026-09-23_12-48-47(final/metrics.json 직접 확인). 이 탭의 8개 매크로가 바로 이 완료된 블록', true],
  ['daq_subsystem (flat)', '진행 중 · worst-corner 부분 검증', 'RUN_2026-09-24_13-44-52, 지금 CTS 단계(34번) 라이브. `--to STAMidPNR-3` — 전체 signoff 아니고 배치 후 타이밍 우선 확인 범위', false],
  ['daq_subsystem (hierarchical, 이 탭의 실제 실행)', '진행 중 · 격자 배치 전체 실행', 'hierarchical_auto_20260924_142552, 지금 ResizerTimingPostCTS 단계(36번) 라이브. 1차 시도(자동배치 가정)는 PDN-0235로 실패 → 명시적 좌표로 수정 후 재실행 중 — "실제 실행" 후보 카드가 이 좌표', false],
] as const

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, state: State, c: Cost, highlightIdx: number | null, glue: GlueTile[] = []) {
  ctx.clearRect(0, 0, w, h)
  const sx = w / DIE_W, sy = h / DIE_H

  // 남은 영역 오버레이: 초록 = 표준셀을 넣기 좋은 여유 공간, 주황 = 조각나서
  // 쓰기 어려운 여유 공간. 매크로 사각형이 그 위에 덮인다.
  const leftover = analyzeLeftover(state.macros)
  for (let r = 0; r < LO_ROWS; r++) for (let col = 0; col < LO_COLS; col++) {
    const cls = leftover.cellClass[r * LO_COLS + col]
    if (cls === 0) continue
    ctx.fillStyle = cls === 1 ? 'rgba(29,158,117,0.22)' : 'rgba(230,120,78,0.55)'
    ctx.fillRect(col * LO_CELL * sx, r * LO_CELL * sy, LO_CELL * sx, LO_CELL * sy)
  }

  ctx.strokeStyle = '#B4B2A9'
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1)

  for (let hIdx = 0; hIdx < N_HUBS; hIdx++) {
    const hub = state.hubs[hIdx], def = hubDefs[hIdx]
    ctx.strokeStyle = def.color + '55'
    ctx.lineWidth = Math.max(1, def.weight)
    for (const m of state.macros) {
      const mcx = m.x + m.w / 2, mcy = m.y + m.h / 2
      ctx.beginPath()
      ctx.moveTo(hub.x * sx, hub.y * sy)
      ctx.lineTo(hub.x * sx, mcy * sy)
      ctx.lineTo(mcx * sx, mcy * sy)
      ctx.stroke()
    }
    ctx.fillStyle = def.color
    ctx.beginPath()
    ctx.arc(hub.x * sx, hub.y * sy, 4, 0, Math.PI * 2)
    ctx.fill()
  }

  state.macros.forEach((p, i) => {
    const baseFill = p.soft ? '#B9AEF0' : '#85B7EB'
    ctx.fillStyle = c.overlapPenalty > 0 ? '#F0997B' : (i === highlightIdx ? '#9FD8C2' : baseFill)
    ctx.fillRect(p.x * sx, p.y * sy, p.w * sx, p.h * sy)
    ctx.strokeStyle = i === highlightIdx ? '#E8C267' : (p.soft ? '#5B45B8' : '#185FA5')
    ctx.lineWidth = i === highlightIdx ? 2 : 1.2
    ctx.setLineDash(p.soft ? [4, 3] : [])
    ctx.strokeRect(p.x * sx, p.y * sy, p.w * sx, p.h * sy)
    ctx.setLineDash([])

    // 안쪽 점선 사각형 = 실제 chan_top 표준셀 면적(319,066µm²)을 같은 가로세로비로
    // 그린 것. 매크로보다 크면(활용률 >100%) 로직이 물리적으로 안 들어간다.
    const u = impliedUtil(p)
    const k = Math.min(1, Math.sqrt(REAL_CHAN_TOP.cellArea / (p.w * p.h)))
    const lw = p.w * k, lh = p.h * k
    ctx.strokeStyle = u > 1 ? '#C0392B' : u > UTIL_WARN ? '#E6784E' : '#0F6E56'
    ctx.setLineDash([3, 3])
    ctx.strokeRect((p.x + (p.w - lw) / 2) * sx, (p.y + (p.h - lh) / 2) * sy, lw * sx, lh * sy)
    ctx.setLineDash([])

    ctx.fillStyle = '#042C53'
    ctx.font = 'bold 10px sans-serif'
    ctx.fillText(`${i} ${p.soft ? 'SOFT' : 'HARD'}`, p.x * sx + 3, p.y * sy + 11)
    ctx.font = '9px sans-serif'
    ctx.fillText(`${Math.round(p.w)}×${Math.round(p.h)}µm`, p.x * sx + 3, p.y * sy + 21)
    ctx.fillStyle = u > 1 ? '#C0392B' : u > UTIL_WARN ? '#B5541F' : '#0F6E56'
    ctx.fillText(`util ${Math.round(u * 100)}%`, p.x * sx + 3, p.y * sy + 31)
  })

  // 표준셀 타일 — 자기 허브 색 테두리 + 허브까지 가는 연결선.
  glue.forEach((t, i) => {
    const def = hubDefs[t.hub], hub = state.hubs[t.hub]
    const cx = t.x + GLUE_TILE / 2, cy = t.y + GLUE_TILE / 2
    ctx.strokeStyle = def.color + '88'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(cx * sx, cy * sy); ctx.lineTo(hub.x * sx, hub.y * sy); ctx.stroke()
    ctx.fillStyle = 'rgba(126,104,215,0.55)'
    ctx.fillRect(t.x * sx + 1, t.y * sy + 1, GLUE_TILE * sx - 2, GLUE_TILE * sy - 2)
    ctx.strokeStyle = def.color
    ctx.lineWidth = 1.5
    ctx.strokeRect(t.x * sx + 1, t.y * sy + 1, GLUE_TILE * sx - 2, GLUE_TILE * sy - 2)
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 8px sans-serif'
    ctx.fillText(`S${i + 1}`, t.x * sx + 3, t.y * sy + 10)
  })
}

const METAL_STACK = [
  { name: 'li1', dir: '수직', thickness: 0.1, pitch: '0.46/0.34' },
  { name: 'met1', dir: '수평', thickness: 0.35, pitch: '0.34' },
  { name: 'met2', dir: '수직', thickness: 0.35, pitch: '0.46' },
  { name: 'met3', dir: '수평', thickness: 0.8, pitch: '0.68' },
  { name: 'met4', dir: '수직', thickness: 0.8, pitch: '0.92' },
  { name: 'met5', dir: '수평', thickness: 1.2, pitch: '3.4' },
] as const

export default function MacroTetris() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const liveStateRef = useRef<State>(referenceCandidate().state)
  const [aiOn, setAiOn] = useState(false)
  const [speed, setSpeed] = useState(80)
  const [tick, setTick] = useState(0)
  const [temp, setTemp] = useState(3000)
  const [liveCost, setLiveCost] = useState<Cost>(() => cost(liveStateRef.current))
  const [narration, setNarration] = useState('실제 실행이 쓰는 격자 배치에서 시작 — 드래그로 옮기거나 AI를 켜세요.')
  const [candidates, setCandidates] = useState<Candidate[]>([referenceCandidate()])
  const savedBestRef = useRef<Record<string, SavedBest>>({})
  const [savedBest, setSavedBest] = useState<SavedBest | null>(null)
  // 다음 redraw에서 최고 후보가 갱신되면 "어디서 나왔는지"로 기록할 이름.
  const sourceRef = useRef('실제 격자')
  const [selected, setSelected] = useState<number | null>(null)
  const dragRef = useRef<{ idx: number } | null>(null)
  const saRngRef = useRef(mulberry32(1))
  const [exportText, setExportText] = useState<string | null>(null)
  // 표준셀 타일은 그걸 채울 때의 매크로 배치(sig)에 묶여 있다 — 매크로가 바뀌면
  // 자리가 더 이상 맞지 않으므로 화면에서 숨기고 "다시 채우기"를 띄운다.
  const glueRef = useRef<Glue | null>(null)
  const [glueView, setGlueView] = useState<Glue | null>(null)
  const playRef = useRef<Play | null>(null)
  const [playView, setPlayView] = useState<Play | null>(null)
  const [playing, setPlaying] = useState(false)
  // AI Chip Tetris의 "6개 배치마다 자동 RE-PLACE" 아이디어를 옮긴 것 — 그리디하게
  // 하나씩 쌓다 보면 초반 선택이 나중 매크로를 몰아넣는데, 3개마다 지금까지 놓인
  // 것들을 빠르게 한 번 더 다듬어(position-only rip-up) 그 비효율을 게임 중간에
  // 줄인다. 매크로가 8개뿐이라 이 패스는 항상 수십 ms 안에 끝나 메인 스레드에서
  // 바로 돌려도 화면이 멈추지 않는다.
  const [autoTidy, setAutoTidy] = useState(true)
  const AUTO_TIDY_EVERY = 3
  const [busy, setBusy] = useState<string | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const pendingRef = useRef(new Map<number, { resolve: (r: unknown) => void; onProgress?: (p: SolverProgress) => void }>())
  const reqIdRef = useRef(0)

  useEffect(() => {
    // 저장된 최고 후보를 legal 기준이 더 엄격해진(예: 2026-09-26 채널 체크 추가)
    // 뒤에도 다시 검증한다 - 예전엔 legal이었지만 지금 기준으론 illegal인 항목은
    // "최고"로 잘못 남아있으면 안 된다.
    try {
      const v = localStorage.getItem(BEST_CAND_KEY)
      if (v) {
        const parsed = JSON.parse(v) as Record<string, SavedBest>
        const revalidated: Record<string, SavedBest> = {}
        for (const [sig, entry] of Object.entries(parsed)) {
          if (isLegal(cost(entry.state))) revalidated[sig] = entry
        }
        savedBestRef.current = revalidated
        localStorage.setItem(BEST_CAND_KEY, JSON.stringify(revalidated))
        const initialSig = shapeSig(liveStateRef.current.macros)
        if (revalidated[initialSig]) setSavedBest(revalidated[initialSig])
      }
    } catch { /* private mode / storage blocked */ }
    const w = new Worker(new URL('../game/macroTetrisWorker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<{ id: number; result?: unknown; progress?: SolverProgress }>) => {
      const job = pendingRef.current.get(e.data.id)
      if (!job) return
      if (e.data.progress) { job.onProgress?.(e.data.progress); return }
      pendingRef.current.delete(e.data.id)
      job.resolve(e.data.result)
    }
    workerRef.current = w
    return () => w.terminate()
  }, [])

  function solveInWorker<T>(req: SolverJob, label: string, onProgress?: (p: SolverProgress) => void): Promise<T> {
    const id = ++reqIdRef.current
    setBusy(label)
    return new Promise<T>(resolve => {
      pendingRef.current.set(id, { resolve: r => { setBusy(null); resolve(r as T) }, onProgress })
      workerRef.current!.postMessage({ ...req, id } as SolverRequest)
    })
  }

  function currentGlue(): GlueTile[] {
    const g = glueRef.current
    return g && g.sig === macrosSignature(liveStateRef.current.macros) ? g.tiles : []
  }

  function setGlue(g: Glue | null) {
    glueRef.current = g
    setGlueView(g)
  }

  function redraw(highlightIdx: number | null = null) {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const c = cost(liveStateRef.current)
    draw(ctx, canvas.width, canvas.height, liveStateRef.current, c, highlightIdx, currentGlue())
    setLiveCost(c)
    // 쌓기 도중의 부분 배치(매크로 8개 미만)는 최고 후보 기록 대상이 아니다.
    const st = liveStateRef.current
    if (st.macros.length !== N) return
    const sig = shapeSig(st.macros)
    const saved = savedBestRef.current[sig]
    if (isLegal(c) && (!saved || c.total < saved.total - 1e-6)) {
      const entry: SavedBest = { state: cloneState(st), total: c.total, wl: c.wl, leftover: c.usableLeftoverPct, foundAt: new Date().toLocaleString(), source: sourceRef.current }
      savedBestRef.current = { ...savedBestRef.current, [sig]: entry }
      try { localStorage.setItem(BEST_CAND_KEY, JSON.stringify(savedBestRef.current)) } catch { /* ignore */ }
      setSavedBest(entry)
    } else {
      setSavedBest(saved ?? null)
    }
  }

  useEffect(() => { redraw() }, [])

  // Continuous SA autopilot - one tick per interval, runs until paused. Unlike
  // a one-shot batch this never "finishes": it keeps perturbing indefinitely,
  // reheating when it goes cold, so it behaves like a real autopilot the user
  // can watch, pause, and take over from at any point.
  useEffect(() => {
    if (!aiOn) return
    const t = setTimeout(() => {
      const before = cost(liveStateRef.current)
      const proposed = stepSA(liveStateRef.current, saRngRef.current, temp)
      const after = cost(proposed)
      const delta = after.total - before.total
      const accept = delta < 0 || saRngRef.current() < Math.exp(-delta / Math.max(temp, 1))
      if (accept) {
        sourceRef.current = 'SA 자동 진행'
        liveStateRef.current = proposed
        redraw()
        setNarration(`SA: 이동 수락 (비용 ${Math.round(before.total)} → ${Math.round(after.total)})`)
      } else {
        setNarration(`SA: 이동 제안했으나 거부 (비용 ${Math.round(before.total)} → ${Math.round(after.total)})`)
      }
      setTick(v => v + 1)
      setTemp(v => (v > 40 ? v * 0.996 : 3000)) // reheat when cold so it never fully freezes
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, speed)
    return () => clearTimeout(t)
  }, [aiOn, speed, tick])

  async function solveReplace() {
    sourceRef.current = 'RePlAce 스타일'
    const result = await solveInWorker<Candidate>({ kind: 'replace', state: liveStateRef.current, seed: Math.floor(Math.random() * 1e9) }, 'RePlAce 스타일 계산 중…')
    liveStateRef.current = result.state
    redraw()
    setNarration('RePlAce 스타일: 전역 배치(당기기+반발) → 합법화(밀어내기)로 즉시 정리')
    setCandidates(prev => [...prev, result].sort(compareCandidates))
  }

  const moveCount = (r: RipUpResult) => r.log.filter(l => !l.includes('조기 종료')).length
  const pctOf = (r: RipUpResult) => (r.before > 0 ? (r.before - r.after) / r.before * 100 : 0)

  async function solveRipUp() {
    sourceRef.current = 'Rip-up'
    const result = await solveInWorker<RipUpResult>({ kind: 'ripup', state: liveStateRef.current, passes: 3, withShapes: false }, 'Rip-up 전수 탐색 중…')
    liveStateRef.current = result.state
    redraw()
    setNarration(`Rip-up & Re-place: 비용 ${Math.round(result.before)} → ${Math.round(result.after)} (${pctOf(result).toFixed(1)}% 개선, ${moveCount(result)}회 이동)`)
    setCandidates(prev => [...prev, { id: 'ripup-' + Date.now(), label: 'Rip-up & Re-place', state: result.state, c: cost(result.state) }].sort(compareCandidates))
  }

  async function solveRipUpFromReal() {
    sourceRef.current = '실제→향상 (Rip-up)'
    setAiOn(false)
    const result = await solveInWorker<RipUpResult>({ kind: 'ripup', state: referenceCandidate().state, passes: 3, withShapes: false }, '실제 배치에서 Rip-up 전수 탐색 중…')
    liveStateRef.current = result.state
    redraw()
    setNarration(`실제 배치(RUN_2026-09-23_12-48-47 격자)로 초기화 후 Rip-up & Re-place — 비용 ${Math.round(result.before)} → ${Math.round(result.after)} (${pctOf(result).toFixed(1)}% 개선, ${moveCount(result)}회 이동)`)
    setCandidates(prev => [...prev, { id: 'ripup-real-' + Date.now(), label: '실제 배치 → Rip-up & Re-place로 향상', state: result.state, c: cost(result.state) }].sort(compareCandidates))
  }

  function exportCfg() {
    const macros = liveStateRef.current.macros
    setExportText(toMacroPlacementCfg(macros))
    const softIdx = macros.map((m, i) => (m.soft ? i : -1)).filter(i => i >= 0)
    setNarration(softIdx.length === 0
      ? '실제 config 형식으로 내보냄 — 전부 HARD라 그대로 config_hierarchical.json에 쓸 수 있음'
      : `주의: 매크로 ${softIdx.join(', ')}는 SOFT — 실제 config는 800×800 chan_top GDS만 배치하므로, 이 좌표를 쓰려면 해당 크기로 chan_top을 먼저 다시 하드닝해야 함`)
  }

  async function copyExport() {
    if (!exportText) return
    try { await navigator.clipboard.writeText(exportText); setNarration('MACRO_PLACEMENT_CFG를 클립보드에 복사함') }
    catch { setNarration('클립보드 복사 실패 — 아래 텍스트를 직접 선택해 복사하세요') }
  }

  function canvasToDie(e: React.MouseEvent<HTMLCanvasElement>): Pos {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: (e.clientX - rect.left) / rect.width * DIE_W, y: (e.clientY - rect.top) / rect.height * DIE_H }
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (playing || busy) return
    const p = canvasToDie(e)
    const idx = liveStateRef.current.macros.findIndex(m => p.x >= m.x && p.x <= m.x + m.w && p.y >= m.y && p.y <= m.y + m.h)
    if (idx >= 0) { dragRef.current = { idx }; setSelected(idx); redraw(idx) }
  }
  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    sourceRef.current = '수동 드래그'
    if (!dragRef.current) return
    const p = canvasToDie(e)
    const idx = dragRef.current.idx
    const next = cloneState(liveStateRef.current)
    const m = next.macros[idx]
    next.macros[idx] = clampMacro({ ...m, x: p.x - m.w / 2, y: p.y - m.h / 2 })
    liveStateRef.current = next
    redraw(idx)
  }

  // 선택된 SOFT 블록의 너비/높이 변경 — 중심을 유지한 채로 크기만 바꾼다.
  // HARD 매크로는 이미 하드닝된 GDS라 크기를 바꿀 수 없다.
  function resizeMacro(idx: number, dim: 'w' | 'h', value: number) {
    sourceRef.current = '크기 변경'
    if (!Number.isFinite(value)) return
    const m0 = liveStateRef.current.macros[idx]
    if (!m0.soft) { setNarration(`매크로 ${idx}는 HARD(하드닝 완료) — 크기를 바꾸려면 먼저 SOFT로 전환하세요`); return }
    const v = Math.max(MACRO_MIN_SIDE, Math.min(MACRO_MAX_SIDE, value))
    const next = cloneState(liveStateRef.current)
    const m = next.macros[idx]
    const resized = dim === 'w' ? { ...m, w: v, x: m.x + (m.w - v) / 2 } : { ...m, h: v, y: m.y + (m.h - v) / 2 }
    next.macros[idx] = clampMacro(resized)
    liveStateRef.current = next
    redraw(idx)
    setNarration(`매크로 ${idx} ${dim === 'w' ? '너비' : '높이'} → ${Math.round(v)}µm (예상 util ${Math.round(impliedUtil(next.macros[idx]) * 100)}%)`)
  }

  // HARD로 되돌리면 실제 GDS 크기(800×800)로 복귀 — HARD인데 실제와 다른 크기는 존재할 수 없다.
  function toggleSoft(idx: number) {
    sourceRef.current = 'HARD/SOFT 전환'
    const next = cloneState(liveStateRef.current)
    const m = next.macros[idx]
    next.macros[idx] = m.soft
      ? clampMacro({ ...m, soft: false, w: REAL_CHAN_TOP.w, h: REAL_CHAN_TOP.h, x: m.x + (m.w - REAL_CHAN_TOP.w) / 2, y: m.y + (m.h - REAL_CHAN_TOP.h) / 2 })
      : { ...m, soft: true }
    liveStateRef.current = next
    redraw(idx)
    setNarration(`매크로 ${idx} → ${next.macros[idx].soft ? 'SOFT (모양 변경 가능)' : 'HARD (실제 800×800 고정)'}`)
  }

  function loadScenario(macros: Macro[], label: string) {
    sourceRef.current = '시나리오 초기 배치'
    stopPlay()
    liveStateRef.current = { macros: macros.map(m => ({ ...m })), hubs: REAL_RUN_HUBS.map(p => ({ ...p })) }
    setAiOn(false)
    setTemp(3000)
    redraw(selected)
    setNarration(label)
  }

  async function solveRipUpShapes() {
    sourceRef.current = 'Rip-up+모양'
    const result = await solveInWorker<RipUpResult>({ kind: 'ripup', state: liveStateRef.current, passes: 2, withShapes: true }, 'SOFT 블록 모양까지 탐색 중… (수 초)')
    liveStateRef.current = result.state
    redraw(selected)
    setNarration(`Rip-up + 모양 탐색: 비용 ${Math.round(result.before)} → ${Math.round(result.after)} (${pctOf(result).toFixed(1)}% 개선, SOFT 블록 모양 변경 ${result.reshaped}회)`)
    setCandidates(prev => [...prev, { id: 'ripup-shape-' + Date.now(), label: 'Rip-up + SOFT 모양 탐색', state: result.state, c: cost(result.state) }].sort(compareCandidates))
  }
  function onMouseUp() {
    if (dragRef.current) setNarration(`매크로 ${dragRef.current.idx}를 직접 이동`)
    dragRef.current = null
    redraw(selected)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (selected === null || playing || busy || selected >= liveStateRef.current.macros.length) return
      // 크기 입력칸에 타이핑하는 중에는 화살표로 매크로를 움직이지 않는다.
      if (e.target instanceof HTMLInputElement) return
      const step = e.shiftKey ? 100 : 20
      sourceRef.current = '화살표 이동'
      const idx = selected
      const next = cloneState(liveStateRef.current)
      const m = next.macros[idx]
      if (e.key === 'ArrowLeft') { e.preventDefault(); next.macros[idx] = clampMacro({ ...m, x: m.x - step }) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next.macros[idx] = clampMacro({ ...m, x: m.x + step }) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); next.macros[idx] = clampMacro({ ...m, y: m.y - step }) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); next.macros[idx] = clampMacro({ ...m, y: m.y + step }) }
      else if (e.key === 'Tab') { e.preventDefault(); setSelected((idx + 1) % N); redraw((idx + 1) % N); return }
      else return
      liveStateRef.current = next
      redraw(idx)
      setNarration(`매크로 ${idx}를 화살표 키로 이동`)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, playing, busy])

  function saveCandidate() {
    const c = cost(liveStateRef.current)
    const cand: Candidate = { id: 'manual-' + Date.now(), label: '직접/AI 조정 배치', state: cloneState(liveStateRef.current), c }
    setCandidates(prev => [...prev, cand].sort(compareCandidates))
    setNarration('지금 배치를 후보로 저장함')
  }

  function loadCandidate(cand: Candidate) {
    sourceRef.current = '후보 불러오기'
    stopPlay()
    liveStateRef.current = cloneState(cand.state)
    redraw()
    setNarration(`"${cand.label}" 불러옴`)
  }

  // ---- 표준셀 채우기 (지금 매크로 배치 기준, 한 번에) ----
  function fillGlueNow() {
    const st = liveStateRef.current
    const r = fillGlue(st.macros, st.hubs)
    setGlue({ tiles: r.tiles, sig: macrosSignature(st.macros) })
    redraw(selected)
    setNarration(r.complete
      ? `표준셀 타일 ${r.tiles.length}/${r.needed}개 전부 배치 — 허브까지 표준셀 WL ${Math.round(r.wl).toLocaleString()}`
      : `표준셀 공간 부족 — ${r.tiles.length}/${r.needed}개만 들어감 (남은 ${(r.needed - r.tiles.length) * GLUE_TILE_CAP / 1000}k µm²의 셀이 놓일 자리가 없음)`)
  }

  // ---- 하나씩 쌓기 플레이: 빈 다이에서 매크로 8개 → 표준셀 타일 13개 순서로 ----
  function startPlay() {
    sourceRef.current = '쌓기 플레이'
    const shapes = liveStateRef.current.macros.length === N ? liveStateRef.current.macros : REAL_RUN_MACROS
    const queue: PlayItem[] = [
      ...shapes.map((m, i) => ({ kind: 'macro' as const, macro: { ...m }, idx: i })),
      ...GLUE_TILE_HUBS.map((hub, i) => ({ kind: 'glue' as const, hub, idx: i })),
    ]
    liveStateRef.current = { macros: [], hubs: REAL_RUN_HUBS.map(p => ({ ...p })) }
    setAiOn(false)
    setSelected(null)
    setGlue(null)
    playRef.current = { queue, pos: 0, result: null }
    setPlayView({ ...playRef.current })
    setPlaying(true)
    redraw()
    setNarration(`쌓기 시작 — 매크로 ${shapes.length}개를 하나씩 놓은 뒤 표준셀 타일 ${GLUE_TILES_NEEDED}개를 채웁니다`)
  }

  function stopPlay() {
    playRef.current = null
    setPlayView(null)
    setPlaying(false)
  }

  function endPlay(ok: boolean, message: string) {
    const p = playRef.current
    if (!p) return
    p.result = { ok, message }
    setPlayView({ ...p })
    setPlaying(false)
    setNarration(message)
  }

  function stepPlay() {
    const p = playRef.current
    if (!p) return
    const item = p.queue[p.pos]
    const st = liveStateRef.current
    if (item.kind === 'macro') {
      const remaining = p.queue.slice(p.pos + 1).flatMap(q => (q.kind === 'macro' ? [q.macro] : []))
      const spot = bestMacroSpot(st.macros, item.macro, st.hubs, remaining)
      if (!spot) { endPlay(false, `NO LEGAL FLOORPLAN — 매크로 ${item.idx}를 놓을 legal한 자리가 없음`); return }
      let placedState: State = { macros: [...st.macros, spot], hubs: st.hubs }
      let tidyNote = ''
      if (autoTidy && placedState.macros.length >= 2 && placedState.macros.length % AUTO_TIDY_EVERY === 0) {
        const before = cost(placedState).total
        const tidied = ripUpReplace(placedState, 1, false)
        // 정리 자체는 legal/비용만 보고 남은 매크로 자리를 신경 안 쓴다 - 정리 때문에
        // 판이 막히면(남은 매크로가 더 이상 못 들어가면) 이 정리는 버리고 원래대로 둔다.
        if (tidied.after < before - 1e-6 && remainingStillFit(tidied.state.macros, remaining)) {
          placedState = tidied.state
          tidyNote = ` + 자동 정리(${Math.round(before)}→${Math.round(tidied.after)})`
        }
      }
      liveStateRef.current = placedState
      redraw(placedState.macros.length - 1)
      setNarration(`매크로 ${item.idx} (${item.macro.soft ? 'SOFT' : 'HARD'} ${item.macro.w}×${item.macro.h}) → (${spot.x}, ${spot.y})${tidyNote}`)
    } else {
      const tiles = currentGlue()
      const t = placeGlueTile(st.macros, tiles, item.hub, st.hubs)
      if (!t) { endPlay(false, `표준셀 공간 부족 — ${tiles.length}/${GLUE_TILES_NEEDED}개만 들어감`); return }
      setGlue({ tiles: [...tiles, t], sig: macrosSignature(st.macros) })
      redraw()
      setNarration(`표준셀 타일 S${tiles.length + 1} → ${hubDefs[item.hub].name} 허브 근처 (${t.x}, ${t.y})`)
    }
    p.pos++
    if (p.pos < p.queue.length) { setPlayView({ ...p }); return }
    const fin = liveStateRef.current, c = cost(fin), tiles = currentGlue()
    endPlay(true, `완료 — 매크로 ${fin.macros.length}개 · 표준셀 ${tiles.length}/${GLUE_TILES_NEEDED} · 매크로 WL ${Math.round(c.wl).toLocaleString()} · 표준셀 WL ${Math.round(glueWirelength(tiles, fin.hubs)).toLocaleString()} · 여유 공간 ${c.usableLeftoverPct}%`)
  }

  useEffect(() => {
    if (!playing) return
    const t = setTimeout(stepPlay, Math.max(150, speed * 4))
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, playView])

  // ---- 병렬 탐색: 레인마다 워커 하나. "최고" 레인은 첫 시도에 RePlAce→SA, 그다음부터
  // 전역 최고에서 SA로 재시작. "랜덤" 레인은 매번 무작위 위치 → RePlAce → SA.
  // 저장된 최고 후보보다 좋은 걸 찾을 때까지 돌리되 최대 시도 횟수에서 멈추고, 찾은
  // 뒤로 레인 수×3번 연속 더 나아지지 않으면 일찍 멈춘다. ----
  const [laneCount, setLaneCount] = useState(4)
  const [randomLanes, setRandomLanes] = useState(2)
  const [budget, setBudget] = useState(60)
  const [itersPerAttempt, setItersPerAttempt] = useState(20000)
  const searchRef = useRef<(SearchView & { workers: Worker[]; bestState: State; top: Candidate[] }) | null>(null)
  const [searchView, setSearchView] = useState<SearchView | null>(null)

  function publishSearch() {
    const s = searchRef.current
    if (!s) return
    const { workers: _w, bestState: _b, top: _t, ...view } = s
    setSearchView({ ...view, lanes: s.lanes.map(l => ({ ...l })), log: s.log.slice(0, 12) })
  }

  // 전역 최고보다 legal하게 좋으면 채택 — 화면·저장된 최고 후보까지 즉시 갱신.
  function tryImprove(state: State, lane: Lane, attempt: number): boolean {
    const s = searchRef.current
    if (!s) return false
    const c = cost(state)
    if (!isLegal(c) || c.total >= s.best.total - 1e-6) return false
    s.best = { total: c.total, attempt, lane: lane.id, mode: lane.mode }
    s.bestState = cloneState(state)
    s.lastImproveAt = s.attempts
    if (s.firstFoundAt === null) s.firstFoundAt = attempt
    lane.wins++
    lane.improvedInJob = true
    liveStateRef.current = cloneState(state)
    sourceRef.current = `병렬 탐색 시도 #${attempt} (레인 ${lane.id + 1}, ${LANE_MODE_LABEL[lane.mode]})`
    redraw()
    return true
  }

  function launchLane(laneId: number) {
    const s = searchRef.current
    if (!s || !s.running) return
    const lane = s.lanes[laneId]
    const cap = s.firstFoundAt !== null ? s.budget : SEARCH_SAFETY_CAP
    if (s.launched >= cap) { lane.status = '대기 (시도 한도)'; publishSearch(); return }
    const attempt = ++s.launched
    const seed = Math.floor(Math.random() * 1e9)
    const job: SolverJob = lane.mode === 'random'
      ? { kind: 'replaceSA', state: s.bestState, seed, maxIters: itersPerAttempt, randomize: true }
      : lane.jobs === 0
        ? { kind: 'replaceSA', state: s.bestState, seed, maxIters: itersPerAttempt, randomize: false }
        : { kind: 'sa', state: s.bestState, seed, maxIters: itersPerAttempt }
    lane.status = `시도 #${attempt} · ${job.kind === 'sa' ? '최고에서 SA' : job.kind === 'replaceSA' && job.randomize ? '랜덤→RePlAce→SA' : 'RePlAce→SA'}`
    lane.jobBest = null
    lane.improvedInJob = false
    s.workers[laneId].postMessage({ ...job, id: attempt } as SolverRequest)
    publishSearch()
  }

  function finishSearch(reason: string) {
    const s = searchRef.current
    if (!s || !s.running) return
    s.running = false
    s.workers.forEach(w => w.terminate())
    s.lanes.forEach(l => { l.status = '종료' })
    const gain = s.startTotal === Infinity ? null : (s.startTotal - s.best.total) / s.startTotal * 100
    s.done = s.firstFoundAt === null
      ? `${reason} — ${s.attempts}번 시도했지만 시작점(${Math.round(s.startTotal).toLocaleString()})보다 좋은 후보를 못 찾음. 시도 횟수나 시도당 반복을 늘려 다시 돌려 보세요.`
      : `${reason} — 제안: 시도 #${s.best.attempt}(레인 ${(s.best.lane ?? 0) + 1}, ${LANE_MODE_LABEL[s.best.mode ?? 'best']})에서 찾은 후보, 비용 ${Math.round(s.startTotal).toLocaleString()} → ${Math.round(s.best.total).toLocaleString()}${gain !== null ? ` (${gain.toFixed(1)}% 개선)` : ''}. 첫 개선은 시도 #${s.firstFoundAt}에서, 총 ${s.attempts}번 시도.`
    if (s.top.length > 0) setCandidates(prev => [...prev, ...s.top].sort(compareCandidates))
    setNarration(s.done)
    publishSearch()
  }

  function onLaneMessage(laneId: number, data: { id: number; result?: unknown; progress?: SolverProgress }) {
    const s = searchRef.current
    if (!s || !s.running) return
    const lane = s.lanes[laneId]
    if (data.progress) {
      lane.jobBest = data.progress.best
      tryImprove(data.progress.state, lane, data.id)
      publishSearch()
      return
    }
    const res = data.result as ReplaceSAResult
    s.attempts++
    lane.jobs++
    tryImprove(res.anneal.state, lane, data.id)
    const c = cost(res.anneal.state)
    const legal = isLegal(c)
    if (legal) {
      // 상위 10개 후보군 — 같은 배치는 한 번만.
      const sig = macrosSignature(res.anneal.state.macros)
      if (!s.top.some(t => macrosSignature(t.state.macros) === sig)) {
        s.top = [...s.top, { id: `par-${data.id}`, label: `병렬 탐색 시도 #${data.id} (${LANE_MODE_LABEL[lane.mode]})`, state: cloneState(res.anneal.state), c }]
          .sort(compareCandidates).slice(0, 10)
      }
    }
    s.log.unshift({ attempt: data.id, lane: laneId, mode: lane.mode, result: legal ? c.total : null, improved: lane.improvedInJob })
    const stall = s.lanes.length * 3
    // 개선을 하나도 못 찾은 동안은 '최대 시도'를 무시하고 계속 돈다 — 안전 상한(SEARCH_SAFETY_CAP)만 적용.
    // 한 번이라도 개선을 찾은 뒤에는 '최대 시도'가 다시 의미를 가진다(사용자가 직접 지정한 예산).
    if (s.firstFoundAt !== null && s.attempts - s.lastImproveAt >= stall) finishSearch(`개선 후 ${stall}번 연속 더 나아지지 않아 멈춤`)
    else if (s.firstFoundAt !== null && s.attempts >= s.budget) finishSearch(`최대 시도 ${s.budget}번 도달`)
    else if (s.attempts >= SEARCH_SAFETY_CAP) finishSearch(`안전 상한 ${SEARCH_SAFETY_CAP}번 도달 (개선을 못 찾음 — 설정을 바꿔 다시 시도해 보세요)`)
    else launchLane(laneId)
  }

  function startSearch() {
    const cur = liveStateRef.current
    if (cur.macros.length !== N) return
    stopPlay()
    setAiOn(false)
    // 출발점 = 지금 배치와 저장된 최고 후보 중 더 좋은 쪽. "더 좋은 후보"는 이것보다 좋아야 한다.
    const curC = cost(cur)
    const saved = savedBestRef.current[shapeSig(cur.macros)]
    const curTotal = isLegal(curC) ? curC.total : Infinity
    const useSaved = saved !== undefined && saved.total <= curTotal
    const startState = cloneState(useSaved ? saved.state : cur)
    const startTotal = useSaved ? saved.total : curTotal
    if (useSaved) { liveStateRef.current = cloneState(saved.state); redraw() }
    const lanes: Lane[] = Array.from({ length: laneCount }, (_, i) => ({ id: i, mode: i < laneCount - randomLanes ? 'best' : 'random', jobs: 0, wins: 0, status: '대기', jobBest: null, improvedInJob: false }))
    const workers = lanes.map(l => {
      const w = new Worker(new URL('../game/macroTetrisWorker.ts', import.meta.url), { type: 'module' })
      w.onmessage = (e: MessageEvent<{ id: number; result?: unknown; progress?: SolverProgress }>) => onLaneMessage(l.id, e.data)
      return w
    })
    searchRef.current = {
      running: true, budget, launched: 0, attempts: 0, startTotal,
      best: { total: startTotal, attempt: null, lane: null, mode: null },
      firstFoundAt: null, lastImproveAt: 0, lanes, log: [], done: null,
      workers, bestState: startState, top: [],
    }
    setNarration(`병렬 탐색 시작 — 레인 ${laneCount}개(최고 재시작 ${laneCount - randomLanes} · 랜덤 ${randomLanes}), 시작 비용 ${startTotal === Infinity ? '(legal 아님)' : Math.round(startTotal).toLocaleString()}${useSaved ? ' (저장된 최고 후보에서)' : ''}, 최대 ${budget}번 시도`)
    lanes.forEach(l => launchLane(l.id))
  }

  // 사용자가 직접 중지하면, 그때까지의 시도 횟수를 '최대 시도'로 남겨둔다 — 다음에
  // 다시 돌릴 때 이번에 멈췄던 지점이 새 기본 상한이 되도록(무제한으로 계속 도는 게
  // 아니라, 방금 멈춘 만큼만 다시 시도해 보고 싶을 때).
  function stopSearch() {
    const attemptsAtStop = searchRef.current?.attempts ?? budget
    finishSearch('사용자가 중지')
    if (attemptsAtStop > 0) setBudget(attemptsAtStop)
  }

  useEffect(() => () => searchRef.current?.workers.forEach(w => w.terminate()), [])
  const searching = searchView?.running ?? false

  const proxy = preSignoffProxy(liveCost)
  const riskCount = liveCost.pinAccessViolations + liveCost.powerAccessViolations
  const partial = liveStateRef.current.macros.length !== N
  // 매크로 8개가 다 놓이지 않았거나 AI/쌓기/워커 계산이 도는 동안에는 편집 버튼을 막는다.
  const locked = aiOn || playing || busy !== null || partial || searching
  const glueTiles = currentGlue()
  const glueStale = glueView !== null && glueTiles.length === 0 && glueView.tiles.length > 0
  const nextItems = playView ? playView.queue.slice(playView.pos, playView.pos + 3) : []
  const status = searching ? `PARALLEL SEARCH ${searchView?.attempts ?? 0}/${searchView?.budget ?? 0}` : busy ? 'AI COMPUTING' : playing ? `STACKING ${playView?.pos ?? 0}/${playView?.queue.length ?? 0}` : playView?.result ? (playView.result.ok ? 'FLOORPLAN COMPLETE' : 'GAME OVER') : !isLegal(liveCost) ? 'ILLEGAL LAYOUT' : aiOn ? 'AI AUTOPILOT (SA)' : 'MANUAL MODE'

  return <div className="chip-tetris-page">
    <section className="chip-game-hero">
      <div>
        <small>SELF-PLAYING PHYSICAL DESIGN GAME · 실제 매크로 배치</small>
        <h2>Macro Tetris</h2>
        <p>daq_subsystem hierarchical 트랙의 실제 배치 문제입니다. <b>▶ 쌓기 플레이</b>를 누르면 AI가 빈 다이에 매크로 8개를 하나씩 놓고, 이어서 실제 표준셀 {REAL_GLUE.cellArea.toLocaleString()}µm²를 {GLUE_TILES_NEEDED}개 타일로 남은 영역에 채웁니다. 다 놓인 뒤에는 드래그·크기 변경·AI 솔버로 계속 고칠 수 있습니다 — 초록 칸은 표준셀을 넣기 좋은 여유 공간, 주황 칸은 조각나서 쓰기 어려운 공간, 보라 타일은 배치된 표준셀입니다.</p>
      </div>
      <div className={`ai-status ${aiOn || playing || busy || searching ? 'live' : ''}`}><i/><span>{status}</span></div>
    </section>

    <section className="chip-scorebar">
      <div><span>WEIGHTED WL</span><b>{Math.round(liveCost.wl).toLocaleString()}</b></div>
      <div><span>BEST 후보 비용</span><b className="pass">{savedBest ? Math.round(savedBest.total).toLocaleString() : '-'}</b></div>
      <div><span>STATE</span><b className={isLegal(liveCost) ? 'pass' : 'warn'}>{isLegal(liveCost) ? 'LEGAL' : 'ILLEGAL'}</b></div>
      <div><span>STD-CELL 여유</span><b className={proxy.leftoverClean ? 'pass' : 'warn'}>{liveCost.usableLeftoverPct}%</b></div>
      <div><span>STD CELL 배치</span><b className={glueTiles.length === GLUE_TILES_NEEDED ? 'pass' : 'warn'}>{glueTiles.length}/{GLUE_TILES_NEEDED}</b></div>
      <div><span>CONFIDENCE</span><b className={proxy.confidence >= 90 ? 'pass' : 'warn'}>{proxy.confidence}%</b></div>
    </section>

    <section className="chip-game-layout">
      <div className="chip-board-wrap">
        <div className="zone-headings"><span>ROW 1 · ch0-3</span><span>CHANNEL · glue 300µm</span><span>ROW 2 · ch4-7</span></div>
        <div style={{ position: 'relative' }}>
          <canvas
            ref={canvasRef} width={620} height={352}
            style={{ width: '100%', height: 'auto', minHeight: 340, background: '#101726', border: '2px solid var(--border-strong)', borderRadius: 8, boxShadow: 'inset 0 0 30px rgba(0,0,0,.35)', display: 'block', cursor: locked && !partial ? 'default' : 'grab' }}
            onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
          />
          {playView?.result && <div className="game-over">
            <b>{playView.result.ok ? 'FLOORPLAN COMPLETE' : 'GAME OVER'}</b>
            <span>{playView.result.message}</span>
            <button onClick={startPlay}>다시 쌓기</button>
          </div>}
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
          {hubDefs.map(hd => <span key={hd.name}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: hd.color, marginRight: 4 }}/>{hd.name} (×{hd.weight})</span>)}
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'rgba(29,158,117,0.45)', marginRight: 4 }}/>표준셀 넣기 좋은 여유</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'rgba(230,120,78,0.7)', marginRight: 4 }}/>조각난 여유(쓰기 어려움)</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'rgba(126,104,215,0.8)', marginRight: 4 }}/>표준셀 타일(300µm, 셀 {GLUE_TILE_CAP.toLocaleString()}µm²)</span>
        </div>
      </div>

      <aside className="chip-control-panel">
        <div className="ai-decision"><span className="panel-label">상태</span><b>{busy ?? narration}</b></div>

        <div><span className="panel-label">게임 · 하나씩 쌓기</span>
          <div className="chip-switches">
            <button className="active" onClick={startPlay} disabled={aiOn || busy !== null}>▶ 쌓기 플레이</button>
            <button onClick={() => setPlaying(v => !v)} disabled={!playView || !!playView.result}>{playing ? '일시정지' : '계속'}</button>
            <button onClick={stepPlay} disabled={!playView || !!playView.result || playing}>한 칸씩</button>
          </div>
          <div className="chip-switches" style={{ marginTop: 5 }}>
            <button className={autoTidy ? 'active replace' : ''} onClick={() => setAutoTidy(v => !v)}>{autoTidy ? '자동 정리 ON' : '자동 정리 OFF'}</button>
          </div>
          <p className="key-help" style={{ marginTop: 4 }}>AI Chip Tetris의 "N개마다 자동 RE-PLACE"를 옮긴 것 — 매크로 {AUTO_TIDY_EVERY}개마다 지금까지 놓인 것들을 빠르게 한 번 더 정리해(position-only rip-up), 초반에 몰아넣은 자리 때문에 뒤에서 막히거나 손해 보는 걸 줄입니다.</p>
          {playView && !playView.result && <div style={{ marginTop: 6 }}>
            <span className="panel-label">NEXT QUEUE</span>
            <div className="next-row">
              {nextItems.map((it, k) => it.kind === 'macro'
                ? <div key={k} className="chip-mini"><i style={{ background: it.macro.soft ? '#B9AEF0' : '#85B7EB' }}/><span>매크로 {it.idx}</span><small>{it.macro.soft ? 'SOFT' : 'HARD'} {it.macro.w}×{it.macro.h}</small></div>
                : <div key={k} className="chip-mini"><i style={{ background: hubDefs[it.hub].color }}/><span>표준셀 S{it.idx + 1}</span><small>{hubDefs[it.hub].name}</small></div>)}
            </div>
          </div>}
        </div>

        <div><span className="panel-label">병렬 탐색 · 더 좋은 후보 찾기</span>
          <div className="chip-switches" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <label className="speed-control" style={{ gridTemplateColumns: 'auto 1fr' }}>레인<input type="number" min={1} max={8} value={laneCount} disabled={searching} onChange={e => { const v = Math.max(1, Math.min(8, Number(e.target.value) || 1)); setLaneCount(v); setRandomLanes(r => Math.min(r, v)) }}/></label>
            <label className="speed-control" style={{ gridTemplateColumns: 'auto 1fr' }}>랜덤<input type="number" min={0} max={laneCount} value={randomLanes} disabled={searching} onChange={e => setRandomLanes(Math.max(0, Math.min(laneCount, Number(e.target.value) || 0)))}/></label>
            <label className="speed-control" style={{ gridTemplateColumns: 'auto 1fr' }}>최대 시도(개선 이후)<input type="number" min={1} max={SEARCH_SAFETY_CAP} value={budget} disabled={searching} onChange={e => setBudget(Math.max(1, Math.min(SEARCH_SAFETY_CAP, Number(e.target.value) || 1)))}/></label>
            <label className="speed-control" style={{ gridTemplateColumns: 'auto 1fr' }}>반복/시도<input type="number" min={1000} max={200000} step={1000} value={itersPerAttempt} disabled={searching} onChange={e => setItersPerAttempt(Math.max(1000, Math.min(200000, Number(e.target.value) || 1000)))}/></label>
          </div>
          <div className="chip-switches" style={{ marginTop: 5, gridTemplateColumns: '1fr 1fr' }}>
            <button className="active" onClick={startSearch} disabled={searching || aiOn || playing || busy !== null || partial}>병렬 탐색 시작</button>
            <button onClick={stopSearch} disabled={!searching}>중지</button>
          </div>
          <p className="key-help" style={{ marginTop: 4 }}>최고 레인 {laneCount - randomLanes}개 · 랜덤 레인 {randomLanes}개. <b>개선을 하나도 못 찾은 동안은 멈추지 않습니다</b>(안전 상한 {SEARCH_SAFETY_CAP}번) — 한 번 찾은 뒤부터 "최대 시도" {budget}번이 적용되고, {laneCount * 3}번 연속 무개선이면 그전에 조기 종료합니다. 중지를 누르면 그 시점 시도 횟수가 다음 "최대 시도" 기본값이 됩니다.</p>
        </div>

        <div><span className="panel-label">시나리오</span>
          <div className="chip-switches" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <button onClick={() => loadScenario(REAL_RUN_MACROS, '실제: 8개 모두 HARD chan_top 800×800 (RUN_2026-09-23_12-48-47 격자)')} disabled={aiOn || playing || busy !== null}>실제 (HARD×8)</button>
            <button onClick={() => loadScenario(MIXED_MACROS, 'what-if 혼합: ch0~3 HARD 800×800 + ch4~7 SOFT 블록(크기 제각각)')} disabled={aiOn || playing || busy !== null}>혼합 (HARD4+SOFT4)</button>
          </div>
        </div>

        <div><span className="panel-label">매크로 {selected !== null && selected < liveStateRef.current.macros.length ? `${selected} · ${liveStateRef.current.macros[selected].soft ? 'SOFT' : 'HARD'}` : '· 캔버스에서 클릭해 선택'}</span>
          {selected !== null && selected < liveStateRef.current.macros.length && (() => {
            const sm = liveStateRef.current.macros[selected]
            const u = impliedUtil(sm)
            return <>
              <div className="chip-switches" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                <label className="speed-control" style={{ gridTemplateColumns: 'auto 1fr' }}>W<input type="number" min={MACRO_MIN_SIDE} max={MACRO_MAX_SIDE} step={50} value={Math.round(sm.w)} disabled={!sm.soft || locked} onChange={e => resizeMacro(selected, 'w', Number(e.target.value))}/></label>
                <label className="speed-control" style={{ gridTemplateColumns: 'auto 1fr' }}>H<input type="number" min={MACRO_MIN_SIDE} max={MACRO_MAX_SIDE} step={50} value={Math.round(sm.h)} disabled={!sm.soft || locked} onChange={e => resizeMacro(selected, 'h', Number(e.target.value))}/></label>
                <button className={sm.soft ? 'active' : ''} onClick={() => toggleSoft(selected)} disabled={locked}>{sm.soft ? 'SOFT → HARD' : 'HARD → SOFT'}</button>
              </div>
              <p className="key-help" style={{ marginTop: 4 }}>
                {Math.round(sm.w)}×{Math.round(sm.h)}µm = {Math.round(sm.w * sm.h).toLocaleString()}µm² · 실제 셀 면적 {REAL_CHAN_TOP.cellArea.toLocaleString()}µm² 기준 예상 util <b style={{ color: u > 1 ? 'var(--danger, #C0392B)' : u > UTIL_WARN ? 'var(--warning)' : 'var(--success)' }}>{Math.round(u * 100)}%</b>
                {u > 1 ? ' — 로직이 물리적으로 안 들어감(illegal)' : u > UTIL_WARN ? ` — ${Math.round(UTIL_WARN * 100)}% 초과, 라우팅 위험` : ''}
                {!sm.soft && ' · HARD라 크기 고정 (실제 LEF 800×800)'}
              </p>
            </>
          })()}
        </div>

        <div><span className="panel-label">AI 솔버 {busy && '· 계산 중 (화면은 멈추지 않음)'}</span>
          <div className="chip-switches">
            <button className={aiOn ? 'active' : ''} onClick={() => setAiOn(v => !v)} disabled={playing || busy !== null || partial}>{aiOn ? 'AI ON' : 'MANUAL'}</button>
            <button onClick={solveReplace} disabled={locked}>RePlAce</button>
            <button onClick={solveRipUp} disabled={locked}>Rip-up</button>
          </div>
          <div className="chip-switches" style={{ marginTop: 5 }}>
            <button className="active replace" onClick={solveRipUpFromReal} disabled={aiOn || playing || busy !== null}>실제→향상</button>
            <button className="active" onClick={solveRipUpShapes} disabled={locked}>Rip-up+모양</button>
            <button onClick={saveCandidate} disabled={partial}>후보 저장</button>
          </div>
          <div className="chip-switches" style={{ marginTop: 5, gridTemplateColumns: '1fr' }}>
            <button onClick={fillGlueNow} disabled={locked}>{glueStale ? '매크로가 바뀜 — 표준셀 다시 채우기' : '표준셀 채우기 (지금 배치 기준)'}</button>
          </div>
        </div>

        <label className="speed-control">AI speed <input type="range" min={20} max={400} step={20} value={speed} onChange={e => setSpeed(Number(e.target.value))}/><b>{speed}ms</b></label>

        <div className="chip-switches">
          <button style={{ gridColumn: '1 / -1' }} onClick={exportCfg} disabled={partial}>실제 config로 내보내기</button>
        </div>

        <p className="key-help">드래그·화살표 키(20µm, Shift 100µm)로 이동, Tab으로 다음 매크로 선택. <b>HARD</b>(실선, 파랑)는 이미 하드닝된 GDS라 크기 고정·위치만 이동, <b>SOFT</b>(점선, 보라)는 W/H로 모양 변경 가능. 매크로 안쪽 점선은 실제 chan_top 셀 면적 {REAL_CHAN_TOP.cellArea.toLocaleString()}µm²({REAL_CHAN_TOP.cellCount.toLocaleString()}셀)을 같은 비율로 그린 것. <b>Rip-up+모양</b>은 SOFT 블록의 모양(util ≤{Math.round(UTIL_WARN * 100)}%, 가로세로비 1:2~2:1)까지 AI가 탐색합니다. SOFT 크기는 what-if — 실제로 쓰려면 그 크기로 chan_top을 다시 하드닝해야 합니다. 표준셀 타일은 허브(신호 그룹 중심)에 가장 가까운 빈 300µm 자리부터 채웁니다.</p>
      </aside>
    </section>

    <section className="chip-analysis-grid">
      <article className="chip-card">
        <div className="chip-card-title"><div><small>BEST SO FAR · 항상 저장</small><h3>지금까지 찾은 최고 후보</h3></div><span>{partial ? '쌓는 중' : '이 모양 구성 기준'}</span></div>
        {savedBest ? <>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginTop: 10, flexWrap: 'wrap' }}>
            <CandidateThumb cand={{ id: 'saved-best', label: '저장된 최고 후보', state: savedBest.state, c: cost(savedBest.state) }} rank={0} onClick={() => { stopPlay(); sourceRef.current = '저장된 최고 후보'; liveStateRef.current = cloneState(savedBest.state); redraw(); setNarration('저장된 최고 후보를 캔버스에 불러옴') }}/>
            <dl className="metric-list" style={{ flex: 1, minWidth: 180, margin: 0 }}>
              <div><dt>비용</dt><dd>{Math.round(savedBest.total).toLocaleString()}</dd></div>
              <div><dt>배선 비용</dt><dd>{Math.round(savedBest.wl).toLocaleString()}</dd></div>
              <div><dt>표준셀 여유</dt><dd>{savedBest.leftover}%</dd></div>
              <div><dt>찾은 곳</dt><dd>{savedBest.source}</dd></div>
              <div><dt>찾은 시각</dt><dd>{savedBest.foundAt}</dd></div>
            </dl>
          </div>
          <p className="chip-note">legal하면서 비용이 더 낮은 배치가 나오면 어떤 방법(드래그·솔버·병렬 탐색)이든 자동으로 갱신되고 브라우저에 저장돼 새로고침 후에도 남습니다. 썸네일을 누르면 캔버스로 불러옵니다.</p>
        </> : <p className="chip-note" style={{ marginTop: 10 }}>아직 이 모양 구성에서 legal한 후보가 저장되지 않았습니다.</p>}
      </article>

      <article className="chip-card" style={{ gridColumn: 'span 2' }}>
        <div className="chip-card-title"><div><small>PARALLEL SEARCH</small><h3>병렬 탐색 진행</h3></div><span>{searchView ? `시도 ${searchView.attempts}/${searchView.budget}` : '대기'}</span></div>
        {searchView ? <>
          <dl className="metric-list">
            <div><dt>시작 비용 → 현재 최고</dt><dd>{searchView.startTotal === Infinity ? '(legal 아님)' : Math.round(searchView.startTotal).toLocaleString()} → {searchView.best.total === Infinity ? '-' : Math.round(searchView.best.total).toLocaleString()}</dd></div>
            <div><dt>첫 개선 발견</dt><dd>{searchView.firstFoundAt !== null ? `시도 #${searchView.firstFoundAt}` : '아직 없음 — 계속 탐색'}</dd></div>
            <div><dt>현재 최고 출처</dt><dd>{searchView.best.attempt !== null ? `시도 #${searchView.best.attempt} · 레인 ${(searchView.best.lane ?? 0) + 1} (${LANE_MODE_LABEL[searchView.best.mode ?? 'best']})` : '시작점'}</dd></div>
          </dl>
          <div className="data-table"><table><thead><tr><th>레인</th><th>모드</th><th>상태</th><th>이번 시도 최고</th><th>완료</th><th>전역 갱신</th></tr></thead><tbody>
            {searchView.lanes.map(l => <tr key={l.id}><td><b>{l.id + 1}</b></td><td>{LANE_MODE_LABEL[l.mode]}</td><td>{l.status}</td><td>{l.jobBest === null || l.jobBest === Infinity ? '-' : Math.round(l.jobBest).toLocaleString()}</td><td>{l.jobs}</td><td>{l.wins > 0 ? <span className="ok-badge">{l.wins}</span> : 0}</td></tr>)}
          </tbody></table></div>
          {searchView.log.length > 0 && <div className="data-table" style={{ marginTop: 8 }}><table><thead><tr><th>시도</th><th>레인</th><th>결과 비용</th><th>전역 최고 갱신</th></tr></thead><tbody>
            {searchView.log.map(a => <tr key={a.attempt}><td>#{a.attempt}</td><td>{a.lane + 1} · {LANE_MODE_LABEL[a.mode]}</td><td>{a.result === null ? 'illegal' : Math.round(a.result).toLocaleString()}</td><td>{a.improved ? <span className="ok-badge">갱신</span> : '-'}</td></tr>)}
          </tbody></table></div>}
          {searchView.done && <p className="rule-disclaimer">{searchView.done}</p>}
        </> : <p className="chip-note" style={{ marginTop: 10 }}>오른쪽 패널의 "병렬 탐색 시작"을 누르면 레인별 진행 상황과 시도 기록이 여기에 나옵니다.</p>}
      </article>
    </section>

    <section className="chip-card">
      <div className="chip-card-title"><div><small>MACROS · 실제 크기</small><h3>8개 매크로 크기와 내부 활용률</h3></div><span>실제 LEF 800×800 · 셀 {REAL_CHAN_TOP.cellArea.toLocaleString()}µm²</span></div>
      <div className="data-table"><table><thead><tr><th>#</th><th>종류</th><th>W×H (µm)</th><th>면적 (µm²)</th><th>실제 대비</th><th>예상 util</th><th>위치 (x, y)</th></tr></thead><tbody>
        {liveStateRef.current.macros.map((m, i) => {
          const u = impliedUtil(m)
          const areaRatio = m.w * m.h / REAL_CHAN_TOP.dieArea
          return <tr key={i} onClick={() => { setSelected(i); redraw(i) }} style={{ cursor: 'pointer', background: i === selected ? 'var(--accent-soft)' : undefined }}>
            <td><b>{i}</b></td>
            <td>{m.soft ? <span className="warning-badge">SOFT</span> : <span className="ok-badge">HARD</span>}</td>
            <td>{Math.round(m.w)}×{Math.round(m.h)}</td>
            <td>{Math.round(m.w * m.h).toLocaleString()}</td>
            <td>{Math.round(areaRatio * 100)}%</td>
            <td style={{ color: u > 1 ? '#C0392B' : u > UTIL_WARN ? 'var(--warning)' : 'var(--success)', fontWeight: 700 }}>{Math.round(u * 100)}%</td>
            <td>({Math.round(m.x)}, {Math.round(m.y)})</td>
          </tr>
        })}
      </tbody></table></div>
      <p className="chip-note">예상 util = 실제 셀 면적 ÷ (W×H × 코어 비율 {(CORE_RATIO * 100).toFixed(1)}%). 실제 800×800은 52%로 metrics.json의 실측 util(52.0%)과 일치합니다. SOFT 블록을 줄이면 남는 공간은 늘지만 util이 {Math.round(UTIL_WARN * 100)}%를 넘으면 라우팅 위험, 100%를 넘으면 로직이 아예 안 들어갑니다(illegal).</p>
    </section>

    {exportText && <section className="chip-card">
      <div className="chip-card-title"><div><small>EXPORT</small><h3>config_hierarchical.json용 MACROS.chan_top.instances</h3></div><span>{riskCount === 0 ? 'READY' : `${riskCount} RISK`}</span></div>
      <textarea readOnly value={exportText} rows={10} style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--surface-muted)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, marginTop: 8 }}/>
      <div style={{ marginTop: 8 }}><button onClick={copyExport} style={btnStyle(false)}>클립보드에 복사</button></div>
      <p className="rule-disclaimer">이 텍스트를 <code>config_hierarchical.json</code>의 <code>MACROS.chan_top.instances</code>에 붙여넣고 실제 OpenLane hierarchical 실행을 다시 돌려야 signoff가 확정됩니다 — 여기서 나온 개선율은 이 탭의 근사 비용 모델 기준입니다.</p>
    </section>}

    <section className="chip-analysis-grid">
      <article className="chip-card">
        <div className="chip-card-title"><div><small>PROBLEM FACTS</small><h3>실제 배치 문제 정의</h3></div><span>daq_subsystem hierarchical</span></div>
        <div className="data-table"><table><thead><tr><th>항목</th><th>값</th><th>근거</th></tr></thead><tbody>{problemFacts.map(([item, val, note]) => <tr key={item}><td><b>{item}</b></td><td>{val}</td><td>{note}</td></tr>)}</tbody></table></div>
        <p className="chip-note">최소 spacing을 실제 성공한 <code>RUN_2026-09-23_12-48-47</code>의 격자 배치와 같은 100µm로 맞췄습니다 — "legal"은 "signoff를 통과할 가능성이 높아진다"는 뜻이지 보장이 아닙니다.</p>
      </article>

      <article className="chip-card">
        <div className="chip-card-title"><div><small>HEURISTIC SEARCH</small><h3>AI가 하는 일</h3></div><span>쌓기 · SA · RePlAce · Rip-up</span></div>
        <ol className="strategy-list">
          <li><b>▶ 쌓기 플레이 (탐욕 + 선검사)</b><span>빈 다이에 매크로를 하나씩, 부분 배치 비용이 가장 낮은 legal 자리에 놓습니다. 남은 매크로가 더 들어갈 수 없게 막는 자리는 빠른 패킹 검사로 미리 뺍니다(이게 없으면 매크로 3에서 GAME OVER). 매크로가 다 놓이면 표준셀 타일 {GLUE_TILES_NEEDED}개를 각자 허브에 가장 가까운 빈 300µm 자리에 채웁니다.</span></li>
          <li><b>SA 자동 진행 (확률적)</b><span>매 스텝 무작위로 하나를 옮겨보고 비용이 낮아지면 수락, 높아져도 온도에 비례한 확률로 수락 — 식으면 다시 데워서 끝나지 않고 계속 돕니다.</span></li>
          <li><b>RePlAce 스타일 (결정론적, 즉시)</b><span>전역 배치(허브로 당기기+서로 반발) → 합법화(밀어내기) 2단계로 한 번에 수렴 — 실제 RePlAce의 정전기 밀도 모델+Nesterov 경사하강 성격을 흉내.</span></li>
          <li><b>Rip-up &amp; Re-place (전수 탐색)</b><span>AI Chip Tetris와 동일한 원리 — 매크로를 하나씩 뽑아 100µm 격자의 모든 legal 위치를 평가하고, 실제로 비용이 낮아질 때만 옮깁니다. 개선되는 이동이 없으면 스스로 멈추는 결정론적 종료.</span></li>
          <li><b>"실제→향상" = 초기화 + Rip-up 한 번에</b><span>실제로 signoff를 통과한 <code>RUN_2026-09-23_12-48-47</code> 격자에서 시작해 곧바로 Rip-up &amp; Re-place를 실행합니다.</span></li>
        </ol>
      </article>

      <article className="chip-card">
        <div className="chip-card-title"><div><small>PRE-SIGNOFF PROXY</small><h3>후보 사전 검사</h3></div><span>{proxy.confidence}% confidence</span></div>
        <div className="precheck-gates">
          <span className={proxy.overlapClean ? 'clean' : 'risk'}>겹침 <b>{proxy.overlapClean ? 'CLEAN' : 'RISK'}</b></span>
          <span className={proxy.spacingClean ? 'clean' : 'risk'}>최소간격(100µm) <b>{proxy.spacingClean ? 'CLEAN' : 'RISK'}</b></span>
          <span className={proxy.channelClean ? 'clean' : 'risk'}>매크로 그룹 채널(≥{CHANNEL_SAFE_MARGIN}µm) <b>{proxy.channelClean ? 'CLEAN' : `RISK ×${liveCost.channelViolations}`}</b></span>
          <span className={proxy.boundsClean ? 'clean' : 'risk'}>다이 경계 <b>{proxy.boundsClean ? 'CLEAN' : 'RISK'}</b></span>
          <span className={proxy.pinAccessClean ? 'clean' : 'risk'}>핀 escape(200µm) <b>{proxy.pinAccessClean ? 'CLEAN' : `RISK ×${liveCost.pinAccessViolations}`}</b></span>
          <span className={proxy.powerAccessClean ? 'clean' : 'risk'}>전원 접근(300µm) <b>{proxy.powerAccessClean ? 'CLEAN' : `RISK ×${liveCost.powerAccessViolations}`}</b></span>
          <span className={proxy.leftoverClean ? 'clean' : 'risk'}>표준셀 여유 공간(≥{LEFTOVER_CLEAN_PCT}%) <b>{proxy.leftoverClean ? 'CLEAN' : `RISK ${liveCost.usableLeftoverPct}%`}</b></span>
          <span className={proxy.utilClean ? 'clean' : 'risk'}>매크로 내부 util(≤{Math.round(UTIL_WARN * 100)}%) <b>{proxy.utilClean ? 'CLEAN' : `RISK ×${liveCost.highUtilMacros + liveCost.infeasibleMacros}`}</b></span>
          <span className={proxy.routabilityRisk === 'low' ? 'clean' : 'risk'}>혼잡 위험 <b>{proxy.routabilityRisk.toUpperCase()}</b></span>
        </div>
        <dl className="metric-list">
          <div><dt>혼잡 구간</dt><dd>{liveCost.congestionCells} cells</dd></div>
          <div><dt>spacing 위반</dt><dd>{liveCost.spacingViolations}</dd></div>
          <div><dt>조각난 여유 칸</dt><dd>{liveCost.fragmentedCells} cells</dd></div>
        </dl>
        <p className="rule-disclaimer">이 모델은 매크로를 속이 빈 사각형으로만 다룹니다 — 실제 핀 위치·PDN 스트랩 배치를 시뮬레이션한 것이 아니라 근사치입니다. 최종 확정은 <code>config_hierarchical_parsac.json</code>으로 만든 실제 OpenLane 실행만 할 수 있습니다. <b>매크로 그룹 채널</b> 항목은 예외적으로 실제 실패 사례에 기반한 하드 legal 게이트입니다 — 2026-09-26에 채널을 300µm→100µm로 좁힌 후보를 실제 OpenLane으로 돌렸더니 hold 버퍼 300개가 legal한 자리를 못 찾아 Detailed Placement가 실패했습니다(DPL-0034/0036). 그 전까지 쓰던 "표준셀 여유 공간" 지표는 이 실패를 못 잡았습니다(둘 다 42%로 동일하게 나옴) — 다이 어디든 빈 공간만 있으면 되는 게 아니라, 매크로 그룹을 가르는 채널 자체가 넓어야 한다는 걸 실제로 확인한 뒤 추가한 항목입니다.</p>
      </article>
    </section>

    {candidates.length > 0 && <section className="chip-card">
      <div className="chip-card-title"><div><small>후보군</small><h3>legal 우선, 배선 비용 순 — 클릭하면 캔버스에 불러옴</h3></div></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        {candidates.map((cand, rank) => <CandidateThumb key={cand.id} cand={cand} rank={rank} onClick={() => loadCandidate(cand)}/>)}
      </div>
      <p className="chip-note">"실제 실행" 카드는 <code>RUN_2026-09-23_12-48-47</code>이 완료된 뒤 hierarchical 1차 실행이 쓰는 진짜 좌표이고, 허브 위치만 이 탭의 근사치입니다.</p>
    </section>}

    <section className="chip-analysis-grid">
      <article className="chip-card" style={{ gridColumn: '1 / -1' }}>
        <div className="chip-card-title"><div><small>SAMPLE TEST 4</small><h3>실제 signoff 현황</h3></div></div>
        <div className="data-table"><table><thead><tr><th>블록</th><th>상태</th><th>근거</th></tr></thead><tbody>{signoffStatus.map(([name, stat, note, done]) => <tr key={name as string}><td><code>{name}</code></td><td>{done ? <span className="ok-badge">{stat}</span> : <span className="warning-badge">{stat}</span>}</td><td>{note}</td></tr>)}</tbody></table></div>
        <p className="chip-note">위 8개 매크로(chan_top)는 <b>이미 최종 통과한 실제 블록</b>입니다 — 이 게임이 풀고 있는 건 그 8개를 daq_subsystem 안에 어떻게 배치할지이지, chan_top 자체의 signoff 여부가 아닙니다.</p>
      </article>
    </section>

    <section className="chip-card">
      <div className="chip-card-title"><div><small>참고</small><h3>3D 배선 층 구조 — 실제로는 평면이 아니라 6개 금속층 위</h3></div></div>
      <p className="chip-note">위 캔버스의 배선 표시는 전부 평면(X-Y) 근사치입니다. 실제로는 트랜지스터 위에 <b>li1부터 met5까지 6개 라우팅 레이어</b>가 쌓여 있고, chan_top의 실제 완주 실행도 이 전체 스택(<code>RT_MIN_LAYER=met1</code>, <code>RT_MAX_LAYER=met5</code>, li1 포함)을 씁니다.</p>
      <MetalStackBars/>
      <p className="rule-disclaimer">이 다이어그램은 실제 sky130 기술 LEF 수치(방향·두께·피치)를 반영한 스키마이고, 개별 넷의 층 배정은 TritonRoute(실제 OpenLane 라우팅 단계)가 결정합니다.</p>
    </section>
  </div>
}

function btnStyle(disabled: boolean): React.CSSProperties {
  return { padding: '8px 16px', borderRadius: 'var(--radius)', border: '0.5px solid var(--border-strong)', background: 'var(--surface-1)', color: 'var(--text-primary)', fontSize: 13, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 }
}

function CandidateThumb({ cand, rank, onClick }: { cand: Candidate; rank: number; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const w = 150, h = 85
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (ctx) draw(ctx, w, h, cand.state, cand.c, null)
  }, [cand])
  const legal = isLegal(cand.c)
  return <div style={{ width: 150, cursor: 'pointer' }} onClick={onClick}>
    <canvas ref={ref} width={w} height={h} style={{ width: '100%', height: 'auto', background: 'var(--surface-1)', borderRadius: 4, border: rank === 0 ? '1.5px solid var(--text-primary)' : '0.5px solid var(--border-strong)' }}/>
    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>{cand.label}</div>
    <div style={{ fontSize: 11, color: legal ? 'var(--text-success)' : 'var(--text-danger)' }}>{legal ? 'legal' : 'illegal'} · WL {Math.round(cand.c.wl)}</div>
    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>spacing 위반 {cand.c.spacingViolations} · 혼잡 {cand.c.congestionCells}칸</div>
  </div>
}

function MetalStackBars() {
  const maxT = Math.max(...METAL_STACK.map(l => l.thickness))
  return <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: 4, maxWidth: 520 }}>
    {METAL_STACK.map(layer => <div key={layer.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 46, fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{layer.name}</div>
      <div style={{ height: 16, width: `${20 + (layer.thickness / maxT) * 200}px`, background: layer.dir === '수직' ? '#7F77DD' : '#378ADD', borderRadius: 3 }}/>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{layer.dir} · 두께 {layer.thickness}µm · 피치 {layer.pitch}µm</div>
    </div>)}
  </div>
}
