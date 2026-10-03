import { useEffect, useState } from 'react'
import pdk from '../data/sky130_pdk_info.json'

type Rect = [string, number, number, number, number]
type Pin = { n: string; dir: string; use: string; rects: Rect[] }
type Cell = { info: { size: [number, number] | null; site: string | null; pins: Pin[] } }
type Position = { x: number; y: number }

type Props = {
  libId: string
  libraryRowHeight: number
  cellName: string
  cell: Cell | null
  cells: Record<string, Cell> | null
  availableCells: string[]
  onSelectCell: (name: string) => void
  onOpenLibrary: () => void
}

const round = (value: number, digits = 3) => Number(value.toFixed(digits))
const sourceSiteWidth = (libId: string) => libId === 'sky130_fd_sc_hvl' ? 0.48 : 0.46
const EMPTY_CELLS: Record<string, Cell> = {}
const DEFAULT_TARGET_NM = 90
const outsideOf = (pins: { name: string; use: string; rects: Rect[] }[], size: [number, number]) => pins.filter(pin => pin.use === 'signal' && pin.rects.some(r =>
  r[1] < -1e-9 || r[2] < -1e-9 || r[3] > size[0] + 1e-9 || r[4] > size[1] + 1e-9)).map(pin => pin.name)
type TargetPin = { name: string; use: string; rects: Rect[] }

// ---- 가상 설계 규칙 ----
// 원본 규칙은 설치된 sky130A 기술 LEF(sky130_fd_sc_hd__nom.tlef)에서 읽은 실제 값이다(tools/gen_std_cell_info.py).
// 가상 규칙은 그 값을 목표/130 비율로 줄인 편집 시작점이며 화면에서 층별로 직접 고친다. 실제 목표 공정의 규칙이 아니다.
type LayerRule = { dir: 'vertical' | 'horizontal'; pitch: number; offset: number; width: number; spacing: number; area: number }
type RuleSet = Record<string, LayerRule>
const RULE_LAYERS = ['li1', 'met1', 'met2', 'met3', 'met4', 'met5']
const REAL_RULES: RuleSet = Object.fromEntries(RULE_LAYERS.flatMap(layer => {
  const v = (pdk.techlef.layers as unknown as Record<string, Partial<LayerRule>>)[layer]
  return v && v.pitch && v.width && v.spacing && v.offset && v.area && v.dir ? [[layer, v as LayerRule]] : []
}))
const scaleRules = (ratio: number): RuleSet => Object.fromEntries(Object.entries(REAL_RULES).map(([layer, v]) => [layer,
  { dir: v.dir, pitch: round(v.pitch * ratio, 4), offset: round(v.offset * ratio, 4), width: round(v.width * ratio, 4), spacing: round(v.spacing * ratio, 4), area: round(v.area * ratio * ratio, 5) }]))

type RuleId = 'outline' | 'grid' | 'width' | 'spacing' | 'track'
const RULE_LABEL: Record<RuleId, string> = { outline: '핀이 셀 외곽 안', grid: 'site·행 격자 정합', width: '최소 폭', spacing: '최소 간격', track: '배선 트랙 접근' }
const RULE_SHORT: Record<RuleId, string> = { outline: '외곽', grid: '격자', width: '폭', spacing: '간격', track: '트랙' }
// fail = 변경 때문에 새로 생긴 위반, origin = 설치된 PDK 원본(원본 규칙 기준)부터 있던 위반
type RuleCheck = { id: RuleId; label: string; fail: number; origin: number; notes: string[] }
const failOf = (r: { checks: RuleCheck[] }) => r.checks.reduce((sum, c) => sum + c.fail, 0)

// 핀 사각형이 층별 규칙을 지키는지 센다. 위반마다 안정적인 키를 붙여, 원본(원본 규칙)과 가상(가상 규칙)을 같은 키로 비교한다.
function violations(pins: TargetPin[], rules: RuleSet) {
  const out = { width: new Map<string, string>(), spacing: new Map<string, string>(), track: new Map<string, string>() }
  // 변경한 LEF 좌표는 1 nm(0.001 µm) 단위로 반올림되고 site 폭도 반올림되므로, ±1.5 nm 또는 0.2% 이내 오차는 위반으로 세지 않는다.
  const EPS = 0.0015
  const tol = (v: number) => EPS + 0.002 * v
  const trackHit = new Map<string, boolean>()
  pins.forEach(pin => pin.rects.forEach((r, i) => {
    const rule = rules[r[0]]
    if (!rule) return
    const thin = Math.min(r[3] - r[1], r[4] - r[2])
    if (thin < rule.width - tol(rule.width)) out.width.set(`${pin.name}:${r[0]}:${i}`, `${pin.name} ${r[0]} 폭 ${round(thin, 3)} < ${rule.width} µm`)
    if (pin.use !== 'signal' || !(rule.pitch > 0)) return
    // 트랙 접근: 라우터는 핀 도형을 지나는 배선 트랙에서 접근한다 — 핀 중심이 트랙 위일 필요는 없고, 트랙이 하나라도 지나가면 된다.
    const lo = rule.dir === 'vertical' ? r[1] : r[2], hi = rule.dir === 'vertical' ? r[3] : r[4]
    const n = Math.ceil((lo - EPS - rule.offset) / rule.pitch)
    const key = `${pin.name}:${r[0]}`
    trackHit.set(key, (trackHit.get(key) ?? false) || rule.offset + n * rule.pitch <= hi + EPS)
  }))
  for (const [key, hit] of trackHit) {
    if (hit) continue
    const [pinName, layer] = key.split(':')
    out.track.set(key, `${pinName} ${layer} 핀을 지나는 ${rules[layer].dir === 'vertical' ? '세로' : '가로'} 배선 트랙이 없음`)
  }
  const all = pins.flatMap(pin => pin.rects.map(r => ({ pin: pin.name, layer: r[0], r })))
  for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) {
    const A = all[a], B = all[b]
    if (A.pin === B.pin || A.layer !== B.layer || !rules[A.layer]) continue
    const dx = Math.max(A.r[1] - B.r[3], B.r[1] - A.r[3], 0), dy = Math.max(A.r[2] - B.r[4], B.r[2] - A.r[4], 0)
    const gap = dx > 0 && dy > 0 ? Math.hypot(dx, dy) : Math.max(dx, dy)
    if (gap < rules[A.layer].spacing - tol(rules[A.layer].spacing)) out.spacing.set(`${[A.pin, B.pin].sort().join('|')}:${A.layer}`, `${A.pin}–${B.pin} ${A.layer} 간격 ${round(gap, 3)} < ${rules[A.layer].spacing} µm`)
  }
  return out
}

function ruleChecks(srcPins: TargetPin[], tgtPins: TargetPin[], target: [number, number], siteW: number, rowH: number, outside: string[], sourceOutside: string[], rules: RuleSet): RuleCheck[] {
  const sv = violations(srcPins, REAL_RULES), tv = violations(tgtPins, rules)
  const cmp = (id: 'width' | 'spacing' | 'track'): RuleCheck => {
    const fresh = [...tv[id]].filter(([key]) => !sv[id].has(key)).map(([, note]) => note)
    return { id, label: RULE_LABEL[id], fail: fresh.length, origin: [...tv[id]].filter(([key]) => sv[id].has(key)).length, notes: fresh.slice(0, 6) }
  }
  const gridOff = Math.abs(target[0] / siteW - Math.round(target[0] / siteW)) * siteW + Math.abs(target[1] / rowH - Math.round(target[1] / rowH)) * rowH
  return [
    { id: 'outline', label: RULE_LABEL.outline, fail: outside.length, origin: sourceOutside.length, notes: outside.slice(0, 6).map(p => `${p} 핀이 셀 외곽 밖`) },
    { id: 'grid', label: RULE_LABEL.grid, fail: gridOff > 0.002 ? 1 : 0, origin: 0, notes: gridOff > 0.002 ? [`크기가 site·행의 정수배가 아님 (${round(gridOff, 4)} µm 어긋남)`] : [] },
    cmp('width'), cmp('spacing'), cmp('track'),
  ]
}

// '원본 핀 외곽 초과': the installed LEF itself already has a signal pin rectangle outside the cell
// outline (e.g. probec_p_8's met5 pin), so the virtual change did not cause it.
type BatchResult = { name: string; source: [number, number] | null; target: [number, number] | null; sites: number; rows: number; pins: TargetPin[]; outsidePins: string[]; sourceOutsidePins: string[]; checks: RuleCheck[]; status: '초안 생성' | '핀 이탈' | '원본 핀 외곽 초과' | '크기 없음' | '치수 오류' }

function pinCenter(pin: Pin, size: [number, number]): Position | null {
  const r = pin.rects[0]
  if (!r || size[0] <= 0 || size[1] <= 0) return null
  return { x: (r[1] + r[3]) / (2 * size[0]) * 100, y: (r[2] + r[4]) / (2 * size[1]) * 100 }
}

function transformCell(name: string, cell: Cell, sourceSite: number, sourceRow: number, targetSite: number, targetRow: number, siteDelta: number, pinDx: number, pinDy: number, rules: RuleSet): BatchResult {
  const source = cell.info.size
  if (!source) return { name, source: null, target: null, sites: 0, rows: 0, pins: [], outsidePins: [], sourceOutsidePins: [], checks: [], status: '크기 없음' }
  const sourcePins: TargetPin[] = cell.info.pins.map(pin => ({ name: pin.n, use: pin.use, rects: pin.rects }))
  const sourceOutsidePins = outsideOf(sourcePins, source)
  const sites = Math.round(source[0] / sourceSite) + siteDelta
  const rows = Math.max(1, Math.round(source[1] / sourceRow))
  const target: [number, number] = [round(targetSite * sites), round(targetRow * rows)]
  if (!Number.isFinite(target[0]) || !Number.isFinite(target[1]) || sites < 1 || !Number.isInteger(sites) || target[0] <= 0 || target[1] <= 0) {
    return { name, source, target: null, sites, rows, pins: [], outsidePins: [], sourceOutsidePins, checks: [], status: '치수 오류' }
  }
  const pins: TargetPin[] = cell.info.pins.map(pin => {
    const dx = pin.use === 'signal' ? pinDx / 100 * target[0] : 0
    const dy = pin.use === 'signal' ? pinDy / 100 * target[1] : 0
    return { name: pin.n, use: pin.use, rects: pin.rects.map(r =>
      [r[0], round(r[1] / source[0] * target[0] + dx), round(r[2] / source[1] * target[1] + dy),
        round(r[3] / source[0] * target[0] + dx), round(r[4] / source[1] * target[1] + dy)] as Rect) }
  })
  const outsidePins = outsideOf(pins, target).filter(pin => !sourceOutsidePins.includes(pin))
  return { name, source, target, sites, rows, pins, outsidePins, sourceOutsidePins,
    checks: ruleChecks(sourcePins, pins, target, targetSite, targetRow, outsidePins, sourceOutsidePins, rules),
    status: outsidePins.length ? '핀 이탈' : sourceOutsidePins.length ? '원본 핀 외곽 초과' : '초안 생성' }
}

function GeometryPreview({ title, size, pins, sourceSize, positions }: {
  title: string
  size: [number, number]
  pins: Pin[]
  sourceSize?: [number, number]
  positions?: Record<string, Position>
}) {
  const [width, height] = size
  const scale = Math.min(350 / width, 190 / height)
  const left = (420 - width * scale) / 2
  const top = (250 - height * scale) / 2
  const tx = (x: number) => left + x * scale
  const ty = (y: number) => top + (height - y) * scale
  const sx = sourceSize ? width / sourceSize[0] : 1
  const sy = sourceSize ? height / sourceSize[1] : 1
  const colors: Record<string, string> = { li1: '#1D9E75', met1: '#378ADD', met2: '#E6784E', met3: '#7F77DD' }

  return <div className="card" style={{ padding: 12, minWidth: 0 }}>
    <b style={{ fontSize: 12 }}>{title}</b>
    <svg viewBox="0 0 420 270" role="img" aria-label={`${title}: 셀 외곽과 핀 위치`} style={{ display: 'block', width: '100%', maxWidth: 500, margin: '6px auto' }}>
      <rect x={left} y={top} width={width * scale} height={height * scale} fill="var(--surface-1)" stroke="var(--text-primary)" strokeDasharray="5 3" strokeWidth={1.5}/>
      {pins.flatMap(pin => {
        const originalCenter = sourceSize ? pinCenter(pin, sourceSize) : null
        const requested = positions?.[pin.n] ?? originalCenter
        const dx = originalCenter && requested ? (requested.x - originalCenter.x) / 100 * width : 0
        const dy = originalCenter && requested ? (requested.y - originalCenter.y) / 100 * height : 0
        return pin.rects.map((r, i) => {
          const x1 = r[1] * sx + dx, y1 = r[2] * sy + dy
          const x2 = r[3] * sx + dx, y2 = r[4] * sy + dy
          return <rect key={`${pin.n}-${i}`} x={tx(x1)} y={ty(y2)} width={Math.max((x2 - x1) * scale, 1)} height={Math.max((y2 - y1) * scale, 1)}
            fill={pin.use === 'signal' ? colors[r[0]] ?? '#888' : '#c0504d'} opacity={0.72}>
            <title>{pin.n} · {r[0]}</title>
          </rect>
        })
      })}
      {pins.filter(pin => pin.use === 'signal' && pin.rects.length > 0).map(pin => {
        const original = sourceSize ? pinCenter(pin, sourceSize) : pinCenter(pin, size)
        const center = positions?.[pin.n] ?? original
        if (!center) return null
        return <text key={pin.n} x={tx(center.x / 100 * width)} y={ty(center.y / 100 * height) - 4}
          textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--text-primary)">{pin.n}</text>
      })}
      <text x={left} y={Math.min(top + height * scale + 17, 267)} fontSize={10} fill="var(--text-secondary)">{round(width)} × {round(height)} µm</text>
    </svg>
  </div>
}

const PIN_COLORS: Record<string, string> = { li1: '#1D9E75', met1: '#378ADD', met2: '#E6784E', met3: '#7F77DD' }
const signed = (v: number) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`
const changeOf = (r: { source: [number, number] | null; target: [number, number] | null }) => r.source && r.target
  ? { w: r.target[0] / r.source[0] - 1, h: r.target[1] / r.source[1] - 1, a: (r.target[0] * r.target[1]) / (r.source[0] * r.source[1]) - 1 } : null
const median = (values: number[]) => { if (!values.length) return 0; const s = [...values].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

// 규칙별 결과 칩: ✓ 적합 · ✕N 변경으로 새로 생긴 위반 · △N 설치된 PDK 원본부터 있던 위반(변경 탓 아님)
function RuleChips({ checks }: { checks: RuleCheck[] }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
    {checks.map(c => {
      const tone = c.fail > 0 ? { bg: 'rgba(192,57,43,.14)', fg: '#C0392B' } : c.origin > 0 ? { bg: 'rgba(224,160,40,.16)', fg: '#B07A10' } : { bg: 'rgba(29,158,117,.14)', fg: '#16805F' }
      return <span key={c.id} title={`${c.label}${c.notes.length ? '\n' + c.notes.join('\n') : ''}${c.origin ? `\n(원본 PDK부터 ${c.origin}건)` : ''}`}
        style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, background: tone.bg, color: tone.fg, fontWeight: 700 }}>
        {RULE_SHORT[c.id]} {c.fail > 0 ? `✕${c.fail}` : c.origin > 0 ? `△${c.origin}` : '✓'}</span>
    })}
  </div>
}

// 한 셀의 변경 전·후를 같은 배율로 나란히 그린다 — 위쪽 원본/가상 그림과 같은 표현(점선 외곽 + 색 핀 사각형)이되,
// 배율을 공유해서 실제로 얼마나 줄거나 늘었는지가 그림에서 바로 보인다.
function BeforeAfterPair({ r, source, onPick }: { r: BatchResult; source: Cell | undefined; onPick: () => void }) {
  if (!r.source || !r.target || !source) {
    return <div className="card" style={{ padding: 10 }}><b style={{ fontSize: 12 }}><code>{r.name}</code></b><div className="chip-note" style={{ marginTop: 4 }}>{r.status} — 그릴 형상이 없습니다.</div></div>
  }
  const PW = 150, PH = 96, GAP = 30, PAD = 8, TOP = 15, BOT = 16
  const maxW = Math.max(r.source[0], r.target[0]), maxH = Math.max(r.source[1], r.target[1])
  const s = Math.min(PW / maxW, PH / maxH)
  const panels = [
    { label: '원본', x0: PAD, size: r.source, pins: source.info.pins.map(p => ({ name: p.n, use: p.use, rects: p.rects })), bad: r.sourceOutsidePins },
    { label: '가상', x0: PAD + PW + GAP, size: r.target, pins: r.pins, bad: r.checks.flatMap(c => c.notes.flatMap(n => n.split(' ')[0].split('–'))) },
  ]
  const VW = PAD * 2 + PW * 2 + GAP, VH = TOP + PH + BOT
  const ch = changeOf(r)!
  const fails = failOf(r)
  const bad = r.status === '핀 이탈' || fails > 0
  return <div role="button" tabIndex={0} onClick={onPick} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick() } }}
    className="card" style={{ padding: 8, minWidth: 0, cursor: 'pointer', borderColor: bad ? '#C0392B' : undefined }}
    title="누르면 위쪽 원본/가상 미리보기에 이 셀이 열립니다">
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'baseline' }}>
      <b style={{ fontSize: 12 }}><code>{r.name}</code></b>
      <span style={{ fontSize: 11, fontWeight: 700, color: fails > 0 ? '#C0392B' : '#16805F' }}>{fails > 0 ? `가상 규칙 위반 ${fails}` : '가상 규칙 적합'}</span>
    </div>
    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>폭 {signed(ch.w)} · 높이 {signed(ch.h)} · <b>면적 {signed(ch.a)}</b></div>
    <RuleChips checks={r.checks}/>
    <svg viewBox={`0 0 ${VW} ${VH}`} role="img" aria-label={`${r.name} 변경 전후`} style={{ display: 'block', width: '100%', marginTop: 4 }}>
      {panels.map((p, pi) => {
        const w = p.size[0] * s, h = p.size[1] * s, ox = p.x0, oy = TOP + PH - h
        return <g key={p.label}>
          <text x={ox} y={TOP - 4} fontSize={10} fontWeight={700} fill="var(--text-primary)">{p.label}</text>
          <rect x={ox} y={oy} width={w} height={h} fill="var(--surface-1)" stroke={pi === 1 && bad ? '#C0392B' : 'var(--text-primary)'} strokeDasharray="4 3" strokeWidth={1.2}/>
          {p.pins.flatMap(pin => pin.rects.filter(q => q[0] === 'nwell' || q[0] === 'pwell').map((q, i) => <rect key={`w-${pin.name}-${i}`} x={ox + q[1] * s} y={oy + (p.size[1] - q[4]) * s}
            width={Math.max((q[3] - q[1]) * s, 0.8)} height={Math.max((q[4] - q[2]) * s, 0.8)} fill={q[0] === 'nwell' ? '#9bd3a8' : '#e3c9a6'} opacity={0.3}/>))}
          {p.pins.flatMap(pin => pin.rects.filter(q => q[0] !== 'nwell' && q[0] !== 'pwell').map((q, i) => <rect key={`${pin.name}-${i}`} x={ox + q[1] * s} y={oy + (p.size[1] - q[4]) * s}
            width={Math.max((q[3] - q[1]) * s, 0.8)} height={Math.max((q[4] - q[2]) * s, 0.8)}
            fill={pin.use === 'signal' ? PIN_COLORS[q[0]] ?? '#888' : '#c0504d'} opacity={0.75}
            stroke={p.bad.includes(pin.name) ? '#C0392B' : 'none'} strokeWidth={1.2}><title>{pin.name} · {q[0]}</title></rect>))}
          {w >= 44 && p.pins.filter(pin => pin.use === 'signal' && pin.rects[0]).map(pin => {
            const q = pin.rects[0]
            return <text key={pin.name} x={ox + (q[1] + q[3]) / 2 * s} y={oy + (p.size[1] - (q[2] + q[4]) / 2) * s - 3} textAnchor="middle" fontSize={7} fontWeight={700} fill="var(--text-primary)">{pin.name}</text>
          })}
          <text x={ox} y={TOP + PH + 12} fontSize={9} fill="var(--text-secondary)">{round(p.size[0], 2)} × {round(p.size[1], 2)} µm</text>
        </g>
      })}
      <text x={PAD + PW + GAP / 2} y={TOP + PH / 2} textAnchor="middle" fontSize={16} fill="var(--text-secondary)">→</text>
    </svg>
  </div>
}

const GALLERY_STATUS = ['전체', '규칙 위반 있음', '규칙 적합', '핀 이탈', '원본 핀 외곽 초과', '치수·크기 문제'] as const
const GALLERY_SORT = [['change', '많이 변한 순 (면적 변화 큼)'], ['outlier', '다른 셀보다 유독 변한 순'], ['violation', '규칙 위반 많은 순'], ['name', '이름순']] as const
type GallerySort = (typeof GALLERY_SORT)[number][0]

// 일괄 적용 결과를 셀마다 전·후 그림으로 보여준다(기본값은 전체, 필요하면 페이지로 나눔). 같은 배율로 그려 크기 변화가 보이고,
// 기본 정렬은 가장 많이 변한 셀이 맨 앞이다. 각 카드에는 가상 규칙 검사 결과가 같이 붙는다.
function BatchGallery({ results, cellsByName, onSelectCell }: { results: BatchResult[]; cellsByName: Record<string, Cell>; onSelectCell: (name: string) => void }) {
  const [status, setStatus] = useState<(typeof GALLERY_STATUS)[number]>('전체')
  const [sort, setSort] = useState<GallerySort>('change')
  const [query, setQuery] = useState('')
  const [pageSize, setPageSize] = useState(0)
  const [page, setPage] = useState(0)
  const q = query.trim().toLowerCase()
  const sized = results.filter(r => r.source && r.target)
  const medianArea = median(sized.map(r => changeOf(r)!.a))
  const magnitude = (r: BatchResult) => { const c = changeOf(r); return !c ? -1 : sort === 'outlier' ? Math.abs(c.a - medianArea) : Math.abs(c.a) }
  const filtered = results.filter(r => (status === '전체' || (status === '치수·크기 문제' ? r.status === '치수 오류' || r.status === '크기 없음'
      : status === '규칙 위반 있음' ? failOf(r) > 0 : status === '규칙 적합' ? !!r.target && failOf(r) === 0 : r.status === status))
    && (!q || r.name.toLowerCase().includes(q)))
    .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'violation' ? failOf(b) - failOf(a) || magnitude(b) - magnitude(a) : magnitude(b) - magnitude(a))
  const displaySize = pageSize === 0 ? Math.max(1, filtered.length) : pageSize
  const pageCount = Math.max(1, Math.ceil(filtered.length / displaySize))
  const pg = Math.min(page, pageCount - 1)
  const shown = filtered.slice(pg * displaySize, (pg + 1) * displaySize)
  const before = sized.reduce((sum, r) => sum + r.source![0] * r.source![1], 0)
  const after = sized.reduce((sum, r) => sum + r.target![0] * r.target![1], 0)
  const violating = sized.filter(r => failOf(r) > 0).length
  const perRule = (['outline', 'grid', 'width', 'spacing', 'track'] as RuleId[]).map(id => ({ id, cells: sized.filter(r => (r.checks.find(c => c.id === id)?.fail ?? 0) > 0).length }))
  const ctl = { padding: '5px 8px', border: '1px solid var(--border-strong)', borderRadius: 5, background: 'var(--surface-1)', color: 'var(--text-primary)', fontSize: 12 }
  const goto = (n: number) => setPage(Math.max(0, Math.min(pageCount - 1, n)))
  return <div style={{ marginBottom: 14 }}>
    <p className="chip-note" style={{ margin: '0 0 8px', padding: 10, borderLeft: '4px solid #378ADD', background: 'var(--surface-muted)' }}><b>전체 {results.length}셀의 가상 변경 결과가 계산되었습니다. 현재 비교 그림 {shown.length}개 표시 중입니다.</b> {pageSize === 0 ? '전체 결과를 아래에서 스크롤하여 볼 수 있습니다.' : `페이지당 ${pageSize}개씩 표시합니다. 전체 그림 펼치기를 누르면 모두 볼 수 있습니다.`} 이 그림은 LEF 외곽·핀을 변환한 미리보기이며 실제 90 nm GDS 이미지가 아닙니다.</p>
    <p className="chip-note" style={{ margin: '0 0 6px' }}>변경 전·후 비교 — 셀 {sized.length}개의 LEF 면적 합 <b>{Math.round(before).toLocaleString()} → {Math.round(after).toLocaleString()} µm² ({before > 0 ? signed(after / before - 1) : '—'})</b>, 셀별 면적 변화 중앙값 {signed(medianArea)}. 한 셀 안에서는 전·후를 같은 배율로 그려 크기 변화가 그대로 보입니다(셀끼리는 배율이 다릅니다). 점선 = 셀 외곽, 색 사각형 = 핀(초록 li1·파랑 met1), 빨간 테두리 = 위반 핀.</p>
    <p className="chip-note" style={{ margin: '0 0 8px' }}><b>가상 규칙 검사</b> — 위 &lsquo;가상 설계 규칙&rsquo; 기준: <b style={{ color: violating ? '#C0392B' : '#16805F' }}>위반 셀 {violating} / {sized.length}</b> · {perRule.map(p => `${RULE_LABEL[p.id]} ${p.cells}셀`).join(' · ')}. 칩의 ✓ 적합 · <span style={{ color: '#C0392B' }}>✕N 변경으로 새로 생긴 위반</span> · <span style={{ color: '#B07A10' }}>△N 설치된 PDK 원본부터 있던 것(변경 탓 아님)</span>. 가상 규칙은 실제 목표 공정의 규칙이 아니므로 DRC 통과 판정이 아닙니다.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <select aria-label="정렬" value={sort} onChange={e => { setSort(e.target.value as GallerySort); setPage(0) }} style={ctl}>
        {GALLERY_SORT.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      <select aria-label="상태 필터" value={status} onChange={e => { setStatus(e.target.value as (typeof GALLERY_STATUS)[number]); setPage(0) }} style={ctl}>
        {GALLERY_STATUS.map(s => <option key={s} value={s}>{s}{s === '전체' ? ` (${results.length})` : ''}</option>)}
      </select>
      <input aria-label="셀 이름 검색" placeholder="셀 이름 검색" value={query} onChange={e => { setQuery(e.target.value); setPage(0) }} style={{ ...ctl, width: 150 }}/>
      <select aria-label="페이지당 셀 수" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(0) }} style={ctl}>
        {[12, 24, 48].map(n => <option key={n} value={n}>{n}개씩</option>)}
        <option value={0}>전체 {filtered.length}개 (느릴 수 있음)</option>
      </select>
      <button type="button" onClick={() => { setPageSize(pageSize === 0 ? 12 : 0); setPage(0) }}>{pageSize === 0 ? '페이지로 나눠 보기' : `전체 그림 펼치기 (${filtered.length}개)`}</button>
      <button type="button" onClick={() => goto(pg - 1)} disabled={pg === 0}>← 이전</button>
      <span className="chip-note">{filtered.length === 0 ? '0' : `${pg * displaySize + 1}–${Math.min((pg + 1) * displaySize, filtered.length)}`} / {filtered.length}셀 · {pg + 1}/{pageCount} 페이지</span>
      <button type="button" onClick={() => goto(pg + 1)} disabled={pg >= pageCount - 1}>다음 →</button>
    </div>
    {shown.length === 0 ? <p className="chip-note">조건에 맞는 셀이 없습니다.</p>
      : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 10 }}>
        {shown.map(r => <div key={r.name} style={{ contentVisibility: 'auto', containIntrinsicSize: '320px 180px' }}><BeforeAfterPair r={r} source={cellsByName[r.name]} onPick={() => onSelectCell(r.name)}/></div>)}
      </div>}
  </div>
}

export default function PdkChangeExperiment({ libId, libraryRowHeight, cellName, cell, cells, availableCells, onSelectCell, onOpenLibrary }: Props) {
  const cellsByName = cells ?? EMPTY_CELLS
  const [targetNm, setTargetNm] = useState(DEFAULT_TARGET_NM)
  const [siteWidth, setSiteWidth] = useState(() => round(sourceSiteWidth(libId) * DEFAULT_TARGET_NM / 130))
  const [rowHeight, setRowHeight] = useState(() => round(libraryRowHeight * DEFAULT_TARGET_NM / 130))
  const [siteDelta, setSiteDelta] = useState(0)
  const [pinDx, setPinDx] = useState(0)
  const [pinDy, setPinDy] = useState(0)
  const [selectedNames, setSelectedNames] = useState<string[]>([])
  const [batchResults, setBatchResults] = useState<BatchResult[] | null>(null)
  const [runId, setRunId] = useState(0)
  const [cellFilter, setCellFilter] = useState('')
  const [rules, setRules] = useState<RuleSet>(() => scaleRules(DEFAULT_TARGET_NM / 130))

  const sourceSize = cell?.info.size ?? null
  const pins = cell?.info.pins ?? []
  const signalPins = pins.filter(pin => pin.use === 'signal' && pin.rects.length > 0)
  const ratio = targetNm / 130

  useEffect(() => {
    setSelectedNames(Object.keys(cellsByName).filter(name => cellsByName[name]?.info.size))
    setBatchResults(null)
  }, [libId, cells])

  useEffect(() => {
    if (!sourceSize) return
    const widthSite = sourceSiteWidth(libId)
    setSiteWidth(round(widthSite * ratio))
    setRowHeight(round(libraryRowHeight * ratio))
    setSiteDelta(0)
    setPinDx(0)
    setPinDy(0)
    setRules(scaleRules(ratio))
    setBatchResults(null)
  }, [libId, libraryRowHeight])

  const suggestDimensions = () => {
    if (!Number.isFinite(ratio) || ratio <= 0) return
    const widthSite = sourceSiteWidth(libId)
    setSiteWidth(round(widthSite * ratio))
    setRowHeight(round(libraryRowHeight * ratio))
    setSiteDelta(0)
    setPinDx(0)
    setPinDy(0)
    setRules(scaleRules(ratio))
    setBatchResults(null)
  }

  const changeTargetNode = (value: number) => {
    setTargetNm(value)
    if (!Number.isFinite(value) || value <= 0) return
    const nextRatio = value / 130
    const widthSite = sourceSiteWidth(libId)
    setSiteWidth(round(widthSite * nextRatio))
    setRowHeight(round(libraryRowHeight * nextRatio))
    setSiteDelta(0)
    setPinDx(0)
    setPinDy(0)
    setRules(scaleRules(nextRatio))
    setBatchResults(null)
  }

  // 층별 가상 규칙을 직접 고친다. pitch를 바꾸면 트랙 offset은 pitch/2(원본 sky130이 전 층에서 그렇다)로, 최소 면적은 폭의 제곱 비율로 따라간다.
  const setRule = (layer: string, field: 'width' | 'spacing' | 'pitch', value: number) => {
    setRules(current => ({ ...current, [layer]: { ...current[layer], [field]: value,
      ...(field === 'pitch' ? { offset: round(value / 2, 4) } : {}),
      ...(field === 'width' ? { area: round(REAL_RULES[layer].area * (value / REAL_RULES[layer].width) ** 2, 5) } : {}) } }))
    setBatchResults(null)
  }

  const focused = cell ? transformCell(cellName, cell, sourceSiteWidth(libId), libraryRowHeight, siteWidth, rowHeight, siteDelta, pinDx, pinDy, rules) : null
  const targetSize = focused?.target
  const positions = Object.fromEntries(signalPins.map(pin => {
    const center = sourceSize ? pinCenter(pin, sourceSize) : null
    return [pin.n, { x: (center?.x ?? 0) + pinDx, y: (center?.y ?? 0) + pinDy }]
  })) as Record<string, Position>
  const validInput = Number.isFinite(targetNm) && targetNm > 0 && Number.isFinite(siteWidth) && siteWidth > 0
    && Number.isFinite(rowHeight) && rowHeight > 0 && Number.isInteger(siteDelta) && Number.isFinite(pinDx) && Number.isFinite(pinDy)
  const runBatch = () => {
    if (!validInput) return
    setRunId(n => n + 1)
    setBatchResults(selectedNames.map(name => transformCell(name, cellsByName[name], sourceSiteWidth(libId), libraryRowHeight, siteWidth, rowHeight, siteDelta, pinDx, pinDy, rules)))
  }
  const showAllResults = () => {
    if (!batchResults) runBatch()
    window.setTimeout(() => document.getElementById('pdk-batch-gallery')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }
  const toggleCell = (name: string) => {
    setSelectedNames(current => current.includes(name) ? current.filter(item => item !== name) : [...current, name])
    setBatchResults(null)
  }
  const downloadResults = () => {
    if (!batchResults) return
    const payload = { kind: 'virtual-lef-batch', verified: false, sourcePdk: 'sky130A', sourceLibrary: libId,
      targetNodeNm: targetNm, conditions: { siteWidth, rowHeight, siteDelta, pinOffsetPercent: [pinDx, pinDy] },
      rules: { note: '가상 규칙 — 실제 목표 공정 규칙이 아님. 원본은 sky130A tech LEF 실측값', real: REAL_RULES, virtual: rules }, cells: batchResults }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `virtual-pdk-${libId}-${targetNm}nm.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const setCondition = (setter: (value: number) => void) => (value: number) => { setter(value); setBatchResults(null) }
  const inputStyle = { width: 95, padding: '6px 8px', border: '1px solid var(--border-strong)', borderRadius: 5, background: 'var(--surface-1)', color: 'var(--text-primary)' }
  const field = (label: string, value: number, setter: (v: number) => void, step: number, min?: number) =>
    <label style={{ display: 'grid', gap: 4, fontSize: 12 }}><span>{label}</span><input type="number" value={value} step={step} min={min} onChange={e => setter(Number(e.target.value))} style={inputStyle}/></label>

  return <section className="card">
    <div className="card-title"><div><small className="kicker">가상 LEF 실험 · 제조 검증 아님</small><h2>PDK 변경 실험</h2></div><button type="button" onClick={onOpenLibrary}>원본 라이브러리 보기</button></div>
    <p className="chip-note" style={{ marginBottom: 12 }}>설치된 {libId} 셀의 LEF 외곽과 핀을 출발점으로 새 공정의 배치 형상을 가정합니다. 목표 공정의 실제 PDK·Liberty·GDS는 연결하지 않으므로 타이밍, 전력, DRC, LVS 결과를 예측하거나 통과로 판정하지 않습니다.</p>
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
      <button type="button" onClick={showAllResults} disabled={!validInput || selectedNames.length === 0}>{batchResults ? `${batchResults.length}개 전체 비교 그림으로 이동` : `${selectedNames.length}개 비교 그림 생성·보기`}</button>
      <span className="chip-note">비교 갤러리는 기본적으로 선택한 셀의 그림을 전부 표시합니다. 필요하면 갤러리에서 페이지 보기로 전환하세요.</span>
    </div>
    <div className="card" style={{ padding: 12, marginBottom: 14 }}>
      <b>기존 배치를 활용한 셀 내부 P&R</b>
      <p className="chip-note" style={{ margin: '8px 0' }}>기존 셀의 소자 배치와 내부 배선을 새 공정 설계의 시작점으로 재사용할 수 있습니다. 복잡한 셀은 새 간격·핀 접근성·배선 충돌에 맞춰 재배치와 재배선이 필요할 수 있습니다.</p>
      <p className="chip-note" style={{ margin: '0 0 8px' }}><b>P&R의 목적:</b> 목표 공정의 배치·배선 규칙을 제약으로 지키면서 연결 길이와 기생 저항·용량, 혼잡을 줄이고 핀 접근성·면적·타이밍을 함께 고려하는 것입니다. 가장 짧은 배선이 언제나 최적은 아닙니다.</p>
      <p className="chip-note" style={{ margin: 0 }}><b>현재 기능은 변경 초안만 생성하며 셀 내부 P&R은 실행하지 않습니다.</b> 실제 설계에서는 목표 90 nm PDK 규칙을 반영해 배치·배선을 반복하고 GDS를 만든 다음 DRC로 최종 형상을 검사합니다. 위반이 있으면 P&R을 수정하며, LVS로 연결 일치도 별도 검증합니다. 목표 PDK가 없는 상태에서는 규칙 준수나 기생값을 실제 공정 기준으로 판정할 수 없습니다.</p>
    </div>
    <div className="data-table" style={{ marginBottom: 14 }}><table><thead><tr><th>여기서 직접 변경 가능한 조건</th><th>화면에 반영되는 내용</th></tr></thead><tbody>
      <tr><td>적용 대상 셀</td><td>현재 라이브러리의 전체 셀 또는 직접 체크한 일부 셀</td></tr>
      <tr><td>목표 노드 표기 (nm)</td><td>130 nm 원본 대비 초기 site 폭·행 높이 비율을 즉시 다시 제안</td></tr>
      <tr><td>가상 site 폭 (µm)</td><td>셀의 한 칸 폭과 전체 가로 크기</td></tr>
      <tr><td>셀별 site 수 증감</td><td>선택한 모든 셀의 원본 site 수에 같은 정수 값을 더함</td></tr>
      <tr><td>가상 행 높이 (µm)</td><td>모든 셀의 한 행 높이. 원본이 여러 행이면 그 수를 유지</td></tr>
      <tr><td>신호 핀 X·Y 이동 (%)</td><td>모든 신호 핀을 같은 비율로 이동하고 셀 밖 이탈을 검사</td></tr>
      <tr><td>가상 설계 규칙 (층별 최소 폭·최소 간격·트랙 pitch)</td><td>변경한 셀이 이 가상 규칙을 지키는지 셀마다 검사 — 외곽·격자·최소 폭·최소 간격·트랙 접근</td></tr>
    </tbody></table></div>
    <p className="chip-note" style={{ marginBottom: 14 }}>공정 코너(TT/SS/FF), 전압, 온도, 트랜지스터 형상은 현재 계산 모델이 없어 선택 항목으로 제공하지 않습니다. 층별 폭·간격·pitch는 아래 &lsquo;가상 설계 규칙&rsquo;으로 직접 정할 수 있고, 최소 면적·비아·내부 소자 규칙은 LEF 핀 사각형만으로 판정할 수 없어 검사하지 않습니다. 핀 도형 크기는 셀 크기에 맞춰 함께 늘거나 줄지만 직접 편집하지 않습니다.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 12, marginBottom: 14 }}>
      <label style={{ display: 'grid', gap: 4, fontSize: 12 }}><span>원본 셀 · {libId}</span><select value={availableCells.includes(cellName) ? cellName : ''} onChange={e => onSelectCell(e.target.value)} style={{ ...inputStyle, width: 210 }}>
        {!availableCells.includes(cellName) && <option value="">셀을 선택하세요</option>}
        {availableCells.map(name => <option key={name} value={name}>{name}</option>)}
      </select></label>
      {field('목표 노드 표기 (nm)', targetNm, changeTargetNode, 1, 1)}
      <button type="button" onClick={suggestDimensions} disabled={targetNm <= 0}>초기값으로 재설정</button>
    </div>
    {!cell && <p className="chip-note">원본 셀 데이터를 불러오는 중입니다.</p>}
    {cell && !sourceSize && <p className="chip-note">이 셀에는 LEF 크기 정보가 없어 형상을 실험할 수 없습니다.</p>}
    {sourceSize && <>
      <p className="chip-note" style={{ marginBottom: 12 }}>초기값은 {targetNm}/130의 단순 비율로 만든 편집 시작점입니다. 공정 이름의 숫자가 실제 도형 배율을 뜻하지 않으며, 아래 값을 직접 조정할 수 있습니다.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 12, marginBottom: 14 }}>
        {field('가상 site 폭 (µm)', siteWidth, setCondition(setSiteWidth), 0.001, 0.001)}
        {field('site 수 증감 (전체)', siteDelta, setCondition(setSiteDelta), 1)}
        {field('가상 행 높이 (µm)', rowHeight, setCondition(setRowHeight), 0.001, 0.001)}
        {field('핀 X 이동 (%)', pinDx, setCondition(setPinDx), 1)}
        {field('핀 Y 이동 (%)', pinDy, setCondition(setPinDy), 1)}
        <span className="chip-note">선택 셀 목표 크기: <b>{targetSize ? `${targetSize[0]} × ${targetSize[1]} µm` : '치수를 확인하세요'}</b></span>
      </div>
      <div className="card" style={{ padding: 12, marginBottom: 14 }}>
        <b style={{ fontSize: 12 }}>가상 설계 규칙 (층별)</b>
        <p className="chip-note" style={{ margin: '6px 0 8px' }}>왼쪽 &lsquo;원본&rsquo;은 설치된 sky130A 기술 LEF(<code>sky130_fd_sc_hd__nom.tlef</code>)의 실제 값이고, 오른쪽 &lsquo;가상&rsquo;은 그 값 × {targetNm}/130으로 시작한 편집 시작점입니다 — 실제 {targetNm} nm 공정의 규칙이 아닙니다. 변경한 셀의 핀이 이 가상 규칙을 지키는지 검사합니다. 트랙 offset은 pitch의 절반으로 따라갑니다(원본 sky130이 전 층에서 그렇습니다).</p>
        <div className="data-table"><table><thead><tr><th rowSpan={2}>층</th><th rowSpan={2}>선호 방향</th><th colSpan={3}>원본 (실제 sky130A, µm)</th><th colSpan={3}>가상 (직접 수정, µm)</th></tr>
          <tr><th>최소 폭</th><th>최소 간격</th><th>트랙 pitch</th><th>최소 폭</th><th>최소 간격</th><th>트랙 pitch</th></tr></thead><tbody>
          {Object.entries(REAL_RULES).map(([layer, real]) => {
            const v = rules[layer] ?? real
            const cellInput = (f: 'width' | 'spacing' | 'pitch') => <input type="number" aria-label={`${layer} 가상 ${f}`} value={v[f]} step={0.001} min={0}
              onChange={e => setRule(layer, f, Number(e.target.value))} style={{ ...inputStyle, width: 82, padding: '3px 6px' }}/>
            return <tr key={layer}><td><b style={{ color: PIN_COLORS[layer] }}>{layer}</b></td><td>{real.dir === 'vertical' ? '세로' : '가로'}</td>
              <td>{real.width}</td><td>{real.spacing}</td><td>{real.pitch}</td>
              <td>{cellInput('width')}</td><td>{cellInput('spacing')}</td><td>{cellInput('pitch')}</td></tr>
          })}
        </tbody></table></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12 }}>
        <GeometryPreview title={`원본 · ${libId}__${cellName}`} size={sourceSize} pins={pins}/>
        {targetSize ? <GeometryPreview title={`가상 · ${targetNm} nm`} size={targetSize} pins={pins} sourceSize={sourceSize} positions={positions}/>
          : <div className="card" style={{ padding: 12 }}>양수 site 폭·행 높이와 유효한 site 수 증감을 입력하세요.</div>}
      </div>
      <div className="data-table" style={{ marginTop: 14, maxHeight: 240 }}>
        <table><thead><tr><th>신호 핀</th><th>원본 중심 (µm)</th><th>가상 중심 (µm)</th></tr></thead><tbody>
          {signalPins.map(pin => {
            const original = pinCenter(pin, sourceSize)!
            const current = positions[pin.n]
            return <tr key={pin.n}><td><code>{pin.n}</code></td>
              <td>{round(original.x / 100 * sourceSize[0], 2)}, {round(original.y / 100 * sourceSize[1], 2)}</td>
              <td>{targetSize ? `${round(current.x / 100 * targetSize[0], 2)}, ${round(current.y / 100 * targetSize[1], 2)}` : '—'}</td></tr>
          })}
        </tbody></table>
      </div>
      {!!focused?.checks.length && <div className="card" style={{ padding: 12, marginTop: 14 }}>
        <b style={{ fontSize: 12 }}>가상 규칙 검사 · {cellName} — {failOf(focused) > 0 ? <span style={{ color: '#C0392B' }}>위반 {failOf(focused)}건</span> : <span style={{ color: '#16805F' }}>가상 규칙 적합</span>}</b>
        <div className="data-table" style={{ marginTop: 6 }}><table><thead><tr><th>규칙</th><th>결과</th><th>상세</th></tr></thead><tbody>
          {focused.checks.map(c => <tr key={c.id}><td>{c.label}</td>
            <td>{c.fail > 0 ? <span className="warning-badge">위반 {c.fail}</span> : c.origin > 0 ? <span className="warning-badge">원본부터 {c.origin}</span> : <span className="ok-badge">적합</span>}</td>
            <td style={{ fontSize: 11 }}>{c.notes.length ? c.notes.join(' · ') : c.origin > 0 ? '설치된 PDK 원본에도 있던 위반이라 변경 때문이 아닙니다' : '—'}</td></tr>)}
        </tbody></table></div>
        <p className="chip-note" style={{ margin: '6px 0 0' }}>원본 핀은 원본 규칙으로, 변경 후 핀은 위 가상 규칙으로 검사하고, 원본에도 있던 위반은 &lsquo;원본부터&rsquo;로 따로 셉니다. 가상 규칙 기준의 형상 점검일 뿐 DRC 통과 판정이 아닙니다.</p>
      </div>}
      {!!focused?.outsidePins.length && <p className="init-error" style={{ marginTop: 10 }}>선택 셀에서 변경 후 외곽을 벗어난 핀: {focused.outsidePins.join(', ')}.</p>}
      {!!focused?.sourceOutsidePins.length && <p className="chip-note" style={{ marginTop: 10 }}>이 셀은 설치된 PDK LEF 원본부터 핀 도형이 셀 외곽 밖까지 걸쳐 있습니다: {focused.sourceOutsidePins.join(', ')}. 가상 변경으로 생긴 이탈이 아닙니다.</p>}
    </>}
    <div className="card" style={{ padding: 12, marginTop: 14 }}>
      <b style={{ fontSize: 12 }}>일괄 변경 대상 · {selectedNames.length}/{availableCells.length}셀</b>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0' }}>
        <button type="button" onClick={() => { setSelectedNames(availableCells.filter(name => cellsByName[name]?.info.size)); setBatchResults(null) }}>전체 선택</button>
        <button type="button" onClick={() => { setSelectedNames(cell ? [cellName] : []); setBatchResults(null) }}>현재 셀만</button>
        <button type="button" onClick={() => { setSelectedNames([]); setBatchResults(null) }}>선택 해제</button>
        <input aria-label="셀 목록 검색" value={cellFilter} onChange={e => setCellFilter(e.target.value)} placeholder="셀 이름 검색" style={{ ...inputStyle, width: 150 }}/>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 150, overflow: 'auto', padding: 4 }}>
        {availableCells.filter(name => name.toLowerCase().includes(cellFilter.toLowerCase())).map(name =>
          <label key={name} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 5, fontSize: 11 }}>
            <input type="checkbox" checked={selectedNames.includes(name)} onChange={() => toggleCell(name)}/>{name}
          </label>)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
        <button type="button" onClick={runBatch} disabled={!validInput || selectedNames.length === 0}>선택 셀 일괄 적용</button>
        <span className="chip-note">PDK 원본 파일은 수정하지 않고, 가상 LEF 치수·핀 위치를 메모리에서 계산합니다.</span>
      </div>
    </div>
    {batchResults && <div id="pdk-batch-gallery" className="card" style={{ padding: 12, marginTop: 14 }}>
      <div className="card-title"><div><small className="kicker">가상 변경 결과</small><h3>{batchResults.length}셀 처리 · 초안 {batchResults.filter(r => r.status === '초안 생성').length} · 핀 이탈 {batchResults.filter(r => r.status === '핀 이탈').length} · 원본부터 핀 외곽 초과 {batchResults.filter(r => r.status === '원본 핀 외곽 초과').length} · 치수 문제 {batchResults.filter(r => r.status === '치수 오류' || r.status === '크기 없음').length} · <span style={{ color: batchResults.some(r => failOf(r) > 0) ? '#C0392B' : '#16805F' }}>가상 규칙 위반 셀 {batchResults.filter(r => failOf(r) > 0).length}</span></h3></div>
        <button type="button" onClick={downloadResults}>결과 JSON 저장</button></div>
      <BatchGallery key={runId} results={batchResults} cellsByName={cellsByName} onSelectCell={onSelectCell}/>
      <div className="data-table" style={{ maxHeight: 360 }}><table><thead><tr><th>셀</th><th>원본 (µm)</th><th>가상 (µm)</th><th>면적 변화</th><th>site×행</th><th>형상 검사</th><th>가상 규칙 검사</th></tr></thead><tbody>
        {[...batchResults].sort((a, b) => failOf(b) - failOf(a) || Math.abs(changeOf(b)?.a ?? 0) - Math.abs(changeOf(a)?.a ?? 0)).map(r => <tr key={r.name} onClick={() => onSelectCell(r.name)} style={{ cursor: 'pointer' }}>
          <td><code>{r.name}</code></td><td>{r.source?.join(' × ') ?? '—'}</td><td>{r.target?.join(' × ') ?? '—'}</td><td>{changeOf(r) ? signed(changeOf(r)!.a) : '—'}</td><td>{r.target ? `${r.sites} × ${r.rows}` : '—'}</td>
          <td>{r.status}{r.outsidePins.length ? ` (${r.outsidePins.join(', ')})` : r.sourceOutsidePins.length ? ` (${r.sourceOutsidePins.join(', ')} · PDK LEF 원본 그대로)` : ''}</td>
          <td>{r.checks.length ? <RuleChips checks={r.checks}/> : '—'}</td></tr>)}
      </tbody></table></div>
    </div>}
    <p className="chip-note" style={{ marginTop: 12 }}><b>현재 판정: 가상·미검증, 셀 내부 P&R 미실행.</b> 초안 생성은 셀 크기와 핀 외곽만 계산되었다는 뜻입니다. 실제 이식은 목표 PDK 규칙을 반영한 셀 내부 P&R, 변경 GDS의 DRC 통과, LVS·PVT 검증이 필요합니다.</p>
  </section>
}
