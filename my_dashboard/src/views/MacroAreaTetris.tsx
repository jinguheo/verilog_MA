// "Macro Area Tetris" — Macro Tetris와 같은 배치 규칙(8개 HARD chan_top, 최소 간격 100µm,
// 매크로 그룹 채널 300µm(실측 하드 게이트, DPL-0034/0036 근거), 핀 escape 200µm·전원 접근
// 300µm, 허브 가중 배선, Rip-up)으로 다이 면적을 탐색한다. 기존에 성공했던 결과에서
// 출발해, 사다리형으로 줄인다 — 5%를 시도하고 실패하면 같은 배치에서 4%→3%→2%→1%로
// 폭을 낮춰 재시도하고, 어느 폭에서든 성공하면 그 배치를 새 기준으로 다시 5%부터
// 시작한다. 1%마저 실패하면 수렴. 실패한 시도는 어느 매크로가 어떤 규칙으로 막혔는지
// 진단하고, 실패 종류별 처리 알고리즘을 거친 과정을 단계별 배치와 함께 남긴다. 통과한
// 배치는 전부 후보 풀에 들어가 각자 히스토리를 쌓고, utilization 기준을 넘는 것 중
// 배선이 짧은 순으로 실제 OpenLane DRC/LVS 검증 대상으로 내보낸다.
// 모델: game/macroAreaModel.ts, 계산: 웹 워커.
import { useEffect, useMemo, useRef, useState } from 'react'
import { hubDefs, N_HUBS, REAL_GLUE, REAL_GLUE_OTHER_PURPOSE, REAL_GLUE_OTHER_PURPOSE_CELLS, REAL_GLUE_OTHER_PURPOSE_RATIO, REAL_GLUE_OTHER_PURPOSE_AREA, LO_CELL, MIN_SPACING, CHANNEL_SAFE_MARGIN, REAL_CHAN_TOP, cloneState, type State, type GlueTile, type Macro, type Pos } from '../game/macroTetrisModel'
import {
  BASE_DIE, EDGE_MARGIN, SHRINK_LADDER, SHAPE_LABEL, ISSUE_LABEL, CHANNEL_SAMPLES, analyzeLeftoverD, costD, gateReason, diagnoseD,
  summarizeIssues, requiredDensity, dieArea, dieUtil, glueTilesNeeded, fillGlueD, realStart, toAreaCfg, candidateDies, shapeVariantDies, baseFor, metricsOf, layoutSig, scaleHubs,
  type Die, type AreaOpts, type Issue, type RepairStep, type ShapeAttempt, type TrialPlan, type CandMetrics,
} from '../game/macroAreaModel'
import type { AreaRequest, AreaResponse } from '../game/macroAreaWorker'

type Cur = { die: Die; state: State }
type TrialRec = { n: number; plan: TrialPlan; attempts: ShapeAttempt[]; accepted: { die: Die; util: number } | null; note: string; converged: boolean }
type HistEvent = { t: string; text: string }
type Cand = {
  id: string; sig: string; die: Die; macros: Macro[]; hubs: Pos[]; metrics: CandMetrics
  method: string; source: 'search' | 'generate' | 'manual'; steps: RepairStep[]
  history: HistEvent[]; found: number; verify: 'not-run' | 'queued'
}
type BoardView = { die: Die; macros: Macro[]; hubs: Pos[]; issues: Issue[]; title: string }
type Best = { die: Die; state: State; util: number; round: number; foundAt: string }

const CANVAS_W = 700
const CANVAS_H = Math.round(CANVAS_W * BASE_DIE.h / BASE_DIE.w)
const DRAG_SNAP = 10
const DENSITY_OPTIONS = [0.4, 0.5, 0.6] as const
const CAND_CAP = 800
// 후보 생성이 지금까지 seeds:0(무작위 시작 없음)으로 호출돼 있어서 후보 다양성이 여유
// 분할 조합(결정론적)에만 갇혀 있었다 — Macro Tetris의 random-restart 아이디어를 옮겨
// local minimum을 벗어날 무작위 시작점을 추가한다. 로드맵 카드의 "8~16개" 권장 범위.
const GENERATE_RANDOM_SEEDS = 12

function optsKey(o: AreaOpts) { return `${Math.round(o.density * 100)}-${o.strict ? 'strict' : 'relaxed'}` }
function readJson<T>(key: string): T | null { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : null } catch { return null } }
function writeJson(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* 저장 불가 환경이면 화면에만 유지 */ } }
const bestKey = (o: AreaOpts) => `macro-area-tetris-best-${optsKey(o)}`
const candKey = (o: AreaOpts) => `macro-area-tetris-cands-v1-${optsKey(o)}`
function now() { return new Date().toLocaleString('ko-KR') }
// 저장된 후보 중 지금 게이트 기준으로 illegal한 것을 걸러낸다 — 채널 하드 게이트처럼
// 나중에 추가된 실측 기반 규칙이 있으면 이전에 저장된 후보가 무효가 될 수 있다.
function validCands(list: Cand[], o: AreaOpts): Cand[] {
  return list.filter(k => !gateReason(k.die, { macros: k.macros, hubs: k.hubs }, costD({ macros: k.macros, hubs: k.hubs }, k.die), o))
}
// 생성 경위(처음 3줄)는 항상 남기고, 그 뒤는 최근 30줄만.
function capHistory(h: HistEvent[]): HistEvent[] { return h.length <= 33 ? h : [...h.slice(0, 3), ...h.slice(-30)] }
function mm2(a: number) { return (a / 1e6).toFixed(3) }
function pct(v: number, digits = 1) { return `${(v * 100).toFixed(digits)}%` }
function signedPct(v: number) { return `${v > 0 ? '+' : ''}${(v * 100).toFixed(2)}%` }

function startFrom(o: AreaOpts): { cur: Cur; label: string } {
  const b = readJson<Best>(bestKey(o))
  if (b) {
    const bc = { die: { ...b.die }, state: cloneState(b.state) }
    // 2026-09-26: 매크로 그룹 채널 하드 게이트가 새로 추가됨 — 그 전에 저장된 최고
    // 결과가 지금 기준으로 illegal(예: 채널 부족)할 수 있으니 불러오기 전에 다시 검사한다.
    const why = gateReason(bc.die, bc.state, costD(bc.state, bc.die), o)
    if (!why) return { cur: bc, label: `기존 최고 결과 (${b.die.w}×${b.die.h}, util ${pct(b.util)}, ${b.foundAt})` }
    return { cur: realStart(), label: `실제 signoff 격자 3700×2100 (저장된 최고 결과가 지금 기준으로 무효 — ${why})` }
  }
  return { cur: realStart(), label: '실제 signoff 격자 3700×2100 (저장된 성공 결과 없음)' }
}

function drawArea(ctx: CanvasRenderingContext2D, v: BoardView, glue: GlueTile[], sel: number | null) {
  const { die, macros, hubs, issues } = v
  const s = CANVAS_W / BASE_DIE.w
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
  ctx.fillStyle = 'rgba(192,57,43,0.5)'
  if (die.w < BASE_DIE.w) ctx.fillRect(die.w * s, 0, (BASE_DIE.w - die.w) * s, Math.min(die.h, BASE_DIE.h) * s)
  if (die.h < BASE_DIE.h) ctx.fillRect(0, die.h * s, BASE_DIE.w * s, (BASE_DIE.h - die.h) * s)
  ctx.fillStyle = '#16213a'
  ctx.fillRect(0, 0, die.w * s, die.h * s)

  const lo = analyzeLeftoverD(die, macros)
  for (let r = 0; r < lo.rows; r++) for (let c = 0; c < lo.cols; c++) {
    const cls = lo.cellClass[r * lo.cols + c]
    if (cls === 0) continue
    ctx.fillStyle = cls === 1 ? 'rgba(29,158,117,0.22)' : 'rgba(230,120,78,0.40)'
    ctx.fillRect(c * LO_CELL * s, r * LO_CELL * s, LO_CELL * s, LO_CELL * s)
  }
  ctx.setLineDash([6, 4]); ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, BASE_DIE.w * s - 1, BASE_DIE.h * s - 1)
  ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(232,194,103,0.5)'
  ctx.strokeRect(EDGE_MARGIN * s, EDGE_MARGIN * s, (die.w - 2 * EDGE_MARGIN) * s, (die.h - 2 * EDGE_MARGIN) * s)
  ctx.setLineDash([])
  ctx.strokeStyle = '#E8C267'; ctx.lineWidth = 2
  ctx.strokeRect(1, 1, die.w * s - 2, die.h * s - 2)

  for (let h = 0; h < N_HUBS; h++) {
    const hub = hubs[h], def = hubDefs[h]
    ctx.strokeStyle = def.color + '55'; ctx.lineWidth = Math.max(1, def.weight)
    for (const m of macros) {
      const mcx = m.x + m.w / 2, mcy = m.y + m.h / 2
      ctx.beginPath(); ctx.moveTo(hub.x * s, hub.y * s); ctx.lineTo(hub.x * s, mcy * s); ctx.lineTo(mcx * s, mcy * s); ctx.stroke()
    }
    ctx.fillStyle = def.color
    ctx.beginPath(); ctx.arc(hub.x * s, hub.y * s, 4, 0, Math.PI * 2); ctx.fill()
  }

  // 실패 부위: 문제 있는 매크로는 빨간 테두리+종류 표시, 간격/겹침 쌍은 빨간 연결선.
  const flagged = new Map<number, string[]>()
  for (const is of issues) for (const i of is.macros) flagged.set(i, [...(flagged.get(i) ?? []), ISSUE_LABEL[is.kind]])
  macros.forEach((p, i) => {
    const bad = flagged.has(i)
    ctx.fillStyle = bad ? '#F4B6A6' : (i === sel ? '#9FD8C2' : '#85B7EB')
    ctx.fillRect(p.x * s, p.y * s, p.w * s, p.h * s)
    ctx.strokeStyle = bad ? '#C0392B' : i === sel ? '#E8C267' : '#185FA5'; ctx.lineWidth = bad ? 2.5 : i === sel ? 2 : 1.2
    ctx.strokeRect(p.x * s, p.y * s, p.w * s, p.h * s)
    const k = Math.min(1, Math.sqrt(REAL_CHAN_TOP.cellArea / (p.w * p.h)))
    ctx.strokeStyle = '#0F6E56'; ctx.setLineDash([3, 3])
    ctx.strokeRect((p.x + (p.w - p.w * k) / 2) * s, (p.y + (p.h - p.h * k) / 2) * s, p.w * k * s, p.h * k * s); ctx.setLineDash([])
    ctx.fillStyle = '#042C53'; ctx.font = 'bold 10px sans-serif'
    ctx.fillText(`ch${i}`, p.x * s + 3, p.y * s + 11)
    ctx.font = '9px sans-serif'
    ctx.fillText(`(${Math.round(p.x)}, ${Math.round(p.y)})`, p.x * s + 3, p.y * s + 21)
    if (bad) { ctx.fillStyle = '#9B2C1F'; ctx.font = 'bold 9px sans-serif'; ctx.fillText([...new Set(flagged.get(i))].join('·') + ' ✕', p.x * s + 3, p.y * s + 32) }
  })
  for (const is of issues) {
    if ((is.kind !== 'spacing' && is.kind !== 'overlap') || is.macros.length !== 2) continue
    const a = macros[is.macros[0]], b = macros[is.macros[1]]
    ctx.strokeStyle = '#E74C3C'; ctx.lineWidth = 2; ctx.setLineDash([4, 3])
    ctx.beginPath(); ctx.moveTo((a.x + a.w / 2) * s, (a.y + a.h / 2) * s); ctx.lineTo((b.x + b.w / 2) * s, (b.y + b.h / 2) * s); ctx.stroke(); ctx.setLineDash([])
  }

  // 이제 정사각형이 아니라 가변 폭(row 조각)이라 t.w를 그대로, 높이는 LO_CELL.
  glue.forEach((t, i) => {
    ctx.fillStyle = 'rgba(126,104,215,0.55)'
    ctx.fillRect(t.x * s + 1, t.y * s + 1, t.w * s - 2, LO_CELL * s - 2)
    ctx.strokeStyle = hubDefs[t.hub].color; ctx.lineWidth = 1.5
    ctx.strokeRect(t.x * s + 1, t.y * s + 1, t.w * s - 2, LO_CELL * s - 2)
    ctx.fillStyle = '#fff'; ctx.font = 'bold 8px sans-serif'
    ctx.fillText(`S${i + 1}`, t.x * s + 3, t.y * s + 10)
  })

  ctx.fillStyle = '#E8C267'; ctx.font = 'bold 11px sans-serif'
  const label = `${die.w} × ${die.h} µm`
  ctx.fillText(label, Math.max(4, Math.min(die.w * s - ctx.measureText(label).width - 6, CANVAS_W - 120)), Math.min(die.h * s + 14, CANVAS_H - 4))
}

// 시도마다의 면적 — 초록은 성공(그 면적으로 채택), 빨강은 실패한 목표 면적. 선은 "지금까지 성공한 면적".
function AreaChart({ start, trials }: { start: Die; trials: TrialRec[] }) {
  const pts = trials.filter(t => !t.converged)
  if (pts.length === 0) return <p className="chip-note" style={{ marginTop: 10 }}>탐색을 시작하면 시도마다의 면적(성공=초록, 실패=빨강)이 그려집니다.</p>
  const W = 660, H = 190, padL = 52, padR = 16, padT = 16, padB = 28
  const areas = [dieArea(start), dieArea(BASE_DIE), ...pts.map(t => t.accepted ? dieArea(t.accepted.die) : Math.max(...t.attempts.map(a => dieArea(a.die))))]
  const lo = Math.min(...areas) * 0.998, hi = Math.max(...areas) * 1.002
  const x = (i: number) => padL + i * (W - padL - padR) / Math.max(1, pts.length)
  const y = (a: number) => padT + (hi - a) / (hi - lo) * (H - padT - padB)
  let okA = dieArea(start)
  const okLine: string[] = [`${x(0)},${y(okA)}`]
  pts.forEach((t, i) => { if (t.accepted) okA = dieArea(t.accepted.die); okLine.push(`${x(i + 1)},${y(okA)}`) })
  return <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="시도별 다이 면적" style={{ width: '100%', height: 'auto', marginTop: 8 }}>
    {[dieArea(BASE_DIE), dieArea(start)].map((a, k) => <g key={k}>
      <line x1={padL} x2={W - padR} y1={y(a)} y2={y(a)} stroke="var(--border-strong)" strokeDasharray="4 4"/>
      <text x={padL - 4} y={y(a) + 3} fontSize={9} textAnchor="end" fill="var(--text-muted)">{k === 0 ? '원래' : '시작'} {mm2(a)}</text>
    </g>)}
    <polyline points={okLine.join(' ')} fill="none" stroke="#1D9E75" strokeWidth={2}/>
    <circle cx={x(0)} cy={y(dieArea(start))} r={4} fill="#888780"/>
    {pts.map((t, i) => {
      const a = t.accepted ? dieArea(t.accepted.die) : Math.max(...t.attempts.map(q => dieArea(q.die)))
      return <g key={t.n}>
        <circle cx={x(i + 1)} cy={y(a)} r={4.5} fill={t.accepted ? '#1D9E75' : '#E24B4A'}/>
        <text x={x(i + 1)} y={H - 10} fontSize={9} textAnchor="middle" fill="var(--text-muted)">#{t.n}</text>
        <text x={x(i + 1)} y={y(a) - 8} fontSize={9} textAnchor="middle" fill={t.accepted ? '#1D9E75' : '#E24B4A'}>{t.accepted ? `${t.accepted.die.h}` : '✕'}</text>
      </g>
    })}
    <text x={padL} y={H - 1} fontSize={9} fill="var(--text-muted)">시도 번호 (위 숫자 = 채택된 다이 높이 µm, 선 = 지금까지 성공한 면적)</text>
  </svg>
}

export default function MacroAreaTetris() {
  const initialOpts: AreaOpts = { density: REAL_GLUE.targetDensity, strict: true }
  const [opts, setOpts] = useState<AreaOpts>(initialOpts)
  const [start, setStart] = useState(() => startFrom(initialOpts))
  const [cur, setCur] = useState<Cur>(() => start.cur)
  const [shrinkPct, setShrinkPct] = useState<number>(SHRINK_LADDER[0])
  const [trials, setTrials] = useState<TrialRec[]>([])
  const [liveAttempts, setLiveAttempts] = useState<ShapeAttempt[]>([])
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [converged, setConverged] = useState<string | null>(null)
  const [narration, setNarration] = useState(`${start.label}에서 시작합니다. ▶ 면적 탐색을 누르면 −${SHRINK_LADDER[0]}%부터 시도하고, 실패하면 같은 배치에서 ${SHRINK_LADDER.slice(1).map(p => `−${p}%`).join('→')}로 폭을 줄여 재시도합니다. 성공하면 그 배치에서 다시 −${SHRINK_LADDER[0]}%부터 이어갑니다.`)
  const [best, setBest] = useState<Best | null>(() => readJson<Best>(bestKey(initialOpts)))
  const [cands, setCands] = useState<Cand[]>(() => validCands(readJson<Cand[]>(candKey(initialOpts)) ?? [], initialOpts))
  // 75%가 기본값이었는데, 실제 신호 격자(3700×2100)에서 나오는 모든 후보의
  // utilization은 71.82%다(macro+glue 면적은 고정, 다이 면적도 같은 다이 크기 안에서는
  // 전부 같으므로 위치가 달라도 util은 동일) — 그래서 후보를 108개 만들어도 기본
  // 필터가 전부 숨겨서 "CANDIDATE POOL"이 텅 비어 보였다(실측 재현: 사용자 리포트
  // "상태 화면에는 있는데 실재 후보는 없어"). 지금까지 알려진 형상(2행 71.8%, 4행
  // 68.3%, 3행 62.3% — 4행/3행은 아직 legal화가 안 되지만) 전부 보이도록 60%로 낮춤.
  const [utilMin, setUtilMin] = useState(0.6)
  const [genProgress, setGenProgress] = useState<{ done: number; total: number; found: number } | null>(null)
  const [selCand, setSelCand] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [openTrial, setOpenTrial] = useState<number | null>(null)
  const [board, setBoard] = useState<BoardView | null>(null)
  const [glue, setGlue] = useState<GlueTile[]>([])
  const [sel, setSel] = useState<number | null>(null)
  const [speed, setSpeed] = useState(300)
  const [exportText, setExportText] = useState<{ title: string; text: string } | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const jobRef = useRef(0)
  const dragRef = useRef<{ idx: number; dx: number; dy: number } | null>(null)
  const curRef = useRef(cur); curRef.current = cur
  const optsRef = useRef(opts); optsRef.current = opts
  const shrinkPctRef = useRef(shrinkPct); shrinkPctRef.current = shrinkPct
  const trialsRef = useRef(trials); trialsRef.current = trials
  const bestRef = useRef(best); bestRef.current = best
  const pendingRef = useRef<{ die: Die; macros: Macro[]; hubs: Pos[]; method: string; source: Cand['source']; steps: RepairStep[]; event: string }[]>([])

  const c = costD(cur.state, cur.die)
  const gate = gateReason(cur.die, cur.state, c, opts)
  const util = dieUtil(cur.die, cur.state.macros)
  const reqDen = requiredDensity(cur.die, cur.state.macros)
  const vsBase = dieArea(cur.die) / dieArea(BASE_DIE) - 1
  const vsStart = dieArea(cur.die) / dieArea(start.cur.die) - 1
  const locked = busy !== null || searching
  const view: BoardView = board ?? { die: cur.die, macros: cur.state.macros, hubs: cur.state.hubs, issues: diagnoseD(cur.die, cur.state, opts), title: '현재 배치' }

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) drawArea(ctx, view, board ? [] : glue, board ? null : sel)
  })

  useEffect(() => { writeJson(candKey(opts), cands) }, [cands, opts])

  function considerBest(next: Cur, round: number) {
    const u = dieUtil(next.die, next.state.macros)
    if (gateReason(next.die, next.state, costD(next.state, next.die), optsRef.current)) return
    const b = bestRef.current
    if (b && b.util >= u - 1e-9) return
    const nb: Best = { die: { ...next.die }, state: cloneState(next.state), util: u, round, foundAt: now() }
    setBest(nb); writeJson(bestKey(optsRef.current), nb)
  }

  // 같은 배치(10µm 단위 좌표가 같은 것)가 다시 나오면 새 후보를 만들지 않고 히스토리에 "재발견"을 쌓는다.
  function flushCandidates() {
    const batch = pendingRef.current
    if (batch.length === 0) return
    pendingRef.current = []
    setCands(prev => {
      const map = new Map(prev.map(p => [p.sig, p]))
      // 한 묶음 안의 재발견은 후보당 한 줄로 합친다(같은 배치로 수렴하는 변형이 수십 개씩 나옴).
      const again = new Map<string, { n: number; first: string }>()
      for (const b of batch) {
        const sig = layoutSig(b.die, b.macros)
        const hit = map.get(sig)
        if (hit) {
          const a = again.get(sig)
          again.set(sig, { n: (a?.n ?? 0) + 1, first: a?.first ?? b.event })
          map.set(sig, { ...hit, found: hit.found + 1 })
          continue
        }
        const metrics = metricsOf(b.die, { macros: b.macros, hubs: b.hubs })
        const applied = b.steps.filter(s => s.applied && s.action !== b.steps[0]?.action)
        map.set(sig, {
          id: `C${String(map.size + 1).padStart(4, '0')}`, sig, die: b.die, macros: b.macros, hubs: b.hubs, metrics, method: b.method, source: b.source, steps: b.steps,
          found: 1, verify: 'not-run',
          history: [
            { t: now(), text: `생성 — ${b.event}` },
            { t: now(), text: applied.length ? `처리 ${applied.length}단계 적용: ${applied.map(s => s.action).join(' → ')}` : '처리 없이 바로 통과' },
            { t: now(), text: `지표 — util ${pct(metrics.util, 2)} · 배선 ${Math.round(metrics.wl).toLocaleString()} · 필요 밀도 ${pct(metrics.reqDensity)} · 핀/전원 막힘 ${metrics.pin}/${metrics.power}` },
          ],
        })
      }
      for (const [sig, a] of again) {
        const k = map.get(sig)
        if (k) map.set(sig, { ...k, history: capHistory([...k.history, { t: now(), text: a.n === 1 ? `재발견 — ${a.first}` : `재발견 ×${a.n} — 다른 방법에서 같은 배치로 수렴 (예: ${a.first})` }]) })
      }
      const all = [...map.values()].sort((a, b) => b.metrics.util - a.metrics.util || a.metrics.wl - b.metrics.wl)
      return all.slice(0, CAND_CAP)
    })
  }

  // jobRef만 올리고 예전 Worker를 그대로 두면, 그 Worker는 여전히 예전 계산을 끝까지
  // 돌린다(결과가 id 불일치로 버려질 뿐 CPU는 계속 씀) — 특히 탐색 도중 Reset을 누르면
  // 몇 초짜리 trial이 화면엔 안 보이는 채로 계속 실행된다. terminate 후 새로 만들어서
  // 실제로 계산을 멈춘다.
  function createWorker(): Worker {
    const w = new Worker(new URL('../game/macroAreaWorker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<AreaResponse>) => {
      const msg = e.data
      if (msg.id !== jobRef.current) return
      if (msg.kind === 'attempt') { setLiveAttempts(prev => [...prev, msg.a]); return }
      if (msg.kind === 'variant') {
        pendingRef.current.push({ die: msg.v.die, macros: msg.v.macros, hubs: msg.v.hubs, method: msg.v.method, source: 'generate', steps: msg.v.steps, event: `후보 생성 ${msg.v.die.w}×${msg.v.die.h} · ${msg.v.method}` })
        setGenProgress(p => (p ? { ...p, found: p.found + 1 } : p))
        return
      }
      if (msg.kind === 'genProgress') { flushCandidates(); setGenProgress(p => ({ done: msg.done, total: msg.total, found: p?.found ?? 0 })); return }
      if (msg.kind === 'generated') {
        flushCandidates(); setBusy(null)
        setNarration(`후보 생성 완료 — 통과 배치 ${msg.found}개(중복은 기존 후보 히스토리에 "재발견"으로 누적). 아래 후보 풀에서 utilization 기준과 배선 길이로 고르세요.`)
        return
      }
      if (msg.kind === 'ripup') {
        setBusy(null)
        const next = { die: curRef.current.die, state: msg.state }
        setCur(next); setGlue([]); setBoard(null)
        setNarration(msg.moves > 0 ? `Rip-up: 매크로 ${msg.moves}번 이동 — 비용 ${Math.round(msg.before).toLocaleString()} → ${Math.round(msg.after).toLocaleString()}` : 'Rip-up: 더 개선되는 이동 없음')
        return
      }
      setBusy(null)
      const r = msg.result
      const n = trialsRef.current.filter(t => !t.converged).length + 1
      if (r.converged) {
        setTrials(prev => [...prev, { n, plan: r.plan, attempts: [], accepted: null, note: r.note, converged: true }])
        setSearching(false); setConverged(r.note)
        setNarration(`${r.note}. 최소 다이 ${curRef.current.die.w}×${curRef.current.die.h} — 이어서 후보를 만듭니다.`)
        generate(curRef.current)
        return
      }
      const acc = r.accepted
      setTrials(prev => [...prev, { n, plan: r.plan, attempts: r.attempts, accepted: acc ? { die: acc.die, util: acc.util } : null, note: r.note, converged: false }])
      setShrinkPct(r.nextPct)
      if (acc) {
        const next = { die: acc.die, state: acc.state }
        setCur(next); setGlue(acc.glue.tiles); setBoard(null)
        pendingRef.current.push({ die: acc.die, macros: acc.state.macros, hubs: acc.state.hubs, method: `면적 탐색 #${n} (−${r.plan.pct}%, ${SHAPE_LABEL[acc.shape]})`, source: 'search', steps: acc.steps, event: `면적 탐색 #${n} 통과 — 목표 ${mm2(r.plan.targetArea)}mm² (−${r.plan.pct}%)` })
        flushCandidates()
        considerBest(next, n)
        setNarration(`#${n} −${r.plan.pct}% 성공: ${acc.die.w}×${acc.die.h} (util ${pct(acc.util, 2)}) → 다음은 이 배치에서 다시 −${SHRINK_LADDER[0]}%`)
      } else {
        const worst = r.attempts.find(a => a.shape === 'height') ?? r.attempts[0]
        setNarration(`#${n} −${r.plan.pct}% 실패: ${worst ? `${worst.die.w}×${worst.die.h} — ${worst.reason}` : '만들 수 있는 후보 다이 없음'} → 같은 배치에서 −${r.nextPct}% 재시도`)
      }
    }
    return w
  }

  useEffect(() => {
    const w = createWorker()
    workerRef.current = w
    return () => w.terminate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 예전 Worker를 실제로 끊고(계산 중지) 새 Worker로 교체한다 — jobRef 증가만으로는
  // 결과를 무시할 뿐 CPU 점유는 안 멈춘다.
  function restartWorker() {
    workerRef.current?.terminate()
    workerRef.current = createWorker()
  }

  function runTrial() {
    const w = workerRef.current
    if (!w) return
    const why = gateReason(curRef.current.die, curRef.current.state, costD(curRef.current.state, curRef.current.die), optsRef.current)
    if (why) { setSearching(false); setNarration(`지금 배치가 통과 조건을 못 맞춰 탐색을 시작할 수 없음 — ${why}. 다시 초기화하거나 Rip-up으로 정리하세요.`); return }
    const id = ++jobRef.current
    setLiveAttempts([]); setExportText(null)
    setBusy(`시도 #${trialsRef.current.filter(t => !t.converged).length + 1} 계산 중`)
    w.postMessage({ id, kind: 'trial', die: curRef.current.die, state: curRef.current.state, pct: shrinkPctRef.current, opts: optsRef.current } satisfies AreaRequest)
  }

  useEffect(() => {
    if (!searching || busy) return
    const t = setTimeout(runTrial, speed)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching, busy, trials])

  function generate(from: Cur) {
    const w = workerRef.current
    if (!w) return
    // 높이만 늘리는 sweep(같은 폭) + 수렴한 면적을 유지한 채 종횡비를 바꾸는 2차원
    // 형상 sweep을 합친다. 후자는 이 위상에서 대부분 폭이 3700µm보다 좁아 4개씩
    // 2행으로 못 들어가므로, repairFrom이 3·4행으로 재구성하거나(면적이 더 필요)
    // 그마저 안 되면 그냥 실패로 걸러진다 — "더 작은 다이"가 아니라 "형상이 다른
    // legal 후보"가 목적이다(배선·혼잡 프로파일 다양화).
    const heightSweep = candidateDies(from.die, Math.max(BASE_DIE.h, from.die.h))
    const shapeSweep = shapeVariantDies(from.state.macros)
    const seen = new Set(heightSweep.map(d => `${d.w}x${d.h}`))
    const dies = [...heightSweep, ...shapeSweep.filter(d => !seen.has(`${d.w}x${d.h}`))]
    const id = ++jobRef.current
    setGenProgress({ done: 0, total: dies.length, found: 0 })
    setBusy(`후보 생성 중 — 다이 ${dies.length}개 (높이 sweep ${heightSweep.length} + 형상 sweep ${shapeSweep.length})`)
    w.postMessage({ id, kind: 'generate', bases: dies.map(d => baseFor(d, from)), opts: optsRef.current, seeds: GENERATE_RANDOM_SEEDS, seedBase: Date.now() % 100000 } satisfies AreaRequest)
  }

  function reset(which: 'best' | 'real', o: AreaOpts = opts) {
    jobRef.current++
    // busy(=아직 응답 안 온 job이 있음)일 때만 재시작 — 그렇지 않으면 매번 정상적인
    // Worker까지 불필요하게 버리고 새로 만들게 된다.
    if (busy !== null) restartWorker()
    const s = which === 'best' ? startFrom(o) : { cur: realStart(), label: '실제 signoff 격자 3700×2100' }
    setStart(s); setCur(s.cur); setShrinkPct(SHRINK_LADDER[0]); setTrials([]); setLiveAttempts([])
    setSearching(false); setBusy(null); setConverged(null); setGlue([]); setBoard(null); setSel(null); setExportText(null); setGenProgress(null)
    setNarration(`${s.label}에서 다시 시작`)
  }

  function changeOpts(next: AreaOpts) {
    setOpts(next)
    setBest(readJson<Best>(bestKey(next)))
    setCands(validCands(readJson<Cand[]>(candKey(next)) ?? [], next))
    setSelCand(null); setChecked(new Set())
    reset('best', next)
  }

  function ripUp() {
    const w = workerRef.current
    if (!w || locked) return
    const id = ++jobRef.current
    setBusy('Rip-up & Re-place 계산 중')
    w.postMessage({ id, kind: 'ripup', die: cur.die, state: cur.state } satisfies AreaRequest)
  }

  function saveCurrentAsCandidate() {
    if (gate) { setNarration(`통과 조건을 못 맞춘 배치는 후보로 저장할 수 없음 — ${gate}`); return }
    pendingRef.current.push({ die: cur.die, macros: cur.state.macros, hubs: cur.state.hubs, method: '수동 편집', source: 'manual', steps: [], event: '현재 배치를 직접 저장' })
    flushCandidates()
    setNarration('현재 배치를 후보 풀에 저장')
  }

  function addHistory(ids: string[], text: string, patch?: Partial<Cand>) {
    setCands(prev => prev.map(p => ids.includes(p.id) ? { ...p, ...patch, history: capHistory([...p.history, { t: now(), text }]) } : p))
  }

  const ranked = useMemo(() => cands.filter(k => k.metrics.util >= utilMin - 1e-9).sort((a, b) => a.metrics.wl - b.metrics.wl || b.metrics.util - a.metrics.util || a.metrics.cost - b.metrics.cost), [cands, utilMin])
  const selected = cands.find(k => k.id === selCand) ?? null

  function exportSelected() {
    const list = cands.filter(k => checked.has(k.id))
    if (list.length === 0) return
    const payload = list.map(k => ({ id: k.id, die: k.die, util: Number(k.metrics.util.toFixed(4)), weighted_wl: Math.round(k.metrics.wl), config: JSON.parse(toAreaCfg(k.die, k.macros, opts.density)) }))
    setExportText({ title: `DRC/LVS 검증 대기열 — 후보 ${list.length}개`, text: JSON.stringify(payload, null, 2) })
    addHistory(list.map(k => k.id), `DRC/LVS 검증 대기열에 추가 (${list.length}개 묶음) — 아직 OpenLane 미실행`, { verify: 'queued' })
  }

  function toCanvas(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const s = CANVAS_W / BASE_DIE.w
    return { x: (e.clientX - rect.left) * (CANVAS_W / rect.width) / s, y: (e.clientY - rect.top) * (CANVAS_H / rect.height) / s }
  }
  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (board) return
    const p = toCanvas(e)
    const idx = cur.state.macros.findIndex(m => p.x >= m.x && p.x <= m.x + m.w && p.y >= m.y && p.y <= m.y + m.h)
    setSel(idx >= 0 ? idx : null)
    if (idx < 0 || locked) return
    dragRef.current = { idx, dx: p.x - cur.state.macros[idx].x, dy: p.y - cur.state.macros[idx].y }
  }
  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const d = dragRef.current
    if (!d) return
    const p = toCanvas(e)
    const m = cur.state.macros[d.idx]
    const x = Math.round(Math.min(cur.die.w - EDGE_MARGIN - m.w, Math.max(EDGE_MARGIN, p.x - d.dx)) / DRAG_SNAP) * DRAG_SNAP
    const y = Math.round(Math.min(cur.die.h - EDGE_MARGIN - m.h, Math.max(EDGE_MARGIN, p.y - d.dy)) / DRAG_SNAP) * DRAG_SNAP
    if (x === m.x && y === m.y) return
    setCur({ die: cur.die, state: { ...cur.state, macros: cur.state.macros.map((q, k) => (k === d.idx ? { ...q, x, y } : q)) } })
    setGlue([])
  }
  function onMouseUp() { dragRef.current = null }

  const realTrials = trials.filter(t => !t.converged)
  const statusText = busy ? 'AI COMPUTING' : searching ? `AREA SEARCH #${realTrials.length + 1}` : converged ? 'CONVERGED' : gate ? 'GATE FAIL' : 'READY'

  return <div className="chip-tetris-page">
    <section className="chip-game-hero">
      <div>
        <small>MACRO TETRIS · AREA MODE · −5%부터 시도하고, 실패하면 폭을 줄여 재시도한다</small>
        <h2>Macro Area Tetris</h2>
        <p><b>기존에 성공했던 결과</b>에서 출발해 다이 면적만 탐색합니다. <b>사다리형</b>: 먼저 −{SHRINK_LADDER[0]}%를 시도하고, 실패하면 같은 배치에서 {SHRINK_LADDER.slice(1).map(p => `−${p}%`).join(' → ')}로 폭을 줄여 재시도합니다. 어느 폭에서든 성공하면 그 결과를 새 기준으로 삼아 다음 시도는 다시 −{SHRINK_LADDER[0]}%부터 시작합니다 — −{SHRINK_LADDER[SHRINK_LADDER.length - 1]}%마저 실패하면 그 다이가 수렴점(이 모델 기준 최소 면적)입니다. 실패한 시도는 <b>어느 매크로가 어떤 규칙으로 막혔는지</b> 진단하고, 실패 종류별 처리 알고리즘을 거친 과정을 단계별로 남깁니다. 통과한 배치는 전부 후보 풀에 쌓이고, 수렴 후 여러 다이 높이·여유 분할로 후보를 더 만듭니다.</p>
      </div>
      <div className={`ai-status ${busy || searching ? 'live' : ''}`}><i/><span>{statusText}</span></div>
    </section>

    <section className="chip-scorebar">
      <div><span>DIE</span><b>{cur.die.w}×{cur.die.h}</b></div>
      <div><span>원래(3700×2100) 대비</span><b className="pass">{signedPct(vsBase)}</b></div>
      <div><span>시작점 대비</span><b className="pass">{signedPct(vsStart)}</b></div>
      <div><span>UTILIZATION</span><b className="pass">{pct(util, 2)}</b></div>
      <div><span>필요 밀도</span><b className={reqDen <= opts.density ? 'pass' : 'warn'}>{pct(reqDen)} / {Math.round(opts.density * 100)}%</b></div>
      <div><span>후보 (util≥{Math.round(utilMin * 100)}%)</span><b className="pass">{ranked.length} / {cands.length}</b></div>
      <div><span>다른 용도(glue 중 탭·버퍼)</span><b>{(REAL_GLUE_OTHER_PURPOSE_AREA / dieArea(cur.die) * 100).toFixed(1)}%</b><small>다이 대비 · glue 자체론 {(REAL_GLUE_OTHER_PURPOSE_RATIO * 100).toFixed(1)}%</small></div>
    </section>

    <section className="chip-game-layout">
      <div className="chip-board-wrap">
        <div className="zone-headings"><span>보고 있는 것: {view.title}</span><span>{view.die.w}×{view.die.h}µm</span><span>{view.issues.length ? `실패 부위 ${view.issues.length}건` : '통과'}</span></div>
        <canvas
          ref={canvasRef} width={CANVAS_W} height={CANVAS_H}
          style={{ width: '100%', height: 'auto', background: '#101726', border: '2px solid var(--border-strong)', borderRadius: 8, display: 'block', cursor: locked || board ? 'default' : 'grab' }}
          onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
        />
        {board && <div style={{ marginTop: 6 }}><button className="chip-link-button" onClick={() => setBoard(null)} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '0.5px solid var(--border-strong)', background: 'var(--surface-1)', color: 'var(--text-primary)', cursor: 'pointer' }}>← 현재 배치로 돌아가기</button></div>}
        {view.issues.length > 0 && <div className="data-table" style={{ marginTop: 6 }}><table><thead><tr><th>실패 부위</th><th>내용</th></tr></thead><tbody>
          {view.issues.slice(0, 10).map((is, k) => <tr key={k}><td><b>{ISSUE_LABEL[is.kind]}</b></td><td>{is.detail}</td></tr>)}
          {view.issues.length > 10 && <tr><td colSpan={2}>… 외 {view.issues.length - 10}건</td></tr>}
        </tbody></table></div>}
        <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
          {hubDefs.map(hd => <span key={hd.name}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: hd.color, marginRight: 4 }}/>{hd.name} (×{hd.weight})</span>)}
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#F4B6A6', border: '2px solid #C0392B', marginRight: 4 }}/>실패 부위 매크로</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'rgba(192,57,43,0.6)', marginRight: 4 }}/>줄여서 없어진 면적</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'rgba(230,120,78,0.6)', marginRight: 4 }}/>좁은 여유(채널·가장자리)</span>
        </div>
      </div>

      <aside className="chip-control-panel">
        <div className="ai-decision"><span className="panel-label">상태</span><b>{busy ?? narration}</b></div>

        <div><span className="panel-label">시작점</span>
          <div className="chip-switches" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <button className="active" onClick={() => reset('best')} disabled={busy !== null}>기존 성공 결과로 초기화</button>
            <button onClick={() => reset('real')} disabled={busy !== null}>실제 격자로 초기화</button>
          </div>
          <p className="key-help" style={{ marginTop: 4 }}>지금 시작점: {start.label}</p>
        </div>

        <div><span className="panel-label">면적 탐색 · 성공→축소 / 실패→증가</span>
          <div className="chip-switches">
            <button className="active" onClick={() => { setConverged(null); setSearching(true) }} disabled={searching || busy !== null || converged !== null}>▶ 면적 탐색</button>
            <button onClick={() => setSearching(false)} disabled={!searching}>일시정지</button>
            <button onClick={runTrial} disabled={locked || converged !== null}>한 번 시도</button>
          </div>
          <p className="key-help" style={{ marginTop: 4 }}>다음 시도 폭: <b>−{shrinkPct}%</b> (사다리 {SHRINK_LADDER.map(p => `${p}%`).join('→')} — 실패하면 다음 폭으로, 성공하면 −{SHRINK_LADDER[0]}%로 복귀)</p>
        </div>

        <div><span className="panel-label">통과 조건</span>
          <div className="chip-switches">
            {DENSITY_OPTIONS.map(d => <button key={d} className={opts.density === d ? 'active' : ''} onClick={() => changeOpts({ ...opts, density: d })} disabled={busy !== null}>밀도 {Math.round(d * 100)}%{d === REAL_GLUE.targetDensity ? ' (실제)' : ''}</button>)}
          </div>
          <div className="chip-switches" style={{ marginTop: 5, gridTemplateColumns: '1fr' }}>
            <button className={opts.strict ? 'active replace' : ''} onClick={() => changeOpts({ ...opts, strict: !opts.strict })} disabled={busy !== null}>{opts.strict ? '엄격: 핀 escape·전원 접근 CLEAN 필수' : '완화: 겹침·간격·경계·용량만'}</button>
          </div>
          <p className="key-help" style={{ marginTop: 4 }}>항상: 겹침 0 · 간격 ≥{MIN_SPACING}µm · 가장자리 ≥{EDGE_MARGIN}µm · 필요 밀도(glue {REAL_GLUE.cellArea.toLocaleString()}µm² ÷ (다이 − 매크로)) ≤ 목표. 엄격은 + 매크로마다 한 면 200µm 이상(핀 escape), 전원 링 또는 300µm 채널 접근. 조건마다 최고 결과·후보 풀이 따로 저장됩니다. 이 glue {REAL_GLUE.cellArea.toLocaleString()}µm² 중 {(REAL_GLUE_OTHER_PURPOSE_RATIO * 100).toFixed(1)}%({REAL_GLUE_OTHER_PURPOSE_CELLS.toLocaleString()}셀, 탭 {REAL_GLUE_OTHER_PURPOSE.tapCells.toLocaleString()}+타이밍 리페어 {REAL_GLUE_OTHER_PURPOSE.timingRepairBuffers.toLocaleString()}+hold 버퍼 {REAL_GLUE_OTHER_PURPOSE.holdBuffers.toLocaleString()})는 RTL 로직이 아니라 P&R이 끼워 넣은 <b>다른 용도</b> — 빈 공간처럼 보여도 실제로는 대부분 이미 목적이 정해져 있습니다.</p>
        </div>

        <div><span className="panel-label">후보 · 수동 편집</span>
          <div className="chip-switches">
            <button className="active" onClick={() => generate(cur)} disabled={locked || gate !== null}>후보 만들기</button>
            <button onClick={ripUp} disabled={locked || board !== null}>Rip-up</button>
            <button onClick={saveCurrentAsCandidate} disabled={locked}>후보로 저장</button>
          </div>
          {genProgress && <p className="key-help" style={{ marginTop: 4 }}>후보 생성 다이 {genProgress.done}/{genProgress.total} · 통과 배치 {genProgress.found}개</p>}
          <div className="chip-switches" style={{ marginTop: 5, gridTemplateColumns: '1fr' }}>
            <button onClick={() => { const r = fillGlueD(cur.die, cur.state.macros, cur.state.hubs, glueTilesNeeded(opts.density), opts.density); setGlue(r.tiles); setBoard(null) }} disabled={locked}>표준셀 타일 표시 (표시용){glue.length > 0 && ` — ${glue.length}/${glueTilesNeeded(opts.density)}개 배치됨`}</button>
          </div>
          <p className="key-help" style={{ marginTop: 4 }}>후보 만들기 = ① 지금 다이부터 3700×2100 높이까지 10µm마다(같은 폭) ② 행 수(1~4)별로 필요한 최소 다이를 closed form으로 계산한 형상(2차원 형상 sweep, MAX_ASPECT 안에서 최대 3개 — 3·4행은 아직 legal 후보 미생성) — 각 다이마다 세로 여유 분할(채널 폭 {CHANNEL_SAMPLES + 1}단계 × 위/아래 배분 3) × 가로 분배 4가지를 진단→처리 알고리즘에 통과시킵니다. 폭이 좁아 4개씩 2행으로 못 들어가는 형상은 처리 알고리즘이 3·4행으로 재구성하거나 실패로 걸러집니다. 탐색이 수렴하면 자동으로 실행됩니다.</p>
        </div>

        <label className="speed-control">시도 간격 <input type="range" min={0} max={1500} step={100} value={speed} onChange={e => setSpeed(Number(e.target.value))}/><b>{speed}ms</b></label>
      </aside>
    </section>

    <section className="chip-analysis-grid">
      <article className="chip-card" style={{ gridColumn: '1 / -1' }}>
        <div className="chip-card-title"><div><small>AREA SEARCH</small><h3>얼마나 줄어드는지 — 시도 기록</h3></div><span>{realTrials.length}번 시도 · 시작점 대비 {signedPct(vsStart)} · 원래 대비 {signedPct(vsBase)}</span></div>
        <AreaChart start={start.cur.die} trials={trials}/>
        <div className="data-table"><table><thead><tr><th>#</th><th>시도 폭</th><th>목표 면적</th><th>시작점 대비</th><th>결과</th><th>어느 부분이 실패했나 (세로만 후보 기준)</th><th>처리 알고리즘</th></tr></thead><tbody>
          {trials.map(t => {
            if (t.converged) return <tr key={`c${t.n}`}><td colSpan={7}><b>{t.note}</b></td></tr>
            const focus = t.attempts.find(a => a.shape === 'height') ?? t.attempts[0]
            const lastIssues = focus?.steps[focus.steps.length - 1]?.issues ?? []
            return <tr key={t.n} onClick={() => setOpenTrial(o => (o === t.n ? null : t.n))} style={{ cursor: 'pointer', background: openTrial === t.n ? 'var(--accent-soft)' : undefined }}>
              <td><b>#{t.n}</b></td>
              <td>−{t.plan.pct}%</td>
              <td>{mm2(t.plan.targetArea)}mm²</td>
              <td>{signedPct(t.plan.targetArea / dieArea(start.cur.die) - 1)}</td>
              <td>{t.accepted ? <span className="ok-badge">성공 {t.accepted.die.w}×{t.accepted.die.h}</span> : <span className="warning-badge">실패 → 폭 줄여 재시도</span>}</td>
              <td style={{ fontSize: 11 }}>{t.accepted ? '-' : summarizeIssues(lastIssues)}</td>
              <td style={{ fontSize: 11 }}>{focus ? focus.steps.map(s => `${s.action}${s.applied ? '' : '(불가)'}`).join(' → ') : '-'}</td>
            </tr>
          })}
        </tbody></table></div>
        {openTrial !== null && (() => {
          const t = trials.find(x => x.n === openTrial && !x.converged)
          if (!t) return null
          return <div style={{ marginTop: 10 }}>
            <p className="chip-note"><b>#{t.n} 상세</b> — 후보 다이별 진단·처리 단계. 단계를 누르면 그 시점 배치가 위 보드에 실패 부위와 함께 그려집니다.</p>
            {t.attempts.map((a, ai) => <div key={ai} className="data-table" style={{ marginTop: 6 }}><table>
              <thead><tr><th colSpan={4}>{SHAPE_LABEL[a.shape]} · {a.die.w}×{a.die.h}µm ({mm2(dieArea(a.die))}mm²) — {a.ok ? '통과' : `실패: ${a.reason}`}</th></tr><tr><th>단계</th><th>무엇을 했나</th><th>결과 진단</th><th>적용</th></tr></thead>
              <tbody>{a.steps.map((s, si) => <tr key={si} onClick={() => setBoard({ die: a.die, macros: s.macros, hubs: scaleHubs(start.cur.state.hubs, start.cur.die, a.die), issues: s.issues, title: `#${t.n} ${SHAPE_LABEL[a.shape]} ${a.die.w}×${a.die.h} · ${s.action}` })} style={{ cursor: 'pointer' }}>
                <td><b>{s.action}</b></td><td style={{ fontSize: 11 }}>{s.why}</td>
                <td style={{ fontSize: 11 }}>{s.ok ? <span className="ok-badge">통과</span> : summarizeIssues(s.issues)}</td>
                <td>{s.applied ? '적용' : '불가·건너뜀'}</td>
              </tr>)}{a.steps.length === 0 && <tr><td colSpan={4}>{a.reason}</td></tr>}</tbody>
            </table></div>)}
          </div>
        })()}
        {liveAttempts.length > 0 && busy && <p className="chip-note">지금 시도 중: {liveAttempts.map(a => `${SHAPE_LABEL[a.shape]} ${a.die.w}×${a.die.h} ${a.ok ? '통과' : '실패'}`).join(' · ')}</p>}
      </article>
    </section>

    <section className="chip-analysis-grid">
      <article className="chip-card" style={{ gridColumn: 'span 2' }}>
        <div className="chip-card-title"><div><small>CANDIDATE POOL · 조건별 저장</small><h3>utilization 기준 통과 · 배선 짧은 순</h3></div><span>{ranked.length}개 / 전체 {cands.length}개</span></div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          <label className="speed-control" style={{ gridTemplateColumns: 'auto 90px', margin: 0 }}>utilization ≥ <input type="number" min={60} max={90} step={0.5} value={Math.round(utilMin * 1000) / 10} onChange={e => setUtilMin(Math.max(0, Math.min(1, Number(e.target.value) / 100)))}/></label>
          <button onClick={() => setChecked(new Set(ranked.slice(0, 10).map(k => k.id)))} disabled={ranked.length === 0} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '0.5px solid var(--border-strong)', background: 'var(--surface-1)', color: 'var(--text-primary)', cursor: 'pointer' }}>상위 10개 선택</button>
          <button onClick={exportSelected} disabled={checked.size === 0} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '0.5px solid var(--border-strong)', background: 'var(--surface-1)', color: 'var(--text-primary)', cursor: 'pointer' }}>선택 {checked.size}개 → DRC/LVS 검증 목록</button>
          <button onClick={() => { if (window.confirm('이 조건의 후보 풀과 히스토리를 모두 지울까요?')) { setCands([]); setChecked(new Set()); setSelCand(null) } }} disabled={cands.length === 0} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '0.5px solid var(--border-strong)', background: 'var(--surface-1)', color: 'var(--text-secondary)', cursor: 'pointer' }}>후보 풀 비우기</button>
        </div>
        <div className="data-table" style={{ marginTop: 8, maxHeight: 420, overflow: 'auto' }}><table><thead><tr><th/><th>순위</th><th>ID</th><th>다이</th><th>util</th><th>배선 비용</th><th>필요 밀도</th><th>핀/전원 막힘</th><th>만든 방법</th><th>발견</th><th>검증</th></tr></thead><tbody>
          {ranked.slice(0, 200).map((k, i) => <tr key={k.id} onClick={() => { setSelCand(k.id); setBoard({ die: k.die, macros: k.macros, hubs: k.hubs, issues: [], title: `후보 ${k.id}` }) }} style={{ cursor: 'pointer', background: k.id === selCand ? 'var(--accent-soft)' : undefined }}>
            <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={checked.has(k.id)} onChange={() => setChecked(prev => { const n = new Set(prev); if (n.has(k.id)) n.delete(k.id); else n.add(k.id); return n })}/></td>
            <td>{i + 1}</td><td><code>{k.id}</code></td><td>{k.die.w}×{k.die.h}</td><td><b>{pct(k.metrics.util, 2)}</b></td>
            <td>{Math.round(k.metrics.wl).toLocaleString()}</td><td>{pct(k.metrics.reqDensity)}</td><td>{k.metrics.pin}/{k.metrics.power}</td>
            <td style={{ fontSize: 11 }}>{k.method}</td><td>{k.found}</td>
            <td>{k.verify === 'queued' ? <span className="warning-badge">대기열</span> : '미실행'}</td>
          </tr>)}
          {ranked.length === 0 && <tr><td colSpan={11}>{cands.length === 0 ? '아직 후보가 없습니다 — ▶ 면적 탐색 또는 후보 만들기를 누르세요.' : `utilization ${pct(utilMin)} 이상인 후보가 없습니다 — 기준을 낮춰 보세요.`}</td></tr>}
        </tbody></table></div>
        <p className="chip-note">같은 배치(10µm 단위 좌표가 같은 것)가 다른 방법으로 다시 나오면 새 후보를 만들지 않고 "발견" 횟수와 히스토리에 누적합니다. 배선 비용이 같으면 utilization이 높은 순. 이 순위는 근사 모델 기준이고, 실제 통과 여부는 OpenLane DRC/LVS로만 확정됩니다.</p>
      </article>

      <article className="chip-card">
        <div className="chip-card-title"><div><small>CANDIDATE HISTORY</small><h3>{selected ? `후보 ${selected.id}` : '후보를 선택하세요'}</h3></div><span>{selected ? `${selected.die.w}×${selected.die.h}` : ''}</span></div>
        {selected ? <>
          <dl className="metric-list">
            <div><dt>utilization</dt><dd>{pct(selected.metrics.util, 2)}</dd></div>
            <div><dt>배선 비용</dt><dd>{Math.round(selected.metrics.wl).toLocaleString()}</dd></div>
            <div><dt>원래 대비 면적</dt><dd>{signedPct(dieArea(selected.die) / dieArea(BASE_DIE) - 1)}</dd></div>
            <div><dt>만든 방법</dt><dd>{selected.method}</dd></div>
          </dl>
          <span className="panel-label">히스토리</span>
          <ol className="strategy-list" style={{ maxHeight: 220, overflow: 'auto' }}>
            {selected.history.map((h, k) => <li key={k}><b>{h.t}</b><span>{h.text}</span></li>)}
          </ol>
          {selected.steps.length > 0 && <>
            <span className="panel-label">처리 단계 (누르면 보드에 표시)</span>
            <div className="data-table"><table><tbody>{selected.steps.map((s, si) => <tr key={si} onClick={() => setBoard({ die: selected.die, macros: s.macros, hubs: selected.hubs, issues: s.issues, title: `후보 ${selected.id} · ${s.action}` })} style={{ cursor: 'pointer' }}>
              <td><b>{s.action}</b></td><td style={{ fontSize: 11 }}>{s.ok ? '통과' : summarizeIssues(s.issues)}</td>
            </tr>)}</tbody></table></div>
          </>}
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <button onClick={() => { setExportText({ title: `후보 ${selected.id} config`, text: toAreaCfg(selected.die, selected.macros, opts.density) }); addHistory([selected.id], 'config 내보냄 (DIE_AREA + MACROS)') }} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '0.5px solid var(--border-strong)', background: 'var(--surface-1)', color: 'var(--text-primary)', cursor: 'pointer' }}>config 내보내기</button>
            <button onClick={() => { setCur({ die: { ...selected.die }, state: { macros: selected.macros.map(m => ({ ...m })), hubs: selected.hubs.map(h => ({ ...h })) } }); setBoard(null); setShrinkPct(SHRINK_LADDER[0]); setConverged(null); addHistory([selected.id], '보드로 불러와 편집 시작') }} disabled={locked} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '0.5px solid var(--border-strong)', background: 'var(--surface-1)', color: 'var(--text-primary)', cursor: 'pointer' }}>보드로 불러오기</button>
          </div>
        </> : <p className="chip-note" style={{ marginTop: 10 }}>후보 풀에서 행을 누르면 그 후보의 생성 경위·처리 단계·지표·내보내기 기록이 시간순으로 보입니다.</p>}
      </article>
    </section>

    {exportText && <section className="chip-card">
      <div className="chip-card-title"><div><small>EXPORT</small><h3>{exportText.title}</h3></div></div>
      <textarea readOnly value={exportText.text} rows={14} style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--surface-muted)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, marginTop: 8 }}/>
      <div style={{ marginTop: 8 }}><button style={{ padding: '8px 16px', borderRadius: 'var(--radius)', border: '0.5px solid var(--border-strong)', background: 'var(--surface-1)', color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer' }} onClick={() => { navigator.clipboard?.writeText(exportText.text).catch(() => setNarration('클립보드 권한이 없어 복사하지 못했습니다 — 텍스트를 직접 선택해 복사하세요')) }}>클립보드에 복사</button></div>
      <p className="rule-disclaimer">각 항목의 <code>config</code>를 <code>config_hierarchical.json</code>에 반영해 OpenLane을 돌려야 DRC/LVS/Antenna/타이밍이 확정됩니다. 이 호스트(8코어)에서는 전체 P&R을 사실상 한 번에 하나씩만 돌릴 수 있어(KLayout DRC 한 단계가 8스레드 전부 사용), 후보가 많아도 순위 상위부터 순차 검증이 현실적입니다.</p>
    </section>}

    <section className="chip-analysis-grid">
      <article className="chip-card" style={{ gridColumn: '1 / -1' }}>
        <div className="chip-card-title"><div><small>AREA FINDING · 2026-09-27</small><h3>순수 재배치 이후의 다음 레버 — 매크로 종횡비 재성형</h3></div><span>계산 확인 완료 · chan_top 재하드닝 전</span></div>
        <p className="chip-note">위 면적 탐색(사다리 5→1%)은 매크로를 800×800 정사각형으로 고정한 채 <b>위치만</b> 바꾸는데, 채널 게이트(≥{CHANNEL_SAFE_MARGIN}µm)가 가로·세로 두 축 모두에서 정확히 딱 맞아(4×800+3×100+2×100=3700, 2×800+300+2×100=2100) <b>이미 바닥</b>입니다 — 재배치만으로는 더 줄일 수 없습니다. 남은 레버는 매크로 자체를 <b>같은 실리콘 면적(640,000µm², 실측 셀 면적 그대로)에서 다른 비율로 재성형</b>하는 것입니다: 정사각형 2행 배치는 다이를 가로로 길게 늘어뜨리는데(3700×2100, 종횡비 1.76:1), 매크로를 세로로 더 길게 만들면 가로 압박이 줄고 세로 압박이 늘어 — 두 압박을 맞바꿔 전체 다이를 정사각형에 더 가깝게 만들 수 있습니다.</p>
        <div className="data-table"><table><thead><tr><th>매크로 W×H (면적 640,000µm² 동일)</th><th>결과 다이</th><th>면적</th><th>기준 대비</th><th>채널·핀·전원 게이트</th></tr></thead><tbody>
          <tr><td>800×800 (현재, 실제 하드닝됨)</td><td>3700×2100</td><td>7.770mm²</td><td>-</td><td><span className="ok-badge">PASS</span></td></tr>
          <tr><td>650×985</td><td>3100×2470</td><td>7.657mm²</td><td>-1.46%</td><td><span className="ok-badge">PASS</span></td></tr>
          <tr style={{ background: 'var(--accent-soft)' }}><td><b>590×1085 (탐색 최적점)</b></td><td><b>2860×2670</b></td><td><b>7.636mm²</b></td><td><b>-1.72%</b></td><td><span className="ok-badge">PASS</span></td></tr>
          <tr><td>500×1280</td><td>2500×3060</td><td>7.650mm²</td><td>-1.55%</td><td><span className="ok-badge">PASS</span></td></tr>
          <tr><td>450×1422</td><td>2300×3350</td><td>7.705mm²</td><td>-0.84%</td><td><span className="ok-badge">PASS</span></td></tr>
          <tr><td>700×914</td><td>3300×2330</td><td>7.689mm²</td><td>-1.04%</td><td><span className="warning-badge">FAIL — 채널 부족</span></td></tr>
        </tbody></table></div>
        <p className="chip-note">방법: <code>costD</code>/<code>gateReason</code>을 그대로 써서 4×2 격자를 여러 W×H(면적 고정, {MIN_SPACING}µm 최소 간격·{CHANNEL_SAFE_MARGIN}µm 채널·100µm 가장자리 여유 그대로)로 직접 만들어 실측 게이트를 통과하는지 하나씩 계산 — 근사치가 아니라 이 탭이 쓰는 legality 함수로 직접 확인한 결과입니다. <b>590×1085 부근이 이론적 최적점</b>(가로 압박=세로 압박이 같아지는 지점)과 거의 일치합니다.</p>
        <p className="rule-disclaimer"><b>확정은 아직 안 됨</b> — 이 표는 "이 비율이면 게이트를 통과할 다이가 나온다"는 배치 문제의 계산 결과일 뿐, chan_top 내부(46,009셀)가 실제로 590×1085 비율에서 라우팅·타이밍이 되는지는 전혀 보지 않습니다. 확정하려면 chan_top을 이 비율로 <b>다시 synthesis+P&R</b>해야 합니다(몇 시간짜리 새 실행, 위치 재배치와는 급이 다른 작업). 아래 로드맵의 "2차원 다이 형상 탐색" 항목이 이 결과를 근거로 합니다.</p>
      </article>
    </section>

    <section className="future-optimization-roadmap macro-area-improvements">
      <div className="roadmap-head"><div><small>MACRO AREA TETRIS STATUS</small><h4>현재 구현 사항과 추후 개선 사항</h4></div><span>현재 모델 6.3/10 · 실제 signoff 연결 전</span></div>
      <div className="roadmap-section-title"><div><small>CURRENT IMPLEMENTATION</small><h5>현재 구현 사항 요약</h5></div><span>현재 실제 동작</span></div>
      <div className="improvement-score-strip">
        <div><span>면적 탐색</span><b>8/10</b><small>5→1% 사다리 · 2D 형상 3행 legal, 4행은 아직</small></div><div><span>제약·진단</span><b>8/10</b><small>실패 부위 기록</small></div><div><span>후보 다양성</span><b>7/10</b><small>random seed 12개 연결 · SA(온도) 미적용</small></div><div><span>배선 예측</span><b>4/10</b><small>근사 hub 비용</small></div><div><span>DRC/LVS</span><b>2/10</b><small>목록 출력 단계</small></div><div><span>시각화</span><b>8/10</b><small>단계별 layout</small></div>
      </div>
      <div className="current-implementation-grid">
        <article><b>면적 축소 사다리</b><span>−5→4→3→2→1% 순서로 줄이고 성공 시 다시 −5%부터 반복</span></article>
        <article><b>3종 다이 형상</b><span>aspect ratio 유지·가로만·세로만 후보를 같은 목표 면적으로 비교</span></article>
        <article><b>물리 제약 gate</b><span>overlap·100µm spacing·boundary·300µm channel·pin·power·density 검사</span></article>
        <article><b>실패별 자동 repair</b><span>legalize → shelf repack → 여유 재분배 → target Rip-up → polish</span></article>
        <article><b>후보·히스토리 관리</b><span>좌표 signature 중복 제거, 재발견 누적, 처리 단계별 layout 보존</span></article>
        <article><b>Worker·수동 편집·출력</b><span>백그라운드 계산, macro drag, 후보 저장과 OpenLane config JSON 출력</span></article>
      </div>
      <div className="roadmap-section-title future"><div><small>ROADMAP STATUS</small><h5>완료·부분 구현·미연결 항목</h5></div><span>2026-09-29 코드 기준</span></div>
      <div className="roadmap-grid">
        <article className="game-done"><header><b>random legal start 연결</b><em>DONE · 2026-09-29</em></header><p>후보 생성이 <code>seeds: 0</code>으로 호출돼 무작위 시작점이 전혀 없었습니다 — 이제 12개(로드맵 권장 8~16개 범위)를 실제로 흩뿌려 deterministic 여유 분할 후보에 더합니다. 다만 지금 붙은 건 Macro Tetris의 <b>Rip-up(greedy 다듬기)</b>까지고, 온도 기반으로 일부 나쁜 이동도 받아들이는 <b>SA 자체는 아직</b>입니다 — local minimum 탈출력은 SA를 실제로 붙여야 더 좋아집니다.</p><small>남은 일: repairFrom의 polish를 SA로 교체</small></article>
        <article className="game-done" style={{ gridColumn: 'span 3' }}>
          <header><b>표준셀 타일 — 가변 폭 row-run</b><em>DONE · 2026-09-29</em></header>
          <p>"표준셀 타일 표시" 디버그 오버레이가 고정 300×300µm 정사각형이라, 남는 공간이 필요 면적의 2.3배(row-run 계산 기준)인데도 자투리로 쪼개져 있어 실측 grid에서 13개 중 12개만 들어갔습니다. 이제 매크로 배치는 <b>그대로 두고</b> 타일만 실제 OpenROAD cutrows처럼 한 줄(row) 안에서 옆으로 이어진 빈 칸을 폭 그대로 쓰도록 바꿔 13/13 전부 들어갑니다 — 위 "표준셀 타일 표시" 버튼에 배치 개수가 바로 뜹니다. S1·S3·S9처럼 매크로 하나 폭보다 넓은 타일이 나오면 정상입니다.</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '8px 0' }}>
            <figure style={{ margin: 0 }}><img src="/macro-area/glue_tiles_off.png" alt="타일 표시 끄기 — 매크로만 보이는 초기 화면" style={{ width: '100%', borderRadius: 6, border: '1px solid var(--border)' }}/><figcaption style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: 8 }}>초기 화면 — 매크로만(타일 표시 끔)</figcaption></figure>
            <figure style={{ margin: 0 }}><img src="/macro-area/glue_tiles_on.png" alt="타일 표시 켜기 — S1·S3·S9가 매크로 폭보다 넓은 가변 폭 타일" style={{ width: '100%', borderRadius: 6, border: '1px solid var(--border)' }}/><figcaption style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: 8 }}>타일 표시 켬 — 13/13, S1·S3·S9가 매크로 폭보다 넓음</figcaption></figure>
          </div>
          <small>확인: macroTetrisModel.regression.ts에 fillGlue 13/13 회귀 고정 · 매크로 위치·util·필요 밀도는 이 변경으로 바뀌지 않음</small>
        </article>
        <article><header><b>복수 선택·그룹 이동</b><em>P2 · NOT IMPLEMENTED</em></header><p>현재는 macro 하나만 drag할 수 있습니다. 그룹 선택 패턴은 다른 게임에 있지만 Macro Area에는 아직 연결되지 않았습니다.</p><small>목표: channel 행 전체 수동 조정 + snapshot</small></article>
        <article><header><b>실제 net 연결 비용</b><em>P0 · NEXT</em></header><p>모든 macro를 모든 hub에 연결하는 근사 비용을 macro↔hub connectivity와 criticality 가중치로 교체합니다. pin 위치가 있으면 HPWL도 함께 계산합니다.</p><small>검증: proxy 순위 ↔ GlobalRoute wirelength 상관도</small></article>
        <article><header><b>2차원 다이 형상 탐색</b><em>PARTIAL · 2026-09-29</em></header><p><code>shapeVariantDies</code>가 행 수(1~4)별로 필요한 최소 다이를 closed form으로 계산해 <code>generate()</code>에 더했습니다 — 2행 3700×2100=7.77mm², 3행 2800×3200=8.96mm², 4행 1900×4300=8.17mm²이며 1행은 종횡비 제한으로 제외됩니다. <code>distributeAxis</code>가 행 재구성 직후에도 {CHANNEL_SAFE_MARGIN}µm(핀 escape 200µm 아님)를 목표로 채널을 벌리도록 고쳐 <b>3행은 이제 legal 후보가 나옵니다</b>. <b>4행은 아직 안 됩니다</b> — legalizeD가 overlap만 보고 채널 여유가 거의 없는 배치를 그대로 legal 판정해, 뒤이은 여유 재분배가 늘릴 여유 자체가 안 남습니다.</p><small>3행 fix는 macroAreaModel.regression.ts + attemptDie 실측으로 확인 · 남은 일: 4행 — legalizeD가 channel-aware하게 shelf repack도 같이 시도하도록</small></article>
        <article><header><b>10→Top 3 실제 검증 퍼널</b><em>P0 · SIGNOFF</em></header><p>상위 10개는 공통 합성 checkpoint를 재사용해 placement·global route·STA까지만 실행하고, 상위 3개만 detailed route·DRC/LVS로 이어갑니다.</p><small>도구: OpenROAD · TritonRoute · Magic/KLayout · Netgen</small></article>
        <article><header><b>PASS-only PPA best</b><em>P0 · SIGNOFF</em></header><p>utilization 단독 best 대신 DRC/LVS PASS 후보만 area·wirelength·WNS/TNS로 Pareto 관리하고, 실제 best를 다음 SA seed로 되돌립니다.</p><small>목표: proxy best와 signoff best 분리</small></article>
        <article><header><b>채널 기준 자동 보정</b><em>P1 · FEEDBACK</em></header><p>현재 300µm hard gate를 유지하되 여러 실제 실행의 DPL·congestion·timing 결과를 축적해 macro group별 안전 폭을 보정합니다.</p><small>주의: 1회 실패값의 과적합 방지</small></article>
        <article><header><b>실제 표준셀 수용성</b><em>P1 · FEEDBACK</em></header><p>단순 남는 면적 density 외에 usable row 단절, halo, PDN obstruction과 pin-access 밀도를 빠른 placement 결과로 평가합니다.</p><small>도구: RePlAce · DPL · FastRoute</small></article>
        <article><header><b>후보 저장 강화</b><em>P2 · QUALITY</em></header><p>작업 중 Reset 시 Worker를 terminate/restart하는 실제 취소는 완료됐습니다. 남은 일은 최대 800개 후보와 단계 기록을 localStorage 대신 IndexedDB 또는 파일 registry로 옮기는 것입니다.</p><small>완료: Worker 취소·기본 회귀 테스트 · 남음: 영속 저장소</small></article>
      </div>
      <div className="flow-implementation-status"><span className="done"><b>현재 구현</b> 면적 축소 사다리 · 형상/행 수 후보 · random seed 12개 · 물리 gate · Worker 취소 · 회귀 테스트</span><span className="next"><b>추후 우선순위</b> 실제 net 비용 → 온도 기반 SA → 3·4행 legalize → 10개 GRT/STA → Top 3 signoff → PASS-only best</span></div>
    </section>

    <section className="chip-analysis-grid">
      <article className="chip-card" style={{ gridColumn: 'span 2' }}>
        <div className="chip-card-title"><div><small>ALGORITHM</small><h3>실패 부위별 처리 알고리즘</h3></div></div>
        <div className="data-table"><table><thead><tr><th>진단된 실패</th><th>처리 알고리즘</th><th>그래도 안 되면</th></tr></thead><tbody>
          <tr><td><b>표준셀 용량</b> (필요 밀도 &gt; 목표)</td><td>배치로 고칠 수 없음 — 즉시 실패</td><td>같은 배치에서 다음 폭(사다리 {SHRINK_LADDER.join('→')}%)으로 재시도</td></tr>
          <tr><td><b>겹침·간격·가장자리</b></td><td>① 위반 매크로만 뽑아, 남은 매크로가 계속 들어갈 수 있는 legal 자리 중 비용 최저 위치로 재배치(채널 번호 유지)</td><td>② 행 재구성 — 2·1·3·4행 선반 재배치 후 남는 여유를 채널에 분배. 모두 안 들어가면 "물리적으로 안 들어감"</td></tr>
          <tr><td><b>매크로 그룹 채널</b> (≥{CHANNEL_SAFE_MARGIN}µm, 실측 하드 게이트)</td><td>③ 여유 재분배 — 행/열을 띠로 묶고 남는 세로·가로 여유를 채널에 먼저 몰아 {CHANNEL_SAFE_MARGIN}µm까지 넓힘</td><td>④ 채널이 좁은 그룹 전체를 대상 Rip-up. 줄지 않으면 실패 → 다음 폭으로 재시도</td></tr>
          <tr><td><b>핀 escape·전원 접근</b> (엄격 모드)</td><td>③ 여유 재분배(위와 동일, {CHANNEL_SAFE_MARGIN}µm 목표라 채널 게이트와 대개 같이 풀림)</td><td>④ 막힌 매크로만 대상 Rip-up(100µm 격자 전수 탐색). 막힘이 줄지 않으면 실패</td></tr>
          <tr><td><b>모두 통과</b></td><td>⑤ Rip-up 다듬기 — 배선·조각난 여유 비용을 낮추되, 통과 조건이 유지될 때만 채택</td><td>-</td></tr>
        </tbody></table></div>
        <p className="chip-note">매크로 그룹 채널 게이트는 2026-09-26 실측에 근거합니다 — daq_subsystem hierarchical 실행에서 행간 채널을 300µm→100µm로 좁힌 후보가 실제로 hold 리페어 버퍼를 못 앉혀 Detailed Placement 자체에 실패했습니다(DPL-0034/0036). 각 단계는 그 시점 배치와 진단 결과를 같이 저장합니다 — 시도 기록의 행을 펼치거나 후보의 처리 단계를 누르면 보드에 그 배치가 실패 부위(빨간 매크로·빨간 연결선)와 함께 그려집니다.</p>
      </article>
      <article className="chip-card">
        <div className="chip-card-title"><div><small>한계</small><h3>이 모델이 보지 않는 것</h3></div></div>
        <p className="chip-note">매크로는 속이 빈 사각형이고 핀 위치·PDN 스트랩·halo는 근사치입니다. 이 설계는 800×800 매크로 4열이 가로 3700µm를 정확히 채워서, 실제로 줄일 수 있는 건 거의 세로(행간 채널)뿐입니다 — 그래서 후보들의 배선 비용 차이가 작고, 진짜 차이는 채널 폭(= 라우팅 여유)에서 납니다. 배선 비용이 가장 짧은 후보가 곧 DRC/LVS를 가장 잘 통과한다는 보장은 없으므로, 여러 개를 실제로 돌려 확인해야 합니다.</p>
      </article>
    </section>
  </div>
}
