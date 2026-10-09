// "Standard Cells" 탭 — sky130A PDK의 표준셀을 전부 버튼으로 나열하고, 누른 셀의
//  · 기능(liberty 불리언 함수 + 설명)  · 구성(크기·면적·핀·트랜지스터)
//  · 회로도(PDK의 실제 SPICE 넷리스트로 그림)  · 레이아웃(PDK의 실제 GDS를 KLayout으로 렌더)
//  · LEF 뷰(핀이 셀 안 어디에 있는지) 를 한 번에 보여준다.
// 데이터는 전부 PDK 파일에서 뽑은 것이다 — tools/gen_std_cell_catalog.py(목록·크기·chan_top 사용량),
// gen_std_cell_devices.py(SPICE), gen_std_cell_info.py(liberty·LEF·techlef),
// tools/wsl/66_render_std_cell_layouts.sh(GDS→PNG). 손으로 적은 숫자 없음.
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import catalog from '../data/sky130_std_cells.json'
import pdk from '../data/sky130_pdk_info.json'
import nonStd from '../data/non_std_cells.json'
import { REAL_GLUE, REAL_GLUE_OTHER_PURPOSE, REAL_GLUE_OTHER_PURPOSE_CELLS, REAL_CHAN_TOP } from '../game/macroTetrisModel'
import PdkChangeExperiment from './PdkChangeExperiment'
import ComplexStandardCellExperiment from './ComplexStandardCellExperiment'

type Variant = { drive: number; w: number; area: number; timing: boolean | null }
type Group = { base: string; category: string; variants: Variant[] }
type Lib = { id: string; label: string; lefCells: number; libertyCells: number | null; functions: number; rowHeight: number; noTiming: string[]; groups: Group[] }
type Pin = { n: string; dir: string; use: string; fn: string | null; cap: number | null; rects: [string, number, number, number, number][] }
type Dev = { n: string; m: string; nets: string[]; w: number; l: number }
type CellData = { ports: string[]; devices: Dev[]; info: { size: [number, number] | null; site: string | null; sym: string | null; area: number | null; footprint: string | null; leak: number | null; desc: string; pins: Pin[] } }

const CATEGORY: Record<string, { label: string; color: string; desc: string }> = {
  logic: { label: '조합 논리', color: '#378ADD', desc: 'AND·OR·NAND·NOR·XOR·AOI·OAI 등 게이트' },
  buffer: { label: '버퍼·인버터·지연', color: '#1D9E75', desc: 'buf·inv·clkbuf·clkinv·dlygate·tri-state' },
  sequential: { label: '플립플롭·래치', color: '#7F77DD', desc: 'DFF·latch·scan FF·clock gate' },
  'mux-adder': { label: 'MUX·가산기', color: '#E6784E', desc: 'mux2/4·half/full adder·majority' },
  'low-power': { label: '저전력(lpflow)', color: '#C0A02B', desc: 'isolation·level shift·power-gated 셀' },
  physical: { label: '물리 전용', color: '#888780', desc: 'tap·fill·decap·diode·tie(conb)·sparecell — 로직이 아님' },
}
const LAYER_COLOR: Record<string, string> = { li1: '#1D9E75', met1: '#378ADD', met2: '#E6784E', nwell: '#9bd3a8', pwell: '#e3c9a6' }

const libs = catalog.libs as unknown as Lib[]
const usage = catalog.usage as { design: string; source: string; totalCells: number; area: number; distinctTypes: number; rows: { cell: string; count: number }[] } | null
const fmt = (n: number) => n.toLocaleString()
const isP = (m: string) => m.includes('pfet')
const isN = (m: string) => m.includes('nfet')

// 배치(P&R)와 그 앞뒤에서 자주 만나는 약어 — [분류, 약어, Full name, 쉬운 설명, 이 프로젝트에서].
// "이 프로젝트에서"는 실제 실행 로그·final/ 폴더·config에서 본 값만 적는다.
const ABBR_GROUPS = ['파일 형식', '배치·배선 단계', '검증 (signoff)', '타이밍', '셀·공정', '탐색 기법'] as const
const ABBREVIATIONS: ReadonlyArray<readonly [(typeof ABBR_GROUPS)[number], string, string, string, string]> = [
  ['파일 형식', 'LEF', 'Library Exchange Format', '부품 카탈로그. 셀·매크로의 외곽 크기, 핀 위치, 배선 금지 영역(OBS), 금속층 규칙', 'chan_top.lef = SIZE 800×800 µm. 상위(daq_subsystem)는 이 LEF만 보고 배치'],
  ['파일 형식', 'DEF', 'Design Exchange Format', '배치도. 다이 크기, 인스턴스 좌표·방향(COMPONENTS), IO 핀(PINS), 연결(NETS)', '단계마다 저장됨. 13번(floorplan) DEF는 IO 핀 좌표가 미확정, 24번(ioplacement)부터 FIXED 좌표'],
  ['파일 형식', 'GDS (GDSII)', 'Graphic Data System II', '제조용 마스크 도형(층별 다각형). DRC·XOR의 검사 대상', 'final/gds/chan_top.gds. 상위 칩은 8개 매크로 GDS + 배선 도형으로 조립'],
  ['파일 형식', 'SPEF', 'Standard Parasitic Exchange Format', 'PEX가 뽑은 넷별 기생 저항(R)·커패시턴스(C). STA가 읽어 실제 배선 지연을 계산', 'final/spef/min · nom · max 세 가지 (MACROS.spef에 연결)'],
  ['파일 형식', 'SDC', 'Synopsys Design Constraints', '타이밍 제약. 클럭 주기, IO 지연 예산, false path, max delay 등', 'constraints/chan_top.sdc (src 14 ns / axi 52 ns), daq_subsystem.sdc'],
  ['파일 형식', 'SDF', 'Standard Delay Format', '셀·배선 지연값을 담은 파일. 지연을 반영한 게이트 레벨 시뮬레이션에 사용', 'final/sdf'],
  ['파일 형식', 'Liberty (.lib)', '약어 아님 — 파일 형식 이름', '셀의 기능과 PVT 코너별 타이밍·전력 모델. 합성·STA가 읽음', '표준셀 lib + 매크로 lib(chan_top__<코너>.lib, 코너 9개)'],
  ['파일 형식', 'SPICE / CDL', 'Simulation Program with Integrated Circuit Emphasis / Circuit Description Language', '트랜지스터 단위 회로. LVS에서 레이아웃에서 추출한 회로와 비교하는 기준', 'final/spice. Netgen LVS의 비교 대상'],
  ['파일 형식', 'NL / PNL', 'Netlist / Powered Netlist', '게이트 연결 목록. PNL은 전원(VPWR/VGND) 핀까지 연결한 버전', 'final/nl/chan_top.nl.v, final/pnl'],
  ['파일 형식', 'VH', 'Verilog Header', '포트 목록만 있는 블랙박스 스텁. 상위 합성이 매크로 내부를 다시 합성하지 않게 함', 'final/vh/chan_top.vh — MACROS의 vh로 연결돼 daq_subsystem 합성이 chan_top을 블랙박스로 읽음'],
  ['파일 형식', 'ODB', 'OpenDB (OpenROAD 내부 DB)', '배치·배선 상태를 통째로 담는 OpenROAD 데이터베이스', '단계 폴더마다 .odb가 저장되어 체크포인트 재개(--from)의 출발점이 됨'],

  ['배치·배선 단계', 'P&R', 'Place and Route', '셀·매크로를 놓고(Place) 금속 배선으로 잇는(Route) 물리 설계 전체', 'OpenLane 단계 13~55번이 이 구간'],
  ['배치·배선 단계', 'PDN', 'Power Distribution Network', 'VDD/GND를 칩 전체에 공급하는 굵은 금속 격자(스트랩)', 'FP_PDN_VERTICAL_LAYER = met4, HORIZONTAL = met5 (chan_top resolved.json)'],
  ['배치·배선 단계', 'TAP', 'Well Tap Cell', '웰·기판 전위를 주기적으로 잡아 래치업을 막는 셀. 표준셀 행 사이에 일정 간격으로 삽입', '18번 TapEndcapInsertion. 매크로가 미배치면 TAP-0032 경고'],
  ['배치·배선 단계', 'GPL / GP', 'Global Placement', '셀의 대략적 위치를 정하는 전역 배치. 겹침을 허용한 채 배선 길이를 줄임', '27번. chan_top 2분 6초. 엔진은 RePlAce(OpenROAD 전역 배치기 이름)'],
  ['배치·배선 단계', 'DPL / DP', 'Detailed Placement (legalization)', '전역 배치 결과를 행·사이트 격자에 겹침 없이 정렬(합법화)', '33번. DPL-0036 = 합법화 실패 (macrotetris v1이 hold 버퍼를 못 놓고 실패)'],
  ['배치·배선 단계', 'CTS', 'Clock Tree Synthesis', '클럭을 모든 플립플롭에 비슷한 지연으로 나눠주는 버퍼 트리 생성', '34번. chan_top 53초'],
  ['배치·배선 단계', 'RSZ', 'Resizer (OpenROAD 타이밍 리페어 엔진)', '버퍼 삽입·셀 교체·핀 스왑으로 setup/hold 위반을 수리', '36번 ResizerTimingPostCTS가 22~52분. RSZ-0062 = setup 위반을 다 못 고침'],
  ['배치·배선 단계', 'GRT / GR', 'Global Routing', '배선의 대략 경로(어느 구역·층으로 갈지)를 먼저 정함. 용량 초과면 혼잡 실패', '38번. GRT-0118 "Routing congestion too high" = macrotetris v2 실패'],
  ['배치·배선 단계', 'DRT', 'Detailed Routing (TritonRoute)', '실제 금속 도형으로 배선 확정. DRC 규칙을 지키며 짬', '43번. 8코어를 거의 다 씀'],
  ['배치·배선 단계', 'HPWL', 'Half-Perimeter WireLength', '넷을 감싸는 최소 사각형의 반둘레. 배치 단계에서 배선 길이를 싸게 추정하는 표준 지표', 'Macro Tetris의 WL은 신호 그룹 허브까지의 가중 맨해튼 거리 근사(HPWL과 같은 계열)'],
  ['배치·배선 단계', 'WL', 'WireLength', '배선 길이. 짧을수록 지연·전력·혼잡이 유리', '다만 WL만 줄이면 채널이 좁아져 실패한 사례(v1·v2)가 있음'],
  ['배치·배선 단계', 'Util', 'Utilization', '셀 면적 ÷ 코어 면적. 높을수록 빽빽해 라우팅이 어려움', 'chan_top 실측 52%. 이 탭 기준 매크로 내부 util ≤70%'],
  ['배치·배선 단계', 'OBS', 'Obstruction', 'LEF에서 "여기엔 배선하지 마라"고 표시한 영역(매크로 내부 등)', 'GRT 로그의 Blockages 수에 반영'],
  ['배치·배선 단계', 'ECO', 'Engineering Change Order', 'signoff 근처에서 작은 변경만 국소적으로 반영하는 수정 방식', 'OpenLane 표준 flow엔 없음 — 변경 시 전체 재실행 또는 체크포인트 재개'],

  ['검증 (signoff)', 'DRC', 'Design Rule Check', '제조 규칙(최소 폭·간격·덮임 등) 위반 검사', 'Magic DRC + KLayout DRC 이중 검사. 12배 큰 칩이라 시간이 오래 걸림'],
  ['검증 (signoff)', 'LVS', 'Layout Versus Schematic', '레이아웃에서 추출한 회로가 원래 회로(SPICE)와 같은지 비교', 'Netgen LVS'],
  ['검증 (signoff)', 'ERC', 'Electrical Rule Check', '전기적 규칙(플로팅 입력, 전원 연결 등) 검사', 'OpenLane에서는 Disconnected Pins(47~48번)·Illegal Overlap(67번) 체크가 비슷한 역할'],
  ['검증 (signoff)', 'XOR', 'eXclusive OR (두 GDS의 도형 차이 비교)', 'Magic과 KLayout이 각각 만든 GDS를 겹쳐서 다른 도형이 없는지 확인', '60~61번 KLayout XOR / XOR checker'],
  ['검증 (signoff)', 'PEX / RCX', 'Parasitic EXtraction / Resistance-Capacitance eXtraction', '실제 배선 모양에서 기생 R·C를 뽑는 단계(RCX는 OpenROAD의 PEX 엔진)', '53번 RCX 1분 11초 → 54번 최종 STA가 SPEF를 읽음'],
  ['검증 (signoff)', 'IR drop', 'I × R drop', '전원망 저항 때문에 셀에 도달하는 전압이 떨어지는 현상', '55번 IRDropReport'],

  ['타이밍', 'STA', 'Static Timing Analysis', '시뮬레이션 없이 모든 경로의 지연을 계산해 클럭 주기를 만족하는지 검사', '12·30·35·37·42·54번에서 단계별로 수행'],
  ['타이밍', 'PVT', 'Process, Voltage, Temperature', '공정 편차·전압·온도 조합 = 코너. 코너마다 지연이 달라 전부 검사', '9개 코너 (min/nom/max 배선 RC × tt/ss/ff 트랜지스터). 셀 지연에는 전압 영향이 가장 크고 온도 영향은 작음 (Evolution SA 배경 지식 16절)'],
  ['타이밍', 'TT / SS / FF', 'Typical-Typical / Slow-Slow / Fast-Fast', 'NMOS·PMOS 속도 코너. SS는 가장 느려 setup에, FF는 가장 빨라 hold에 불리', '코너 이름 예: nom_ss_100C_1v60 = nom RC, SS, 100°C, 1.60V. 공정 편차는 파운드리가 정하고, 온도·전압은 그 공정과 짝지어진 동작 조건. 지연 셀 dlygate4sd3_1은 ss 1.11ns로 ff 0.38ns의 약 2.9배'],
  ['타이밍', 'OCV / Derating', 'On-Chip Variation / Derating', '같은 칩 안에서 셀마다 속도가 다른 것. 지연에 비율을 곱해 비관적으로 계산해 덮음', 'TIME_DERATING_CONSTRAINT = 5(%). 공정 코너·clock uncertainty와 별개 마진'],
  ['타이밍', 'WNS / TNS / WS', 'Worst Negative Slack / Total Negative Slack / Worst Slack', 'slack = 여유 시간. WNS는 가장 나쁜 위반, TNS는 위반의 합, WS는 부호 포함 최악 여유', 'chan_top signoff: setup WS +0.99 ns, TNS 0'],
  ['타이밍', 'Setup / Hold', '(약어 아님)', 'setup은 데이터가 클럭 전에 충분히 일찍 도착해야 하는 조건(주기가 길수록 유리), hold는 클럭 후에 너무 일찍 바뀌지 말아야 하는 조건(주기와 무관)', '30분~1시간 걸린 36번 리페어가 이 둘을 수리'],
  ['타이밍', 'Clock uncertainty', '(약어 아님)', '지터·스큐 등 클럭 불확실성에 대비한 마진. setup 허용 시간에서 빼고 hold 필요 시간에 더함', 'chan_top.sdc에서 주기의 5% (axi_clk 52ns → 2.6ns). hold 위반 약 4,170개와 hold 버퍼 약 8,080개의 직접 원인 (Evolution SA 배경 지식 15절)'],
  ['타이밍', 'Removal / Recovery', '(약어 아님)', '비동기 리셋 핀에 대한 hold·setup 대응 검사. removal은 리셋 해제가 클럭 엣지 직후 너무 일찍 오지 않아야 하는 조건', '리셋 동기화 플롭 → RESET_B 경로의 removal 0.358ns'],
  ['타이밍', 'Hold 버퍼 / 지연 셀', '(약어 아님)', 'hold 위반을 고치려고 resizer가 데이터 경로에 넣는 지연용 셀(holdNNN, dlygate4sd3). 같은 경로의 setup 지연도 늘림', '36번에서 8,075~8,085개 삽입. worst 경로에 11~18개가 직렬로 붙음'],
  ['타이밍', 'CDC', 'Clock Domain Crossing', '서로 다른 클럭 영역 사이 신호 전달. 동기화 회로·비동기 FIFO 필요', 'chan_top의 src_clk ↔ axi_clk (prim_fifo_async)'],
  ['타이밍', 'CTS skew', '(약어 아님)', '클럭이 플립플롭마다 도착하는 시간 차이', 'STA 리포트의 skew.max/min.rpt'],

  ['셀·공정', 'PDK', 'Process Design Kit', '공정이 제공하는 설계 키트 — 셀 라이브러리, 규칙(DRC/LVS 덱), 모델', 'sky130A (volare로 설치)'],
  ['셀·공정', 'sky130_fd_sc_hd', 'SkyWater 130nm · foundry digital · standard cell · high density', 'SkyWater 130nm 공정의 고밀도 디지털 표준셀 라이브러리', '이 프로젝트 디지털 P&R이 쓰는 라이브러리'],
  ['셀·공정', 'NMOS / PMOS', 'N-type / P-type Metal-Oxide-Semiconductor', 'CMOS를 이루는 두 트랜지스터. PMOS는 위쪽(VDD, n-well), NMOS는 아래쪽(GND, p기판)', '표준셀 한 줄 안에서 위/아래로 나뉘어 배치'],
  ['셀·공정', 'VPWR / VGND', '(sky130 전원 핀 이름) Power / Ground', 'sky130 셀의 전원·접지 핀. 일반적으로 VDD/VSS와 같은 역할', 'PNL(전원 연결 netlist)과 PDN이 이 핀을 잇는다'],
  ['셀·공정', 'li1 · licon · mcon · met1~5', 'local interconnect 1 · local-interconnect contact · metal contact · metal 1~5', '아래부터 확산/폴리 → licon → li1 → mcon → met1 → via … met5. 층마다 수직/수평이 번갈아 나옴', '라우팅은 met1~met5, 셀 내부 배선은 li1'],
  ['셀·공정', 'PPA', 'Power, Performance, Area', '전력·성능·면적 세 축의 트레이드오프', 'PPA 실험 탭들의 평가 기준'],
  ['셀·공정', 'RTL', 'Register Transfer Level', '레지스터와 그 사이 로직으로 쓴 하드웨어 기술(SystemVerilog)', 'OpenLane의 입력 (합성 전)'],

  ['탐색 기법', 'SA', 'Simulated Annealing', '나빠지는 이동도 온도에 비례한 확률로 받아들이며 점점 식혀 국소 최적을 벗어나는 탐색', 'Macro Tetris·표준셀 SA 실험의 탐색 엔진'],
  ['탐색 기법', 'ParSAC', 'Parallel Simulated Annealing with Constraints', '경계·그룹·고정 위치 제약을 지원하는 병렬 SA 매크로 floorplanner', '설치 완료, 경계/그룹 제약 확인. 아직 본 실행엔 미투입'],
  ['탐색 기법', 'RePlAce', '(OpenROAD 전역 배치기 이름)', '정전기 밀도 모델 + Nesterov 경사하강으로 셀을 퍼뜨리며 배선 길이를 줄이는 해석적 배치기', 'OpenLane GlobalPlacement(27번)가 사용. 이 탭의 "RePlAce 스타일"은 그 성격을 단순화한 흉내'],
]

function cellName(lib: Lib, g: Group, v: Variant, data: Record<string, CellData> | null): string {
  const withDrive = `${g.base}_${v.drive}`
  if (!data || data[withDrive]) return withDrive
  return data[g.base] ? g.base : withDrive
}

// ---- 회로도: PDK SPICE의 실제 소자·연결을 그린다 ----
// PMOS는 위(VPWR 쪽), NMOS는 아래(VGND 쪽). 같은 게이트 넷을 쓰는 P/N은 같은 열에 놓고 게이트를 세로로 잇는다.
// 채널 단자는 레일에 가까운 쪽이 위/아래로 오도록 D/S를 뒤집어 그리고(전기적으로 대칭), 모든 단자에 넷 이름을
// 붙인다. 가운데 띠에서 둘 이상의 단자가 만나는 넷(보통 출력)은 실제 배선으로 이어 준다.
function Schematic({ cell }: { cell: CellData }) {
  const devs = cell.devices.filter(d => isP(d.m) || isN(d.m))
  const gateOrder: string[] = []
  for (const d of devs) if (!gateOrder.includes(d.nets[1])) gateOrder.push(d.nets[1])
  gateOrder.sort((a, b) => (cell.ports.indexOf(a) < 0 ? 999 : cell.ports.indexOf(a)) - (cell.ports.indexOf(b) < 0 ? 999 : cell.ports.indexOf(b)))
  type Col = { gate: string; p?: Dev; n?: Dev }
  const cols: Col[] = []
  for (const g of gateOrder) {
    const ps = devs.filter(d => isP(d.m) && d.nets[1] === g), ns = devs.filter(d => isN(d.m) && d.nets[1] === g)
    for (let i = 0; i < Math.max(ps.length, ns.length); i++) cols.push({ gate: g, p: ps[i], n: ns[i] })
  }
  const CW = 96, X0 = 70, YR1 = 18, YP = 112, YN = 258, YR2 = 352, W = X0 + cols.length * CW + 30, H = 372
  const SUPPLY = (n: string) => n === 'VPWR' || n === 'VGND'
  const mid: Record<string, number[]> = {}
  const parts: ReactElement[] = []
  const labelOf = (x: number, y: number, net: string, dy: number, k: string) => !SUPPLY(net) ? <text key={k} x={x + 4} y={y + dy} fontSize={8.5} fill="currentColor" opacity={0.75}>{net.replace('#', '')}</text> : null
  cols.forEach((c, i) => {
    const cx = X0 + i * CW
    const draw = (d: Dev | undefined, y: number, p: boolean) => {
      if (!d) return
      const [dn, , sn] = [d.nets[0], d.nets[1], d.nets[2]]
      const rail = p ? 'VPWR' : 'VGND'
      // 레일 쪽 단자가 위(P)/아래(N)에 오게
      const railIsD = dn === rail
      const top = p ? (railIsD ? dn : sn) : (railIsD ? sn : dn)
      const bot = p ? (railIsD ? sn : dn) : (railIsD ? dn : sn)
      const col = p ? '#c0504d' : '#4a7ebb'
      const tx = cx + 24
      parts.push(<g key={`${d.n}`} stroke={col} strokeWidth={1.6} fill="none">
        <line x1={cx + 8} y1={y - 22} x2={cx + 8} y2={y + 22}/>
        <line x1={cx - 2} y1={y - 22} x2={cx - 2} y2={y + 22}/>
        <line x1={cx + 8} y1={y - 22} x2={tx} y2={y - 22}/><line x1={tx} y1={y - 22} x2={tx} y2={y - 40}/>
        <line x1={cx + 8} y1={y + 22} x2={tx} y2={y + 22}/><line x1={tx} y1={y + 22} x2={tx} y2={y + 40}/>
        <line x1={cx - 30} y1={y} x2={p ? cx - 8 : cx - 2} y2={y}/>
        {p && <circle cx={cx - 5} cy={y} r={3}/>}
        <title>{`${d.n} ${d.m} W=${d.w}µm L=${d.l}µm  D=${d.nets[0]} G=${d.nets[1]} S=${d.nets[2]} B=${d.nets[3]}`}</title>
      </g>)
      parts.push(<text key={`${d.n}t`} x={cx + 12} y={y + 3} fontSize={8} fill={col}>{`W${d.w}/L${d.l}`}</text>)
      for (const [net, yy, dir] of [[top, y - 40, -1], [bot, y + 40, 1]] as [string, number, number][]) {
        if (net === rail) parts.push(<line key={`${d.n}r${dir}`} x1={tx} y1={yy} x2={tx} y2={p ? YR1 : YR2} stroke={col} strokeWidth={1.4}/>)
        else if (SUPPLY(net)) parts.push(<line key={`${d.n}s${dir}`} x1={tx} y1={yy} x2={tx} y2={net === 'VPWR' ? YR1 : YR2} stroke="currentColor" strokeWidth={1.2} opacity={0.5}/>)
        else {
          { const l = labelOf(tx, yy, net, dir < 0 ? -4 : 12, `${d.n}l${dir}`); if (l) parts.push(l) }
          const inMid = (p && dir > 0) || (!p && dir < 0)
          if (inMid) (mid[net] = mid[net] ?? []).push(tx)
          if (inMid) parts.push(<circle key={`${d.n}j${dir}`} cx={tx} cy={yy} r={2} fill={col}/>)
        }
      }
    }
    draw(c.p, YP, true)
    draw(c.n, YN, false)
    const gx = cx - 30
    parts.push(<line key={`g${i}`} x1={gx} y1={c.p ? YP : YN} x2={gx} y2={c.n ? YN : YP} stroke="currentColor" strokeWidth={1.2} opacity={0.7}/>)
    parts.push(<text key={`gt${i}`} x={gx - 4} y={(c.p ? YP : YN) - 6} fontSize={10} fontWeight={700} textAnchor="end" fill="currentColor">{c.gate.replace('#', '')}</text>)
  })
  // 가운데 띠 배선
  Object.entries(mid).filter(([, xs]) => xs.length > 1).forEach(([net, xs], k) => {
    const y = 160 + (k % 5) * 8 + 6
    parts.push(<g key={`m${net}`} stroke="#8a6d3b" strokeWidth={1.2}><line x1={Math.min(...xs)} y1={y} x2={Math.max(...xs)} y2={y}/>{xs.map((x, j) => <line key={j} x1={x} y1={YP + 40} x2={x} y2={YN - 40}/>)}</g>)
  })
  return <svg viewBox={`0 0 ${W} ${H}`} style={{ width: Math.max(W, 260), maxWidth: 'none', color: 'var(--text)' }} role="img" aria-label="transistor-level schematic">
    <line x1={X0 - 36} y1={YR1} x2={W - 20} y2={YR1} stroke="#c0504d" strokeWidth={2}/><text x={4} y={YR1 + 4} fontSize={10} fill="#c0504d" fontWeight={700}>VPWR</text>
    <line x1={X0 - 36} y1={YR2} x2={W - 20} y2={YR2} stroke="#4a7ebb" strokeWidth={2}/><text x={4} y={YR2 + 4} fontSize={10} fill="#4a7ebb" fontWeight={700}>VGND</text>
    {parts}
  </svg>
}

// ---- LEF 뷰: 셀 외곽(SIZE)과 핀이 놓인 자리 ----
function LefView({ cell }: { cell: CellData }) {
  const size = cell.info.size
  if (!size) return <p className="chip-note">이 셀은 LEF 정보가 없습니다.</p>
  const [w, h] = size, S = 78, pad = 26
  const rects = cell.info.pins.flatMap(p => p.rects.map(r => ({ pin: p, r })))
  const X = (x: number) => pad + x * S, Y = (y: number) => pad + (h - y) * S
  return <svg viewBox={`0 0 ${w * S + pad * 2} ${h * S + pad * 2}`} style={{ width: Math.max(w * S + pad * 2, 160), maxWidth: 'none', color: 'var(--text)' }} role="img" aria-label="LEF pin view">
    {rects.filter(({ r }) => r[0] === 'nwell' || r[0] === 'pwell').map(({ r }, i) => <rect key={`w${i}`} x={X(r[1])} y={Y(r[4])} width={(r[3] - r[1]) * S} height={(r[4] - r[2]) * S} fill={LAYER_COLOR[r[0]]} opacity={0.25}/>)}
    <rect x={X(0)} y={Y(h)} width={w * S} height={h * S} fill="none" stroke="currentColor" strokeDasharray="4 3" opacity={0.7}/>
    {rects.filter(({ r }) => r[0] !== 'nwell' && r[0] !== 'pwell').map(({ pin, r }, i) => <g key={i}>
      <rect x={X(r[1])} y={Y(r[4])} width={(r[3] - r[1]) * S} height={(r[4] - r[2]) * S} fill={LAYER_COLOR[r[0]] ?? '#888'} opacity={0.75}><title>{`${pin.n} · ${r[0]} (${r[1]}, ${r[2]})–(${r[3]}, ${r[4]})`}</title></rect>
      {pin.use === 'signal' && <text x={X((r[1] + r[3]) / 2)} y={Y((r[2] + r[4]) / 2) + 4} fontSize={11} fontWeight={700} textAnchor="middle" fill="#fff">{pin.n}</text>}
    </g>)}
    <text x={pad} y={pad - 8} fontSize={10} fill="currentColor">{w} µm</text>
    <text x={4} y={pad + (h * S) / 2} fontSize={10} fill="currentColor">{h}</text>
  </svg>
}

export default function StandardCells() {
  const [libId, setLibId] = useState(libs[0].id)
  const [cat, setCat] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState('nand2_1')
  const [data, setData] = useState<Record<string, Record<string, CellData>>>({})
  const [loadErr, setLoadErr] = useState('')
  const [subTab, setSubTab] = useState<'library' | 'background' | 'experiment' | 'complex' | 'complex10' | 'complex50'>(() => {
    const requested = new URLSearchParams(window.location.search).get('tab')
    return requested === 'background' || requested === 'experiment' || requested === 'complex' || requested === 'complex10' || requested === 'complex50' ? requested : 'library'
  })
  const [imageFailed, setImageFailed] = useState(false)
  const lib = libs.find(l => l.id === libId) ?? libs[0]
  const libData = data[libId] ?? null
  const site = libId === 'sky130_fd_sc_hvl' ? { name: 'unithv', w: 0.48, h: 4.07 } : pdk.techlef?.site
  const libertyFile = libId === 'sky130_fd_sc_hvl' ? 'lib/…__tt_025C_3v30.lib' : libId === 'sky130_ef_sc_hd' ? '물리 전용 셀 · Liberty 없음' : 'lib/…__tt_025C_1v80.lib'
  const selectSubTab = (next: 'library' | 'background' | 'experiment' | 'complex' | 'complex10' | 'complex50') => {
    setSubTab(next)
    const url = new URL(window.location.href)
    url.searchParams.set('page', 'stdcells')
    url.searchParams.set('tab', next)
    window.history.replaceState({}, '', url)
  }

  useEffect(() => {
    if (data[libId]) return
    fetch(`/stdcells/${libId}.cells.json`).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      .then(j => { setData(d => ({ ...d, [libId]: j })); setLoadErr('') }).catch(e => setLoadErr(`셀 상세 데이터를 못 불러왔습니다 (${e.message})`))
  }, [libId, data])
  useEffect(() => setImageFailed(false), [libId, sel])

  const byCat = useMemo(() => {
    const m = new Map<string, { cells: number; functions: number }>()
    for (const g of lib.groups) { const e = m.get(g.category) ?? { cells: 0, functions: 0 }; e.cells += g.variants.length; e.functions += 1; m.set(g.category, e) }
    return m
  }, [lib])
  const maxCells = Math.max(...[...byCat.values()].map(v => v.cells), 1)
  const widths = lib.groups.flatMap(g => g.variants.map(v => v.w))
  const q = query.trim().toLowerCase()
  const groups = lib.groups.filter(g => (cat === 'all' || g.category === cat) && (q === '' || g.base.includes(q)))
  const shownCells = groups.reduce((s, g) => s + g.variants.length, 0)

  const cell = libData?.[sel] ?? null
  const info = cell?.info
  const selGroup = lib.groups.find(g => sel === g.base || sel.startsWith(g.base + '_') && /^\d+$/.test(sel.slice(g.base.length + 1)))
  const nP = cell?.devices.filter(d => isP(d.m)).length ?? 0, nN = cell?.devices.filter(d => isN(d.m)).length ?? 0
  const outFns = info?.pins.filter(p => p.fn) ?? []

  const usageByCat = useMemo(() => {
    const m = new Map<string, number>()
    const cats = new Map(libs[0].groups.map(g => [g.base, g.category] as const))
    for (const r of usage?.rows ?? []) m.set(cats.get(r.cell.replace(/_\d+$/, '')) ?? 'logic', (m.get(cats.get(r.cell.replace(/_\d+$/, '')) ?? 'logic') ?? 0) + r.count)
    return m
  }, [])

  return <div style={{ display: 'grid', gap: 16 }}>
    <div className="layout-pills" role="tablist" aria-label="Standard Cells 수평 탭">
      <button type="button" role="tab" aria-selected={subTab === 'library'} className={subTab === 'library' ? 'active' : ''} onClick={() => selectSubTab('library')}>셀 라이브러리</button>
      <button type="button" role="tab" aria-selected={subTab === 'background'} className={subTab === 'background' ? 'active' : ''} onClick={() => selectSubTab('background')}>배경 지식</button>
      <button type="button" role="tab" aria-selected={subTab === 'experiment'} className={subTab === 'experiment' ? 'active' : ''} onClick={() => selectSubTab('experiment')}>PDK 변경 실험</button>
      <button type="button" role="tab" aria-selected={subTab === 'complex'} className={subTab === 'complex' ? 'active' : ''} onClick={() => selectSubTab('complex')}>복잡한 표준셀 실험 (5개 이하)</button>
      <button type="button" role="tab" aria-selected={subTab === 'complex10'} className={subTab === 'complex10' ? 'active' : ''} onClick={() => selectSubTab('complex10')}>더 복잡한 표준셀 실험 (10개 이하)</button>
      <button type="button" role="tab" aria-selected={subTab === 'complex50'} className={subTab === 'complex50' ? 'active' : ''} onClick={() => selectSubTab('complex50')}>매우 복잡한 표준셀 실험 (20개 이상)</button>
    </div>
    {subTab === 'experiment' ? <PdkChangeExperiment libId={libId} libraryRowHeight={lib.rowHeight} cellName={sel} cell={cell}
      cells={libData} availableCells={Object.keys(libData ?? {})} onSelectCell={setSel} onOpenLibrary={() => selectSubTab('library')}/> : subTab === 'complex' ? <ComplexStandardCellExperiment level="five"/> : subTab === 'complex10' ? <ComplexStandardCellExperiment level="ten"/> : subTab === 'complex50' ? <ComplexStandardCellExperiment level="twenty"/> : subTab === 'background' ? <>
    <section className="card">
      <div className="card-title"><div><small className="kicker">PDK FILES</small><h3>표준 셀과 PDK 파일을 읽는 법</h3></div></div>
        <p className="chip-note" style={{ margin: '0 0 10px' }}>Standard Cells 탭은 설치된 {pdk.name} PDK의 기존 셀을 보여줍니다. 셀을 새로 설계하거나 DRC·LVS 통과를 판정하는 도구는 아닙니다. 현재 프로젝트의 디지털 P&amp;R은 주로 <code>sky130_fd_sc_hd</code>를 사용합니다.</p>
        <div className="data-table"><table><thead><tr><th>파일</th><th>여기서 볼 수 있는 것</th><th>이 파일만으로 알 수 없는 것</th></tr></thead><tbody>
          <tr><td><b>LEF</b></td><td>셀 외곽 크기, 배치 site, 핀의 위치·도형, 배선 금지 영역(OBS)</td><td>내부 트랜지스터와 제조용 전체 도형</td></tr>
          <tr><td><b>GDS</b></td><td>웰·확산·게이트·콘택트·비아·금속 등 층별 상세 도형과 셀 계층</td><td>논리 기능, PVT별 지연·전력, DRC 통과 여부 자체</td></tr>
          <tr><td><b>Liberty</b></td><td>셀 기능과 공정·전압·온도(PVT) 조건별 타이밍·전력 모델</td><td>제조용 레이아웃 도형</td></tr>
          <tr><td><b>SPICE/CDL</b></td><td>소자와 연결 관계. LVS에서 레이아웃 추출 회로와 비교할 기준</td><td>배치용 셀 외곽과 배선 핀 도형</td></tr>
        </tbody></table></div>
        <p className="chip-note" style={{ margin: '10px 0 0' }}><b>LEF와 GDS:</b> 셀 라이브러리 탭의 LEF 뷰(셀 윤곽과 핀)는 LEF만으로 그린 것입니다. 실제 칩의 최종 레이아웃에는 상세 도형이 필요하며, GDS 파일이나 GDS로 내보낼 수 있는 원본 레이아웃에서 가져옵니다. DRC는 도형을 해당 PDK 규칙으로 검사하고, LVS는 추출된 연결을 회로와 비교합니다.</p>
        <p className="chip-note" style={{ margin: '6px 0 0' }}><b>공정 변경:</b> 예를 들어 130 nm 설계를 90 nm로 옮길 때 셀 그림을 일정 비율로 줄여 쓰지 않습니다. 90 nm PDK와 검증된 셀 라이브러리로 다시 합성·배치하고, 타이밍·전력·DRC·LVS를 확인해야 합니다. 필요한 셀이나 목표 성능이 없으면 이식이 불가능할 수도 있습니다.</p>
    </section>

    <section className="card">
      <div className="card-title"><div><small className="kicker">BACKGROUND</small><h3>표준셀은 P&amp;R에서 어떻게 다뤄지고, 언제 직접 바꾸나</h3></div></div>
      <div className="data-table"><table><thead><tr><th>구분</th><th>내용</th></tr></thead><tbody>
        <tr><td><b>기본: 블랙박스로 배치·배선</b></td><td>디지털 로직은 표준셀 단위로 P&amp;R합니다. 셀 내부(트랜지스터·poly·diffusion·내부 li1)는 PDK가 이미 완성·검증해 둔 GDS이고, P&amp;R은 LEF 추상 뷰(크기·핀 사각형·전원 레일·배선 금지 영역)만 봅니다. P&amp;R이 정하는 것은 셀의 <b>위치(x,y)·방향(N/FS)</b>과 셀 사이 met1 이상 배선뿐이며, 최종 GDS는 셀 GDS 인스턴스 + 배선 도형으로 조립됩니다.</td></tr>
        <tr><td><b>셀 자체를 직접 바꾸는 경우</b></td><td>① <b>커스텀 셀 추가</b> — PDK에 없는 특수 래치/고속 FF/큰 구동 버퍼/저누설 변형 (PPA가 라이브러리 셀로 안 나올 때)<br/>② <b>기존 셀 변형</b> — 트랜지스터 W/L, Vt(hvt/lvt/svt), 핀 위치, 폭 변경 (타이밍·누설·핀 접근성/혼잡 개선)<br/>③ <b>PDK 셀 결함 우회</b> — 특정 공정/툴 조합의 DRC·LVS·핀 접근 문제 수정<br/>④ <b>전용 라이브러리 구축</b> — 파운드리/IP 회사가 새 셀 세트를 통째로 설계</td></tr>
        <tr><td><b>셀을 바꾸면 갱신 순서</b></td><td>위 표의 4개 파일은 이름으로 묶인 같은 셀의 다른 뷰라서 함께 갱신해야 합니다.<br/><b>GDS</b>(원본 도형 수정) → <b>SPICE</b>(W/L·연결을 GDS와 일치 → LVS 통과) → <b>LEF</b>(크기·핀 사각형을 GDS에서 다시 추출) → <b>liberty</b>(바뀐 트랜지스터로 SPICE 재특성화 — 건너뛰면 합성/STA가 옛 셀 기준으로 계산). 이후 DRC·LVS를 통과시키고 상위 P&amp;R이 새 LEF/liberty를 읽게 합니다.</td></tr>
        <tr><td><b>이 프로젝트에서</b></td><td>현재 흐름(OpenLane + sky130A)은 PDK 셀을 그대로 사용합니다. 커스텀 셀은 PDK 원본을 덮어쓰지 말고 별도 라이브러리(예: <code>sky130_custom</code>)로 만들어 OpenLane 설정이 가리키게 하는 것이 안전합니다 — 덮어쓰면 같은 PDK를 쓰는 다른 설계까지 바뀝니다.</td></tr>
        <tr><td><b>표준셀이 아닌 대상</b> <small>(아래 카드에 실측)</small></td><td>SRAM·아날로그·I/O 패드는 별도 GDS+LEF 매크로로 두고 P&amp;R은 배치만 하며, 하위 블록(chan_top 등)은 먼저 P&amp;R해 하나의 매크로로 만든 뒤 상위(daq_subsystem)에서 glue 표준셀과 함께 배치합니다.</td></tr>
      </tbody></table></div>
    </section>

    <section className="card">
      <div className="card-title"><div><small className="kicker">GLOSSARY</small><h3>배치에 쓰이는 약어와 Full name</h3></div><span className="connection">{ABBREVIATIONS.length}개</span></div>
      <p className="chip-note" style={{ margin: '0 0 10px' }}>P&amp;R 로그·config·이 대시보드에서 마주치는 약어를 분류별로 모았습니다. 마지막 열은 이 프로젝트의 실제 실행(chan_top 완주 실행, hierarchical daq_subsystem 실행)에서 본 값입니다.</p>
      {ABBR_GROUPS.map(group => <div key={group} style={{ marginBottom: 14 }}>
        <h4 style={{ margin: '0 0 6px' }}>{group}</h4>
        <div className="data-table"><table><thead><tr><th style={{ width: '12%' }}>약어</th><th style={{ width: '22%' }}>Full name</th><th style={{ width: '34%' }}>의미</th><th>이 프로젝트에서</th></tr></thead><tbody>
          {ABBREVIATIONS.filter(a => a[0] === group).map(a => <tr key={a[1]}><td><b>{a[1]}</b></td><td style={{ fontSize: 12 }}>{a[2]}</td><td style={{ fontSize: 12 }}>{a[3]}</td><td style={{ fontSize: 12 }}>{a[4]}</td></tr>)}
        </tbody></table></div>
      </div>)}
      <p className="chip-note">흐름으로 이으면: <b>RTL → 합성 → (SDC·LEF·Liberty) → floorplan → PDN → GPL → DPL → CTS → RSZ → GRT → DRT → RCX(PEX) → STA(SPEF) → GDS → DRC·LVS·XOR</b> 순서입니다. 앞쪽 STA는 추정 기생 성분, 뒤쪽(PEX 이후) STA가 signoff 값입니다.</p>
    </section>

    <section className="card">
      <div className="card-title"><div><small className="kicker">NOT STANDARD CELLS</small><h3>표준셀이 아닌 것들 — PDK가 제공하는 것과 우리 프로젝트에서 실제로 쓴 것</h3></div><span className="connection">tools/gen_non_std_cells.py (PDK LEF + 합성 stat.json)</span></div>
      <div className="data-table"><table><thead><tr><th>PDK 라이브러리</th><th>종류</th><th>개수</th><th>표준셀이 아닌 이유 / 내용</th></tr></thead><tbody>
        {nonStd.pdk.map(p => <tr key={p.lib}><td><code>{p.lib}</code></td><td><b>{p.kind}</b></td><td>{fmt(p.count)}</td><td style={{ fontSize: 12 }}>{p.why}
          {'breakdown' in p && p.breakdown && <div>{Object.entries(p.breakdown).map(([k, v]) => `${k} ${v}`).join(' · ')}</div>}
          {'macros' in p && p.macros && <div>{p.macros.map(m => `${m.name} (${m.w}×${m.h} µm)`).join(' · ')}</div>}</td></tr>)}
        <tr><td colSpan={4} style={{ fontSize: 12 }}>이 밖에 PDK 밖에서 가져온 <b>IP</b>(예: 오픈소스 sram22 SRAM, <code>sky130_ef_ip__adc3v_12bit</code> ADC)도 표준셀이 아닌 매크로로 취급합니다.</td></tr>
      </tbody></table></div>
      <h4 style={{ margin: '14px 0 6px' }}>우리 프로젝트의 블록별 구성 (최신 합성 결과)</h4>
      <div className="data-table"><table><thead><tr><th>블록</th><th>합성 셀 수</th><th>표준셀</th><th>표준셀이 아닌 셀 (크기 = LEF)</th></tr></thead><tbody>
        {nonStd.project.map(b => <tr key={b.block}><td><code>{b.block}</code></td><td>{fmt(b.totalCells)}</td><td>{fmt(b.stdCells)}{b.nonStd.length === 0 && ' (100%)'}</td>
          <td style={{ fontSize: 12 }}>{b.nonStd.length === 0 ? '없음' : b.nonStd.map(e => <div key={e.cell}><b style={{ color: '#E6784E' }}>{e.cell}</b> ×{e.count}{e.w ? ` — ${e.w}×${e.h} µm (${fmt(Math.round(e.w * e.h))} µm²)` : ''}</div>)}</td></tr>)}
        {nonStd.hierarchical && <tr><td><code>daq_subsystem</code><br/><small>hierarchical</small></td><td colSpan={2}>chan_top ×{nonStd.hierarchical.instances}</td><td style={{ fontSize: 12 }}><b style={{ color: '#7F77DD' }}>{nonStd.hierarchical.macro}</b> — 표준셀로 만든 블록을 먼저 P&amp;R로 굳힌 뒤 매크로로 배치 ({nonStd.hierarchical.w}×{nonStd.hierarchical.h} µm). 내부는 전부 표준셀이지만 상위에서는 SRAM처럼 블랙박스입니다.</td></tr>}
      </tbody></table></div>
      <p className="chip-note">정리: <b>chan_top·chan_ctrl·cnt_sat·skid_buffer·daq_subsystem(채널 포함 통합 합성)은 100% 표준셀</b>이고, <b>ppa3_adc_capture만 ADC·SRAM 매크로가 섞여 있습니다</b>. hierarchical 구성의 chan_top은 표준셀 집합이 매크로로 승격된 경우입니다. 표준셀이 아닌 쪽은 P&amp;R에서 먼저 큰 블록으로 배치하고, 그 사이 여유 공간에 표준셀이 채워집니다(Macro Tetris가 다루는 부분).</p>
    </section>

    </> : <>
    <section className="card">
      <div className="card-title"><div><small className="kicker">PDK · 지금 표시 중: {pdk.name} / {lib.id}</small><h2>표준셀 라이브러리 — PDK가 제공하는 셀 전체</h2></div><div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}><span className="connection">{catalog.generatedFrom}</span><button type="button" onClick={() => setSubTab('background')} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border-strong)', background: 'var(--surface-1)', color: 'var(--text-primary)', cursor: 'pointer' }}>배경 지식 보기 →</button></div></div>
      <div className="data-table"><table><tbody>
        <tr><td><b>PDK</b></td><td>{pdk.name} (SkyWater 130nm CMOS, open_pdks <code>{String(pdk.openPdks).slice(0, 8)}</code>) — 설치 위치 <code>{pdk.install}</code></td></tr>
        <tr><td><b>제공 라이브러리</b></td><td>{pdk.libsRef.map(l => <code key={l} style={{ marginRight: 8, fontWeight: l === lib.id ? 800 : 400 }}>{l}</code>)}</td></tr>
        <tr><td><b>표준셀 라이브러리 3종</b></td><td>{pdk.stdcellLibs.map(l => <div key={l.id}><code style={{ fontWeight: l.id === lib.id ? 800 : 400 }}>{l.id}</code> — {l.role}</div>)}</td></tr>
        <tr><td><b>공정 기술 파일</b></td><td>{pdk.libsTech.map(t => <code key={t} style={{ marginRight: 8 }}>{t}</code>)} · 기준 site <code>{site?.name}</code> = {site?.w}×{site?.h} µm</td></tr>
      </tbody></table></div>
      <div className="layout-pills" style={{ marginTop: 10 }}>{libs.map(l => <button key={l.id} className={l.id === libId ? 'active' : ''} onClick={() => { setLibId(l.id); setCat('all'); setQuery(''); setSel(l.groups[0] ? `${l.groups[0].base}_${l.groups[0].variants[0].drive}` : '') }}>{l.id.replace('sky130_', '')} · {l.lefCells}셀</button>)}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginTop: 12 }}>
        <div className="card" style={{ padding: 12 }}><small>총 가용 셀 수 (LEF)</small><h3 style={{ margin: '4px 0' }}>{fmt(lib.lefCells)}</h3><small>{lib.label}</small></div>
        <div className="card" style={{ padding: 12 }}><small>기능 종류 (drive 제외)</small><h3 style={{ margin: '4px 0' }}>{fmt(lib.functions)}</h3><small>같은 기능의 크기 변형을 하나로 묶음</small></div>
        <div className="card" style={{ padding: 12 }}><small>행 높이</small><h3 style={{ margin: '4px 0' }}>{lib.rowHeight} µm</h3><small>높이 고정, 폭만 가변</small></div>
        <div className="card" style={{ padding: 12 }}><small>셀 폭 범위</small><h3 style={{ margin: '4px 0' }}>{Math.min(...widths)}–{Math.max(...widths)} µm</h3><small>가장 작은 셀 ~ 가장 큰 셀</small></div>
      </div>
      {lib.libertyCells !== null && <p className="chip-note" style={{ marginTop: 10 }}>liberty(타이밍) 정의 <b>{lib.libertyCells}개</b> / LEF <b>{lib.lefCells}개</b> — 차이 {lib.lefCells - lib.libertyCells}개는 타이밍이 없는 물리 전용 셀: <code>{lib.noTiming.join(' · ')}</code>.</p>}
    </section>

    <section className="card">
      <div className="card-title"><div><small className="kicker">CATEGORY</small><h3>분류별 셀 개수 — {lib.id}</h3></div><span className="connection">누르면 아래 버튼이 그 분류만 보입니다</span></div>
      <div className="data-table"><table><thead><tr><th>분류</th><th>셀 수</th><th>기능 종류</th><th style={{ width: '34%' }}/><th>설명</th></tr></thead><tbody>
        {Object.entries(CATEGORY).filter(([k]) => byCat.has(k)).map(([k, c]) => {
          const e = byCat.get(k)!
          return <tr key={k} onClick={() => setCat(cat === k ? 'all' : k)} style={{ cursor: 'pointer', background: cat === k ? 'var(--accent-soft)' : undefined }}>
            <td><b>{c.label}</b></td><td><b>{fmt(e.cells)}</b></td><td>{e.functions}</td>
            <td><div style={{ height: 10, borderRadius: 3, background: c.color, width: `${e.cells / maxCells * 100}%`, minWidth: 3 }}/></td><td style={{ fontSize: 11 }}>{c.desc}</td></tr>
        })}
      </tbody></table></div>
    </section>

    <section className="card">
      <div className="card-title"><div><small className="kicker">CELLS · {shownCells}개</small><h3>셀을 눌러 구성·회로도·레이아웃 보기</h3></div>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="nand, dff, mux…" style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-muted)', color: 'var(--text)', fontSize: 12 }}/></div>
      <div className="layout-pills" style={{ marginBottom: 8 }}>
        <button className={cat === 'all' ? 'active' : ''} onClick={() => setCat('all')}>전체</button>
        {Object.entries(CATEGORY).filter(([k]) => byCat.has(k)).map(([k, c]) => <button key={k} className={cat === k ? 'active' : ''} onClick={() => setCat(k)}>{c.label}</button>)}
      </div>
      <div style={{ display: 'grid', gap: 10, maxHeight: 340, overflow: 'auto', paddingRight: 4 }}>
        {Object.entries(CATEGORY).filter(([k]) => cat === 'all' ? byCat.has(k) : k === cat).map(([k, c]) => {
          const gs = groups.filter(g => g.category === k)
          if (!gs.length) return null
          return <div key={k}><b style={{ fontSize: 12 }}><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: c.color, marginRight: 6 }}/>{c.label} · {gs.reduce((s, g) => s + g.variants.length, 0)}개</b>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
              {gs.flatMap(g => g.variants.map(v => { const name = cellName(lib, g, v, libData); const on = sel === name
                return <button key={name} onClick={() => setSel(name)} title={`${g.base} · drive ${v.drive || '-'} · ${v.w}µm · ${v.area}µm²`} style={{ fontSize: 11, fontFamily: 'var(--font-mono)', padding: '4px 9px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${on ? c.color : 'var(--border-strong)'}`, background: on ? c.color : 'var(--surface-1)', color: on ? '#fff' : 'var(--text-primary)', fontWeight: on ? 800 : 500 }}>{name}</button> }))}
            </div></div>
        })}
        {shownCells === 0 && <p className="chip-note">조건에 맞는 셀이 없습니다.</p>}
      </div>
    </section>

    <section className="card">
      <div className="card-title"><div><small className="kicker">SELECTED CELL</small><h3><code>{lib.id}__{sel}</code></h3></div>{selGroup && <span className="connection" style={{ color: CATEGORY[selGroup.category]?.color }}>{CATEGORY[selGroup.category]?.label} · {selGroup.variants.length}종 변형</span>}</div>
      {loadErr && <p className="init-error">{loadErr}</p>}
      {!cell && !loadErr && <p className="chip-note">불러오는 중…</p>}
      {cell && info && <>
        <p style={{ margin: '4px 0 8px', fontSize: 14 }}><b>기능</b> — {info.desc}</p>
        {outFns.length > 0 && <div className="data-table"><table><thead><tr><th>출력 핀</th><th>불리언 함수 (liberty)</th></tr></thead><tbody>{outFns.map(p => <tr key={p.n}><td><code>{p.n}</code></td><td><code>{p.fn}</code></td></tr>)}</tbody></table></div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, margin: '10px 0' }}>
          <div className="card" style={{ padding: 10 }}><small>크기</small><h4 style={{ margin: '3px 0' }}>{info.size ? `${info.size[0]} × ${info.size[1]} µm` : '—'}</h4><small>site {info.size && site ? Math.round(info.size[0] / site.w) : '—'}칸 × {info.size && site ? Math.round(info.size[1] / site.h) : '—'}행{info.sym ? ` · 대칭 ${info.sym}` : ''}</small></div>
          <div className="card" style={{ padding: 10 }}><small>면적 (liberty)</small><h4 style={{ margin: '3px 0' }}>{info.area ?? '—'} µm²</h4><small>{info.footprint ? `footprint ${info.footprint}` : '타이밍 정의 없음'}</small></div>
          <div className="card" style={{ padding: 10 }}><small>트랜지스터</small><h4 style={{ margin: '3px 0' }}>PMOS {nP} + NMOS {nN}</h4><small>총 {cell.devices.length}개 소자 (SPICE)</small></div>
          <div className="card" style={{ padding: 10 }}><small>핀</small><h4 style={{ margin: '3px 0' }}>신호 {info.pins.filter(p => p.use === 'signal').length}개</h4><small>입력 {info.pins.filter(p => p.use === 'signal' && p.dir === 'input').length} · 출력 {info.pins.filter(p => p.use === 'signal' && p.dir === 'output').length} + 전원 {info.pins.filter(p => p.use !== 'signal').length}</small></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12 }}>
          <div className="card" style={{ padding: 10, minWidth: 0 }}><b style={{ fontSize: 12 }}>회로도 (SPICE의 실제 소자·연결)</b><div style={{ overflowX: 'auto', marginTop: 6 }}><Schematic cell={cell}/></div>
            <small className="chip-note">빨강 PMOS는 N-well 쪽(위, VPWR), 파랑 NMOS는 P-sub 쪽(아래, VGND). 같은 게이트 신호는 같은 열에서 세로로 연결. 소자에 마우스를 올리면 D/G/S/B 넷이 보입니다.</small></div>
          <div className="card" style={{ padding: 10, minWidth: 0 }}><b style={{ fontSize: 12 }}>레이아웃 (PDK GDS 실제 도형)</b>
            <div style={{ overflowX: 'auto', marginTop: 6 }}>{imageFailed
              ? <p className="chip-note">이 셀의 GDS 렌더 이미지가 없습니다. 오른쪽 LEF 뷰에서 외곽과 핀을 확인할 수 있습니다.</p>
              : <img src={`/stdcells/layout/${libId}/${sel}.png`} alt={`${sel} layout`} style={{ maxHeight: 300, background: '#fff', borderRadius: 4 }} onError={() => setImageFailed(true)}/>}</div>
            <small className="chip-note">poly(빨강 세로줄)가 diffusion을 가로지르는 곳이 트랜지스터 — 위쪽 절반이 PMOS(N-well), 아래쪽 절반이 NMOS이고, 위·아래 가로줄이 VPWR/VGND met1 레일입니다. KLayout으로 렌더 (이미지가 없으면 이 PDK에 GDS가 없는 셀).</small></div>
          <div className="card" style={{ padding: 10, minWidth: 0 }}><b style={{ fontSize: 12 }}>LEF 뷰 (P&amp;R이 보는 크기·핀 위치)</b><div style={{ overflowX: 'auto', marginTop: 6 }}><LefView cell={cell}/></div>
            <small className="chip-note">점선 = 셀 외곽(SIZE), 초록 li1·파랑 met1 = 핀 사각형. 라우터는 이 사각형에 닿게 배선합니다.</small></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 12, marginTop: 12 }}>
          <div className="data-table"><table><thead><tr><th>핀</th><th>방향</th><th>용도</th><th>입력 용량 pF</th><th>위치 (µm, 사각형 중심·층)</th></tr></thead><tbody>
            {info.pins.map(p => { const r = p.rects[0]; return <tr key={p.n}><td><code>{p.n}</code></td><td>{p.dir}</td><td>{p.use}</td><td>{p.cap ?? '—'}</td><td style={{ fontSize: 11 }}>{r ? `${r[0]} (${((r[1] + r[3]) / 2).toFixed(2)}, ${((r[2] + r[4]) / 2).toFixed(2)})${p.rects.length > 1 ? ` 외 ${p.rects.length - 1}` : ''}` : '—'}</td></tr> })}
          </tbody></table></div>
          <div className="data-table"><table><thead><tr><th>소자</th><th>종류</th><th>W / L µm</th><th>D</th><th>G</th><th>S</th><th>B</th></tr></thead><tbody>
            {cell.devices.map(d => <tr key={d.n}><td>{d.n}</td><td>{d.m}</td><td>{d.w} / {d.l}</td>{d.nets.slice(0, 4).map((n, i) => <td key={i} style={{ fontSize: 11 }}>{n}</td>)}</tr>)}
          </tbody></table></div>
        </div>
        <p className="chip-note" style={{ marginTop: 8 }}><b>회로도 ↔ 레이아웃 대응</b>: 회로도의 소자 {cell.devices.length}개(W/L 표)가 레이아웃에서는 diffusion 폭 = W, poly 길이 = L인 트랜지스터로 구현됩니다 (이 셀은 PMOS {nP}, NMOS {nN}). 회로도의 입력 신호는 레이아웃/LEF의 li1 핀 사각형으로, VPWR/VGND는 위·아래 met1 레일로 나옵니다.</p>
      </>}
    </section>

    <section className="card">
      <div className="card-title"><div><small className="kicker">PDK FILES → 설계 흐름</small><h3>이 셀이 설계 흐름의 각 단계에서 쓰이는 방식</h3></div><span className="connection">선택한 셀: {sel}</span></div>
      <div className="data-table"><table><thead><tr><th>단계</th><th>쓰는 PDK 파일</th><th>거기서 읽는 정보 (선택한 셀 기준)</th></tr></thead><tbody>
        <tr><td><b>1. 합성</b> (RTL→게이트)</td><td><code>{libertyFile}</code></td><td>{libId === 'sky130_ef_sc_hd' ? '이 라이브러리의 셀은 물리 보조용으로 표시되며, 이 탭에 타이밍 Liberty가 없습니다.' : <>셀 이름·<b>기능</b>({outFns.map(p => `${p.n}=${p.fn}`).join(', ') || '—'})·<b>면적</b> {info?.area ?? '—'} µm²·핀 입력 용량·지연 표. 합성기가 RTL 로직을 라이브러리 셀로 매핑할 때 사용</>}</td></tr>
        <tr><td><b>2. 플로어플랜/배치</b></td><td><code>lef/…lef</code> + <code>techlef/…tlef</code></td><td>셀 <b>크기</b> {info?.size ? `${info.size[0]}×${info.size[1]} µm` : '—'} = site <code>{info?.site ?? '—'}</code>({site?.w}×{site?.h}µm) {info?.size && site ? `${Math.round(info.size[0] / site.w)}칸 × ${Math.round(info.size[1] / site.h)}행` : ''}. 배치기는 이 격자 위에 셀을 놓고 <b>위치</b>(x,y)와 방향을 정함</td></tr>
        <tr><td><b>3. 라우팅</b></td><td><code>lef</code> (PIN/RECT) + <code>techlef</code> 배선층</td><td>셀 안 <b>핀 위치</b>: {info?.pins.filter(p => p.use === 'signal').map(p => `${p.n}@${p.rects[0]?.[0]}(${((p.rects[0]?.[1] + p.rects[0]?.[3]) / 2).toFixed(2)}, ${((p.rects[0]?.[2] + p.rects[0]?.[4]) / 2).toFixed(2)})`).join(' · ') || '—'}. 라우터가 핀 사각형(li1)에서 met1~ 로 올려 연결. 배선 pitch: {Object.entries(pdk.techlef?.layers ?? {}).map(([k, v]) => `${k} ${(v as { pitch: number }).pitch}`).join(' · ')} µm</td></tr>
        <tr><td><b>4. 물리 검증</b></td><td><code>gds/…gds</code> + <code>spice/…spice</code> (<code>cdl/</code>)</td><td>GDS는 마스크가 될 <b>실제 도형</b>(DRC가 검사), SPICE/CDL은 <b>트랜지스터 회로</b> — LVS가 GDS에서 추출한 회로와 이 SPICE를 비교해 같은지 확인. 아래 회로도와 레이아웃이 바로 이 쌍</td></tr>
      </tbody></table></div>
      <p className="chip-note">파일별로 무엇을 알 수 있고 무엇은 알 수 없는지는 <b>배경 지식</b> 탭에 정리되어 있습니다.</p>
    </section>

    {usage && <section className="card">
      <div className="card-title"><div><small className="kicker">PROJECT USAGE</small><h3>우리 설계는 이 중 무엇을 얼마나 쓰나 — {usage.design}</h3></div><span className="connection">합성 직후 {fmt(usage.totalCells)}셀 · {usage.distinctTypes}종</span></div>
      <p className="chip-note" style={{ marginBottom: 8 }}>출처: <code>{usage.source}</code>. hd 라이브러리 {libs[0].lefCells}개 중 <b>{usage.distinctTypes}종(drive 포함)</b>만 실제로 사용합니다.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 14 }}>
        <div className="data-table"><table><thead><tr><th>분류</th><th>사용 셀 수</th><th>비율</th></tr></thead><tbody>
          {Object.entries(CATEGORY).filter(([k]) => usageByCat.has(k)).sort((a, b) => (usageByCat.get(b[0]) ?? 0) - (usageByCat.get(a[0]) ?? 0)).map(([k, c]) => <tr key={k}>
            <td><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: c.color, marginRight: 5 }}/>{c.label}</td><td>{fmt(usageByCat.get(k)!)}</td><td>{(usageByCat.get(k)! / usage.totalCells * 100).toFixed(1)}%</td></tr>)}
        </tbody></table></div>
        <div className="data-table" style={{ maxHeight: 260, overflow: 'auto' }}><table><thead><tr><th>가장 많이 쓴 셀 Top 15 (누르면 위에서 보기)</th><th>개수</th></tr></thead><tbody>
          {usage.rows.slice(0, 15).map(r => <tr key={r.cell} onClick={() => { setLibId('sky130_fd_sc_hd'); setSel(r.cell); window.scrollTo({ top: 0, behavior: 'smooth' }) }} style={{ cursor: 'pointer' }}><td><code>{r.cell}</code></td><td>{fmt(r.count)}</td></tr>)}
        </tbody></table></div>
      </div>
    </section>}

    <section className="card">
      <div className="card-title"><div><small className="kicker">SYNTHESIS → P&R</small><h3>합성 때와 P&R 후 셀 개수는 왜 이렇게 다른가</h3></div></div>
      <div className="data-table"><table><thead><tr><th>단계</th><th>셀 수</th><th>무엇이 늘었나</th></tr></thead><tbody>
        <tr><td>chan_top 합성 직후</td><td>{fmt(usage?.totalCells ?? 0)}</td><td>RTL이 만든 로직만 (위 표)</td></tr>
        <tr><td>chan_top 라우팅 후 (signoff)</td><td>{fmt(REAL_CHAN_TOP.cellCount)}</td><td>탭셀·클록 트리 버퍼·타이밍/hold 리페어 버퍼가 P&R 단계에서 추가됨</td></tr>
        <tr><td>daq_subsystem glue 합성 직후</td><td>{fmt(REAL_GLUE.synthCells)}</td><td>8채널을 제외한 나머지 로직(dma_sched·csr·irq_ctrl·perf_cnt)</td></tr>
        <tr><td>daq_subsystem glue 라우팅 후</td><td>{fmt(REAL_GLUE.cellCount)}</td><td>그중 {fmt(REAL_GLUE_OTHER_PURPOSE_CELLS)}셀({(REAL_GLUE_OTHER_PURPOSE_CELLS / REAL_GLUE.cellCount * 100).toFixed(1)}%)이 탭 {fmt(REAL_GLUE_OTHER_PURPOSE.tapCells)} + 타이밍 리페어 {fmt(REAL_GLUE_OTHER_PURPOSE.timingRepairBuffers)} + hold 버퍼 {fmt(REAL_GLUE_OTHER_PURPOSE.holdBuffers)}</td></tr>
      </tbody></table></div>
    </section>
    </>}
  </div>
}
