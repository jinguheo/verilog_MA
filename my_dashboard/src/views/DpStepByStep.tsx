// beam search · 간격 DP 단계별 그림 설명.
//  A. beam search(위상): 실제 Chip Tetris 엔진(chipTetrisEngine)을 이 화면에서 돌려, 블록을 하나씩 놓는 과정을 단계별로 그린다.
//  B. 간격 DP(정확): ADC·SRAM 사이 간격을 규칙 아래 나누는 표 채우기를 단계별로 그린다.
// 그림의 배치·후보 수·점수·표 값은 모두 렌더링할 때 계산한 실제 값이다(손으로 쓴 숫자 없음).
import { useEffect, useMemo, useState } from 'react'
import * as E from '../game/chipTetrisEngine'
import { TERMS, beamAsync } from './chipSearch'

const p ={ margin: '4px 0 8px', fontSize: 13, lineHeight: 1.8 } as const
const ul = { margin: '0 0 8px 18px', padding: 0, fontSize: 13, lineHeight: 1.8 } as const
const box = { padding: 10, borderRadius: 8, border: '1px solid var(--border-strong)', background: 'var(--surface)' } as const
const COLS = E.BOARD_COLS, ROWS = E.BOARD_ROWS
const f1 = (x: number) => x.toFixed(1)

// ================= A. beam search (위상) =================
type Place = { id: E.BlockId; r: number; x: number; y: number }
type TNode = { s: E.GameState; value: number; sig: string; trail: string[]; places: Place[]; parent: number }
type TStep = {
  id: E.BlockId; parents: number; fullPerParent: number; ringPerParent: number | null; legalFirst: number; legalTotal: number
  merged: number; kept: TNode[]; pruned: TNode[]; firstParent: E.Board; coverage: number[][]; ring: boolean[][] | null; minV: number; maxV: number
}
const SEQ = E.PLACEMENT_SEQUENCE
const key3 = (r: number, x: number, y: number) => `${r}:${x}:${y}`

function candidates(board: E.Board, id: E.BlockId): { list: Array<[number, number, number]>; ring: boolean[][] | null } {
  const rots = E.rotationsFor(id)
  const req = E.BLOCKS[id].requiredNeighbor
  if (!req) { const list: Array<[number, number, number]> = []; rots.forEach((_, r) => { for (let x = 0; x < COLS; x++) for (let y = 0; y < ROWS; y++) list.push([r, x, y]) }); return { list, ring: null } }
  const occ = new Set<string>(); const ring = Array.from({ length: ROWS }, () => Array<boolean>(COLS).fill(false))
  board.forEach((row, y) => row.forEach((c, x) => { if (c?.id === req) occ.add(`${x},${y}`) }))
  for (const k of occ) { const [x, y] = k.split(',').map(Number); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (!occ.has(`${nx},${ny}`) && nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS) ring[ny][nx] = true } }
  const seen = new Set<string>(); const list: Array<[number, number, number]> = []
  rots.forEach((shape, r) => { for (let ny = 0; ny < ROWS; ny++) for (let nx = 0; nx < COLS; nx++) { if (!ring[ny][nx]) continue
    for (const [sx, sy] of shape) { const x = nx - sx, y = ny - sy, k = key3(r, x, y); if (!seen.has(k) && x >= 0 && y >= 0) { seen.add(k); list.push([r, x, y]) } } } })
  return { list, ring }
}

// 상태 키: bucket = 0 이면 보드 전체(정확), N > 0 이면 각 블록을 (모양, x/N, y/N) 칸 버킷으로 뭉친 요약 키
const stateKey = (n: TNode, bucket: number) => bucket === 0 ? n.sig : n.places.map(q => `${q.id}:${q.r}:${Math.floor(q.x / bucket)}:${Math.floor(q.y / bucket)}`).join('|')

function expand(layer: TNode[], id: E.BlockId, K: number, bucket: number): { step: TStep; next: TNode[] } {
  const fullPerParent = E.rotationsFor(id).length * COLS * ROWS
  const coverage = Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0))
  const merged = new Map<string, TNode>()
  let legalTotal = 0, legalFirst = 0, ringPerParent: number | null = null, ringShown: boolean[][] | null = null
  layer.forEach((n, pi) => {
    const { list, ring } = candidates(n.s.board, id)
    if (pi === 0) { ringPerParent = ring ? list.length : null; ringShown = ring }
    for (const [r, x, y] of list) {
      const active = { id, rotation: r, x, y } as E.ActiveBlock
      if (!E.isLegalPlacement(n.s.board, active)) continue
      legalTotal++
      const s2 = E.lockActive(n.s, active, n.s.queue, n.s.hold)
      const child: TNode = { s: s2, value: E.evaluatePlacement(s2.board), sig: E.placementSignature(s2.board), trail: [...n.trail, `${E.BLOCKS[id].label}: 모양 ${r} @ (${x},${y})`], places: [...n.places, { id, r, x, y }], parent: pi }
      const ck = stateKey(child, bucket); const old = merged.get(ck); if (!old || child.value > old.value) merged.set(ck, child)
      if (pi === 0) { legalFirst++; for (const [px, py] of E.rotationsFor(id)[r]) { const cx = px + x, cy = py + y; if (cy >= 0 && cy < ROWS && cx >= 0 && cx < COLS) coverage[cy][cx]++ } }
    }
  })
  const all = [...merged.values()].sort((a, b) => b.value - a.value)
  const kept = all.slice(0, K)
  return { next: kept, step: { id, parents: layer.length, fullPerParent, ringPerParent, legalFirst, legalTotal, merged: all.length, kept, pruned: all.slice(K, K + 3), firstParent: layer[0].s.board, coverage, ring: ringShown,
    minV: all.length ? all[all.length - 1].value : 0, maxV: all.length ? all[0].value : 0 } }
}

function BoardSvg({ board, heat, ring, width = 300 }: { board: E.Board; heat?: number[][]; ring?: boolean[][] | null; width?: number }) {
  const maxHeat = heat ? Math.max(1, ...heat.flat()) : 1
  return <svg viewBox={`0 0 ${COLS} ${ROWS}`} width={width} height={width * ROWS / COLS} style={{ display: 'block', borderRadius: 4, border: '1px solid var(--border-strong)', background: 'var(--surface-muted)' }} role="img" aria-label="25×12 배치 보드">
    {Array.from({ length: COLS - 1 }, (_, i) => <line key={`v${i}`} x1={i + 1} x2={i + 1} y1={0} y2={ROWS} stroke="var(--border)" strokeWidth={0.03}/>)}
    {Array.from({ length: ROWS - 1 }, (_, i) => <line key={`h${i}`} y1={i + 1} y2={i + 1} x1={0} x2={COLS} stroke="var(--border)" strokeWidth={0.03}/>)}
    {heat && heat.flatMap((row, y) => row.map((v, x) => v > 0 ? <rect key={`h${x}-${y}`} x={x} y={y} width={1} height={1} fill="#f2994a" fillOpacity={0.12 + 0.6 * v / maxHeat}/> : null))}
    {board.flatMap((row, y) => row.map((c, x) => c ? <rect key={`b${x}-${y}`} x={x + 0.04} y={y + 0.04} width={0.92} height={0.92} rx={0.08} fill={E.BLOCKS[c.id].color}/> : null))}
    {ring && ring.flatMap((row, y) => row.map((v, x) => v ? <rect key={`r${x}-${y}`} x={x + 0.1} y={y + 0.1} width={0.8} height={0.8} fill="none" stroke="#16a085" strokeWidth={0.12}/> : null))}
  </svg>
}

// 격자도에 넣는 작은 보드. hi 블록은 검은 테두리로 "이 단계에서 새로 놓은 블록"을 표시한다.
function BoardMini({ board, x, y, w, hi, dim }: { board: E.Board; x: number; y: number; w: number; hi?: E.BlockId; dim?: boolean }) {
  let minX = 99, minY = 99, maxX = -1, maxY = -1
  if (hi) board.forEach((row, yy) => row.forEach((c, xx) => { if (c?.id === hi) { minX = Math.min(minX, xx); maxX = Math.max(maxX, xx); minY = Math.min(minY, yy); maxY = Math.max(maxY, yy) } }))
  return <svg x={x} y={y} width={w} height={w * ROWS / COLS} viewBox={`0 0 ${COLS} ${ROWS}`} opacity={dim ? 0.5 : 1}>
    <rect width={COLS} height={ROWS} fill="var(--surface-muted)" stroke="var(--border-strong)" strokeWidth={0.15}/>
    {board.flatMap((row, yy) => row.map((c, xx) => c ? <rect key={`${xx}-${yy}`} x={xx + 0.04} y={yy + 0.04} width={0.92} height={0.92} rx={0.08} fill={E.BLOCKS[c.id].color}/> : null))}
    {hi && maxX >= 0 && <rect x={minX - 0.05} y={minY - 0.05} width={maxX - minX + 1.1} height={maxY - minY + 1.1} fill="none" stroke="var(--text)" strokeWidth={0.28}/>}
  </svg>
}

function Trellis({ trace, K, sel, onSel }: { trace: TStep[]; K: number; sel: number; onSel: (i: number) => void }) {
  const colW = 178, bw = 150, bh = bw * ROWS / COLS, rowH = bh + 24, top = 56
  const rows = K + 3
  const W = 16 + SEQ.length * colW, H = top + rows * rowH + 6
  const pos = (c: number, r: number) => ({ x: 8 + c * colW, y: top + r * rowH })
  const path: number[] = []
  if (trace.length === SEQ.length) { let idx = Math.min(sel, trace[SEQ.length - 1].kept.length - 1); for (let c = SEQ.length - 1; c >= 0; c--) { path[c] = idx; idx = trace[c].kept[idx]?.parent ?? 0 } }
  const edge = (c: number, node: TNode, r: number, kind: 'kept' | 'pruned') => {
    if (c === 0 || node.parent < 0) return null
    const a = pos(c - 1, node.parent), b = pos(c, r)
    const x1 = a.x + bw, y1 = a.y + bh / 2, x2 = b.x, y2 = b.y + bh / 2
    const onPath = kind === 'kept' && path[c] === r && path[c - 1] === node.parent
    return <path key={`e${c}-${kind}-${r}`} d={`M${x1} ${y1} C${x1 + 20} ${y1}, ${x2 - 20} ${y2}, ${x2} ${y2}`} fill="none"
      stroke={onPath ? '#1D9E75' : kind === 'kept' ? '#5a8dee' : 'var(--text-muted)'} strokeWidth={onPath ? 3.2 : 1.3} strokeDasharray={kind === 'pruned' ? '4 3' : undefined} opacity={onPath ? 1 : 0.75}/>
  }
  return <div style={{ overflowX: 'auto' }}><svg viewBox={`0 0 ${W} ${H}`} width={W} style={{ display: 'block' }} role="img" aria-label="beam search 격자도: 단계별로 남은 상태와 부모 연결">
    {trace.map((st, c) => { const o = pos(c, 0); return <g key={`h${c}`}>
      <text x={o.x} y={14} fontSize={12} fontWeight={700} fill="currentColor">{c + 1}단계 · {NAME[st.id]}</text>
      <text x={o.x} y={30} fontSize={10} fill="currentColor" opacity={0.8}>합법 {st.legalTotal.toLocaleString()}개 → 병합 {st.merged.toLocaleString()}개</text>
      <text x={o.x} y={44} fontSize={10} fill="currentColor" opacity={0.8}>상위 {st.kept.length}개 유지</text></g> })}
    {trace.map((st, c) => <g key={`g${c}`}>
      {st.kept.map((n, i) => edge(c, n, i, 'kept'))}
      {st.pruned.map((n, j) => edge(c, n, K + j, 'pruned'))}
    </g>)}
    {trace.map((st, c) => <g key={`b${c}`}>
      {st.kept.map((n, i) => { const o = pos(c, i); const on = path[c] === i; const last = c === SEQ.length - 1
        return <g key={i} onClick={last ? () => onSel(i) : undefined} style={{ cursor: last ? 'pointer' : 'default' }}>
          {on && <rect x={o.x - 3} y={o.y - 3} width={bw + 6} height={bh + 6} fill="none" stroke="#1D9E75" strokeWidth={2.4} rx={3}/>}
          <BoardMini board={n.s.board} x={o.x} y={o.y} w={bw} hi={st.id}/>
          <text x={o.x} y={o.y + bh + 13} fontSize={10} fill="currentColor">#{i + 1} 점수 <tspan fontWeight={700}>{f1(n.value)}</tspan> · ({n.places[c].x},{n.places[c].y})</text>
        </g> })}
      {st.pruned.map((n, j) => { const o = pos(c, K + j)
        return <g key={`p${j}`}>
          <BoardMini board={n.s.board} x={o.x} y={o.y} w={bw} hi={st.id} dim/>
          <text x={o.x} y={o.y + bh + 13} fontSize={10} fill="currentColor" opacity={0.75}>버려짐 · 점수 {f1(n.value)} · ({n.places[c].x},{n.places[c].y})</text>
        </g> })}
    </g>)}
  </svg></div>
}

function PathStrip({ trace, path }: { trace: TStep[]; path: number[] }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
    {trace.map((st, c) => { const n = st.kept[path[c]]; if (!n) return null; const pl = n.places[c]
      return <div key={c} style={{ width: 214 }}>
        <svg viewBox={`0 0 ${COLS} ${ROWS}`} width={214} height={214 * ROWS / COLS} style={{ display: 'block' }}><BoardMini board={n.s.board} x={0} y={0} w={COLS} hi={st.id}/></svg>
        <div style={{ fontSize: 12, marginTop: 4, lineHeight: 1.6 }}><b>{c + 1}. {NAME[st.id]}</b> 놓기<br/>모양 {pl.r} · 위치 ({pl.x}, {pl.y}) · 점수 <b>{f1(n.value)}</b><br/>
          <span style={{ color: 'var(--text-secondary)' }}>합법 후보 {st.legalTotal.toLocaleString()}개 중 {path[c] + 1}위로 남음</span></div>
      </div> })}
  </div>
}

const RULE_TEXT: Record<string, string> = {
  adc: '아날로그 영역: 블록 중심이 보드 왼쪽 42% 안(x ≤ 10.5)에 있어야 합니다.',
  sram: '메모리 영역: 블록 중심이 보드 오른쪽 45%(x ≥ 13.75)에 있고, ADC와 칸 거리 2 이상 떨어져야 합니다.',
  opamp: '필수 이웃: ADC와 맞닿아야 합니다(맨해튼 거리가 정확히 1인 칸이 있어야 함).',
  fifo: '필수 이웃: 앞서 놓은 SAR NEAR(opamp)와 맞닿아야 하고, ADC와는 바로 붙으면 안 됩니다.',
  control: '필수 이웃: SRAM과 맞닿아야 하고, ADC와는 바로 붙으면 안 됩니다.',
}
const NAME: Record<string, string> = { adc: 'ADC MACRO', sram: 'SRAM MACRO', opamp: 'SAR NEAR', fifo: 'CDC EDGE', control: 'CAPTURE NEAR' }

function Legend() {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 12, margin: '4px 0 8px' }}>
    {SEQ.map(id => <span key={id}><i style={{ display: 'inline-block', width: 12, height: 12, background: E.BLOCKS[id].color, borderRadius: 2, marginRight: 4, verticalAlign: -2 }}/>{NAME[id]}</span>)}
    <span><i style={{ display: 'inline-block', width: 12, height: 12, background: '#f2994a', opacity: 0.6, borderRadius: 2, marginRight: 4, verticalAlign: -2 }}/>합법 위치가 덮는 칸(진할수록 많이 덮음)</span>
    <span><i style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #16a085', borderRadius: 2, marginRight: 4, verticalAlign: -2, boxSizing: 'border-box' }}/>이웃 규칙 후보 띠</span>
  </div>
}

function Stepper({ steps, index, onChange }: { steps: string[]; index: number; onChange: (i: number) => void }) {
  return <div style={{ margin: '8px 0' }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
      {steps.map((s, i) => <button key={s} type="button" className={i === index ? 'active' : ''} onClick={() => onChange(i)} style={{ fontSize: 12 }}>{i}. {s}</button>)}
    </div>
    <div style={{ display: 'flex', gap: 8 }}>
      <button type="button" disabled={index === 0} onClick={() => onChange(index - 1)}>← 이전</button>
      <button type="button" className="active" disabled={index === steps.length - 1} onClick={() => onChange(index + 1)}>다음 단계 →</button>
    </div>
  </div>
}

// 한 배치의 점수를 항목별로 풀어 쓴 표. 값은 엔진 measureBoard로 이 화면에서 계산하고, 합계가 evaluatePlacement와 같은지 검증한다.
function ScoreBreakdown({ board, label }: { board: E.Board; label: string }) {
  const m = E.measureBoard(board)
  const rows = TERMS.map(([k, w, name, always]) => ({ k, w, name, always, val: m[k] as number, c: -(m[k] as number) * w }))
  const sum = rows.reduce((a, r) => a + r.c, 0), engine = E.evaluatePlacement(board), ok = Math.abs(sum - engine) < 1e-6
  const fmt = (x: number) => (Math.round(x * 100) / 100).toString()
  const part = (always: boolean) => rows.filter(r => r.always === always)
  const subtotal = (always: boolean) => part(always).reduce((a, r) => a + r.c, 0)
  const table = (always: boolean) => <div className="data-table"><table><thead><tr><th>항목</th><th>측정값</th><th>가중치</th><th>점수 기여</th></tr></thead><tbody>
    {part(always).map(r => <tr key={r.k} style={r.val === 0 ? { color: 'var(--text-muted)' } : undefined}><td>{r.name}</td><td>{fmt(r.val)}</td><td>× {r.w}</td><td><b>{r.val === 0 ? '0' : fmt(r.c)}</b></td></tr>)}
    <tr><td colSpan={3}><b>소계</b></td><td><b>{fmt(subtotal(always))}</b></td></tr>
  </tbody></table></div>
  return <div style={{ ...box, marginTop: 10 }}>
    <b style={{ fontSize: 13 }}>점수는 어떻게 계산되나 — {label}</b>
    <p style={p}>점수 = <b>− Σ (측정값 × 가중치)</b>. <b>감점만 더하므로 0이 가장 좋고</b>(실제로는 도달 못 함) 위반이 없어도 0이 되지 않습니다. 아래는 이 배치를 엔진 <code>measureBoard</code>로 잰 값입니다.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
      <div style={{ flex: 1, minWidth: 280 }}><b style={{ fontSize: 12 }}>① 위반이 하나도 없어도 남는 항 (구조상 0이 될 수 없음)</b>{table(true)}</div>
      <div style={{ flex: 1, minWidth: 280 }}><b style={{ fontSize: 12 }}>② 위반이 있을 때만 붙는 항 (0이면 위반 없음)</b>{table(false)}</div>
    </div>
    <p style={{ ...p, fontWeight: 700, color: ok ? 'var(--success)' : 'var(--danger)' }}>합계 {fmt(sum)} = 엔진 evaluatePlacement {fmt(engine)} {ok ? '✓ 일치' : '✗ 불일치'}</p>
    <ul style={ul}>
      <li><b>하드 규칙과 소프트 비용은 별개입니다.</b> 하드 규칙(ADC 위치 ≤ 0.42·열, SRAM ≥ 0.55·열이며 ADC와 거리 ≥ 2, 필수 이웃과 거리 정확히 1, 이웃 아닌 블록은 ADC에 인접 금지)은 <b>점수에 들어가지 않고 어기면 그 위치를 후보에서 아예 뺍니다</b>(beam search의 ② 합법 검사). 필수 이웃 인접 항은 하드 규칙이 이미 보장해 합법 후보에서는 항상 0이고, 나머지 ②번 항(영역·격리·간격 등)은 합법이어도 붙을 수 있습니다. 어느 항이 얼마를 차지하는지는 위 표의 실제 측정값을 보세요.</li>
      <li><b>가장 큰 연속 항:</b> 배선 길이 proxy는 네트 4개(ADC–SAR 1, SAR–CDC 1, <b>CDC–SRAM 1.4</b>, SRAM–CAP 1)의 중심 맨해튼 거리를 가중해 더한 뒤 ×2.5 합니다. 매크로 여유(벌점)는 하드 매크로 쌍(ADC–SRAM)의 간격이 <b>6칸(300 µm) 미만이면 부족한 칸 수 × 6</b>, 2칸(100 µm) 미만이면 위험 ×90이 따로 붙습니다.</li>
      <li><b>부분 배치의 점수는 최종 점수와 다릅니다.</b> 아직 안 놓인 블록이 포함된 항(예: 배선 네트는 양 끝 블록이 모두 놓여야 생김)은 계산에서 빠집니다. beam search는 이 <b>부분 점수</b>로 상위 K를 고르므로, 지금 점수가 높은 후보가 최종에서 가장 좋다는 보장이 없습니다. beam search가 정확한 DP가 아닌 이유 중 하나입니다.</li>
      <li>점수는 <b>게임 proxy</b>입니다. 실제 LVS·DRC에서 문제가 된 tap sliver, 매크로 전원 연결은 이 식에 없습니다(설계 후보 1이 푸는 문제).</li>
    </ul>
  </div>
}

// ---- 이웃 영역 블록의 모양: 엔진이 실제로 만든 shape를 그대로 그린다 (셀 수는 고정, 칸을 띄워 퍼뜨림) ----
const ORIGINAL_SHAPES: Record<string, number> = { opamp: 8, fifo: 6, control: 8 }   // 확장 전 모양 수. 확장 모양은 뒤에 덧붙어 번호가 유지됨
function ShapeGallery() {
  return <div style={{ margin: '8px 0' }}>
    <b style={{ fontSize: 12 }}>이웃 영역 블록의 모양 (엔진이 만든 그대로 — 셀 수는 고정이고 칸을 띄워 퍼뜨린 모양)</b>
    {(['opamp', 'fifo', 'control'] as const).map(id => {
      const shapes = E.rotationsFor(id)
      return <div key={id} style={{ margin: '6px 0' }}>
        <div style={{ fontSize: 12 }}><b>{NAME[id]}</b> · 셀 {E.BLOCKS[id].base.length}개 · 모양 <b>{shapes.length}개</b> (기존 {ORIGINAL_SHAPES[id]}개 + 추가 {shapes.length - ORIGINAL_SHAPES[id]}개, 한 변 최대 5칸 = 250 µm)</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 3 }}>
          {shapes.map((sh, i) => {
            const w = Math.max(...sh.map(q => q[0])) + 1, h = Math.max(...sh.map(q => q[1])) + 1, u = 9
            return <div key={i} style={{ textAlign: 'center' }}>
              <svg width={w * u + 4} height={h * u + 4} role="img" aria-label={`${NAME[id]} 모양 ${i}`} style={{ border: `1px solid ${i >= ORIGINAL_SHAPES[id] ? '#e67e22' : 'var(--border-strong)'}`, borderRadius: 3, background: 'var(--surface-muted)' }}>
                {sh.map(([x, y]) => <rect key={`${x}-${y}`} x={2 + x * u} y={2 + y * u} width={u - 1} height={u - 1} fill={E.BLOCKS[id].color}/>)}
              </svg>
              <div style={{ fontSize: 10, color: i >= ORIGINAL_SHAPES[id] ? '#e67e22' : 'var(--text-muted)' }}>{i}{i >= ORIGINAL_SHAPES[id] ? ' 새' : ''}</div>
            </div>
          })}
        </div>
      </div>
    })}
    <p style={{ ...p, fontSize: 12 }}>주황 테두리가 이번에 추가한 모양입니다: 3칸 이상 띄움, 가로·세로를 다르게 띄움, 일자형 1×4, L자·T자(4셀 블록), CDC의 3~4칸 띄움. <b>필수 이웃 규칙은 "한 셀이라도 맞닿으면 통과"라서</b> 퍼진 모양의 나머지 조각이 멀어지지 않도록 한 변을 5칸으로 제한했습니다. 모양이 늘면 후보 수가 거의 비례해 늘지만(측정: beam K=8 합법 검사 8,891 → 19,393번), 점수가 좋아지는 폭은 작았습니다(−136.51 → −134.77). 점수식에 "영역을 나눠 놓으면 이득"이라는 항이 없기 때문입니다(측정: 배경 지식 탭 11절 ⑤ "모양을 8개에서 23개로" 표).</p>
  </div>
}

// ---- 놓는 순서 실험: 같은 beam search를 블록 순서만 바꿔 돌린다 ----
const SHORT_NAME: Record<string, string> = { adc: 'ADC', sram: 'SRAM', opamp: 'SAR', fifo: 'CDC', control: 'CAP' }
function perms<T>(a: T[]): T[][] { return a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(r => [x, ...r])) }
const ALL_ORDERS = perms([...SEQ])
// 필수 이웃 블록이 먼저 놓여 있어야 합법 위치가 생긴다(엔진의 하드 규칙)
const respectsPrereq = (o: E.BlockId[]) => o.every((id, i) => { const q = E.BLOCKS[id].requiredNeighbor; return !q || o.indexOf(q) < i })
const VALID_ORDERS = ALL_ORDERS.filter(respectsPrereq)
const BAD_EXAMPLES: E.BlockId[][] = [['opamp', 'adc', 'fifo', 'sram', 'control'], ['adc', 'sram', 'fifo', 'opamp', 'control']]
type OrderRow = { order: E.BlockId[]; best?: number; ms?: number; stoppedAt?: E.BlockId }
const orderLabel = (o: E.BlockId[]) => o.map(i => SHORT_NAME[i]).join(' → ')

function OrderBox() {
  const [rows, setRows] = useState<OrderRow[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const run = async () => {
    setBusy(true); setRows([])
    const out: OrderRow[] = []
    for (const order of [...BAD_EXAMPLES, ...VALID_ORDERS]) {
      setMsg(`${orderLabel(order)} 계산 중… (${out.length + 1}/${BAD_EXAMPLES.length + VALID_ORDERS.length})`)
      const r = await beamAsync(8, 4, undefined, order)
      out.push({ order, best: r.top[0]?.value, ms: r.ms, stoppedAt: r.stoppedAt }); setRows([...out])
    }
    setMsg(''); setBusy(false)
  }
  const bad = rows.filter(r => r.stoppedAt), ok = rows.filter(r => !r.stoppedAt).sort((a, b) => (b.best ?? -Infinity) - (a.best ?? -Infinity))
  const isDefault = (o: E.BlockId[]) => o.every((id, i) => id === SEQ[i])
  return <div style={{ ...box, marginTop: 10 }}>
    <b style={{ fontSize: 13 }}>놓는 순서가 바뀌면 어떻게 되나 — 같은 beam search를 순서만 바꿔 돌려 봅니다</b>
    <ul style={ul}>
      <li><b>가능한 순서는 {ALL_ORDERS.length}가지 중 {VALID_ORDERS.length}가지뿐입니다.</b> 엔진의 하드 규칙이 "필수 이웃이 이미 놓여 있어야" 합법 위치를 인정하기 때문에 SAR는 ADC 뒤, CDC는 SAR 뒤, CAP은 SRAM 뒤에만 놓을 수 있습니다. 이 규칙을 어기는 순서는 첫 위반 블록에서 합법 위치가 0개가 되어 상태가 모두 사라집니다(아래 버튼으로 확인).</li>
      <li><b>남은 {VALID_ORDERS.length}가지도 결과가 크게 다릅니다.</b> beam search는 지금까지 놓은 블록만으로 점수를 매기므로(앞의 "부분 배치 점수"), 나중에 놓일 블록과 짝이 되는 항(같은 종류끼리 가깝게 놓는 기능 클러스터, 배선)을 먼저 놓는 블록은 볼 수 없습니다. 그래서 <b>순서도 beam search의 설정값</b>이고, 정확한 DP처럼 순서와 무관한 최적을 주지 않습니다.</li>
    </ul>
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '6px 0' }}>
      <button type="button" className="active" disabled={busy} onClick={() => { void run() }}>{busy ? '계산 중…' : `순서별로 실행 (K=8, 4칸 버킷 · 순서 ${VALID_ORDERS.length}개 + 위반 예 ${BAD_EXAMPLES.length}개)`}</button>
      {busy && <span style={{ fontSize: 12, color: 'var(--warning)' }}>{msg}</span>}
    </div>
    {rows.length > 0 && <div className="data-table"><table><thead><tr><th>순서</th><th>최종 점수 (높을수록 좋음)</th><th>시간</th><th>비고</th></tr></thead><tbody>
      {ok.map(r => <tr key={orderLabel(r.order)}><td>{orderLabel(r.order)}{isDefault(r.order) && <b> (기본 순서)</b>}</td><td><b>{r.best!.toFixed(2)}</b></td><td>{(r.ms! / 1000).toFixed(1)}초</td><td>{r.best! < -300 ? 'CAP이 CDC보다 먼저 놓임 → 같은 종류(digital) 블록이 멀어져 기능 클러스터 감점' : ''}</td></tr>)}
      {bad.map(r => <tr key={orderLabel(r.order)} style={{ color: 'var(--danger)' }}><td>{orderLabel(r.order)}</td><td>상태 없음</td><td>{(r.ms! / 1000).toFixed(1)}초</td><td>{SHORT_NAME[r.stoppedAt!]} 단계에서 합법 위치 0개 (필수 이웃이 아직 안 놓임)</td></tr>)}
    </tbody></table></div>}
    <ul style={ul}>
      <li><b>측정(2026-10-09, Node에서 같은 엔진·같은 조건):</b> K=8에서 {VALID_ORDERS.length}가지 중 4가지가 −133 ~ −164, 6가지는 모두 CAP을 CDC보다 먼저 놓는 순서로 −522.6 ~ −553.3이었습니다. K=32로 키워도 같은 6가지는 −522.6에서 벗어나지 못했습니다(다른 후보로 갈아타지 못함). 기본 순서(ADC → SRAM → SAR → CDC → CAP)가 최선도 아니었습니다: K=8에서 ADC → SAR → SRAM → CDC → CAP가 −133.22로 기본(−134.77)보다 좋았고 K=32에서는 기본 −132.74가 앞섰습니다.</li>
      <li><b>−522.6의 원인(측정):</b> CAP을 먼저 놓는 순서의 최선 배치를 항목별로 풀면 기능 클러스터 8 × 45 = −360이 점수의 대부분이었습니다. CAP이 놓이는 시점에는 CDC가 아직 없어 이 항이 0이라 beam이 CAP을 SRAM 위쪽 빈 곳(점수가 좋은 곳)에 놓았고, 나중에 CDC가 SAR 옆(ADC 근처)에 놓이면서 두 블록이 멀어졌습니다.</li>
      <li><b>대응(제안):</b> ① 선행 조건을 지키는 {VALID_ORDERS.length}가지 순서를 모두 돌려 최선을 고릅니다(K=8이면 순서당 수 초). ② 같은 종류끼리 가까워야 하는 블록은 <b>가까운 단계에 연달아</b> 놓습니다. ③ 부분 점수에 아직 안 놓인 블록과의 거리에 대한 낙관적 추정을 넣습니다(미구현). SA는 완성된 배치를 고치므로 이 부분 점수 문제가 없습니다.</li>
    </ul>
  </div>
}

function BeamPart() {
  const [K, setK] = useState(3)
  const [bucket, setBucket] = useState(0)
  const [view, setView] = useState<'trellis' | 'steps'>('trellis')
  const [sel, setSel] = useState(0)
  const [step, setStep] = useState(0)
  const [trace, setTrace] = useState<TStep[]>([])
  const [busy, setBusy] = useState(true)
  useEffect(() => {
    let dead = false
    setBusy(true); setTrace([])
    const run = async () => {
      let layer: TNode[] = [{ s: E.createGame(0), value: 0, sig: '', trail: [], places: [], parent: -1 }]
      const out: TStep[] = []
      for (const id of SEQ) {
        await new Promise(r => setTimeout(r, 0))
        if (dead) return
        const { step: st, next } = expand(layer, id, K, bucket)
        out.push(st); layer = next; setTrace([...out])
      }
      if (!dead) setBusy(false)
    }
    void run()
    return () => { dead = true }
  }, [K, bucket])
  const names = ['문제 설정', ...SEQ.map(id => `${NAME[id]} 놓기`), '결과']
  const last = trace[trace.length - 1]
  const cur = step >= 1 && step <= SEQ.length ? trace[step - 1] : null

  return <div>
    <p style={p}>아래는 <b>이 화면에서 실제 엔진을 돌려서</b> 그린 그림입니다. 빔 폭 K를 바꾸면 다시 계산합니다.</p>
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '4px 0' }}>
      <label style={{ fontSize: 12 }}>빔 폭 K <select value={K} onChange={e => { setK(Number(e.target.value)); setStep(0) }}>{[2, 3, 5].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
      <label style={{ fontSize: 12 }}>상태 키 <select value={bucket} onChange={e => { setBucket(Number(e.target.value)); setStep(0) }}><option value={0}>정확(보드 전체)</option>{[2, 3, 4].map(v => <option key={v} value={v}>{v}칸 버킷 요약</option>)}</select></label>
      {busy && <span style={{ fontSize: 12, color: 'var(--warning)' }}>엔진 계산 중… ({trace.length}/{SEQ.length}단계)</span>}
    </div>
    <div className="analog-tabs" role="tablist" aria-label="보기" style={{ margin: '6px 0 8px' }}>
      <button type="button" role="tab" aria-selected={view === 'trellis'} className={view === 'trellis' ? 'active' : ''} onClick={() => setView('trellis')}>한 장으로 보기 (격자도)</button>
      <button type="button" role="tab" aria-selected={view === 'steps'} className={view === 'steps' ? 'active' : ''} onClick={() => setView('steps')}>단계별로 보기</button>
    </div>

    {view === 'trellis' && <div style={box}>
      <b style={{ fontSize: 13 }}>실제로 놓이는 과정을 한 장으로 — 열 = 놓는 단계, 한 줄 = 빔에 남은 상태</b>
      <ul style={ul}>
        <li><b>검은 테두리</b>: 그 단계에서 <b>새로 놓은 블록</b>. 같은 열의 각 그림은 <b>서로 다른 위치에 놓은 후보</b>입니다.</li>
        <li><b>파란 선</b>: 어느 부모 상태에서 이어 놓았는지. <b>회색 점선(흐리게)</b>: 점수가 상위 K에 못 들어 <b>버려진 후보</b>(버려진 것 중 상위 3개).</li>
        <li><b>초록 굵은 선과 테두리</b>: 마지막 단계에서 고른 후보가 <b>만들어진 경로</b>. 마지막 열의 그림을 눌러 다른 후보의 경로를 볼 수 있습니다.</li>
        <li>매 열에서 일어나는 일: 앞 열에 남은 상태마다 <b>합법 위치를 전부 만들고 → 점수를 매기고 → 상위 K개만 남깁니다.</b> 이것이 beam search의 전부입니다.</li>
      </ul>
      <Legend/>
      {trace.length === 0 ? <span style={{ fontSize: 13, color: 'var(--warning)' }}>엔진으로 계산하는 중입니다…</span> : <Trellis trace={trace} K={K} sel={sel} onSel={setSel}/>}
      {trace.length === SEQ.length && <>
        <b style={{ fontSize: 13, display: 'block', margin: '14px 0 6px' }}>선택한 후보 #{Math.min(sel, trace[SEQ.length - 1].kept.length - 1) + 1}이 만들어지는 과정 (순서대로)</b>
        <PathStrip trace={trace} path={(() => { const pth: number[] = []; let idx = Math.min(sel, trace[SEQ.length - 1].kept.length - 1); for (let c = SEQ.length - 1; c >= 0; c--) { pth[c] = idx; idx = trace[c].kept[idx]?.parent ?? 0 } return pth })()}/>
      </>}
    </div>}

    {view === 'steps' && <><Stepper steps={names} index={step} onChange={setStep}/>
    <Legend/></>}

    {view === 'steps' && step === 0 && <div style={box}>
      <b style={{ fontSize: 13 }}>0. 문제 설정 — 보드와 블록</b>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 8 }}>
        <div><BoardSvg board={E.emptyBoard()} width={320}/><div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{COLS}×{ROWS} 칸 · 한 칸 {E.GRID_UM} µm · 보드 {E.DIE_WIDTH_UM}×{E.DIE_HEIGHT_UM} µm</div></div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="data-table"><table><thead><tr><th>블록</th><th>종류</th><th>모양 수</th><th>크기(칸)</th><th>필수 이웃</th></tr></thead><tbody>
            {SEQ.map(id => { const shapes = E.rotationsFor(id); const s0 = shapes[0]; const w = Math.max(...s0.map(q => q[0])) + 1, h = Math.max(...s0.map(q => q[1])) + 1
              return <tr key={id}><td><i style={{ display: 'inline-block', width: 10, height: 10, background: E.BLOCKS[id].color, marginRight: 4, borderRadius: 2 }}/>{NAME[id]}</td><td>{E.BLOCKS[id].physicalKind === 'hard-macro' ? '하드 매크로' : '이웃 영역'}</td><td>{shapes.length}</td><td>{w}×{h}</td><td>{E.BLOCKS[id].requiredNeighbor ? NAME[E.BLOCKS[id].requiredNeighbor!] : '—'}</td></tr> })}
          </tbody></table></div>
        </div>
      </div>
      <ShapeGallery/>
      <p style={p}>beam search는 이 5개 블록을 <b>정해진 순서(ADC → SRAM → SAR NEAR → CDC EDGE → CAPTURE NEAR)</b>로 하나씩 놓습니다. 순서를 바꾸면 결과가 크게 달라집니다(이 화면 맨 아래 "놓는 순서가 바뀌면" 참고). 매 단계는 같은 5가지 일을 합니다.</p>
      <ol style={ul}>
        <li><b>전이:</b> 지금 상태에서 다음 블록을 놓을 수 있는 (모양, x, y)를 만든다.</li>
        <li><b>합법 검사:</b> 겹침·영역·이웃 같은 hard rule을 어기면 즉시 버린다(가지치기).</li>
        <li><b>값 계산:</b> 남은 후보마다 게임 점수(높을수록 좋음)를 계산한다.</li>
        <li><b>상태 병합:</b> 같은 보드가 된 후보는 하나로 합치고 더 좋은 값만 남긴다.</li>
        <li><b>상위 K 유지:</b> 값이 높은 K개만 다음 단계로 넘긴다(그래서 "beam").</li>
      </ol>
    </div>}

    {view === 'steps' && step >= 1 && step <= SEQ.length && !cur && <div style={box}><span style={{ fontSize: 13, color: 'var(--warning)' }}>이 단계를 엔진으로 계산하는 중입니다…</span></div>}
    {view === 'steps' && cur && <div style={box}>
      <b style={{ fontSize: 13 }}>{step}. {NAME[cur.id]} 놓기 — 단계 {step}/{SEQ.length}</b>
      <p style={{ ...p, color: 'var(--text-secondary)' }}>규칙: {RULE_TEXT[cur.id]}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <BoardSvg board={cur.firstParent} heat={cur.coverage} ring={cur.ring} width={340}/>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>부모 상태 #1(이전 단계의 최고 상태)에서 {NAME[cur.id]}의 <b>합법 위치 {cur.legalFirst}개</b>가 덮는 칸{cur.ring ? ' · 초록 테두리는 이웃 후보 띠' : ''}</div>
        </div>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div className="data-table"><table><thead><tr><th>beam search 동작</th><th>이 단계의 실제 값</th></tr></thead><tbody>
            <tr><td>① 부모 상태(이전 단계에서 넘어온 상위 K)</td><td><b>{cur.parents}</b>개</td></tr>
            <tr><td>② 전이 후보 (부모 1개당)</td><td>{cur.ringPerParent === null ? <>전체 스캔 <b>{cur.fullPerParent.toLocaleString()}</b>개 (모양 {E.rotationsFor(cur.id).length}가지 × {COLS}×{ROWS} 칸)</> : <>전체 스캔 {cur.fullPerParent.toLocaleString()}개 → <b>이웃 띠 {cur.ringPerParent.toLocaleString()}개</b></>}</td></tr>
            <tr><td>③ hard rule 통과(합법) 후보</td><td>부모 #1에서 <b>{cur.legalFirst}</b>개, 부모 전체 합 <b>{cur.legalTotal.toLocaleString()}</b>개</td></tr>
            <tr><td>④ 값 계산</td><td>최고 <b>{f1(cur.maxV)}</b> · 최저 {f1(cur.minV)} (게임 점수, 높을수록 좋음 · 항목별 계산은 이 화면 맨 아래 표)</td></tr>
            <tr><td>⑤ 같은 보드 병합</td><td>{cur.legalTotal.toLocaleString()}개 → <b>{cur.merged.toLocaleString()}</b>개</td></tr>
            <tr><td>⑥ 상위 K={K} 유지</td><td><b>{cur.kept.length}</b>개를 다음 단계로</td></tr>
          </tbody></table></div>
          {cur.ringPerParent !== null && <p style={p}>이웃 규칙은 "맞닿아야 한다"이므로, 이웃 블록 <b>바로 바깥 칸(초록 띠)</b>을 모양의 어느 한 칸이 덮는 위치만 후보가 될 수 있습니다. 그래서 전체 스캔 대신 띠에서만 만들어도 <b>합법 위치를 하나도 놓치지 않고</b>(실측: 25개 상태 1,640 = 1,640) 후보가 크게 줄어듭니다.</p>}
          {step === 2 && <div style={p}>
            <b>이 단계에서 beam search의 두 장치를 구분해서 봅니다.</b>
            <ul style={ul}>
              <li><b>병합("같은 부분 문제를 다시 합친다"):</b> 지금 상태 키는 <b>{bucket === 0 ? '보드 전체(정확)' : `${bucket}칸 버킷 요약`}</b>입니다. {cur.merged < cur.legalTotal ? <>{cur.legalTotal.toLocaleString()}개가 <b>{cur.merged.toLocaleString()}개로 줄었습니다.</b> 같은 버킷의 비슷한 상태끼리 합치고 점수가 높은 하나만 남긴 것입니다(<b>근사</b>이므로 좋은 상태를 잃을 수 있습니다).</> : <><b>{cur.legalTotal.toLocaleString()}개 → {cur.merged.toLocaleString()}개로 줄지 않았습니다.</b> 놓는 순서가 정해져 있고 키가 보드 전체라서 같은 보드가 만들어지지 않기 때문입니다. 위의 "상태 키"를 <b>4칸 버킷 요약</b>으로 바꿔 보세요.</>} 측정(K=32): 정확한 키는 병합이 없었고, 4칸 버킷은 ADC 135→12개 등으로 줄여 같은 K에서 <b>점수 −136.5 → −133.1, 시간 21.0초 → 13.2초</b>였습니다(설계 후보 2의 7절).</li>
              <li><b>상위 K 자르기(beam):</b> {cur.merged.toLocaleString()}개 중 값이 높은 {cur.kept.length}개만 남깁니다. {cur.merged < cur.legalTotal ? '병합과 함께 탐색량을 줄이는 장치이며' : '정확한 키에서는 탐색량을 줄이는 것이 이 장치뿐이며'} 최적을 보장하지 못합니다.</li>
            </ul>
          </div>}
        </div>
      </div>
      <div style={{ marginTop: 10, fontSize: 12 }}><b>다음 단계로 넘어가는 상위 {cur.kept.length}개 상태</b> (점수 높은 순)</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
        {cur.kept.map((n, i) => <div key={n.sig} style={{ textAlign: 'center' }}><BoardSvg board={n.s.board} width={150}/><div style={{ fontSize: 11 }}>#{i + 1} · 점수 <b>{f1(n.value)}</b></div></div>)}
      </div>
    </div>}

    {view === 'steps' && step === SEQ.length + 1 && last && <div style={box}>
      <b style={{ fontSize: 13 }}>{step}. 결과 — 서로 다른 상위 {last.kept.length}개 완성 배치와 계보</b>
      <p style={p}>마지막 단계의 상위 K개가 beam search의 출력입니다. 각 배치는 <b>어떤 순서로 어디에 놓았는지(계보)</b>를 함께 갖습니다. 이 배치들이 L1(floorplan·tap·PDN) 판정으로 넘어갑니다.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        {last.kept.map((n, i) => <div key={n.sig} style={{ maxWidth: 330 }}>
          <BoardSvg board={n.s.board} width={310}/>
          <div style={{ fontSize: 12, marginTop: 4 }}><b>#{i + 1}</b> · 점수 <b>{f1(n.value)}</b> · 위반 {E.measureBoard(n.s.board).violations}건</div>
          <ol style={{ margin: '2px 0 0 16px', padding: 0, fontSize: 11, lineHeight: 1.6, color: 'var(--text-secondary)' }}>{n.trail.map(t => <li key={t}>{t}</li>)}</ol>
        </div>)}
      </div>
      <ul style={ul}>
        <li><b>최적을 보장하지 않습니다.</b> 상위 K개만 남기므로, 지금 점수가 낮아 버려진 상태가 나중에 더 좋았을 수 있습니다. K를 키우면 좋아지지만 시간이 늘어납니다(실측: K=8 4.4초 → K=32 17.9초 → K=128 71.7초, 점수 −185.1 → −136.5 → −135.0).</li>
        <li>점수는 <b>게임 proxy</b>이며 실제 DRC·LVS 결과가 아닙니다. 위반 기억의 금지·risk는 이 그림에 아직 반영되지 않았습니다.</li>
      </ul>
    </div>}

    {(() => {
      const fin = last && trace.length === SEQ.length ? last.kept[Math.min(sel, last.kept.length - 1)] : null
      if (view === 'steps' && cur) return <ScoreBreakdown board={cur.kept[0].s.board} label={`${NAME[cur.id]}까지 놓은 부분 배치 (${step}/${SEQ.length}개), 이 단계 상위 #1`}/>
      if (fin) return <ScoreBreakdown board={fin.s.board} label={`최종 후보 #${Math.min(sel, last!.kept.length - 1) + 1} (격자도에서 고른 후보)`}/>
      return null
    })()}

    <OrderBox/>
  </div>
}

// ================= B. 간격 DP (정확) =================
const G = { coreLeft: 20.24, coreRight: 1229.6, halo: 10, macros: [{ n: 'ADC', w: 223.71 }, { n: 'SRAM', w: 764.24 }], strapPitch: 40, strapOffset: 22.66 }
const INF = Infinity
type GCell = { cost: number; gap: number; macro: number; from: number }
function gapDp(u: number, T: number) {
  const k = G.macros.length, coreW = G.coreRight - G.coreLeft
  const L = coreW - G.macros.reduce((a, m) => a + m.w, 0) - 2 * G.halo * k
  const LU = Math.round(L / u), Tu = Math.ceil(T / u)
  const allowed = (g: number) => g === 0 || g >= Tu
  const gapCost = (i: number, gum: number) => (i > 0 && i < k) ? Math.max(0, 300 - (gum + 2 * G.halo)) * 0.01 : 0
  const leftEdge = (i: number, s: number) => G.coreLeft + s * u + G.macros.slice(0, i).reduce((a, m) => a + m.w + 2 * G.halo, 0) + G.halo
  const macroCost = (x: number) => { const d = (((x - G.strapOffset) % G.strapPitch) + G.strapPitch) % G.strapPitch; return Math.min(d, G.strapPitch - d) * 0.05 }
  const f: number[][] = Array.from({ length: k + 1 }, () => Array<number>(LU + 1).fill(INF))
  const cell: (GCell | null)[][] = Array.from({ length: k + 1 }, () => Array<GCell | null>(LU + 1).fill(null))
  f[0][0] = 0
  for (let i = 0; i < k; i++) for (let s = 0; s <= LU; s++) { if (f[i][s] === INF) continue
    for (let g = 0; g <= LU - s; g++) { if (!allowed(g)) continue
      const s2 = s + g, gc = gapCost(i, g * u), mc = macroCost(leftEdge(i, s2)), c = f[i][s] + gc + mc
      if (c < f[i + 1][s2]) { f[i + 1][s2] = c; cell[i + 1][s2] = { cost: c, gap: gc, macro: mc, from: s } } } }
  const finals = Array.from({ length: LU + 1 }, (_, s) => { const r = LU - s; return f[k][s] === INF || !allowed(r) ? INF : f[k][s] + gapCost(k, r * u) })
  let best = INF, bs = -1; finals.forEach((c, s) => { if (c < best) { best = c; bs = s } })
  const path: number[] = [bs]; let s = bs; for (let i = k; i > 0; i--) { s = cell[i][s]!.from; path.push(s) }; path.reverse()   // 누적 합 s_0=0, s_1, s_2
  const gaps = [path[1] - path[0], path[2] - path[1], LU - path[2]].map(g => g * u)
  // 전수 탐색(k=2)으로 검증
  let bruteBest = INF
  for (let g0 = 0; g0 <= LU; g0++) { if (!allowed(g0)) continue; for (let g1 = 0; g1 <= LU - g0; g1++) { if (!allowed(g1)) continue; const g2 = LU - g0 - g1; if (!allowed(g2)) continue
    const c = gapCost(0, g0 * u) + macroCost(leftEdge(0, g0)) + gapCost(1, g1 * u) + macroCost(leftEdge(1, g0 + g1)) + gapCost(2, g2 * u); if (c < bruteBest) bruteBest = c } }
  const reach = f.map(row => row.filter(v => v < INF).length)
  return { f, cell, LU, Tu, L, k, allowed, finals, best, bestS: bs, path, gaps, bruteBest, reach, leftEdge, gapCost, macroCost, u, T }
}

function GapBar({ gaps, u }: { gaps: number[]; u?: number }) {
  const coreW = G.coreRight - G.coreLeft, W = 760, sc = W / coreW
  const segs: Array<{ x: number; w: number; kind: 'gap' | 'macro' | 'halo'; label: string; gi?: number }> = []
  let x = 0
  const push = (w: number, kind: 'gap' | 'macro' | 'halo', label: string, gi?: number) => { segs.push({ x, w, kind, label, gi }); x += w }
  push(gaps[0], 'gap', `g0 ${f1(gaps[0])}`, 0)
  G.macros.forEach((m, i) => { push(G.halo, 'halo', ''); push(m.w, 'macro', `${m.n} ${f1(m.w)}`); push(G.halo, 'halo', ''); push(gaps[i + 1], 'gap', `g${i + 1} ${f1(gaps[i + 1])}`, i + 1) })
  return <svg viewBox={`0 0 ${W + 20} 64`} width="100%" style={{ maxWidth: W + 20, display: 'block' }} role="img" aria-label="코어 가로 방향의 매크로와 간격">
    <rect x={10} y={14} width={W} height={34} fill="none" stroke="var(--border-strong)"/>
    {segs.map((s, i) => <g key={i}>
      <rect x={10 + s.x * sc} y={14} width={Math.max(0.5, s.w * sc)} height={34} fill={s.kind === 'macro' ? '#5a8dee' : s.kind === 'halo' ? '#c9d3ea' : (s.w > 0 && s.w < 15 ? '#e57373' : '#9bd3b4')} fillOpacity={s.kind === 'gap' && s.w === 0 ? 0 : 0.9}/>
      {s.label && s.w * sc > 40 && <text x={10 + (s.x + s.w / 2) * sc} y={35} textAnchor="middle" fontSize={11} fill="#10253f" fontWeight={700}>{s.label}</text>}
      {s.kind === 'gap' && s.w * sc <= 40 && <text x={10 + (s.x + s.w / 2) * sc} y={10} textAnchor="middle" fontSize={10} fill="currentColor">{s.label}{s.w === 0 ? ' (0)' : ''}</text>}
    </g>)}
    <text x={10} y={62} fontSize={10} fill="currentColor">코어 왼쪽 {G.coreLeft} µm</text><text x={W + 10} y={62} fontSize={10} textAnchor="end" fill="currentColor">코어 오른쪽 {G.coreRight} µm</text>
    {u ? <text x={W / 2 + 10} y={62} fontSize={10} textAnchor="middle" fill="currentColor">연한 파랑 = halo {G.halo} µm · 초록 = 허용 간격 · 빨강 = sliver(위반)</text> : null}
  </svg>
}

function DpTable({ d, hiPath, sel, onSel, showRow }: { d: ReturnType<typeof gapDp>; hiPath: boolean; sel: [number, number] | null; onSel: (c: [number, number]) => void; showRow: number }) {
  const cw = 22, ch = 26, left = 70, W = left + (d.LU + 1) * cw + 6
  const finite = d.f.flat().filter(v => v < INF); const lo = Math.min(...finite), hi = Math.max(...finite)
  const rows = ['f[0] (시작)', 'f[1] 간격 g0 선택 후', 'f[2] 간격 g1 선택 후']
  return <div style={{ overflowX: 'auto' }}><svg viewBox={`0 0 ${W} ${3 * ch + 36}`} width={W} style={{ display: 'block' }} role="img" aria-label="DP 표 f[i][s]">
    {Array.from({ length: d.LU + 1 }, (_, s) => (s % 4 === 0 || s === d.LU) ? <text key={s} x={left + s * cw + cw / 2} y={12} textAnchor="middle" fontSize={9} fill="currentColor">{s}</text> : null)}
    <text x={4} y={12} fontSize={9} fill="currentColor">s = 사용한 길이(칸)</text>
    {rows.map((name, i) => i <= showRow && <g key={i}>
      <text x={4} y={22 + i * ch + ch / 2 + 3} fontSize={9} fill="currentColor">{name.split(' ')[0]}</text>
      {Array.from({ length: d.LU + 1 }, (_, s) => {
        const v = d.f[i][s]; const on = hiPath && d.path[i] === s; const isSel = sel && sel[0] === i && sel[1] === s
        const t = v < INF ? (v - lo) / Math.max(1e-9, hi - lo) : 0
        return <g key={s} onClick={() => v < INF && onSel([i, s])} style={{ cursor: v < INF ? 'pointer' : 'default' }}>
          <rect x={left + s * cw} y={22 + i * ch} width={cw - 1} height={ch - 2} fill={v < INF ? '#3f7fd9' : 'none'} fillOpacity={v < INF ? 0.15 + 0.7 * (1 - t) : 0} stroke={isSel ? '#e67e22' : on ? '#1D9E75' : 'var(--border)'} strokeWidth={isSel || on ? 2 : 0.5} strokeDasharray={v < INF ? undefined : '2 2'}/>
          {v < INF && <text x={left + s * cw + cw / 2} y={22 + i * ch + ch / 2 + 3} textAnchor="middle" fontSize={8.5} fill="#0b1e38" fontWeight={on ? 800 : 400}>{v.toFixed(1)}</text>}
        </g> })}
    </g>)}
  </svg></div>
}

function GapPart() {
  const [u, T] = [5, 15]
  const d = useMemo(() => gapDp(u, T), [])
  const [step, setStep] = useState(0)
  const [sel, setSel] = useState<[number, number] | null>(null)
  const names = ['문제', '허용 간격', '표 f[0]', 'g0 선택 → f[1]', 'g1 선택 → f[2]', '마지막 간격', '역추적', '검증']
  const explainCell = (c: [number, number] | null) => {
    if (!c || c[0] === 0) return null
    const [i, s2] = c; const opts: Array<{ from: number; g: number; total: number; gc: number; mc: number }> = []
    for (let s = 0; s <= s2; s++) { const g = s2 - s; if (!d.allowed(g) || d.f[i - 1][s] === INF) continue
      const gc = d.gapCost(i - 1, g * u), mc = d.macroCost(d.leftEdge(i - 1, s2)); opts.push({ from: s, g, gc, mc, total: d.f[i - 1][s] + gc + mc }) }
    opts.sort((a, b) => a.total - b.total)
    return <div style={{ ...box, marginTop: 8 }}>
      <b style={{ fontSize: 12 }}>f[{i}][{s2}] = {d.f[i][s2].toFixed(2)} 는 어떻게 나왔나 — 이 칸으로 오는 경로 {opts.length}개 중 최소 선택</b>
      <div className="data-table"><table><thead><tr><th>이전 칸 s</th><th>이번 간격 g</th><th>f[{i - 1}][s]</th><th>간격 비용</th><th>매크로 {G.macros[i - 1].n} 비용</th><th>합계</th></tr></thead><tbody>
        {opts.slice(0, 5).map((o, k) => <tr key={o.from} style={k === 0 ? { fontWeight: 700, color: 'var(--success)' } : undefined}><td>{o.from}</td><td>{o.g}칸 ({o.g * u} µm)</td><td>{d.f[i - 1][o.from].toFixed(2)}</td><td>{o.gc.toFixed(2)}</td><td>{o.mc.toFixed(2)}</td><td>{o.total.toFixed(2)}</td></tr>)}
      </tbody></table></div>
      {opts.length > 5 && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>… 나머지 {opts.length - 5}개 경로는 더 큽니다. 최소 하나만 남기고(부모 기록), 나머지는 버립니다.</div>}
    </div>
  }
  const allGaps = d.gaps
  return <div>
    <p style={p}>두 번째 DP는 <b>"ADC 왼쪽, ADC–SRAM 사이, SRAM 오른쪽" 세 간격을 나누는 문제</b>입니다. 한 행 띠에서 매크로 순서가 정해져 있을 때 정확한 최적을 구합니다. 표의 칸을 클릭하면 그 값이 어떻게 나왔는지 볼 수 있습니다.</p>
    <Stepper steps={names} index={step} onChange={s => { setStep(s); setSel(null) }}/>

    {step === 0 && <div style={box}>
      <b style={{ fontSize: 13 }}>0. 문제 — 남는 가로 길이를 세 간격에 어떻게 나눌까</b>
      <GapBar gaps={[9.66, 146.29, 25.3]} u={u}/>
      <p style={{ ...p, fontSize: 12, color: 'var(--text-secondary)' }}>위 그림은 <b>실제 PPA3 실행</b>의 간격입니다: g0 = 9.66 µm(빨강, sliver → 위반), g1 ≈ 146.3 µm, g2 ≈ 25.3 µm(위반 없음). 간격 합은 아래의 L과 같습니다.</p>
      <p style={p}>코어 폭 {f1(G.coreRight - G.coreLeft)} µm에서 매크로 두 개({G.macros.map(m => `${m.n} ${m.w}`).join(', ')} µm)와 양쪽 halo({G.halo} µm × 4)를 빼면 <b>나눌 길이 L = {f1(d.L)} µm</b>가 남습니다. 이 L을 간격 3개 <b>g0 + g1 + g2 = L</b>로 나눕니다.</p>
      <ul style={ul}>
        <li><b>규칙(sliver):</b> 각 간격은 <b>0이거나 T={T} µm 이상</b>이어야 합니다. 그 사이의 좁은 틈은 tap이 못 들어가 위반이 됩니다(실제 실행의 9.66 µm가 이 경우).</li>
        <li><b>비용:</b> 매크로 사이 간격이 300 µm보다 좁으면 벌점, 매크로 위치가 PDN strap 격자에서 벗어날수록 벌점. <b>이 비용식은 알고리즘을 보이기 위한 예시</b>입니다(strap 피치 {G.strapPitch} µm, 오프셋 {G.strapOffset} µm는 실측값이 아님).</li>
        <li>길이를 {u} µm 칸으로 나눠 그립니다(L ≈ {d.LU}칸 = {d.LU * u} µm, 반올림). 정밀 계산(0.5 µm 칸)은 7단계에서 같은 결과를 확인합니다.</li>
      </ul>
      <p style={p}>가능한 조합을 전부 나열하면 후보가 많고 규칙·비용을 매번 다시 계산해야 합니다. DP는 <b>"앞에서 이미 정한 부분의 최소 비용"을 표에 저장해 재사용</b>합니다.</p>
    </div>}

    {step === 1 && <div style={box}>
      <b style={{ fontSize: 13 }}>1. 허용되는 간격 — 규칙이 후보를 먼저 자른다</b>
      <svg viewBox={`0 0 ${(d.LU + 1) * 20 + 20} 56`} width="100%" style={{ maxWidth: (d.LU + 1) * 20 + 20 }} role="img" aria-label="허용 간격 막대">
        {Array.from({ length: d.LU + 1 }, (_, g) => <g key={g}><rect x={10 + g * 20} y={10} width={19} height={22} fill={d.allowed(g) ? '#9bd3b4' : '#e57373'} fillOpacity={0.85}/>
          {(g % 3 === 0 || g === d.LU) && <text x={10 + g * 20 + 9.5} y={46} textAnchor="middle" fontSize={9} fill="currentColor">{g}</text>}</g>)}
      </svg>
      <p style={p}>간격 하나를 <b>g칸</b>({u} µm/칸)으로 정할 때 허용되는 g는 초록입니다. g=0(바짝 붙임)과 g ≥ {d.Tu}칸({d.Tu * u} µm)만 허용이고, 1~{d.Tu - 1}칸은 sliver라 <b>전이 자체를 만들지 않습니다.</b> 이게 DP의 "hard rule 가지치기"입니다.</p>
    </div>}

    {step >= 2 && step <= 5 && <div style={box}>
      <b style={{ fontSize: 13 }}>{step}. {['', '', '표의 시작 — f[0][0] = 0', '첫 간격 g0 선택 → f[1] 채우기', '둘째 간격 g1 선택 → f[2] 채우기', '마지막 간격은 나머지'][step]}</b>
      <DpTable d={d} hiPath={false} sel={sel} onSel={setSel} showRow={step === 2 ? 0 : step === 3 ? 1 : 2}/>
      {step === 2 && <p style={p}><b>f[i][s]</b>의 뜻: <b>간격 g0 … g(i−1)을 이미 정했고 그 합이 s칸일 때의 최소 비용</b>. 아직 아무 간격도 정하지 않았으니 f[0][0] = 0 하나뿐이고 나머지는 도달 불가(점선)입니다.</p>}
      {step === 3 && <><p style={p}>g0을 규칙에 맞는 값(0, {d.Tu}칸 이상)으로 정하면 s = g0이 되고, 비용은 <b>간격 비용 + ADC의 PDN 정렬 비용</b>입니다(ADC 왼쪽 가장자리가 g0에 따라 정해지므로). 도달 가능한 칸 <b>{d.reach[1]}개</b>가 채워졌고, s=1~{d.Tu - 1}은 규칙 때문에 비어 있습니다.</p></>}
      {step === 4 && <><p style={p}>이제 f[1]의 각 칸에서 g1을 더해 f[2][s']를 만듭니다. <b>같은 s'에 도달하는 길이 여러 개</b>(s, g)이면 <b>비용이 최소인 하나만 남깁니다</b>(나머지는 부모 기록에서 버림). 이것이 DP가 조합 폭발을 막는 방법입니다: 표는 {d.k + 1}행 × {d.LU + 1}칸 = {(d.k + 1) * (d.LU + 1)}칸이면 충분합니다. 도달 가능한 칸 <b>{d.reach[2]}개</b>. <b>파란 칸을 눌러 보세요.</b></p></>}
      {step === 5 && <>
        <p style={p}>마지막 간격 g2는 선택하지 않고 <b>나머지 r = {d.LU} − s</b>로 정해집니다. 이 r도 규칙(0 또는 ≥ {d.Tu}칸)을 통과해야 하고, 통과하는 s에 대해서만 <b>총 비용 = f[2][s] + 마지막 간격 비용</b>을 계산합니다. 그중 최소가 답입니다.</p>
        <div style={{ overflowX: 'auto' }}><svg viewBox={`0 0 ${(d.LU + 1) * 22 + 90} 60`} width={(d.LU + 1) * 22 + 90} style={{ display: 'block' }} role="img" aria-label="s별 총 비용">
          <text x={4} y={20} fontSize={9} fill="currentColor">총 비용</text>
          {d.finals.map((c, s) => <g key={s}><rect x={70 + s * 22} y={8} width={21} height={24} fill={c < INF ? '#3f7fd9' : 'none'} fillOpacity={c < INF ? 0.2 + 0.6 * (1 - (c - d.best) / Math.max(1e-9, Math.max(...d.finals.filter(v => v < INF)) - d.best)) : 0} stroke={s === d.bestS ? '#1D9E75' : 'var(--border)'} strokeWidth={s === d.bestS ? 2 : 0.5} strokeDasharray={c < INF ? undefined : '2 2'}/>
            {c < INF && <text x={70 + s * 22 + 10.5} y={23} textAnchor="middle" fontSize={8.5} fill="#0b1e38">{c.toFixed(1)}</text>}
            {(s % 4 === 0 || s === d.LU) && <text x={70 + s * 22 + 10.5} y={46} textAnchor="middle" fontSize={9} fill="currentColor">{s}</text>}</g>)}
        </svg></div>
        <p style={p}>총 비용이 가장 작은 칸은 <b>s = {d.bestS}</b>(비용 <b>{d.best.toFixed(2)}</b>)입니다.</p></>}
      {explainCell(sel)}
    </div>}

    {step === 6 && <div style={box}>
      <b style={{ fontSize: 13 }}>6. 역추적 — 부모 기록을 거꾸로 따라가 간격을 복원</b>
      <DpTable d={d} hiPath={true} sel={sel} onSel={setSel} showRow={2}/>
      <p style={p}>최소 비용 칸 (f[2][{d.path[2]}])에서 시작해 각 칸이 기억한 <b>이전 칸</b>을 따라 f[1][{d.path[1]}] → f[0][0]까지 올라갑니다(초록 테두리). 이전 칸과의 차이가 곧 그 간격입니다.</p>
      <div className="data-table"><table><thead><tr><th>간격</th><th>계산</th><th>값</th></tr></thead><tbody>
        <tr><td>g0 (ADC 왼쪽)</td><td>{d.path[1]} − {d.path[0]}칸</td><td><b>{f1(allGaps[0])} µm</b></td></tr>
        <tr><td>g1 (ADC–SRAM 사이)</td><td>{d.path[2]} − {d.path[1]}칸</td><td><b>{f1(allGaps[1])} µm</b></td></tr>
        <tr><td>g2 (SRAM 오른쪽)</td><td>{d.LU} − {d.path[2]}칸 (나머지)</td><td><b>{f1(allGaps[2])} µm</b></td></tr>
      </tbody></table></div>
      <GapBar gaps={allGaps} u={u}/>
      <p style={p}>세 간격이 모두 규칙(0 또는 ≥ {T} µm)을 통과하므로 <b>sliver가 없습니다.</b> 반면 실제 PPA3 실행은 g0 = 9.66 µm였습니다.</p>
    </div>}

    {step === 7 && <div style={box}>
      <b style={{ fontSize: 13 }}>7. 검증 — 전수 탐색과 같은 답인가</b>
      <div className="data-table"><table><thead><tr><th>방법</th><th>최소 비용 ({u} µm 칸)</th><th>결과</th></tr></thead><tbody>
        <tr><td>DP (표 {(d.k + 1) * (d.LU + 1)}칸)</td><td><b>{d.best.toFixed(4)}</b></td><td rowSpan={2} style={{ fontWeight: 700, color: Math.abs(d.best - d.bruteBest) < 1e-9 ? 'var(--success)' : 'var(--danger)' }}>{Math.abs(d.best - d.bruteBest) < 1e-9 ? '일치' : '불일치'}</td></tr>
        <tr><td>전수 탐색 (모든 g0, g1 조합)</td><td><b>{d.bruteBest.toFixed(4)}</b></td></tr>
      </tbody></table></div>
      <p style={p}>이 화면은 칸을 {u} µm로 거칠게 잡아 최적 간격이 <b>{allGaps.map(f1).join(' / ')} µm</b>입니다. 칸을 <b>0.5 µm</b>로 정밀하게 하면 최적 간격이 <b>32.5 / 116.5 / 32.5 µm</b>(비용 1.6535)로 <b>달라지고</b>, 그때도 전수 탐색과 비용·간격이 모두 일치했습니다(DP 122 ms, 전수 154 ms, 규칙을 통과하는 조합 38,590개; 별도 시제품 실행값). 격자가 거칠면 최적이 격자 사이로 빠지므로, <b>beam search로 거친 위상을 고른 뒤 간격 DP를 정밀 격자로 다시 돌립니다.</b></p>
      <ul style={ul}>
        <li><b>왜 정확한가:</b> 앞 간격들의 합 s만 같으면 뒤의 비용이 앞의 선택 순서와 무관하기 때문에, 같은 s는 최소 비용 하나만 기억해도 답을 잃지 않습니다(최적 부분 구조).</li>
        <li><b>복잡도:</b> 표 {d.k + 1}행 × {d.LU + 1}칸, 칸마다 최대 {d.LU + 1}가지 전이 → 매크로 2개에서 순식간입니다.</li>
        <li><b>한계:</b> 비용식과 임계값 T는 예시이며, 매크로 순서가 정해지고 비용이 간격·x에만 의존할 때 정확합니다.</li>
      </ul>
    </div>}

    <GapScore d={d}/>
  </div>
}

// 간격 DP의 비용이 어떻게 계산되는지: 최적 경로의 항목별 값을 같은 함수로 다시 계산해 d.best와 맞춰 본다.
function GapScore({ d }: { d: ReturnType<typeof gapDp> }) {
  const [s1, s2] = [d.path[1], d.path[2]], u = d.u
  const gum = d.gaps, gc = [d.gapCost(0, gum[0]), d.gapCost(1, gum[1]), d.gapCost(2, gum[2])]
  const xs = [d.leftEdge(0, s1), d.leftEdge(1, s2)], mc = xs.map(x => d.macroCost(x))
  const dist = (x: number) => { const r = (((x - G.strapOffset) % G.strapPitch) + G.strapPitch) % G.strapPitch; return Math.min(r, G.strapPitch - r) }
  const total = gc.reduce((a, v) => a + v, 0) + mc.reduce((a, v) => a + v, 0), ok = Math.abs(total - d.best) < 1e-9
  const ruleOk = gum.map(g => g === 0 || g >= d.T)
  const f3 = (x: number) => x.toFixed(3)
  return <div style={{ ...box, marginTop: 12 }}>
    <b style={{ fontSize: 13 }}>비용은 어떻게 계산되나 — 규칙(통과/탈락)과 비용(연속 값)을 따로 센다</b>
    <p style={p}>간격 DP는 <b>① 규칙(하드): 어기면 전이 자체를 만들지 않음</b>, <b>② 비용(소프트): 규칙을 통과한 조합의 합</b>으로 나뉩니다. 위 표의 최적 경로(g = {gum.map(f1).join(' / ')} µm, {u} µm 칸)를 같은 함수로 다시 풀면 다음과 같습니다.</p>
    <div className="data-table"><table><thead><tr><th>항목</th><th>식</th><th>이 경로의 값</th><th>비용</th></tr></thead><tbody>
      {gum.map((g, i) => <tr key={`r${i}`}><td>간격 g{i} 규칙</td><td>0 또는 ≥ {d.T} µm</td><td>{f1(g)} µm {ruleOk[i] ? '통과' : '탈락'}</td><td>—</td></tr>)}
      <tr><td>ADC–SRAM 간격 (g1)</td><td>max(0, 300 − (g1 + 2×halo {2 * G.halo})) × 0.01</td><td>g1 + {2 * G.halo} = {f1(gum[1] + 2 * G.halo)} µm</td><td>{f3(gc[1])}</td></tr>
      <tr><td>g0, g2 간격</td><td>비용식 없음 (규칙만)</td><td>—</td><td>{f3(gc[0] + gc[2])}</td></tr>
      {G.macros.map((m, i) => <tr key={m.n}><td>{m.n} PDN 정렬</td><td>strap(피치 {G.strapPitch}, 오프셋 {G.strapOffset})까지 거리 × 0.05</td><td>왼쪽 가장자리 x = {f1(xs[i])} µm → 거리 {f3(dist(xs[i]))} µm</td><td>{f3(mc[i])}</td></tr>)}
      <tr><td colSpan={3}><b>합계</b></td><td><b>{f3(total)}</b></td></tr>
    </tbody></table></div>
    <p style={{ ...p, fontWeight: 700, color: ok ? 'var(--success)' : 'var(--danger)' }}>합계 {total.toFixed(4)} = 표의 최소 비용 {d.best.toFixed(4)} {ok ? '✓ 일치' : '✗ 불일치'}</p>
    <b style={{ fontSize: 12 }}>beam search(게임 점수)와 무엇이 다른가</b>
    <div className="data-table"><table><thead><tr><th>관점</th><th>beam search (게임 점수, 감점 합)</th><th>간격 DP (예시 비용, 작을수록 좋음)</th></tr></thead><tbody>
      <tr><td>매크로 사이 여유</td><td>ADC–SRAM 간격이 6칸(300 µm) 미만이면 부족한 칸 × 6, 2칸(100 µm) 미만이면 +90</td><td>(간격 + 2×halo) &lt; 300 µm이면 부족 µm × 0.01. 정밀 격자에서 최적 g1 = 116.5 µm도 이 벌점 때문에 비용이 0이 되지 않음</td></tr>
      <tr><td>전원(PDN)</td><td>열 위치가 5칸 간격 전원 줄에서 1칸 이내가 아니면 +18 (거친 판정)</td><td>strap 격자(40 µm)에서 벗어난 µm × 0.05 (연속 값)</td></tr>
      <tr><td>sliver (tap 못 들어가는 좁은 틈)</td><td><b>점수에 항이 없음</b> — 한 칸이 {E.GRID_UM} µm라 그보다 좁은 틈을 표현하지 못함</td><td><b>하드 규칙</b>: 간격은 0 또는 ≥ T</td></tr>
      <tr><td>배선·높이·구멍 등</td><td>있음 (배선 proxy, 높이, 구멍, 울퉁불퉁함)</td><td>없음 — 한 행에서 매크로 순서가 고정이라 간격과 위치만 봄</td></tr>
    </tbody></table></div>
    <ul style={ul}>
      <li><b>두 값은 단위·가중치가 달라 서로 더하거나 비교할 수 없습니다.</b> 간격 DP의 비용식은 알고리즘을 보이기 위한 <b>예시</b>이며, 게임 점수는 칸(50 µm) 단위 proxy입니다(0.12 점/µm 정도의 기울기 대 0.01).</li>
      <li>그래서 역할을 나눕니다: beam search가 <b>거친 위치와 순서</b>를 고르고, 간격 DP가 <b>정밀 간격</b>에서 sliver 같은 게임 점수가 못 보는 규칙을 하드 규칙으로 보장합니다.</li>
    </ul>
  </div>
}

export default function DpStepByStep() {
  const [part, setPart] = useState<'beam' | 'gap'>('beam')
  return <div>
    <p style={p}>탐색을 두 부분(<b>beam search</b>와 정확한 <b>간격 DP</b>)으로 나눠 <b>그림과 함께 한 단계씩</b> 설명합니다. 위의 유사 코드 ①, ②에 각각 대응합니다.</p>
    <div className="analog-tabs" role="tablist" aria-label="탐색 종류" style={{ marginBottom: 8 }}>
      <button type="button" role="tab" aria-selected={part === 'beam'} className={part === 'beam' ? 'active' : ''} onClick={() => setPart('beam')}>A. beam search — 블록을 하나씩 놓기 (정확하지 않음)</button>
      <button type="button" role="tab" aria-selected={part === 'gap'} className={part === 'gap' ? 'active' : ''} onClick={() => setPart('gap')}>B. 간격 DP — 규칙 아래 간격 나누기 (정확)</button>
    </div>
    {part === 'beam' ? <BeamPart/> : <GapPart/>}
  </div>
}
