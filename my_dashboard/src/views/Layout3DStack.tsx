import { useState, type CSSProperties } from 'react'

type View = 'iso' | 'top' | 'side'
type Piece = 'pmos' | 'nmos' | 'tap' | 'dummy'
const layers = [
  { name: 'met5', z: 156, color: '#f6c445', direction: '가로', pitch: '3.40 µm', width: '1.60 µm', use: '상위 전원망·클럭' },
  { name: 'met4', z: 126, color: '#a86cf4', direction: '세로', pitch: '0.92 µm', width: '0.30 µm', use: '수직 전원망(PDN)' },
  { name: 'met3', z: 96, color: '#31b7a4', direction: '가로', pitch: '0.68 µm', width: '0.30 µm', use: '신호·IO 가로 배선' },
  { name: 'met2', z: 66, color: '#e45ba6', direction: '세로', pitch: '0.46 µm', width: '0.14 µm', use: '신호·IO 세로 배선' },
  { name: 'met1', z: 36, color: '#4596ef', direction: '가로', pitch: '0.34 µm', width: '0.14 µm', use: '표준셀 내부·전원 rail' },
  { name: 'li1', z: 13, color: '#df7452', direction: '세로', pitch: '0.46 × 0.34 µm', width: '0.17 µm', use: '소자 가까운 로컬 연결' },
] as const
const views: Record<View, string> = { iso: 'rotateX(58deg) rotateZ(-38deg)', top: 'rotateX(0deg)', side: 'rotateX(82deg)' }
const mustRules = [
  ['폭·간격', '각 층의 minimum width/spacing과 넓은 금속의 추가 spacing 준수'],
  ['비아·인클로저', '인접 금속층만 연결하고 위·아래 금속이 비아를 충분히 감쌈'],
  ['웰·탭', 'PMOS=N-well, NMOS=P-sub/P-well, well/substrate tap 주기 준수'],
  ['전원·신뢰성', 'PG 폭, via array, IR drop, current density와 EM 한계 확인'],
  ['안테나·밀도', 'gate antenna ratio와 metal density/fill(CMP) 검사'],
  ['사인오프', 'DRC 0, LVS 일치, open/short 0 후에만 제조 데이터 출력'],
] as const

function MetalStack() {
  const [view, setView] = useState<View>('iso')
  const [exploded, setExploded] = useState(true)
  const [selected, setSelected] = useState('met5')
  const active = layers.find(x => x.name === selected) ?? layers[0]
  return <section className="layout3d-section">
    <div className="layout3d-heading"><div><small>SKY130 PHYSICAL STACK</small><h3>배선층 3D 구조</h3></div><span>RT_MIN met1 · RT_MAX met5</span></div>
    <p className="layout3d-intro">트랜지스터 위에 <b>li1 → met1…met5</b>가 비아로 이어지는 2.5D 구조입니다. 층을 눌러 실제 tech LEF 규칙을 확인할 수 있습니다.</p>
    <div className="layout3d-controls"><div className="layout-pills">{([['iso','등각'],['top','위'],['side','측면']] as const).map(([id,label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>{label}</button>)}</div><button className="game-action" onClick={() => setExploded(x => !x)}>{exploded ? '층 합치기' : '층 펼치기'}</button></div>
    <div className="layout3d-grid"><div className="chip-stage"><div className="chip-stack" style={{ transform: views[view] }}>
      <div className="device-plane"><span>NMOS · PMOS / poly / diffusion</span></div>
      {layers.slice().reverse().map((layer, index) => <button key={layer.name} className={`metal-plane ${layer.direction === '세로' ? 'vertical' : 'horizontal'} ${selected === layer.name ? 'selected' : ''}`} style={{ '--layer-color': layer.color, transform: `translate3d(-50%,-50%,${exploded ? layer.z : 13 + index * 11}px)` } as CSSProperties} onClick={() => setSelected(layer.name)}><span>{layer.name}</span></button>)}
      {[26,54,84,114,144].map(z => <i key={z} className="via-column" style={{ transform: `translate3d(-50%,-50%,${exploded ? z : 18 + z / 3}px)` }}/>)}
    </div></div><div className="layer-inspector"><b style={{ color: active.color }}>{active.name}</b><span>{active.use}</span><dl><div><dt>선호 방향</dt><dd>{active.direction}</dd></div><div><dt>라우팅 피치</dt><dd>{active.pitch}</dd></div><div><dt>최소 폭</dt><dd>{active.width}</dd></div></dl><p>설치된 <code>sky130_fd_sc_hd__nom.tlef</code> 기준. 선호 방향은 라우터 기본 방향이며 절대 금지는 아닙니다.</p></div></div>
  </section>
}

const ROWS = 12, COLS = 20
function makeLevel(level: number): Array<Piece | null> {
  return Array.from({ length: ROWS * COLS }, (_, i) => {
    const row = Math.floor(i / COLS), col = i % COLS
    if ((i * 7 + level * 11) % 9 < 3) return null
    if (col % 10 === 0) return 'tap'
    return row < ROWS / 2 ? 'pmos' : 'nmos'
  })
}
function PlacementGame() {
  const [level, setLevel] = useState(1)
  const [board, setBoard] = useState<Array<Piece | null>>(() => makeLevel(1))
  const [piece, setPiece] = useState<Piece>('pmos')
  const [score, setScore] = useState(0)
  const [message, setMessage] = useState('빈 슬롯을 선택해 규칙에 맞는 소자를 놓으세요.')
  const [deviceCount, setDeviceCount] = useState(2048)
  const placed = board.filter(Boolean).length
  const represented = Math.round(placed / board.length * deviceCount)
  const place = (index: number) => {
    const row = Math.floor(index / COLS), col = index % COLS
    if (board[index]) { setMessage('⛔ 이미 사용 중인 슬롯입니다 — overlap 금지.'); setScore(s => Math.max(0, s - 5)); return }
    if (piece === 'pmos' && row >= ROWS / 2) { setMessage('⛔ PMOS는 N-well(위쪽)에만 배치할 수 있습니다.'); setScore(s => Math.max(0, s - 5)); return }
    if (piece === 'nmos' && row < ROWS / 2) { setMessage('⛔ NMOS는 P-sub/P-well(아래쪽)에만 배치할 수 있습니다.'); setScore(s => Math.max(0, s - 5)); return }
    if (piece === 'tap' && col % 5 !== 0) { setMessage('⛔ tap은 전원 rail과 연결되는 지정 열에 놓으세요.'); setScore(s => Math.max(0, s - 3)); return }
    const next = [...board]; next[index] = piece; setBoard(next)
    setScore(s => s + (piece === 'tap' ? 20 : 10)); setMessage(`✅ ${piece.toUpperCase()} 합법 배치 — spacing/overlap 검사 통과`)
  }
  const nextLevel = () => { const n = level + 1; setLevel(n); setBoard(makeLevel(n)); setScore(0); setMessage(`LEVEL ${n}: 새로운 netlist 배치 시작`) }
  return <section className="tetris-section">
    <div className="game-hud"><div><small>TRANSISTOR TETRIS</small><b>LEVEL {level}</b></div><div><span>SCORE</span><strong>{score.toLocaleString()}</strong></div><div><span>DRC</span><strong className="pass-text">0</strong></div></div>
    <p className="layout3d-intro">수천 개 소자는 클러스터로 압축 표시합니다. 조각을 고른 뒤 빈 칸을 누르면 overlap, well, tap 위치를 즉시 검사합니다.</p>
    <div className="game-toolbar"><div className="piece-palette">{(['pmos','nmos','tap','dummy'] as Piece[]).map(x => <button key={x} className={`${x} ${piece === x ? 'selected' : ''}`} onClick={() => setPiece(x)}><i/>{x.toUpperCase()}</button>)}</div><label>규모 <select value={deviceCount} onChange={e => setDeviceCount(Number(e.target.value))}><option>1024</option><option>2048</option><option>4096</option></select></label><button className="game-action" onClick={nextLevel}>새 레벨</button></div>
    <div className="tetris-grid"><div className="placement-board"><div className="well-label nwell">N-WELL · PMOS ZONE</div><div className="well-label pwell">P-SUB / P-WELL · NMOS ZONE</div><div className="power-rail vdd">VDD</div><div className="placement-cells">{board.map((cell, i) => <button key={i} className={cell ? `device-cluster ${cell}` : 'device-slot'} onClick={() => place(i)} title={cell ?? 'empty slot'}/>)}</div><div className="power-rail vss">VSS</div></div><div className="game-panel"><strong>{represented.toLocaleString()} / {deviceCount.toLocaleString()}</strong><span>표현된 transistor · {placed}/{board.length} clusters</span><div className="game-message">{message}</div><ul><li>PMOS는 위 N-well</li><li>NMOS는 아래 P-well/substrate</li><li>같은 칸 중복 배치 금지</li><li>tap은 지정 열에 주기적으로 배치</li></ul><p>실제 placer는 이 검사를 공간 인덱스와 legalizer로 수천~수백만 소자에 적용합니다.</p></div></div>
  </section>
}

const cells = {
  inv: { name: 'INV (인버터)', p: 1, n: 1, pins: 'A → Y', desc: 'PMOS 1 + NMOS 1. 입력을 반전하는 가장 작은 논리셀.' },
  nand: { name: 'NAND2', p: 2, n: 2, pins: 'A, B → Y', desc: 'PMOS 병렬 + NMOS 직렬. 두 입력이 모두 1일 때만 0.' },
  dff: { name: 'DFF', p: 6, n: 6, pins: 'D, CLK → Q', desc: 'latch 두 단계와 clock inverter로 상태 1 bit를 저장. 실제 transistor 수는 라이브러리 셀별로 다름.' },
} as const
function StandardCellAnatomy() {
  const [cell, setCell] = useState<keyof typeof cells>('inv'), c = cells[cell]
  return <section className="standard-cell-section">
    <div className="layout3d-heading"><div><small>STANDARD CELL ANATOMY</small><h3>표준셀은 어떻게 구성되는가</h3></div><span>고정 높이 · 가변 폭</span></div>
    <div className="layout-pills cell-tabs">{(Object.keys(cells) as Array<keyof typeof cells>).map(id => <button key={id} className={cell === id ? 'active' : ''} onClick={() => setCell(id)}>{cells[id].name}</button>)}</div>
    <div className="cell-anatomy-grid"><div className="cell-cutaway"><div className="cell-rail top">VPWR / VDD · met1</div><div className="cell-zone p"><b>N-WELL</b>{Array.from({length:c.p},(_,i)=><i key={`p${i}`}>P</i>)}</div><div className="poly-gates">{Array.from({length:Math.max(c.p,c.n)},(_,i)=><i key={i}/>)}</div><div className="cell-zone n"><b>P-SUB</b>{Array.from({length:c.n},(_,i)=><i key={`n${i}`}>N</i>)}</div><div className="cell-rail bottom">VGND / VSS · met1</div></div><div className="cell-explain"><h4>{c.name}</h4><p>{c.desc}</p><dl><div><dt>논리 핀</dt><dd>{c.pins}</dd></div><div><dt>내부</dt><dd>active/diffusion + poly gate + contact/li1</dd></div><div><dt>외부 연결</dt><dd>met1 pin, 상위층 routing</dd></div><div><dt>배치 기준</dt><dd>row에 snap, abut 가능, VDD/VSS rail 정렬</dd></div></dl></div></div>
    <p className="signoff-note"><b>핵심:</b> 디지털 P&amp;R은 raw transistor가 아니라 PDK에서 DRC/LVS·타이밍·전력 특성화가 끝난 표준셀을 테트리스처럼 배치합니다. 아날로그 full-custom만 transistor/finger를 직접 배열하고 matching 제약을 추가합니다.</p>
  </section>
}
export default function Layout3DStack() {
  return <div className="layout-lab"><MetalStack/><PlacementGame/><StandardCellAnatomy/><section className="manufacturing-rules"><div className="layout3d-heading"><div><small>MANUFACTURING GATES</small><h3>제조 전에 반드시 통과할 규칙</h3></div><span>PDK DRC deck가 최종 기준</span></div><div className="rule-grid">{mustRules.map(([title,text],i)=><div key={title}><i>{i+1}</i><p><b>{title}</b><span>{text}</span></p></div>)}</div><p className="signoff-note"><b>주의:</b> 게임의 DRC 0은 교육용 내부 검사입니다. 실제 제조 가능 판정은 추출한 GDS에 Magic/KLayout DRC, Netgen LVS, antenna·density·IR/EM 검사를 수행한 결과로 확정합니다.</p></section></div>
}
