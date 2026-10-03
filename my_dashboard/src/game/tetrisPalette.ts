// Macro Tetris / Macro Area Tetris 캔버스가 같이 쓰는 영역 색.
//
// 어두운 남색 배경 위에서 "표준셀을 넣을 수 있는 남은 공간"과 "이미 배치된 표준셀
// 타일"이 둘 다 반투명 초록/보라라 구분이 안 됐다. 색만으로 구분하지 않도록(1) 서로
// 먼 색상, (2) 비어 있는 공간은 빗금(투명 바탕 + 선), 배치된 타일은 불투명 단색으로
// 질감 자체를 다르게 했다 — 비어 있다 = 빗금, 채워졌다 = 꽉 찬 색.
//
//   매크로(점유)            연한 파랑, 단색          (기존 그대로)
//   표준셀 넣기 좋은 여유   청록 + 우상향 빗금       빈 공간, 정사각형 규칙으로 바로 쓸 수 있음
//   조각난 여유             호박색 + 격자 빗금       빈 공간, 조각나서 쓰기 어려움
//   표준셀 타일(배치됨)     자홍 단색 + 흰 테두리    실제로 채워진 표준셀 영역
export type FreeKind = 'usable' | 'fragmented'

export const TETRIS_COLORS = {
  usable: { fill: 'rgba(0,200,210,0.13)', line: 'rgba(70,235,240,0.70)', swatch: '#46EBF0' },
  fragmented: { fill: 'rgba(255,165,0,0.20)', line: 'rgba(255,196,64,0.85)', swatch: '#FFC440' },
  tile: { fill: 'rgba(222,60,250,0.92)', border: '#FFFFFF', text: '#2A0034', swatch: '#DE3CFA' },
} as const

const patternCache = new WeakMap<CanvasRenderingContext2D, Partial<Record<FreeKind, CanvasPattern>>>()

// 8×8 타일을 만들어 캔버스 전체에 반복 — 칸 하나(약 19px)보다 촘촘해서 인접한 칸이
// 이어진 한 덩어리 빗금으로 보인다.
function hatchPattern(ctx: CanvasRenderingContext2D, kind: FreeKind): CanvasPattern | null {
  const cached = patternCache.get(ctx)?.[kind]
  if (cached) return cached
  const t = document.createElement('canvas')
  t.width = 8; t.height = 8
  const g = t.getContext('2d')
  if (!g) return null
  g.strokeStyle = TETRIS_COLORS[kind].line
  g.lineWidth = 1.2
  g.beginPath()
  g.moveTo(-1, 9); g.lineTo(9, -1)
  g.moveTo(-1, 1); g.lineTo(1, -1)
  g.moveTo(7, 9); g.lineTo(9, 7)
  if (kind === 'fragmented') { g.moveTo(-1, -1); g.lineTo(9, 9) }
  g.stroke()
  const p = ctx.createPattern(t, 'repeat')
  if (!p) return null
  const entry = patternCache.get(ctx) ?? {}
  entry[kind] = p
  patternCache.set(ctx, entry)
  return p
}

export function drawFreeCell(ctx: CanvasRenderingContext2D, kind: FreeKind, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = TETRIS_COLORS[kind].fill
  ctx.fillRect(x, y, w, h)
  const p = hatchPattern(ctx, kind)
  if (p) { ctx.fillStyle = p; ctx.fillRect(x, y, w, h) }
}

export function drawTileBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = TETRIS_COLORS.tile.fill
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2)
  ctx.strokeStyle = TETRIS_COLORS.tile.border
  ctx.lineWidth = 1.5
  ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3)
}

// 범례 칩용 CSS — 캔버스와 같은 질감(빗금 vs 단색)을 그대로 보여준다.
export const LEGEND_SWATCH: Record<'usable' | 'fragmented' | 'tile', Record<string, string | number>> = {
  usable: { display: 'inline-block', width: 14, height: 10, borderRadius: 2, marginRight: 4, border: `1px solid ${TETRIS_COLORS.usable.line}`, background: `repeating-linear-gradient(135deg, ${TETRIS_COLORS.usable.line} 0 1.5px, ${TETRIS_COLORS.usable.fill} 1.5px 5px)` },
  fragmented: { display: 'inline-block', width: 14, height: 10, borderRadius: 2, marginRight: 4, border: `1px solid ${TETRIS_COLORS.fragmented.line}`, background: `repeating-linear-gradient(135deg, ${TETRIS_COLORS.fragmented.line} 0 1.5px, ${TETRIS_COLORS.fragmented.fill} 1.5px 5px), repeating-linear-gradient(45deg, ${TETRIS_COLORS.fragmented.line} 0 1.5px, transparent 1.5px 5px)` },
  tile: { display: 'inline-block', width: 14, height: 10, borderRadius: 2, marginRight: 4, border: '1.5px solid #fff', outline: '1px solid #888', background: TETRIS_COLORS.tile.fill },
}
