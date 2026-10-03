// Macro Tetris / Macro Area Tetris 캔버스가 같이 쓰는 영역 색.
//
// 어두운 남색 배경 위에서 "표준셀을 넣을 수 있는 남은 공간"과 "이미 배치된 표준셀
// 타일"이 둘 다 반투명 초록/보라라 구분이 안 됐다. 색만으로 구분하지 않도록(1) 서로
// 먼 색상, (2) 비어 있는 공간은 빗금(투명 바탕 + 선), 배치된 타일은 불투명 단색으로
// 질감 자체를 다르게 했다 — 비어 있다 = 빗금, 채워졌다 = 꽉 찬 색.
//
//   매크로(점유)            연한 파랑, 단색          (기존 그대로)
//   표준셀 넣기 좋은 여유   연한 초록 + 성긴 / 빗금   빈 공간, 정사각형 규칙으로 바로 쓸 수 있음
//   조각난 여유             연한 호박색 + 성긴  빗금  빈 공간, 조각나서 쓰기 어려움
//   표준셀 타일(배치됨)     자홍 단색 + 흰 테두리    실제로 채워진 표준셀 영역
export type FreeKind = 'usable' | 'fragmented'

export const TETRIS_COLORS = {
  usable: { fill: 'rgba(60,200,120,0.07)', line: 'rgba(110,225,150,0.50)', swatch: '#6EE196' },
  fragmented: { fill: 'rgba(255,165,0,0.10)', line: 'rgba(255,190,70,0.60)', swatch: '#FFBE46' },
  tile: { fill: 'rgba(222,60,250,0.92)', border: '#FFFFFF', text: '#2A0034', swatch: '#DE3CFA' },
} as const

const patternCache = new WeakMap<CanvasRenderingContext2D, Partial<Record<FreeKind, CanvasPattern>>>()

// 10×10 타일을 만들어 캔버스 전체에 반복 — 칸 하나(약 19px)보다 촘촘해서 인접한 칸이
// 이어진 한 덩어리 빗금으로 보인다.
function hatchPattern(ctx: CanvasRenderingContext2D, kind: FreeKind): CanvasPattern | null {
  const cached = patternCache.get(ctx)?.[kind]
  if (cached) return cached
  const t = document.createElement('canvas')
  t.width = 10; t.height = 10
  const g = t.getContext('2d')
  if (!g) return null
  g.strokeStyle = TETRIS_COLORS[kind].line
  g.lineWidth = 1
  g.beginPath()
  if (kind === 'usable') {
    // 우상향 '/' 성긴 빗금
    g.moveTo(-1, 11); g.lineTo(11, -1)
  } else {
    // 좌상향 역사선 — 그물 격자 대신 한 방향만 써서 덜 답답하게(usable과 방향·색 모두 다름)
    g.moveTo(-1, -1); g.lineTo(11, 11)
  }
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

// 캔버스 바탕색(어두운 남색). 범례 칩은 밝은 페이지 위에 그려지므로 같은 바탕을 깔아야
// 캔버스에서 보이는 색과 일치한다.
export const CANVAS_BACKDROP = '#101726'

// 범례 칩용 CSS — 캔버스와 같은 질감(빗금 vs 단색)을 그대로 보여준다.
export const LEGEND_SWATCH: Record<'usable' | 'fragmented' | 'tile', Record<string, string | number>> = {
  usable: { display: 'inline-block', width: 20, height: 12, borderRadius: 2, marginRight: 4, border: `1px solid ${TETRIS_COLORS.usable.line}`, background: `repeating-linear-gradient(135deg, ${TETRIS_COLORS.usable.line} 0 1px, ${TETRIS_COLORS.usable.fill} 1px 5px), ${CANVAS_BACKDROP}` },
  fragmented: { display: 'inline-block', width: 20, height: 12, borderRadius: 2, marginRight: 4, border: `1px solid ${TETRIS_COLORS.fragmented.line}`, background: `repeating-linear-gradient(45deg, ${TETRIS_COLORS.fragmented.line} 0 1px, ${TETRIS_COLORS.fragmented.fill} 1px 5px), ${CANVAS_BACKDROP}` },
  tile: { display: 'inline-block', width: 20, height: 12, borderRadius: 2, marginRight: 4, border: '1.5px solid #fff', outline: '1px solid #888', background: `linear-gradient(${TETRIS_COLORS.tile.fill}, ${TETRIS_COLORS.tile.fill}), ${CANVAS_BACKDROP}` },
}
