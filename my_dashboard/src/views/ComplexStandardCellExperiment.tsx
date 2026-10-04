import { useEffect, useMemo, useState } from 'react'
import pdk from '../data/sky130_pdk_info.json'
import CellSaExperiment, { benchPlacement, netCount, placementsOf, saMoves, saStages } from './CellSaExperiment'

type Rect = [string, number, number, number, number]
type Pin = { n: string; use: string; rects: Rect[] }
type SourceCell = { devices: unknown[]; info: { size: [number, number] | null; pins: Pin[] } }
type SourceData = Record<string, SourceCell>
type Order = 'and-mux' | 'mux-and'
type Rules = { site: number; row: number; m1Pitch: number; m1Width: number; railHalf: number }
type Weights = { bend: number; vertical: number; area: number }
type Placement = { order: Order; muxFlip: boolean; andFlip: boolean; gapSites: number }
type Box = { x1: number; x2: number; y1: number; y2: number }
type Candidate = Placement & {
  id: string; xRect: number; trackY: number | null
  muxX: number; andX: number; muxW: number; andW: number; width: number; area: number
  path: { ax: number; ay: number; bx: number; by: number } | null
  length: number; hLen: number; vLen: number; bends: number; cost: number; reject: string | null
}
type Search = { rules: Rules; tracks: number[]; all: Candidate[]; valid: Candidate[]; rejected: Record<string, number> }

const SOURCE = ['mux2_1', 'and2_1'] as const
const SOURCE_SITE = 0.46
const MAX_GAP_SITES = 2
// Pitch/width come from the installed sky130 techlef. The rail-clearance formula below is only an
// experiment proxy; it is not the complete sky130 DRC deck or a verified pin-access rule.
const MET1 = pdk.techlef?.layers?.met1 ?? { pitch: 0.34, width: 0.14 }
const round = (n: number) => Number(n.toFixed(3))
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const pct = (a: number, b: number) => (a ? `${b >= a ? '+' : ''}${round((b / a - 1) * 100)}%` : '—')
const DEFAULT_WEIGHTS: Weights = { bend: 0.3, vertical: 1, area: 0.02 }

// Target rule sets. VPDK-90 is a made-up 90 nm-class rule set for this experiment (9 met1 tracks per
// row, site = met1 pitch, narrower rail). It is NOT a foundry PDK; "ratio" is sky130 scaled by 90/130.
const PRESETS: Record<'vpdk90' | 'ratio', { label: string; note: string; rules: Rules }> = {
  vpdk90: { label: '가상 90 nm PDK (VPDK-90)', note: 'site = met1 pitch 0.28 µm, 행 = 9트랙 × 0.28 = 2.52 µm, met1 폭 0.12 µm, 레일 0.34 µm',
    rules: { site: 0.28, row: 2.52, m1Pitch: 0.28, m1Width: 0.12, railHalf: 0.17 } },
  ratio: { label: '단순 비율 축소 (×90/130)', note: 'sky130의 모든 치수를 같은 비율로 줄인 비교용',
    rules: { site: round(SOURCE_SITE * 90 / 130), row: round(2.72 * 90 / 130), m1Pitch: round(MET1.pitch * 90 / 130), m1Width: round(MET1.width * 90 / 130), railHalf: round(0.24 * 90 / 130) } },
}

// Every placement the search tries: cell order × each cell N/FN (left-right mirror; FS would swap the
// rails, so it is not legal in the same row) × gap 0..MAX_GAP_SITES. A wider gap only moves the two
// pins further apart (they are in different cells), so larger gaps can never win.
const ALL_PLACEMENTS: Placement[] = (['mux-and', 'and-mux'] as Order[]).flatMap(order => [false, true].flatMap(muxFlip => [false, true].flatMap(andFlip =>
  Array.from({ length: MAX_GAP_SITES + 1 }, (_, gapSites) => ({ order, muxFlip, andFlip, gapSites })))))
const BASELINE_PLACEMENT: Placement = { order: 'mux-and', muxFlip: false, andFlip: false, gapSites: 0 }

// Half height of the VGND/VPWR met1 rail as drawn in the cell's own LEF (sky130 hd: 0.24 µm).
function railHalf(cell: SourceCell): number {
  const r = cell.info.pins.find(p => p.n === 'VGND')?.rects.find(x => x[0] === 'met1')
  return r ? r[4] : 0.24
}

// Proxy tracks sit at pitch/2 + k·pitch and use an assumed rail clearance of (pitch - width).
function met1Tracks(height: number, pitch: number, width: number, rail: number): number[] {
  const tracks: number[] = []
  if (pitch <= 0 || width <= 0 || pitch <= width) return tracks
  const clear = rail + (pitch - width)
  for (let y = pitch / 2; y < height; y += pitch) if (y - width / 2 >= clear - 1e-9 && y + width / 2 <= height - clear + 1e-9) tracks.push(round(y))
  return tracks
}

// Suggest the smallest simple parameter repair for the reported proxy failure. A subsequent search
// may expose another failure; this is not a foundry DRC repair or proof of a legal routed cell.
function repairFor(reason: string | null, rules: Rules): { guidance: string; corrected: Rules | null } {
  if (reason === 'met1 pitch ≤ 폭 (간격 없음)') {
    const pitch = round(Math.max(rules.m1Width + 0.01, rules.m1Width * 1.2))
    return { guidance: `met1 pitch를 ${round(rules.m1Pitch)} → ${pitch} µm로 늘려 폭 ${round(rules.m1Width)} µm보다 크게 설정`,
      corrected: { ...rules, m1Pitch: pitch } }
  }
  if (reason === '레일 사이에 met1 트랙 없음') {
    const clear = rules.railHalf + (rules.m1Pitch - rules.m1Width)
    const firstIndex = Math.max(0, Math.ceil((clear + rules.m1Width / 2 - rules.m1Pitch / 2) / rules.m1Pitch))
    const trackY = rules.m1Pitch / 2 + firstIndex * rules.m1Pitch
    const row = round(trackY + rules.m1Width / 2 + clear + 0.01)
    return { guidance: `행 높이를 ${round(rules.row)} → ${row} µm 이상으로 늘려 레일 사이 트랙을 확보`,
      corrected: { ...rules, row } }
  }
  if (reason === '핀 도형 없음') return { guidance: '원본 LEF의 MUX X·AND B 핀 도형을 확인하고, 없으면 유효한 핀 자료를 제공', corrected: null }
  return { guidance: '탈락 원인을 확인한 뒤 가상 PDK 값을 조정하고 재탐색', corrected: null }
}

// A pin rectangle placed in the row: scaled from the sky130 LEF to the target cell size, mirrored for FN.
function placedRects(cell: SourceCell, pin: string, cellX: number, cellW: number, rowH: number, flip: boolean): Box[] {
  const src = cell.info.size
  const p = cell.info.pins.find(q => q.n === pin)
  if (!src || !p) return []
  return p.rects.map(r => {
    let x1 = r[1] * cellW / src[0], x2 = r[3] * cellW / src[0]
    if (flip) [x1, x2] = [cellW - x2, cellW - x1]
    return { x1: cellX + x1, x2: cellX + x2, y1: r[2] * rowH / src[1], y2: r[4] * rowH / src[1] }
  })
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const cx = (b: Box) => (b.x1 + b.x2) / 2

// Try every placement × X-pin rectangle × met1 track for net M (u_mux.X → u_and.B). The route is
// pin → (vertical jog only if the track misses the pin's y-range) → met1 along the track → pin; a
// via can land anywhere on the pin shape. Cost = length + bend·bends + vertical·(vertical length) + area·area.
function searchAll(mux: SourceCell, and: SourceCell, rules: Rules, placements: Placement[], w: Weights): Search {
  const tracks = met1Tracks(rules.row, rules.m1Pitch, rules.m1Width, rules.railHalf)
  const muxW = Math.round((mux.info.size?.[0] ?? 0) / SOURCE_SITE) * rules.site
  const andW = Math.round((and.info.size?.[0] ?? 0) / SOURCE_SITE) * rules.site
  const nX = mux.info.pins.find(p => p.n === 'X')?.rects.length ?? 0
  const all: Candidate[] = []
  const rejected: Record<string, number> = {}
  for (const pl of placements) {
    const gap = pl.gapSites * rules.site
    const muxX = pl.order === 'mux-and' ? 0 : andW + gap
    const andX = pl.order === 'and-mux' ? 0 : muxW + gap
    const width = muxW + andW + gap
    const xs = placedRects(mux, 'X', muxX, muxW, rules.row, pl.muxFlip)
    const b = placedRects(and, 'B', andX, andW, rules.row, pl.andFlip)[0]
    const shared = { ...pl, muxX, andX, muxW, andW, width, area: width * rules.row }
    const id = (xi: number, t: number | null) => `${pl.order}|${pl.muxFlip ? 'FN' : 'N'}|${pl.andFlip ? 'FN' : 'N'}|${pl.gapSites}|${xi}|${t ?? '-'}`
    for (let xi = 0; xi < nX; xi++) {
      const a = xs[xi]
      const reason = rules.m1Pitch <= rules.m1Width ? 'met1 pitch ≤ 폭 (간격 없음)' : !tracks.length ? '레일 사이에 met1 트랙 없음' : !a || !b ? '핀 도형 없음' : null
      if (reason) {
        rejected[reason] = (rejected[reason] ?? 0) + 1
        all.push({ ...shared, id: id(xi, null), xRect: xi, trackY: null, path: null, length: Infinity, hLen: 0, vLen: 0, bends: 0, cost: Infinity, reject: reason })
        continue
      }
      for (const t of tracks) {
        const ay = clamp(t, a.y1, a.y2), by = clamp(t, b.y1, b.y2)
        const ax = cx(a), bx = cx(b)
        const segs = [Math.abs(t - ay), Math.abs(ax - bx), Math.abs(t - by)]
        const hLen = segs[1], vLen = segs[0] + segs[2], length = hLen + vLen
        const bends = Math.max(0, segs.filter(s => s > 1e-6).length - 1)
        all.push({ ...shared, id: id(xi, t), xRect: xi, trackY: t, path: { ax, ay, bx, by }, length, hLen, vLen, bends,
          cost: length + w.bend * bends + w.vertical * vLen + w.area * shared.area, reject: null })
      }
    }
  }
  const valid = all.filter(c => !c.reject).sort(compareCandidates)
  return { rules, tracks, all, valid, rejected }
}

// Lower cost wins; ties go to smaller area, then shorter route, then a stable id.
const compareCandidates = (p: Candidate, q: Candidate) => p.cost - q.cost || p.area - q.area || p.length - q.length || p.id.localeCompare(q.id)
const placementKey = (c: Placement) => `${c.order}|${c.muxFlip}|${c.andFlip}|${c.gapSites}`

const placementLabel = (c: Placement) => `${c.order === 'mux-and' ? 'MUX→AND' : 'AND→MUX'} · MUX ${c.muxFlip ? 'FN' : 'N'} · AND ${c.andFlip ? 'FN' : 'N'} · 간격 ${c.gapSites}`

function Snapshot({ c, rules, tracks, pxPerUm, maxW, maxH, label }: { c: Candidate; rules: Rules; tracks: number[]; pxPerUm: number; maxW: number; maxH: number; label: string }) {
  const pad = 14
  const W = maxW * pxPerUm + pad * 2, H = maxH * pxPerUm + pad * 2 + 14
  const X = (x: number) => pad + x * pxPerUm, Y = (y: number) => pad + (maxH - y) * pxPerUm
  return <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} 배치와 내부 넷 경로`} style={{ display: 'block', width: '100%', maxWidth: W }}>
    <rect x={X(0)} y={Y(rules.row)} width={c.width * pxPerUm} height={rules.row * pxPerUm} fill="none" stroke="var(--text-secondary)" strokeDasharray="4 3"/>
    {[{ x: c.muxX, w: c.muxW, t: `MUX2${c.muxFlip ? ' FN' : ''}`, k: 'm', col: '#378ADD' }, { x: c.andX, w: c.andW, t: `AND2${c.andFlip ? ' FN' : ''}`, k: 'a', col: '#1D9E75' }].map(b => <g key={b.k}>
      <rect x={X(b.x)} y={Y(rules.row)} width={b.w * pxPerUm} height={rules.row * pxPerUm} fill={b.col} fillOpacity={0.12} stroke={b.col} strokeWidth={1.5}/>
      <text x={X(b.x + b.w / 2)} y={Y(rules.row) + 13} textAnchor="middle" fontSize={10} fontWeight={700} fill="currentColor">{b.t}</text>
    </g>)}
    <rect x={X(0)} y={Y(rules.railHalf)} width={c.width * pxPerUm} height={rules.railHalf * pxPerUm} fill="#4a7ebb" opacity={0.35}/>
    <rect x={X(0)} y={Y(rules.row)} width={c.width * pxPerUm} height={rules.railHalf * pxPerUm} fill="#c0504d" opacity={0.35}/>
    {tracks.map(y => <line key={y} x1={X(0)} x2={X(c.width)} y1={Y(y)} y2={Y(y)} stroke="#378ADD" opacity={0.35}/>)}
    {c.path && c.trackY !== null && <>
      <path d={`M ${X(c.path.ax)} ${Y(c.path.ay)} V ${Y(c.trackY)} H ${X(c.path.bx)} V ${Y(c.path.by)}`} stroke="#b45f06" strokeWidth={2.2} fill="none"/>
      <circle cx={X(c.path.ax)} cy={Y(c.path.ay)} r={3.5} fill="#b45f06"/><circle cx={X(c.path.bx)} cy={Y(c.path.by)} r={3.5} fill="#b45f06"/></>}
    <text x={X(0)} y={H - 4} fontSize={10} fill="currentColor">{round(c.width)} × {rules.row} µm · 트랙 {tracks.length}개</text>
  </svg>
}

// level='five': 5개 이하(2셀 MUX+AND 전수 탐색 + 2~5셀 후보군), level='ten': 10개 이하(6~10셀 후보군 + SA, 시간 분석),
// level='twenty': 20개 이상(20~50셀 후보군 + SA).
export default function ComplexStandardCellExperiment({ level = 'five' }: { level?: 'five' | 'ten' | 'twenty' }) {
  const [data, setData] = useState<SourceData | null>(null)
  const [loadError, setLoadError] = useState('')
  const [preset, setPreset] = useState<'vpdk90' | 'ratio' | 'custom'>('vpdk90')
  const [rules, setRules] = useState<Rules>(PRESETS.vpdk90.rules)
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS)
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [progress, setProgress] = useState(100)
  const [playing, setPlaying] = useState(false)
  const [inputs, setInputs] = useState({ A: 0, B: 1, S: 0, E: 1 })

  useEffect(() => {
    let active = true
    fetch('/stdcells/sky130_fd_sc_hd.cells.json')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<SourceData> })
      .then(j => { if (active) { setData(j); setLoadError('') } })
      .catch(e => { if (active) setLoadError(`SKY130A HD 셀 데이터를 불러오지 못했습니다 (${e.message})`) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => setProgress(value => Math.min(100, value + 2)), 60)
    return () => window.clearInterval(timer)
  }, [playing])
  useEffect(() => { if (progress >= 100) setPlaying(false) }, [progress])
  useEffect(() => setPickedId(null), [rules, weights])

  const mux = data?.mux2_1
  const and = data?.and2_1
  const ready = !!(mux?.info.size && and?.info.size)
  const sourceHeight = mux?.info.size?.[1] ?? 0
  const sourceRules: Rules = useMemo(() => ({ site: SOURCE_SITE, row: sourceHeight, m1Pitch: MET1.pitch, m1Width: MET1.width, railHalf: mux ? railHalf(mux) : 0.24 }), [sourceHeight, mux])
  // 130 nm and "rules only" keep our hypothetical MUX→AND, N/N, gap-0 composite placement and only search the routing;
  // the full search also tries every placement, so the two effects can be told apart.
  const baseSearch = useMemo(() => ready ? searchAll(mux!, and!, sourceRules, [BASELINE_PLACEMENT], weights) : null, [ready, mux, and, sourceRules, weights])
  const keptSearch = useMemo(() => ready ? searchAll(mux!, and!, rules, [BASELINE_PLACEMENT], weights) : null, [ready, mux, and, rules, weights])
  const full = useMemo(() => ready ? searchAll(mux!, and!, rules, ALL_PLACEMENTS, weights) : null, [ready, mux, and, rules, weights])
  const base = baseSearch?.valid[0] ?? null
  const kept = keptSearch?.valid[0] ?? null
  const best = full?.valid[0] ?? null
  const cur = (pickedId && full?.valid.find(c => c.id === pickedId)) || best
  const curRank = cur && full ? full.valid.indexOf(cur) + 1 : 0

  const setRule = (k: keyof Rules) => (v: number) => { setRules(r => ({ ...r, [k]: v })); setPreset('custom'); setProgress(100) }
  const applyPreset = (p: 'vpdk90' | 'ratio') => { setPreset(p); setRules(PRESETS[p].rules); setProgress(100) }

  // animation: base → cur. Outline, pins and tracks change first; cells then move (mirroring applies once moving starts).
  const scaleStep = Math.min(1, progress / 35)
  const moveStep = Math.max(0, Math.min(1, (progress - 35) / 65))
  const frameRules: Rules = { site: mix(sourceRules.site, rules.site, scaleStep), row: mix(sourceRules.row, rules.row, scaleStep),
    m1Pitch: mix(sourceRules.m1Pitch, rules.m1Pitch, scaleStep), m1Width: mix(sourceRules.m1Width, rules.m1Width, scaleStep), railHalf: mix(sourceRules.railHalf, rules.railHalf, scaleStep) }
  const frame = useMemo(() => {
    if (!ready || !base || !cur) return null
    const muxW = mix(base.muxW, cur.muxW, scaleStep), andW = mix(base.andW, cur.andW, scaleStep)
    const gap = mix(0, cur.gapSites * rules.site, scaleStep)
    const muxX = mix(0, cur.muxX, moveStep), andX = mix(muxW + gap, cur.andX, moveStep)
    const moving = moveStep > 0
    const tracks = met1Tracks(frameRules.row, frameRules.m1Pitch, frameRules.m1Width, frameRules.railHalf)
    const a = placedRects(mux!, 'X', muxX, muxW, frameRules.row, moving && cur.muxFlip)[moving ? cur.xRect : base.xRect]
    const b = placedRects(and!, 'B', andX, andW, frameRules.row, moving && cur.andFlip)[0]
    const t = tracks.length && a && b ? tracks.reduce((p, q) => Math.abs(q - (moving ? cur.trackY ?? q : base.trackY ?? q) * frameRules.row / (moving ? rules.row : sourceRules.row)) < Math.abs(p - (moving ? cur.trackY ?? p : base.trackY ?? p) * frameRules.row / (moving ? rules.row : sourceRules.row)) ? q : p) : null
    return { muxW, andW, muxX, andX, tracks, a, b, t, muxFlip: moving && cur.muxFlip, andFlip: moving && cur.andFlip }
  }, [ready, base, cur, scaleStep, moveStep, frameRules.row, frameRules.m1Pitch, frameRules.m1Width, frameRules.railHalf, rules.site, rules.row, sourceRules.row, mux, and])
  const targetShort = preset === 'custom' ? '사용자 지정' : '90 nm'
  const targetLabel = preset === 'custom' ? '사용자 지정 가상 규칙' : '90 nm 가상 PDK'
  const phase = progress === 0 ? '130 nm 가상 결합 시작 배치' : progress < 35 ? '1/3 · 셀 외곽·핀·트랙 변경' : progress < 100 ? '2/3 · 선택 후보로 재배치' : `3/3 · ${targetShort} 가상 배치 완료`
  const overlap = frame ? frame.muxX < frame.andX + frame.andW && frame.andX < frame.muxX + frame.muxW : false
  const framePath = frame && frame.a && frame.b && frame.t !== null ? {
    h: Math.abs(cx(frame.a) - cx(frame.b)),
    v: Math.abs(clamp(frame.t, frame.a.y1, frame.a.y2) - frame.t) + Math.abs(clamp(frame.t, frame.b.y1, frame.b.y2) - frame.t),
  } : null

  const selected = inputs.S ? inputs.B : inputs.A
  const output = inputs.E && selected ? 1 : 0
  const maxW = Math.max(base?.width ?? 0, kept?.width ?? 0, cur?.width ?? 0, 1)
  const maxH = Math.max(sourceRules.row, rules.row)
  const scale = Math.min(64, 700 / maxW)
  const pad = 35
  const sx = (x: number) => pad + x * scale
  const sy = (y: number) => pad + (maxH - y) * scale
  const placementsTried = full ? new Set(full.all.map(c => `${c.order}|${c.muxFlip}|${c.andFlip}|${c.gapSites}`)).size : 0
  const rejectedTotal = full ? Object.values(full.rejected).reduce((s, v) => s + v, 0) : 0
  const bestPlacementCount = full ? new Map(full.valid.map(c => [`${c.order}|${c.muxFlip}|${c.andFlip}|${c.gapSites}`, c])).size : 0
  const failedPlacements = useMemo(() => {
    const seen = new Set<string>()
    return (full?.all ?? []).filter(c => {
      const key = placementKey(c)
      if (!c.reject || seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [full])
  const failureExamples = useMemo(() => {
    if (!ready) return []
    const examples = [
      { label: '배선 pitch가 폭보다 작음', changed: 'met1 pitch = 폭의 90%', rules: { ...rules, m1Pitch: round(rules.m1Width * 0.9) } },
      { label: '전원 레일 사이에 트랙 없음', changed: '행 높이 = 레일 반폭 × 2 (pitch는 폭보다 크게 유지)',
        rules: { ...rules, row: round(rules.railHalf * 2), m1Pitch: Math.max(rules.m1Pitch, round(rules.m1Width + 0.01)) } },
    ]
    return examples.map(example => ({ ...example, result: searchAll(mux!, and!, example.rules, [BASELINE_PLACEMENT], weights) }))
  }, [ready, mux, and, rules, weights])
  const currentRepair = repairFor(failedPlacements[0]?.reject ?? null, rules)
  const applyRepair = (corrected: Rules) => { setRules(corrected); setPreset('custom'); setProgress(100) }

  // ---- timing analysis: measure the real search, then extrapolate the candidate count to larger composites ----
  const bench = useMemo(() => {
    if (!ready || !full) return null
    const runs = 40
    const t0 = performance.now()
    for (let i = 0; i < runs; i++) searchAll(mux!, and!, rules, ALL_PLACEMENTS, weights)
    const ms = (performance.now() - t0) / runs
    return { ms, usPerCandidate: ms * 1000 / Math.max(1, full.all.length) }
  }, [ready, mux, and, rules, weights, full])
  const nPinRects = mux?.info.pins.find(p => p.n === 'X')?.rects.length ?? 3
  // Measured per-placement evaluation time t_p(n) for the real-cell circuit of the SA experiment; exhaustive time
  // = N_placements(n) × t_p(n), SA time = M(n) moves × t_p(n). The verdict compares the two measured-based times.
  const scaling = useMemo(() => {
    if (!data || level !== 'ten') return []
    return [2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => {
      const tp = benchPlacement(data, n, rules, weights)
      const placements = placementsOf(n), moves = saMoves(n)
      return { n, nets: netCount(n), placements, moves, tp, tEx: tp === null ? NaN : placements * tp / 1e6, tSa: tp === null ? NaN : moves * tp / 1e6 }
    })
  }, [data, rules, weights, level])
  const YEAR = 86400 * 365
  const verdictRow = (r: { tEx: number; tSa: number }) => !Number.isFinite(r.tEx) ? { t: '—', c: undefined }
    : r.tEx >= YEAR ? { t: '전수 비현실적 → 휴리스틱', c: '#8e1b10' } : r.tEx <= r.tSa ? { t: '전수 (이 모델의 최적 보장)', c: '#1D9E75' } : { t: 'SA 추정 시간이 짧음', c: '#c0392b' }
  const saFrom = scaling.find(r => r.tEx > r.tSa)
  const impossibleFrom = scaling.find(r => r.tEx >= YEAR)
  const lastExhaustive = saFrom ? scaling.find(r => r.n === saFrom.n - 1) : undefined
  const fmtTime = (sec: number) => {
    if (!Number.isFinite(sec)) return '—'
    if (sec < 1e-3) return `${round(sec * 1e6)} µs`
    if (sec < 1) return `${Number((sec * 1e3).toFixed(1))} ms`
    if (sec < 120) return `${Number(sec.toFixed(1))} 초`
    if (sec < 3600) return `${Number((sec / 60).toFixed(1))} 분`
    if (sec < 86400 * 2) return `${Number((sec / 3600).toFixed(1))} 시간`
    const years = sec / (86400 * 365)
    if (years < 1) return `${Number((sec / 86400).toFixed(1))} 일`
    return years < 1e4 ? `${fmtN(Number(years.toFixed(1)))} 년` : `${years.toExponential(1)} 년`
  }

  // ---- live replay of the exhaustive scan (the real search finishes in ~bench.ms; this only slows it down to watch) ----
  const scanInfo = useMemo(() => {
    if (!full) return null
    const prefixBest: (Candidate | null)[] = [], prefixValid: number[] = [], events: { i: number; c: Candidate }[] = []
    let b: Candidate | null = null, v = 0
    full.all.forEach((c, i) => {
      if (!c.reject) { v++; if (!b || compareCandidates(c, b) < 0) { b = c; events.push({ i, c }) } }
      prefixBest.push(b); prefixValid.push(v)
    })
    return { prefixBest, prefixValid, events }
  }, [full])
  const [scanI, setScanI] = useState<number | null>(null)
  const scanTotal = full?.all.length ?? 0
  const scanStep = Math.max(1, Math.ceil(scanTotal / 60))
  useEffect(() => setScanI(null), [rules, weights])
  useEffect(() => {
    if (scanI === null || scanI >= scanTotal) return
    const t = window.setTimeout(() => setScanI(i => i === null ? null : Math.min(scanTotal, i + scanStep)), 25)
    return () => window.clearTimeout(t)
  }, [scanI, scanTotal, scanStep])
  const scanDone = scanI === null ? scanTotal : scanI
  const scanCur = scanDone > 0 ? full?.all[scanDone - 1] ?? null : null
  const scanBest = scanDone > 0 ? scanInfo?.prefixBest[scanDone - 1] ?? null : null
  const scanValid = scanDone > 0 ? scanInfo?.prefixValid[scanDone - 1] ?? 0 : 0
  const scanEvents = scanInfo?.events.filter(e => e.i < scanDone) ?? []

  // ---- best candidate of every placement, with its distinguishing features ----
  const perPlacement = useMemo(() => {
    if (!full || !full.valid.length) return []
    const m = new Map<string, Candidate>()
    for (const c of full.valid) if (!m.has(placementKey(c))) m.set(placementKey(c), c)
    const rows = [...m.values()]
    const minLen = Math.min(...rows.map(c => c.length)), minArea = Math.min(...rows.map(c => c.area)), minV = Math.min(...rows.map(c => c.vLen))
    return rows.map(c => {
      const tags: string[] = []
      if (c === full.valid[0]) tags.push('최적')
      if (c.bends === 0) tags.push('직선 연결 (꺾임 0)')
      if (Math.abs(c.length - minLen) < 1e-9) tags.push('최단 경로')
      if (Math.abs(c.vLen - minV) < 1e-9 && c.vLen < 1e-9) tags.push('세로 구간 없음')
      if (Math.abs(c.area - minArea) < 1e-9) tags.push('최소 면적'); else tags.push(`간격 ${c.gapSites} → 면적 +${round(c.area - minArea)} µm²`)
      if (c.muxFlip || c.andFlip) tags.push(`FN 사용 (${[c.muxFlip && 'MUX', c.andFlip && 'AND'].filter(Boolean).join('·')})`)
      // swapping the order and mirroring both cells is the whole pair mirrored left-right: same wire, same area
      const mirror = rows.find(o => o !== c && o.order !== c.order && o.muxFlip !== c.muxFlip && o.andFlip !== c.andFlip && o.gapSites === c.gapSites && Math.abs(o.cost - c.cost) < 1e-9)
      if (mirror) tags.push(`좌우 대칭 쌍 (${full.valid.indexOf(mirror) + 1}위와 동등)`)
      return { c, tags, rank: full.valid.indexOf(c) + 1 }
    })
  }, [full])

  // ---- all 24 placements side by side: the same placement under sky130 (130 nm) and the virtual 90 nm rules ----
  const full130 = useMemo(() => ready ? searchAll(mux!, and!, sourceRules, ALL_PLACEMENTS, weights) : null, [ready, mux, and, sourceRules, weights])
  const [gallerySort, setGallerySort] = useState<'90' | '130' | 'fixed'>('90')
  const gallery = useMemo(() => {
    if (!full || !full130) return []
    const firstBy = (s: Search) => { const m = new Map<string, Candidate>(); for (const c of s.valid) if (!m.has(placementKey(c))) m.set(placementKey(c), c); return m }
    const m90 = firstBy(full), m130 = firstBy(full130)
    // competition ranking on cost: placements with equal cost (e.g. left-right mirror pairs) share a rank
    const rankIn = (m: Map<string, Candidate>, k: string) => { const c = m.get(k); return c ? 1 + [...m.values()].filter(o => o.cost < c.cost - 1e-9).length : null }
    return ALL_PLACEMENTS.map((pl, idx) => { const k = placementKey(pl)
      return { k, idx, pl, c90: m90.get(k) ?? null, c130: m130.get(k) ?? null, rank90: rankIn(m90, k), rank130: rankIn(m130, k) } })
  }, [full, full130])
  const gallerySorted = [...gallery].sort((a, b) => gallerySort === 'fixed' ? a.idx - b.idx
    : gallerySort === '90' ? (a.rank90 ?? 99) - (b.rank90 ?? 99) : (a.rank130 ?? 99) - (b.rank130 ?? 99))
  const galleryMaxW = Math.max(1, ...gallery.flatMap(g => [g.c90?.width ?? 0, g.c130?.width ?? 0]))
  const best130s = gallery.filter(g => g.rank130 === 1), best90s = gallery.filter(g => g.rank90 === 1)
  const sameBest = best90s.some(g => g.rank130 === 1)
  const rankChanged = gallery.filter(g => g.rank90 !== g.rank130).length

  const downloadProposal = () => {
    if (!base || !cur || !full) return
    const pack = (c: Candidate, r: Rules) => ({ placement: placementLabel(c), xPinRect: c.xRect, trackYUm: c.trackY, outlineUm: [round(c.width), r.row], areaUm2: round(c.area),
      net: { lengthUm: round(c.length), horizontalUm: round(c.hLen), verticalUm: round(c.vLen), bends: c.bends }, cost: round(c.cost),
      instances: [{ name: 'u_mux', cell: 'mux2_1', xUm: round(c.muxX), orient: c.muxFlip ? 'FN' : 'N' }, { name: 'u_and', cell: 'and2_1', xUm: round(c.andX), orient: c.andFlip ? 'FN' : 'N' }] })
    const proposal = {
      name: 'custom_emux2_1', kind: 'virtual-composite-standard-cell-candidate', verified: false,
      sourcePdk: 'sky130A', sourceLibrary: 'sky130_fd_sc_hd', targetPdk: preset === 'custom' ? 'custom virtual rules' : PRESETS[preset].label, targetPdkIsReal: false, targetRules: rules,
      function: 'Y = E & (S ? B : A)', connections: { u_mux: { A0: 'A', A1: 'B', S: 'S', X: 'M' }, u_and: { A: 'E', B: 'M', X: 'Y' } },
      search: { method: 'exhaustive', candidates: full.all.length, placements: placementsTried, valid: full.valid.length, rejected: full.rejected, weights, selectedRank: curRank },
      source130: { ...pack(base, sourceRules), compositeCellIsVirtual: true }, target90RulesOnly: kept ? pack(kept, rules) : null, target90Selected: pack(cur, rules),
      top10: full.valid.slice(0, 10).map(c => pack(c, rules)),
      assumptions: ['130 nm combined cell and placement are virtual; only the two source cells are real sky130 cells', 'site count per cell kept from sky130', 'pin shapes scaled proportionally, mirrored for FN', 'one met1 track per route; assumed pin access', 'proxy rail clearance; no complete DRC rules', 'no OBS/other nets, no via enclosure rules'],
      missing: ['merged transistor layout', 'internal legal routing', 'GDS', 'LEF', 'Liberty', 'DRC', 'LVS', 'parasitic extraction'],
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(proposal, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'custom_emux2_1-proposal.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const num = (label: string, value: number, onChange: (v: number) => void, step: number, min = 0.01, max = 5) => <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>{label}<input type="number" min={min} max={max} step={step} value={value}
    onChange={e => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))} style={{ width: 80 }}/></label>
  const three = [base && { c: base, r: sourceRules, t: baseSearch!.tracks, label: '130 nm · 가상 결합 시작 배치' }, kept && { c: kept, r: rules, t: keptSearch!.tracks, label: `${targetShort} · 가상 규칙만 변경 (배치 유지)` },
    cur && { c: cur, r: rules, t: full!.tracks, label: `${targetShort} · 전수 탐색 ${curRank === 1 ? '최적' : `${curRank}위`}` }].filter(Boolean) as { c: Candidate; r: Rules; t: number[]; label: string }[]

  return <section className="card">
    <div className="card-title"><div><small className="kicker">SKY130A HD → {targetLabel} · 전수 탐색 · 검증 전</small><h2>{level === 'five' ? '복잡한 표준셀 실험 (5개 이하)' : level === 'ten' ? '더 복잡한 표준셀 실험 (10개 이하)' : '매우 복잡한 표준셀 실험 (20개 이상)'}</h2></div><button type="button" onClick={downloadProposal} disabled={!cur}>후보 JSON 저장</button></div>
    {level === 'ten' && <p className="chip-note" style={{ marginBottom: 12 }}><b>6~10개 표준셀</b>로 이루어진 복합 셀 후보(가산기·카운터·ALU 슬라이스 등)를 만들어 봅니다. 배치 가짓수가 천만 ~ 수십조라 전수 탐색이 어려워 <b>SA</b>로 찾고, 6셀 후보는 전수 탐색으로 정답과 대조합니다. 목표 규칙은 가상 PDK이고 모든 셀·핀은 실제 SKY130A HD입니다. 5개 이하 후보와 2셀 전수 탐색은 <b>복잡한 표준셀 실험 (5개 이하)</b> 탭에, 20~50셀은 <b>매우 복잡한 표준셀 실험 (20개 이상)</b> 탭에 있습니다.</p>}
    {level === 'twenty' && <p className="chip-note" style={{ marginBottom: 12 }}><b>20~50개 표준셀</b>로 이루어진 복합 셀 후보(4·8비트 가산기, 8비트 카운터, 4비트 ALU 등)입니다. 배치 가짓수가 10^18 이상이라 전수 탐색은 불가능하고 검증할 정답도 없어, <b>SA</b>의 결과가 seed마다 같은 답에 모이는지로 신뢰를 가늠합니다. SA의 이동 횟수는 셀 수에 비례해서만 늘기 때문에 셀이 많을수록 탐색 공간 대비 평가 비율이 급격히 작아지고, 같은 규칙으로도 시간은 넷 수에 따라 달라집니다. 목표 규칙은 가상 PDK이고 모든 셀·핀은 실제 SKY130A HD입니다.</p>}
    {level === 'five' && <p className="chip-note" style={{ marginBottom: 12 }}><b>custom_emux2_1</b> — MUX2와 AND2를 결합한 enable형 2:1 MUX 후보입니다. 논리식은 <code>Y = E · (S ? B : A)</code>입니다. 130 nm의 두 실제 라이브러리 셀을 사용하지만, 결합 셀과 목표 형상·규칙은 가상입니다. 아래 2셀 전수 탐색 뒤에 <b>2~5셀 후보군</b>(전가산기·4:1 MUX 등)도 같은 방식으로 탐색합니다. 6~10셀은 <b>더 복잡한 표준셀 실험 (10개 이하)</b> 탭에서 다룹니다.</p>}
    <p className="chip-note" style={{ marginBottom: 12, padding: 10, borderLeft: '4px solid #b45f06', background: 'var(--surface-muted)' }}><b>가상 실험 안내:</b> 130 nm의 개별 MUX2·AND2 크기와 핀 자료만 실제 SKY130A에서 가져왔습니다. 130 nm 결합 셀의 배치와 {targetLabel}에 따른 셀 모양·주황색 배선은 모두 시뮬레이션입니다. 여기의 “규칙 통과”는 제한된 모델 검사이며 실제 PDK DRC·LVS 통과가 아닙니다.</p>
    {loadError && <p className="init-error">{loadError}</p>}
    {!data && !loadError && <p className="chip-note">원본 셀 크기와 핀 위치를 불러오는 중입니다.</p>}
    {data && !ready && <p className="init-error">MUX2 또는 AND2의 LEF 크기가 없어 실험할 수 없습니다.</p>}
    {ready && full && <>
      {level === 'five' && <div className="data-table" style={{ marginBottom: 14 }}><table><thead><tr><th>구성</th><th>PDK 원본</th><th>후보 내부 연결</th></tr></thead><tbody>
        <tr><td>MUX</td><td><code>sky130_fd_sc_hd__mux2_1</code> · {mux!.devices.length}개 소자 · {mux!.info.size![0]} × {sourceHeight} µm ({Math.round(mux!.info.size![0] / SOURCE_SITE)} site) · 출력 X 핀 사각형 {mux!.info.pins.find(p => p.n === 'X')?.rects.length}개</td><td>A0=A, A1=B, S=S, X=M</td></tr>
        <tr><td>AND</td><td><code>sky130_fd_sc_hd__and2_1</code> · {and!.devices.length}개 소자 · {and!.info.size![0]} × {sourceHeight} µm ({Math.round(and!.info.size![0] / SOURCE_SITE)} site)</td><td>A=E, B=M, X=Y</td></tr>
      </tbody></table></div>}

      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}><b style={{ fontSize: 12 }}>목표 PDK 규칙</b>
          {(['vpdk90', 'ratio'] as const).map(p => <button key={p} type="button" className={preset === p ? 'active' : ''} aria-pressed={preset === p} onClick={() => applyPreset(p)}>{PRESETS[p].label}</button>)}
          {preset === 'custom' && <span className="chip-note">직접 수정한 규칙</span>}</div>
        <div className="data-table" style={{ marginTop: 8 }}><table><thead><tr><th>규칙</th><th>SKY130A 자료 기반 130 nm 모델</th><th>목표 ({targetLabel})</th><th>변화</th></tr></thead><tbody>
          {([['site 폭 (µm)', 'site'], ['행 높이 (µm)', 'row'], ['met1 pitch (µm)', 'm1Pitch'], ['met1 폭 (µm)', 'm1Width'], ['전원 레일 반폭 (µm)', 'railHalf']] as [string, keyof Rules][]).map(([n, k]) =>
            <tr key={k}><td>{n}</td><td>{round(sourceRules[k])}</td><td>{round(rules[k])}</td><td>{pct(sourceRules[k], rules[k])}</td></tr>)}
          <tr><td>행 높이 / site 폭</td><td>{round(sourceRules.row / sourceRules.site)}</td><td>{round(rules.row / rules.site)}</td><td>{pct(sourceRules.row / sourceRules.site, rules.row / rules.site)}</td></tr>
        </tbody></table></div>
        <p className="chip-note" style={{ margin: '6px 0 0' }}>{preset === 'custom' ? '프리셋에서 값을 직접 바꾼 상태입니다' : PRESETS[preset].note}. SKY130A의 site·pitch·폭·레일 수치는 설치된 techlef/셀 LEF에서 읽었지만 트랙의 레일 이격 계산은 이 화면의 단순화된 가정입니다. 목표 값은 <b>실제 파운드리 PDK가 아닌 이 실험용 가상 규칙</b>입니다.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 10, marginTop: 8 }}>
          {num('site 폭', rules.site, setRule('site'), 0.001)}{num('행 높이', rules.row, setRule('row'), 0.01)}{num('met1 pitch', rules.m1Pitch, setRule('m1Pitch'), 0.001)}{num('met1 폭', rules.m1Width, setRule('m1Width'), 0.001)}{num('레일 반폭', rules.railHalf, setRule('railHalf'), 0.001)}
        </div>
      </div>

      {level !== 'five' && <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 10 }}>
          <b style={{ fontSize: 12, alignSelf: 'center' }}>비용 = 배선 길이 합 +</b>
          {num('꺾임 1회당 (µm)', weights.bend, v => setWeights(w => ({ ...w, bend: v })), 0.05, 0, 5)}
          {num('세로 구간 추가 가중', weights.vertical, v => setWeights(w => ({ ...w, vertical: v })), 0.1, 0, 10)}
          {num('면적 가중 (/µm²)', weights.area, v => setWeights(w => ({ ...w, area: v })), 0.01, 0, 1)}
          <button type="button" onClick={() => setWeights(DEFAULT_WEIGHTS)}>기본 가중치</button>
        </div>
        <p className="chip-note" style={{ margin: '6px 0 0' }}>가중치는 후보군 탐색의 비용 모델입니다. 세로 구간·꺾임 벌점은 가상 값이며 실제 층 사용·비아·RC를 계산한 것이 아닙니다. 바꾸면 아래 후보 탐색 결과가 초기화됩니다.</p>
      </div>}

      {level === 'ten' && bench && <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div className="card-title" style={{ marginBottom: 6 }}><div><small className="kicker">TIME ANALYSIS · 먼저 분석</small><h3>전수 탐색이 가능한가 — 실제 측정 시간으로 판단</h3></div>
          <span className="connection" style={{ color: '#1D9E75' }}>현재 2셀: 전수 (즉시)</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
          <div className="card" style={{ padding: 10 }}><small>현재 후보 수</small><h4 style={{ margin: '3px 0' }}>{fmtN(full.all.length)}개</h4><small>배치 {placementsTried} × X 핀 {nPinRects} × 트랙 {full.tracks.length}</small></div>
          <div className="card" style={{ padding: 10 }}><small>전수 탐색 1회 (실측)</small><h4 style={{ margin: '3px 0' }}>{fmtTime(bench.ms / 1000)}</h4><small>이 브라우저에서 40회 평균</small></div>
          <div className="card" style={{ padding: 10 }}><small>후보 1개 평가</small><h4 style={{ margin: '3px 0' }}>{round(bench.usPerCandidate)} µs</h4><small>위 2셀 탐색 기준 (객체 생성 포함)</small></div>
        </div>
        <div className="card" style={{ padding: 10, marginTop: 10, background: 'var(--surface-muted)' }}>
          <b style={{ fontSize: 12 }}>탐색 시간 계산식</b>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.8, marginTop: 4 }}>
            <div>전수 탐색 시간 T<sub>전수</sub>(n) = N<sub>배치</sub>(n) × t<sub>p</sub>(n)</div>
            <div>SA 시간 T<sub>SA</sub>(n) = M(n) × t<sub>p</sub>(n), &nbsp;M(n) = {saStages()} 단계 × max(100, 40n) 이동</div>
            <div>배치 수 N<sub>배치</sub>(n) = n! (셀 순서) × 2<sup>n</sup> (셀마다 N/FN) × {MAX_GAP_SITES + 1}<sup>n−1</sup> (셀 사이 간격 0~{MAX_GAP_SITES} site)</div>
            <div>t<sub>p</sub>(n) = 배치 하나를 평가하는 시간 — 그 배치의 넷 전부를 각자 최선의 (핀 사각형 쌍 × met1 트랙)으로 배선해 비용 합산. <b>n마다 이 브라우저에서 실측</b> (넷이 많을수록 길어짐)</div>
            {(() => { const r = scaling.find(x => x.n === 4); return r && r.tp !== null ? <div><b>예 (n=4, 넷 {r.nets}개):</b> T<sub>전수</sub> = 4!·2⁴·3³ × {round(r.tp)} µs = {fmtN(r.placements)} × {round(r.tp)} µs = <b>{fmtTime(r.tEx)}</b> · T<sub>SA</sub> = {fmtN(r.moves)} × {round(r.tp)} µs = <b>{fmtTime(r.tSa)}</b></div> : null })()}
            <div style={{ color: 'var(--text-secondary)' }}>2셀(custom_emux2_1, 5개 이하 탭)은 후보 {fmtN(full.all.length)}개를 {fmtTime(bench.ms / 1000)}에 전부 평가 (실측). 아래 표는 SA 실험의 실제 셀 회로(nand2·inv·mux2·and2·xor2·nor2·or2·a21oi·buf·nand2) 앞 n개 기준입니다.</div>
          </div>
        </div>
        <div className="data-table" style={{ marginTop: 10 }}><table><thead><tr><th>셀 수 · 넷 수</th><th>배치 수 N<br/><small>n!·2ⁿ·{MAX_GAP_SITES + 1}ⁿ⁻¹</small></th><th>t<sub>p</sub> (실측)</th><th>전수 탐색<br/><small>N × t<sub>p</sub></small></th><th>SA<br/><small>M × t<sub>p</sub></small></th><th>판정</th></tr></thead><tbody>
          {scaling.map(r => { const v = verdictRow(r); return <tr key={r.n}>
            <td><b>{r.n}셀</b> · 넷 {r.nets}개</td><td>{fmtN(r.placements)}</td><td>{r.tp === null ? '—' : `${round(r.tp)} µs`}</td>
            <td style={{ fontSize: 11 }}>{fmtN(r.placements)} × {r.tp === null ? '—' : round(r.tp)} µs<br/>= <b>{fmtTime(r.tEx)}</b></td>
            <td style={{ fontSize: 11 }}>{fmtN(r.moves)} × {r.tp === null ? '—' : round(r.tp)} µs<br/>= <b>{fmtTime(r.tSa)}</b></td>
            <td style={{ color: v.c, fontWeight: 700 }}>{v.t}</td></tr> })}
        </tbody></table></div>
        <div className="card" style={{ padding: 10, marginTop: 10, borderLeft: '4px solid #c0392b' }}>
            <b style={{ fontSize: 13 }}>탐색 방법 기준 (위 실측에서 나온 경계)</b>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.7 }}>
              {saFrom && <li><b style={{ color: '#1D9E75' }}>1~{saFrom.n - 1}셀: 전수 탐색</b> — {lastExhaustive ? <>{lastExhaustive.n}셀도 전수 {fmtTime(lastExhaustive.tEx)}로 SA({fmtTime(lastExhaustive.tSa)})보다 빠르거나 같고, </> : null}모든 배치를 보므로 이 비용 모델의 <b>전역 최적이 보장</b>됩니다.</li>}
              {saFrom && <li><b style={{ color: '#c0392b' }}>{saFrom.n}셀 이상: SA가 유리한 구간(이 측정 기준)</b> — {saFrom.n}셀부터 전수 추정 {fmtTime(saFrom.tEx)}가 SA 추정 {fmtTime(saFrom.tSa)}보다 길어집니다. 셀이 하나 늘면 전수 후보 수가 급증하지만 이 SA 이동 횟수는 완만하게 늘어납니다. SA는 최적 보장이 없어 seed를 여러 번 돌려 비교할 수 있습니다 — 아래 실험에서 {saFrom.n}~6셀은 전수 결과와 직접 대조합니다.</li>}
              {impossibleFrom && <li><b style={{ color: '#8e1b10' }}>{impossibleFrom.n}셀 이상: 이 모델의 전수 추정이 1년 이상</b> — {impossibleFrom.n}셀 전수 추정 시간은 {fmtTime(impossibleFrom.tEx)}입니다. 이때는 SA 등 휴리스틱이 실용적이지만 전수 외의 다른 알고리즘이나 제약 축소도 가능하며, 전역 최적 여부는 별도 증명 없이는 알 수 없습니다.</li>}
            </ul>
            <div className="data-table" style={{ marginTop: 8 }}><table><thead><tr><th>규모</th><th>실제 도구가 쓰는 방법</th></tr></thead><tbody>
              <tr><td>셀 몇 개 · 작은 창</td><td><b>전수 탐색</b> — 세부 배치(detailed placement)가 3~4셀 창을 옮겨 가며 순서·방향을 전부 시도하는 것과 같은 크기 (이 실험의 2셀)</td></tr>
              <tr><td>매크로 수십~수백 개</td><td><b>SA</b> — 크고 개수가 적은 블록의 위치·방향. OpenROAD 매크로 배치기(mpl)가 SA 기반이고, 이 프로젝트의 Macro Tetris도 SA</td></tr>
              <tr><td>표준셀 수천~수백만 개</td><td><b>RePlAce</b>(OpenROAD 전역 배치) — 셀 전체를 한 번에 전기장(밀도) 모델로 연속 좌표에 퍼뜨리는 해석적 전역 배치 → <b>legalization</b>(행·site에 겹침 없이 맞춤) → <b>세부 배치</b>(작은 창 최적화)</td></tr>
              <tr><td>배선</td><td><b>전역 배선</b>(격자 단위 대략 경로) → <b>세부 배선</b>, 넷끼리 겹치면 <b>rip-up &amp; reroute</b>(뜯고 비용 올려 다시 잇기) 반복</td></tr>
            </tbody></table></div>
            <p className="chip-note" style={{ margin: '6px 0 0' }}>표준셀이 많아지면 RePlAce 같은 전역 배치 후 세부 배치를 사용하고, SA는 개수가 적은 매크로에 주로 씁니다. 위 시간은 이 브라우저의 간이 배선 평가를 바탕으로 추정했으며 하드웨어·구현·문제 구조에 따라 탐색 방법의 유불리 경계가 달라질 수 있습니다.</p>
          </div>
      </div>}

      {level === 'five' && <>
      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div className="card-title" style={{ marginBottom: 6 }}><div><small className="kicker">EXHAUSTIVE SEARCH</small><h3>가능한 조합 전부를 시도해 비용이 가장 낮은 것 선택</h3></div>
          {cur && curRank !== 1 && <button type="button" onClick={() => setPickedId(null)}>최적 후보로 돌아가기</button>}</div>
        <div className="data-table"><table><thead><tr><th>탐색 차원</th><th>경우의 수</th><th>설명</th></tr></thead><tbody>
          <tr><td>셀 순서</td><td>2</td><td>MUX→AND, AND→MUX</td></tr>
          <tr><td>셀 방향</td><td>2 × 2</td><td>각 셀 N 또는 FN(좌우 뒤집기). FS(위아래)는 레일이 바뀌어 같은 행에 놓을 수 없어 제외</td></tr>
          <tr><td>셀 사이 간격</td><td>{MAX_GAP_SITES + 1}</td><td>0~{MAX_GAP_SITES} site. 이 단일 넷·장애물 없는 모델에서는 간격 증가가 거리·면적만 늘립니다. 실제 P&R에서는 간격이 핀 접근·혼잡을 개선할 수 있습니다.</td></tr>
          <tr><td>출력 X 핀 사각형</td><td>{mux!.info.pins.find(p => p.n === 'X')?.rects.length}</td><td>MUX2의 X 핀은 LEF에서 사각형 여러 개 — 어느 도형을 배선 시작점으로 쓸지</td></tr>
          <tr><td>met1 트랙</td><td>{full.tracks.length}</td><td>레일 사이에서 쓸 수 있는 트랙 전부</td></tr>
          <tr><td><b>전체 후보</b></td><td><b>{fmtN(full.valid.length + rejectedTotal)}</b></td><td>배치 {placementsTried}가지 × 배선 {placementsTried ? round((full.valid.length + rejectedTotal) / placementsTried) : 0}가지</td></tr>
        </tbody></table></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, margin: '10px 0', fontSize: 13 }}>
          <span>가상 모델 통과 <b style={{ color: '#1D9E75' }}>{fmtN(full.valid.length)}</b></span>
          <span>가상 모델 탈락 <b style={{ color: rejectedTotal ? '#c0392b' : undefined }}>{fmtN(rejectedTotal)}</b>{rejectedTotal ? ` (${Object.entries(full.rejected).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}</span>
          <span>가상 모델에서 경로를 찾은 배치 {bestPlacementCount}가지</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 10 }}>
          <b style={{ fontSize: 12, alignSelf: 'center' }}>비용 = 경로 길이 +</b>
          {num('꺾임 1회당 (µm)', weights.bend, v => setWeights(w => ({ ...w, bend: v })), 0.05, 0, 5)}
          {num('세로 구간 추가 가중', weights.vertical, v => setWeights(w => ({ ...w, vertical: v })), 0.1, 0, 10)}
          {num('면적 가중 (/µm²)', weights.area, v => setWeights(w => ({ ...w, area: v })), 0.01, 0, 1)}
          <button type="button" onClick={() => setWeights(DEFAULT_WEIGHTS)}>기본 가중치</button>
        </div>
        <p className="chip-note" style={{ margin: '6px 0 8px' }}>세로 구간과 꺾임에는 <b>가상의 벌점</b>을 줍니다. 실제 다른 층 사용이나 비아 개수, RC 비용을 계산한 값은 아닙니다. 가중치를 바꾸면 이 비용 모델로 즉시 다시 전부 탐색합니다.</p>
        {full.valid.length === 0 ? <p className="init-error">가상 모델에서 경로를 찾은 후보가 없습니다. 아래 탈락 이유와 권장 수정값을 확인하세요.</p> :
          <div className="data-table" style={{ maxHeight: 320, overflow: 'auto' }}><table><thead><tr><th>순위</th><th>배치</th><th>X 핀</th><th>트랙 y</th><th>길이</th><th>가로 / 세로</th><th>꺾임</th><th>면적</th><th>비용</th></tr></thead><tbody>
            {full.valid.slice(0, 15).map((c, i) => <tr key={c.id} onClick={() => { setPickedId(c.id); setProgress(100) }} style={{ cursor: 'pointer', background: cur?.id === c.id ? 'var(--accent-soft)' : undefined }}>
              <td><b>{i + 1}</b></td><td style={{ fontSize: 11 }}>{placementLabel(c)}</td><td>#{c.xRect + 1}</td><td>{c.trackY}</td><td>{round(c.length)}</td><td>{round(c.hLen)} / {round(c.vLen)}</td><td>{c.bends}</td><td>{round(c.area)}</td><td><b>{round(c.cost)}</b></td></tr>)}
          </tbody></table></div>}
        <p className="chip-note" style={{ margin: '6px 0 0' }}>상위 15개를 표시합니다. 행을 누르면 그 후보가 아래 비교·애니메이션에 반영됩니다. 같은 비용이면 면적 → 길이 순으로 정렬합니다.</p>
      </div>

      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div className="card-title" style={{ marginBottom: 6 }}><div><small className="kicker">VIRTUAL FAILURE CASES · 실제 DRC 아님</small><h3>실패한 배치와 실패 규칙도 보기</h3></div></div>
        {failedPlacements.length > 0 ? <>
          <p className="chip-note" style={{ margin: '0 0 8px' }}>현재 목표 규칙에서 가상 경로를 찾지 못한 배치 {failedPlacements.length}/{placementsTried}가지를 모두 표시합니다. 같은 이유로 반복된 후보는 배치당 하나만 표시합니다.</p>
          <div className="data-table" style={{ maxHeight: 220, overflow: 'auto' }}><table><thead><tr><th>탈락 배치</th><th>실패 이유 (가상 모델)</th><th>고칠 것 · 재탐색 전</th><th>X 핀 도형</th></tr></thead><tbody>
            {failedPlacements.map(c => <tr key={c.id}><td>{placementLabel(c)}</td><td style={{ color: '#c0392b' }}>{c.reject}</td><td>{repairFor(c.reject, rules).guidance}</td><td>#{c.xRect + 1}</td></tr>)}
          </tbody></table></div>
          {currentRepair.corrected && <button type="button" onClick={() => applyRepair(currentRepair.corrected!)} style={{ marginTop: 8 }}>현재 실패 원인의 권장 수정 적용</button>}
        </> : <p className="chip-note" style={{ margin: '0 0 8px' }}>현재 목표 규칙에서는 이 제한된 모델의 모든 배치에서 경로를 찾았습니다. 이것은 실제 DRC 통과를 뜻하지 않습니다.</p>}
        <p className="chip-note" style={{ margin: '0 0 8px' }}>아래는 현재 가상 PDK 값을 한 항목씩 일부러 바꾼 <b>독립적인 실패 시뮬레이션</b>입니다. 실제 90 nm 공정 규칙이나 발견된 제조 결함이 아닙니다.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: 10 }}>
          {failureExamples.map(example => { const failed = example.result.all.find(c => c.reject), repair = repairFor(failed?.reject ?? null, example.rules)
            return <div key={example.label} className="card" style={{ padding: 10, minWidth: 0 }}>
              <b style={{ fontSize: 12 }}>{example.label}</b><div style={{ fontSize: 11, margin: '5px 0' }}>{example.changed} · 후보 {example.result.all.length}개 중 가상 모델 탈락 {example.result.all.filter(c => c.reject).length}개</div>
              <div style={{ color: '#c0392b', fontSize: 12 }}>결과: {failed?.reject ?? '이 설정에서는 경로가 남아 있음'}</div>
              {failed && <div style={{ fontSize: 12, marginTop: 5 }}><b>고칠 것:</b> {repair.guidance}</div>}
              {failed && <Snapshot c={failed} rules={example.rules} tracks={example.result.tracks} pxPerUm={Math.min(40, 240 / failed.width)} maxW={failed.width} maxH={Math.max(sourceRules.row, example.rules.row)} label={`${example.label} 가상 실패`}/>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}><button type="button" onClick={() => applyRepair(example.rules)}>이 실패 조건 적용</button>{repair.corrected && <button type="button" onClick={() => applyRepair(repair.corrected!)}>권장 수정 후 재탐색</button>}</div>
            </div> })}
        </div>
        <p className="chip-note" style={{ margin: '8px 0 0' }}>수정 버튼은 표시된 한 가지 가상 실패 원인만 고친 뒤 다시 탐색합니다. 다른 탈락 원인이 이어서 나타날 수 있으며 실제 DRC 통과를 보증하지 않습니다. 기본 상태로 돌아가려면 위의 <b>가상 90 nm PDK (VPDK-90)</b> 버튼을 누르세요.</p>
      </div>

      {scanInfo && <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div className="card-title" style={{ marginBottom: 6 }}><div><small className="kicker">LIVE SCAN</small><h3>탐색 과정 — 후보를 하나씩 평가하며 최선이 바뀌는 과정</h3></div>
          <div style={{ display: 'flex', gap: 8 }}><button type="button" onClick={() => setScanI(0)}>탐색 과정 재생</button>{scanI !== null && <button type="button" onClick={() => setScanI(null)}>결과로 건너뛰기</button>}</div></div>
        <div style={{ height: 8, borderRadius: 4, background: 'var(--surface-muted)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${scanTotal ? scanDone / scanTotal * 100 : 0}%`, background: '#378ADD' }}/></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, margin: '8px 0', fontSize: 13 }}>
          <span>처리 <b>{fmtN(scanDone)}</b> / {fmtN(scanTotal)}</span><span>가상 모델 통과 <b style={{ color: '#1D9E75' }}>{fmtN(scanValid)}</b></span><span>탈락 <b>{fmtN(scanDone - scanValid)}</b></span>
          <span>최선 갱신 <b>{scanEvents.length}</b>회</span>{scanBest && <span>지금까지 최선 비용 <b>{round(scanBest.cost)}</b></span>}
          {scanI !== null && scanI < scanTotal && <span style={{ color: '#C0A02B' }}>재생 중 (실제 계산은 {fmtTime((bench?.ms ?? 0) / 1000)}에 끝남 — 보이도록 느리게 재생)</span>}
          {scanDone === scanTotal && <span style={{ color: '#1D9E75' }}>완료 · 전체 {fmtN(scanTotal)}개 중 최선 확정</span>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 10 }}>
          {scanCur && <div style={{ minWidth: 0 }}><small><b>지금 평가 중 #{scanDone}</b> · {placementLabel(scanCur)} · X#{scanCur.xRect + 1} · y={scanCur.trackY ?? '—'}<br/>{scanCur.reject ? <span style={{ color: '#c0392b' }}>탈락: {scanCur.reject}<br/>고칠 것: {repairFor(scanCur.reject, rules).guidance}</span> : <>길이 {round(scanCur.length)} µm · 꺾임 {scanCur.bends} · 비용 {round(scanCur.cost)}</>}</small>
            <Snapshot c={scanCur} rules={rules} tracks={full.tracks} pxPerUm={Math.min(48, 300 / maxW)} maxW={maxW} maxH={rules.row} label="지금 평가 중"/></div>}
          {scanBest && <div style={{ minWidth: 0 }}><small><b style={{ color: '#1D9E75' }}>지금까지 최선</b> · {placementLabel(scanBest)} · X#{scanBest.xRect + 1} · y={scanBest.trackY}<br/>길이 {round(scanBest.length)} µm · 꺾임 {scanBest.bends} · 비용 <b>{round(scanBest.cost)}</b></small>
            <Snapshot c={scanBest} rules={rules} tracks={full.tracks} pxPerUm={Math.min(48, 300 / maxW)} maxW={maxW} maxH={rules.row} label="지금까지 최선"/></div>}
        </div>
        <div className="data-table" style={{ marginTop: 8, maxHeight: 180, overflow: 'auto' }}><table><thead><tr><th>최선이 바뀐 시점</th><th>후보</th><th>길이</th><th>꺾임</th><th>비용</th></tr></thead><tbody>
          {[...scanEvents].reverse().map(e => <tr key={e.i}><td>#{e.i + 1}</td><td style={{ fontSize: 11 }}>{placementLabel(e.c)} · X#{e.c.xRect + 1} · y={e.c.trackY}</td><td>{round(e.c.length)}</td><td>{e.c.bends}</td><td><b>{round(e.c.cost)}</b></td></tr>)}
        </tbody></table></div>
      </div>}

      {perPlacement.length > 0 && <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div className="card-title" style={{ marginBottom: 6 }}><div><small className="kicker">CANDIDATE FEATURES</small><h3>배치 {perPlacement.length}가지 각각의 최선과 특징</h3></div></div>
        <div className="data-table" style={{ maxHeight: 340, overflow: 'auto' }}><table><thead><tr><th>전체 순위</th><th>배치</th><th>X 핀 · 트랙</th><th>길이</th><th>가로 / 세로</th><th>꺾임</th><th>면적</th><th>비용</th><th>특징</th></tr></thead><tbody>
          {perPlacement.map(({ c, tags, rank }) => <tr key={c.id} onClick={() => { setPickedId(c.id); setProgress(100) }} style={{ cursor: 'pointer', background: cur?.id === c.id ? 'var(--accent-soft)' : undefined }}>
            <td><b>{rank}</b></td><td style={{ fontSize: 11 }}>{placementLabel(c)}</td><td>#{c.xRect + 1} · y={c.trackY}</td><td>{round(c.length)}</td><td>{round(c.hLen)} / {round(c.vLen)}</td><td>{c.bends}</td><td>{round(c.area)}</td><td><b>{round(c.cost)}</b></td>
            <td style={{ fontSize: 11 }}>{tags.map(t => <span key={t} style={{ display: 'inline-block', margin: '1px 3px 1px 0', padding: '1px 6px', borderRadius: 8, background: t === '최적' ? '#1D9E75' : 'var(--surface-muted)', color: t === '최적' ? '#fff' : undefined }}>{t}</span>)}</td></tr>)}
        </tbody></table></div>
        <p className="chip-note" style={{ margin: '6px 0 0' }}>배치(순서·방향·간격)마다 배선을 전수 탐색해 가장 좋은 것 하나씩만 보여 줍니다. 행을 누르면 그 후보가 아래 비교에 반영됩니다.</p>
      </div>}

      {gallery.length > 0 && full130 && <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div className="card-title" style={{ marginBottom: 6 }}><div><small className="kicker">ALL {gallery.length} PLACEMENTS · 130 nm vs {targetShort}</small><h3>배치 {gallery.length}가지 그림 — 130 nm 가상 결합 후보와 {targetLabel} 비교</h3></div>
          <div className="layout-pills">{([['90', `${targetShort} 순위순`], ['130', '130 nm 순위순'], ['fixed', '배치 번호순']] as const).map(([k, l]) => <button key={k} className={gallerySort === k ? 'active' : ''} onClick={() => setGallerySort(k)}>{l}</button>)}</div></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 13, marginBottom: 8 }}>
          <span>130 nm 가상 모델 최적 ({best130s.length}개 동점): <b>{best130s.map(g => placementLabel(g.pl)).join(' / ') || '—'}</b></span>
          <span>{targetShort} 가상 모델 최적 ({best90s.length}개 동점): <b>{best90s.map(g => placementLabel(g.pl)).join(' / ') || '—'}</b></span>
          <span>{sameBest ? '최적 배치는 두 규칙에서 같음' : <b style={{ color: '#c0392b' }}>규칙이 바뀌며 최적 배치가 달라짐</b>}</span>
          <span>순위가 바뀐 배치 <b>{rankChanged}</b> / {gallery.length} (동점은 같은 순위, 좌우 대칭 쌍은 늘 동점)</span>
        </div>
        <p className="chip-note" style={{ margin: '0 0 8px' }}>각 칸의 위 그림은 SKY130A 개별 셀 자료(site 0.46 · 행 2.72 · met1 pitch 0.34 µm)로 만든 <b>가상 결합 배치</b>, 아래 그림은 {targetLabel}에서 <b>같은 배치</b>를 그린 것입니다. 같은 축척(µm)으로 크기 차이를 보여주며, 주황색 선은 제한된 핀·트랙 모델에서 고른 경로입니다. 칸을 누르면 해당 목표 후보가 아래 비교·애니메이션에 반영됩니다.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 10, maxHeight: 900, overflow: 'auto', paddingRight: 4 }}>
          {gallerySorted.map(g => { const isLib = g.k === placementKey(BASELINE_PLACEMENT), sel = cur && placementKey(cur) === g.k
            const border = g.rank90 === 1 ? '#1D9E75' : g.rank130 === 1 ? '#7F77DD' : sel ? 'var(--text-primary)' : 'var(--border-strong)'
            return <div key={g.k} onClick={() => { if (g.c90) { setPickedId(g.c90.id); setProgress(100) } }} style={{ border: `${g.rank90 === 1 || g.rank130 === 1 || sel ? 2 : 1}px solid ${border}`, borderRadius: 8, padding: 8, cursor: 'pointer', minWidth: 0, background: sel ? 'var(--accent-soft)' : undefined }}>
              <div style={{ fontSize: 11, fontWeight: 700 }}>#{g.idx + 1} · {placementLabel(g.pl)}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '3px 0' }}>
                {g.rank130 === 1 && <span style={{ fontSize: 10, padding: '0 6px', borderRadius: 8, background: '#7F77DD', color: '#fff' }}>130 최적</span>}
                {g.rank90 === 1 && <span style={{ fontSize: 10, padding: '0 6px', borderRadius: 8, background: '#1D9E75', color: '#fff' }}>{targetShort} 최적</span>}
                {isLib && <span style={{ fontSize: 10, padding: '0 6px', borderRadius: 8, background: 'var(--surface-muted)' }}>130 시작 배치 (가상)</span>}
              </div>
              <small style={{ color: '#7F77DD' }}>130 nm · {g.rank130 ?? '—'}위 · 길이 {g.c130 ? round(g.c130.length) : '—'} µm · 꺾임 {g.c130?.bends ?? '—'}</small>
              {g.c130 ? <Snapshot c={g.c130} rules={sourceRules} tracks={full130.tracks} pxPerUm={Math.min(40, 220 / galleryMaxW)} maxW={galleryMaxW} maxH={Math.max(sourceRules.row, rules.row)} label={`130 nm 가상 결합 ${placementLabel(g.pl)}`}/> : <p className="chip-note" style={{ color: '#c0392b' }}>가상 모델 실패: {full130.all.find(c => placementKey(c) === g.k)?.reject ?? '경로 없음'}</p>}
              <small style={{ color: '#1D9E75' }}>{targetShort} · {g.rank90 ?? '—'}위 · 길이 {g.c90 ? round(g.c90.length) : '—'} µm · 꺾임 {g.c90?.bends ?? '—'}</small>
              {g.c90 ? <Snapshot c={g.c90} rules={rules} tracks={full.tracks} pxPerUm={Math.min(40, 220 / galleryMaxW)} maxW={galleryMaxW} maxH={Math.max(sourceRules.row, rules.row)} label={`${targetLabel} ${placementLabel(g.pl)}`}/> : <p className="chip-note" style={{ color: '#c0392b' }}>가상 모델 실패: {full.all.find(c => placementKey(c) === g.k)?.reject ?? '경로 없음'}</p>}
              {g.c90 && g.c130 && <div style={{ fontSize: 11, marginTop: 2 }}>
                길이 <b>{pct(g.c130.length, g.c90.length)}</b> · 면적 <b>{pct(g.c130.area, g.c90.area)}</b> · 세로 {round(g.c130.vLen)}→{round(g.c90.vLen)} µm
                {g.rank130 !== g.rank90 && <> · 순위 {g.rank130}→<b style={{ color: (g.rank90 ?? 99) < (g.rank130 ?? 99) ? '#1D9E75' : '#c0392b' }}>{g.rank90}</b></>}</div>}
            </div> })}
        </div>
      </div>}

      </>}

      <CellSaExperiment key={level} data={data} rules={rules} weights={weights} tier={level === 'five' ? 1 : level === 'ten' ? 2 : 3}/>

      {level === 'five' && <>
      {base && kept && cur && <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <b style={{ fontSize: 12 }}>무엇이 얼마나 바뀌나 — 같은 축척(µm)으로 나란히</b>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10, marginTop: 8 }}>
          {three.map(s => <div key={s.label} style={{ minWidth: 0 }}><small><b>{s.label}</b><br/>{placementLabel(s.c)}</small><Snapshot c={s.c} rules={s.r} tracks={s.t} pxPerUm={Math.min(48, 300 / maxW)} maxW={maxW} maxH={maxH} label={s.label}/></div>)}
        </div>
        <p className="chip-note" style={{ margin: '4px 0 0' }}>점선 = 결합 셀 외곽, 아래 파란 띠·위 빨간 띠 = VGND/VPWR met1 레일, 옅은 가로줄 = 사용 가능한 met1 트랙, 주황 = 내부 넷 M 경로. 앞의 두 그림도 배선(핀 사각형·트랙)은 전수 탐색으로 고른 최선입니다.</p>
        <div className="data-table" style={{ marginTop: 10 }}><table><thead><tr><th>항목</th>{three.map(s => <th key={s.label}>{s.label}</th>)}<th>130 가상 시작 → {targetShort} 가상 선택</th></tr></thead><tbody>
          <tr><td colSpan={5}><b>모양</b></td></tr>
          <tr><td>결합 셀 외곽 (µm)</td>{three.map(s => <td key={s.label}>{round(s.c.width)} × {s.r.row}</td>)}<td>폭 {pct(base.width, cur.width)} · 높이 {pct(sourceRules.row, rules.row)}</td></tr>
          <tr><td>면적 (µm²)</td>{three.map(s => <td key={s.label}>{round(s.c.area)}</td>)}<td>{pct(base.area, cur.area)}</td></tr>
          <tr><td>종횡비 (폭 / 높이)</td>{three.map(s => <td key={s.label}>{round(s.c.width / s.r.row)}</td>)}<td>{pct(base.width / sourceRules.row, cur.width / rules.row)}</td></tr>
          <tr><td>배치 (순서 · 방향 · 간격)</td>{three.map(s => <td key={s.label} style={{ fontSize: 11 }}>{placementLabel(s.c)}</td>)}<td>{placementLabel(base) === placementLabel(cur) ? '같음' : '바뀜'}</td></tr>
          <tr><td colSpan={5}><b>배선 (내부 넷 M)</b></td></tr>
          <tr><td>사용 가능 met1 트랙</td>{three.map(s => <td key={s.label}>{s.t.length}개</td>)}<td>{full.tracks.length - baseSearch!.tracks.length >= 0 ? '+' : ''}{full.tracks.length - baseSearch!.tracks.length}개</td></tr>
          <tr><td>사용 X 핀 · 트랙 높이</td>{three.map(s => <td key={s.label}>#{s.c.xRect + 1} · y={s.c.trackY} ({Math.round((s.c.trackY ?? 0) / s.r.row * 100)}%)</td>)}<td>행 안에서의 상대 위치</td></tr>
          <tr><td>경로 길이 (µm)</td>{three.map(s => <td key={s.label}><b>{round(s.c.length)}</b></td>)}<td><b>{pct(base.length, cur.length)}</b></td></tr>
          <tr><td>가로(met1) / 세로 구간 (µm)</td>{three.map(s => <td key={s.label}>{round(s.c.hLen)} / {round(s.c.vLen)}</td>)}<td>가로 {pct(base.hLen, cur.hLen)} · 세로 {base.vLen ? pct(base.vLen, cur.vLen) : `${round(base.vLen)} → ${round(cur.vLen)}`}</td></tr>
          <tr><td>꺾임 수</td>{three.map(s => <td key={s.label}>{s.c.bends}</td>)}<td>{cur.bends - base.bends >= 0 ? '+' : ''}{cur.bends - base.bends}</td></tr>
        </tbody></table></div>
        <p className="chip-note" style={{ marginTop: 8 }}><b>해석:</b> 규칙만 바꾸고 가상 결합 시작 배치를 유지하면 경로가 {round(base.length)} → {round(kept.length)} µm({pct(base.length, kept.length)}, 축소 효과)이고,
          {' '}가능한 배치 {placementsTried}가지를 모두 시도해 고른 {curRank === 1 ? '최적' : `${curRank}위`} 후보는 {round(cur.length)} µm로 거기서 {pct(kept.length, cur.length)} 더 변합니다(배치·방향 최적화 효과).
          {' '}모양은 종횡비 {round(base.width / sourceRules.row)} → {round(cur.width / rules.row)}로 {Math.abs((cur.width / rules.row) / (base.width / sourceRules.row) - 1) < 0.02 ? '거의 그대로입니다(같은 비율로 축소).' : '바뀝니다(site 폭과 행 높이의 축소 비율이 다름).'}</p>
      </div>}

      {frame && base && cur && <div className="card" style={{ padding: 12, overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}><b style={{ fontSize: 12 }}>130 nm → {targetShort} 변화 · {phase}</b><button type="button" onClick={() => { setProgress(0); setPlaying(true) }}>변화 재생</button><button type="button" onClick={() => setPlaying(false)} disabled={!playing}>일시 정지</button><label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>진행 <input type="range" min={0} max={100} value={progress} onChange={e => { setPlaying(false); setProgress(Number(e.target.value)) }}/>{progress}%</label></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 8, fontSize: 12 }}>
          <span>현재 가상 외곽 <b>{round(Math.max(frame.muxX + frame.muxW, frame.andX + frame.andW))} × {round(frameRules.row)} µm</b></span>
          <span>가상 met1 트랙 <b>{frame.tracks.length}개</b></span>
          <span>표시 경로 <b>{framePath ? `${round(framePath.h + framePath.v)} µm` : '없음'}</b></span>
          <span>배치 상태 <b>{overlap ? '전환 중 겹침' : '외곽 겹침 없음'}</b></span>
        </div>
        <svg viewBox={`0 0 ${maxW * scale + pad * 2} ${maxH * scale + pad * 2}`} role="img" aria-label={`130 nm 가상 결합 배치에서 ${targetLabel} 후보로 변화하는 셀 외곽, 핀, met1 트랙과 내부 연결`} style={{ display: 'block', width: '100%', minWidth: 380, maxWidth: 800, margin: '10px auto' }}>
          <rect x={sx(0)} y={sy(sourceRules.row)} width={base.width * scale} height={sourceRules.row * scale} fill="none" stroke="var(--text-secondary)" strokeDasharray="6 4" opacity={0.5}/>
          {frame.tracks.map(y => <line key={y} x1={sx(Math.min(frame.muxX, frame.andX))} x2={sx(Math.max(frame.muxX + frame.muxW, frame.andX + frame.andW))} y1={sy(y)} y2={sy(y)} stroke="#378ADD" strokeWidth={1} opacity={0.25}/>)}
          {[{ cell: mux!, x: frame.muxX, width: frame.muxW, flip: frame.muxFlip, label: 'MUX2', color: '#378ADD' }, { cell: and!, x: frame.andX, width: frame.andW, flip: frame.andFlip, label: 'AND2', color: '#1D9E75' }].map(item => <g key={item.label}>
            <rect x={sx(item.x)} y={sy(frameRules.row)} width={item.width * scale} height={frameRules.row * scale} fill={item.color} fillOpacity={0.12} stroke={item.color} strokeWidth={2}/>
            <text x={sx(item.x + item.width / 2)} y={sy(frameRules.row) + 18} textAnchor="middle" fontSize={13} fontWeight={700} fill="currentColor">{item.label}{item.flip ? ' FN' : ''}</text>
            {item.cell.info.pins.filter(p => p.use === 'signal').map(p => placedRects(item.cell, p.n, item.x, item.width, frameRules.row, item.flip).map((r, i) => <g key={`${p.n}-${i}`}>
              <rect x={sx(r.x1)} y={sy(r.y2)} width={Math.max(1, (r.x2 - r.x1) * scale)} height={Math.max(1, (r.y2 - r.y1) * scale)} fill={item.color} opacity={0.45}/>
              {i === 0 && <text x={sx(cx(r))} y={sy(r.y2) - 3} textAnchor="middle" fontSize={10} fill="currentColor">{p.n}</text>}
            </g>))}
          </g>)}
          {frame.a && frame.b && frame.t !== null && <g stroke="#b45f06" strokeWidth={2.4} fill="none">
            <path d={`M ${sx(cx(frame.a))} ${sy(clamp(frame.t, frame.a.y1, frame.a.y2))} V ${sy(frame.t)} H ${sx(cx(frame.b))} V ${sy(clamp(frame.t, frame.b.y1, frame.b.y2))}`}/>
            <circle cx={sx(cx(frame.a))} cy={sy(clamp(frame.t, frame.a.y1, frame.a.y2))} r={5} fill="#b45f06"/><circle cx={sx(cx(frame.b))} cy={sy(clamp(frame.t, frame.b.y1, frame.b.y2))} r={5} fill="#b45f06"/>
          </g>}
        </svg>
        <p className="chip-note" style={{ margin: 0 }}>회색 점선은 130 nm <b>가상 결합 후보</b>의 외곽, 반투명 사각형은 원본 LEF에서 변환한 핀 도형입니다. 재생하면 규칙(외곽·핀·트랙)이 먼저 바뀌고 그다음 선택 후보의 위치·방향으로 재배치됩니다. 표시 경로는 제한된 모델의 길이이며 실제 배선·기생값이 아닙니다. {overlap && progress > 35 && progress < 100 ? <b>이동 중 셀 겹침은 애니메이션 장면일 뿐 합법 배치가 아닙니다. </b> : null}</p>
      </div>}

      <p className="chip-note" style={{ marginTop: 10 }}><b>탐색 모델의 가정:</b> 셀마다 SKY130A의 site 수를 유지하고, 핀 도형은 셀 크기에 비례해 이동(FN이면 좌우 반전)합니다. 내부 넷 M만 met1 트랙 하나로 연결하고 핀 도형을 배선 시작점으로 쓸 수 있다고 가정합니다. 다른 신호 넷, 셀 내부 배선 장애물(OBS), 비아와 간격의 상세 규칙은 검사하지 않습니다. 이는 소자 수준의 셀 내부 P&R이나 실제 DRC가 아닙니다.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10, marginTop: 12 }}>
        <div className="card" style={{ padding: 12 }}><small>원본 셀의 실제 GDS 렌더 · 참고</small><div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>{SOURCE.map(name => <figure key={name} style={{ margin: 0 }}><img src={`/stdcells/layout/sky130_fd_sc_hd/${name}.png`} alt={`SKY130A ${name} 원본 GDS 렌더`} style={{ maxWidth: 180, maxHeight: 120, background: '#fff' }}/><figcaption style={{ fontSize: 11 }}>{name}</figcaption></figure>)}</div><small>{targetLabel}의 GDS는 생성되지 않았습니다.</small></div>
        <div className="card" style={{ padding: 12 }}><small>재사용한 원본 소자</small><h3 style={{ margin: '4px 0' }}>{mux!.devices.length + and!.devices.length}개</h3><small>두 SPICE 셀의 소자 수 합계 · 새 레이아웃 미생성</small></div>
      </div>
      <div className="card" style={{ padding: 12, marginTop: 12 }}>
        <b style={{ fontSize: 12 }}>기능 확인 · 입력을 눌러보기</b>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 8 }}>
          {(['A', 'B', 'S', 'E'] as const).map(name => <button type="button" key={name} aria-pressed={inputs[name] === 1} onClick={() => setInputs(v => ({ ...v, [name]: v[name] ? 0 : 1 }))}>{name} = {inputs[name]}</button>)}
          <span>선택값 <b>{selected}</b> → 출력 <b>Y = {output}</b></span>
        </div>
      </div>
      <p className="chip-note" style={{ marginTop: 12 }}><b>판정:</b> 기존 셀의 단순 크기 변경만으로는 {targetLabel}에 대응하는 단일 표준 셀이 완성되지 않습니다. 새 규칙에 맞는 소자·핀·전원 레일·내부 배선 P&R이 필요할 수 있습니다. 실제 목표 PDK가 생기면 GDS를 만든 뒤 DRC·LVS·기생 추출·타이밍 특성화를 해야 하며, 현재 화면은 이들 검증을 실행하지 않습니다.</p>
      </>}
      {level !== 'five' && <p className="chip-note" style={{ marginTop: 10 }}><b>탐색 모델의 가정:</b> 셀마다 SKY130A의 site 수를 유지하고 핀 도형은 셀 크기에 비례해 이동(FN이면 좌우 반전)합니다. 후보 안의 내부 연결(드라이버→싱크 2핀 넷)만 met1 트랙 하나로 잇고, 넷끼리는 독립이라 같은 트랙을 공유해 생기는 충돌은 검사하지 않습니다. 클록·전원·외부 입력, 셀 내부 배선 장애물(OBS), 비아와 간격의 상세 규칙도 검사하지 않습니다. 소자 수준의 셀 내부 P&R이나 실제 DRC가 아니며, 실제 목표 PDK가 생기면 GDS를 만든 뒤 DRC·LVS·기생 추출·타이밍 특성화가 필요합니다.</p>}
    </>}
  </section>
}

function fmtN(n: number) { return n.toLocaleString() }
