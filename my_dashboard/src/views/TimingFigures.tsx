// Evolution SA 배경 지식 15절(Setup · Hold · WNS)의 그림.
// 숫자는 chan_top 재성형 풀 실행(runs/reshape_full_*)의 STA 리포트(55-openroad-stapostpnr, 35-openroad-stamidpnr-1)에서 읽은 값이다.
const BLUE = '#85B7EB', BLUE_D = '#185FA5', ORANGE = '#EF9F27', RED = '#c0392b', GREEN = '#1D9E75', GRAY = '#9aa3ad'
const wrap = { maxWidth: 680, display: 'block', margin: '6px 0 10px' } as const
const cap = { margin: '0 0 8px', fontSize: 12, lineHeight: 1.7, color: 'var(--text-secondary)' } as const

// ① Setup · Hold 개념: 클럭 엣지, 데이터 도착, 금지 구간
export function SetupHoldConceptFigure() {
  const L = 80, C = 440, setup = 36, hold = 30, arrive = 350, nextChange = 500
  return <figure style={{ margin: 0 }}>
    <svg viewBox="0 0 640 252" width="100%" style={wrap} role="img" aria-label="launch 엣지에서 출발한 데이터가 capture 엣지의 setup·hold 금지 구간을 피해야 한다">
      <text x={8} y={36} fontSize={11} fill="currentColor">클럭</text>
      <path d="M40 50 H80 V22 H260 V50 H440 V22 H620" fill="none" stroke="currentColor" strokeWidth={1.6}/>
      <line x1={L} y1={18} x2={L} y2={206} stroke={GRAY} strokeDasharray="3 3"/>
      <line x1={C} y1={18} x2={C} y2={206} stroke={GRAY} strokeDasharray="3 3"/>
      <text x={L} y={12} fontSize={11} textAnchor="middle" fill="currentColor">launch 엣지 (t=0)</text>
      <text x={C} y={12} fontSize={11} textAnchor="middle" fill="currentColor">capture 엣지 (t=주기 T)</text>
      <rect x={C - setup} y={64} width={setup + hold} height={110} fill={RED} opacity={0.14}/>
      <text x={C - setup / 2} y={186} fontSize={10} textAnchor="middle" fill={RED}>setup</text>
      <text x={C + hold / 2} y={186} fontSize={10} textAnchor="middle" fill={RED}>hold</text>
      <text x={C - setup + (setup + hold) / 2} y={200} fontSize={10} textAnchor="middle" fill={RED}>데이터가 바뀌면 안 되는 구간</text>
      <text x={8} y={110} fontSize={11} fill="currentColor">데이터</text>
      <rect x={40} y={90} width={L - 40} height={28} fill={BLUE} stroke={BLUE_D}/>
      <rect x={L} y={90} width={arrive - L} height={28} fill="none" stroke={GRAY} strokeDasharray="4 3"/>
      <text x={(L + arrive) / 2} y={108} fontSize={10.5} textAnchor="middle" fill="currentColor">경로 지연 동안 값이 흔들림</text>
      <rect x={arrive} y={90} width={nextChange - arrive} height={28} fill={BLUE} stroke={BLUE_D}/>
      <text x={(arrive + nextChange) / 2} y={108} fontSize={10.5} textAnchor="middle" fill="currentColor">새 데이터 (안정)</text>
      <rect x={nextChange} y={90} width={620 - nextChange} height={28} fill="none" stroke={GRAY} strokeDasharray="4 3"/>
      <text x={arrive} y={136} fontSize={10.5} textAnchor="middle" fill={GREEN}>▲ 도착 (①)</text>
      <text x={nextChange + 4} y={136} fontSize={10.5} textAnchor="start" fill={GREEN}>▲ 다음 변화 (②)</text>
      <text x={40} y={226} fontSize={11} fill={GREEN}>① setup: 도착 ≤ T − setup 시간 − uncertainty</text>
      <text x={40} y={244} fontSize={11} fill={GREEN}>② hold: 다음 데이터 변화 ≥ T + hold 시간 + uncertainty</text>
    </svg>
    <figcaption style={cap}>① <b>Setup</b>은 launch 엣지에서 출발한 데이터가 <b>다음 capture 엣지 앞 setup 구간 전에</b> 도착하는지, ② <b>Hold</b>는 같은 엣지에서 출발한 <b>다음 데이터가 capture 엣지 뒤 hold 구간이 끝난 뒤에야</b> 바뀌는지 봅니다. clock uncertainty는 두 구간을 모두 넓힙니다.</figcaption>
  </figure>
}

// ② Setup 허용 시간 vs 실제 데이터 지연 (모양별 누적 막대)
const SHAPES = [
  { name: '650×985', wns: -0.139, hold: 15.90, wire: 0.24 },
  { name: '590×1085', wns: -0.179, hold: 14.44, wire: 0.27 },
  { name: '500×1280', wns: -2.690, hold: 20.25, wire: 0.25 },
  { name: '450×1422', wns: -0.460, hold: 16.02, wire: 0.36 },
]
const BUDGET = 49.136 // 52 − 2.6(uncertainty) − 0.265(setup 시간)
export function SetupBudgetFigure() {
  const X0 = 120, K = 9.2 // px / ns
  const x = (ns: number) => X0 + ns * K
  return <figure style={{ margin: 0 }}>
    <svg viewBox="0 0 640 250" width="100%" style={wrap} role="img" aria-label="모양별 데이터 경로 지연과 허용 시간 비교">
      {[0, 10, 20, 30, 40, 50].map(t => <g key={t}>
        <line x1={x(t)} y1={34} x2={x(t)} y2={190} stroke={GRAY} opacity={0.35}/>
        <text x={x(t)} y={204} fontSize={10} textAnchor="middle" fill="currentColor">{t}</text>
      </g>)}
      <text x={X0 + 26 * K} y={222} fontSize={10.5} textAnchor="middle" fill="currentColor">데이터 경로 지연 (ns, ss 코너)</text>
      {SHAPES.map((s, i) => {
        const total = BUDGET - s.wns
        const logic = total - s.hold - s.wire
        const y = 44 + i * 36
        return <g key={s.name}>
          <text x={X0 - 8} y={y + 16} fontSize={11} textAnchor="end" fill="currentColor" fontWeight={s.name === '500×1280' ? 700 : 400}>{s.name}</text>
          <rect x={x(0)} y={y} width={logic * K} height={24} fill={BLUE} stroke={BLUE_D}/>
          <rect x={x(logic)} y={y} width={s.hold * K} height={24} fill={ORANGE} stroke="#a86b05"/>
          <rect x={x(logic + s.hold)} y={y} width={Math.max(s.wire * K, 2)} height={24} fill={RED}/>
          <text x={x(logic) + s.hold * K / 2} y={y + 16} fontSize={10} textAnchor="middle" fill="#2b1a00">{s.hold.toFixed(1)}</text>
          <text x={x(0) + logic * K / 2} y={y + 16} fontSize={10} textAnchor="middle" fill="#0b2a47">{logic.toFixed(1)}</text>
          <text x={x(total) + 6} y={y + 16} fontSize={10.5} fill={RED} fontWeight={700}>{s.wns.toFixed(2)}</text>
        </g>
      })}
      <line x1={x(BUDGET)} y1={30} x2={x(BUDGET)} y2={192} stroke={GREEN} strokeWidth={2} strokeDasharray="5 3"/>
      <text x={x(BUDGET)} y={24} fontSize={10.5} textAnchor="middle" fill={GREEN}>허용 49.14 (= 52 − 2.6 − 0.27)</text>
      <rect x={120} y={232} width={10} height={10} fill={BLUE}/><text x={134} y={241} fontSize={10} fill="currentColor">원래 로직 + clk→Q</text>
      <rect x={250} y={232} width={10} height={10} fill={ORANGE}/><text x={264} y={241} fontSize={10} fill="currentColor">hold 지연 셀</text>
      <rect x={350} y={232} width={10} height={10} fill={RED}/><text x={364} y={241} fontSize={10} fill="currentColor">배선(net)</text>
      <text x={470} y={241} fontSize={10} fill={RED}>빨간 숫자 = setup WNS</text>
    </svg>
    <figcaption style={cap}>막대 전체가 데이터 경로 지연이고 초록 점선이 허용 시간입니다. <b>500×1280은 원래 로직이 가장 짧은데도 hold 지연 셀이 20.3ns로 가장 길어서</b> 점선을 2.69ns 넘습니다. 배선(빨간 조각)은 0.25ns 안팎이라 사실상 보이지 않습니다. (전체 길이 = 허용 49.14 − WNS, 리포트의 slack으로 역산한 값이라 ±0.01ns 오차가 있습니다.)</figcaption>
  </figure>
}

// ③ Hold(removal) 위반: 필요 시간에서 uncertainty가 차지하는 몫
export function HoldBudgetFigure() {
  const X0 = 150, K = 135 // px / ns
  const x = (ns: number) => X0 + ns * K
  return <figure style={{ margin: 0 }}>
    <svg viewBox="0 0 640 190" width="100%" style={wrap} role="img" aria-label="hold(removal) 검사에서 데이터 도착과 필요 시간 비교">
      {[0, 0.5, 1, 1.5, 2, 2.5, 3].map(t => <g key={t}>
        <line x1={x(t)} y1={26} x2={x(t)} y2={140} stroke={GRAY} opacity={0.35}/>
        <text x={x(t)} y={154} fontSize={10} textAnchor="middle" fill="currentColor">{t}</text>
      </g>)}
      <text x={X0 + 1.7 * K} y={172} fontSize={10.5} textAnchor="middle" fill="currentColor">시간 (ns, nom_tt, 590×1085, 35번 단계)</text>
      <text x={X0 - 8} y={56} fontSize={11} textAnchor="end" fill="currentColor">데이터 도착</text>
      <rect x={x(0)} y={40} width={0.943 * K} height={26} fill={BLUE} stroke={BLUE_D}/>
      <text x={x(0.4715)} y={57} fontSize={10} textAnchor="middle" fill="#0b2a47">0.943</text>
      <text x={X0 - 8} y={104} fontSize={11} textAnchor="end" fill="currentColor">필요 시간</text>
      <rect x={x(0)} y={88} width={0.344 * K} height={26} fill={GRAY} stroke="#5f6870"/>
      <rect x={x(0.344)} y={88} width={0.358 * K} height={26} fill="#c9ced4" stroke="#5f6870"/>
      <rect x={x(0.702)} y={88} width={2.6 * K} height={26} fill={RED} opacity={0.75}/>
      <text x={x(0.172)} y={79} fontSize={9.5} textAnchor="middle" fill="currentColor">캡처 클럭 0.34</text>
      <text x={x(0.8)} y={128} fontSize={9.5} textAnchor="start" fill="currentColor">removal 0.36</text>
      <text x={x(2.0)} y={105} fontSize={11} textAnchor="middle" fill="#fff" fontWeight={700}>clock uncertainty 2.60</text>
      <line x1={x(0.943)} y1={30} x2={x(0.943)} y2={120} stroke={GREEN} strokeWidth={2} strokeDasharray="4 3"/>
      <line x1={x(3.302)} y1={84} x2={x(3.302)} y2={120} stroke="currentColor"/>
      <text x={x(3.302)} y={80} fontSize={10} textAnchor="middle" fill="currentColor">필요 3.302</text>
      <text x={x(2.0)} y={78} fontSize={11} textAnchor="middle" fill={RED} fontWeight={700}>slack = 0.943 − 3.302 = −2.359 (위반)</text>
      <text x={x(0.943) + 6} y={22} fontSize={10.5} textAnchor="start" fill={GREEN}>uncertainty를 빼면 필요 0.702 → +0.24 (여유)</text>
    </svg>
    <figcaption style={cap}>데이터는 0.943ns에 도착하는데 필요 시간은 3.302ns입니다. 필요 시간의 <b>대부분(2.6ns)이 clock uncertainty</b>입니다. 이 마진을 빼면 같은 경로가 +0.24ns 여유로 통과합니다.</figcaption>
  </figure>
}

// ④ 원인의 사슬
export function TimingChainFigure() {
  const boxes = [
    { n: '①', t: 'SDC: clock uncertainty', s: '주기의 5% (axi 2.6ns)' },
    { n: '②', t: 'hold 필요 시간이 커짐', s: '짧은 경로 약 4,170개 위반' },
    { n: '③', t: 'resizer가 지연 셀 삽입', s: 'hold 버퍼 약 8,080개' },
    { n: '④', t: '같은 경로의 setup도 느려짐', s: '경로가 같아서 지연이 그대로 더해짐' },
    { n: '⑤', t: 'ss 코너에서 허용 49.1ns 초과', s: '셀이 느려져 WNS 음수' },
    { n: '⑥', t: '모양은 "몰리는 경로"만 바꿈', s: '총량은 같고 11개 vs 18개' },
  ]
  const pos = [[20, 14], [235, 14], [450, 14], [450, 100], [235, 100], [20, 100]]
  return <figure style={{ margin: 0 }}>
    <svg viewBox="0 0 640 176" width="100%" style={wrap} role="img" aria-label="clock uncertainty에서 setup WNS 위반까지의 원인 사슬">
      <defs><marker id="tc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker></defs>
      {boxes.map((b, i) => <g key={b.n}>
        <rect x={pos[i][0]} y={pos[i][1]} width={170} height={62} rx={6} fill={i === 4 ? '#f6d5d1' : i === 5 ? '#d7ede3' : BLUE} stroke={i === 4 ? RED : i === 5 ? GREEN : BLUE_D} opacity={0.95}/>
        <text x={pos[i][0] + 8} y={pos[i][1] + 20} fontSize={12} fontWeight={700} fill="#0b2a47">{b.n} {b.t}</text>
        <text x={pos[i][0] + 8} y={pos[i][1] + 42} fontSize={10.5} fill="#0b2a47">{b.s}</text>
      </g>)}
      <line x1={192} y1={45} x2={233} y2={45} stroke="currentColor" markerEnd="url(#tc-arrow)"/>
      <line x1={407} y1={45} x2={448} y2={45} stroke="currentColor" markerEnd="url(#tc-arrow)"/>
      <line x1={535} y1={78} x2={535} y2={98} stroke="currentColor" markerEnd="url(#tc-arrow)"/>
      <line x1={448} y1={131} x2={407} y2={131} stroke="currentColor" markerEnd="url(#tc-arrow)"/>
      <line x1={233} y1={131} x2={192} y2={131} stroke="currentColor" markerEnd="url(#tc-arrow)"/>
    </svg>
    <figcaption style={cap}>①~④는 모양과 무관하게 같고, <b>⑥에서만 모양이 영향을 줍니다.</b> 배선 길이는 이 사슬 어디에도 들어 있지 않습니다.</figcaption>
  </figure>
}

// ⑤ 공정·전압·온도에 따른 셀 지연 (sky130_fd_sc_hd Liberty, dlygate4sd3_1)
// 값: 표의 입력 slew 0.053ns · 부하 약 0.0037pF 한 점에서 cell_rise와 cell_fall의 평균.
const SS_N40 = [[1.76, 0.742], [1.60, 1.077], [1.44, 1.732], [1.40, 2.050], [1.35, 2.549], [1.28, 3.680]]
const FF_N40 = [[1.95, 0.377], [1.76, 0.467], [1.65, 0.548], [1.56, 0.644]]
const SS_100 = [[1.60, 1.112], [1.40, 1.657]]
export function CornerDelayFigure() {
  const X0 = 70, X1 = 600, Y0 = 200, Y1 = 30
  const vx = (v: number) => X0 + (v - 1.25) / (2.0 - 1.25) * (X1 - X0)
  const dy = (d: number) => Y0 - d / 4 * (Y0 - Y1)
  const line = (pts: number[][]) => pts.map(([v, d], i) => `${i ? 'L' : 'M'}${vx(v).toFixed(1)} ${dy(d).toFixed(1)}`).join(' ')
  return <figure style={{ margin: 0 }}>
    <svg viewBox="0 0 640 262" width="100%" style={wrap} role="img" aria-label="전원 전압에 따른 지연 셀 dlygate4sd3_1의 지연">
      {[0, 1, 2, 3, 4].map(t => <g key={t}>
        <line x1={X0} y1={dy(t)} x2={X1} y2={dy(t)} stroke={GRAY} opacity={0.35}/>
        <text x={X0 - 8} y={dy(t) + 4} fontSize={10} textAnchor="end" fill="currentColor">{t}</text>
      </g>)}
      {[1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0].map(v => <text key={v} x={vx(v)} y={Y0 + 16} fontSize={10} textAnchor="middle" fill="currentColor">{v.toFixed(1)}</text>)}
      <text x={(X0 + X1) / 2} y={Y0 + 34} fontSize={10.5} textAnchor="middle" fill="currentColor">전원 전압 (V)</text>
      <text x={16} y={(Y0 + Y1) / 2} fontSize={10.5} textAnchor="middle" fill="currentColor" transform={`rotate(-90 16 ${(Y0 + Y1) / 2})`}>지연 (ns)</text>
      <path d={line(SS_N40)} fill="none" stroke={RED} strokeWidth={2}/>
      <path d={line(FF_N40)} fill="none" stroke={BLUE_D} strokeWidth={2}/>
      <path d={line(SS_100)} fill="none" stroke={ORANGE} strokeWidth={2} strokeDasharray="5 3"/>
      {SS_N40.map(([v, d]) => <circle key={'s' + v} cx={vx(v)} cy={dy(d)} r={3.5} fill={RED}/>)}
      {FF_N40.map(([v, d]) => <circle key={'f' + v} cx={vx(v)} cy={dy(d)} r={3.5} fill={BLUE_D}/>)}
      {SS_100.map(([v, d]) => <circle key={'h' + v} cx={vx(v)} cy={dy(d)} r={3.5} fill={ORANGE}/>)}
      <circle cx={vx(1.80)} cy={dy(0.550)} r={4.5} fill={GREEN}/>
      <text x={vx(1.80) + 8} y={dy(0.550) - 6} fontSize={10} fill={GREEN}>tt 25°C 1.80V: 0.55</text>
      <text x={vx(1.95) - 4} y={dy(0.377) + 16} fontSize={10} textAnchor="end" fill={BLUE_D}>ff −40°C 1.95V: 0.38 (STA 코너)</text>
      <text x={vx(1.60) + 8} y={dy(1.112) - 8} fontSize={10} fill={ORANGE}>ss 100°C 1.60V: 1.11 (STA 코너)</text>
      <text x={vx(1.28) + 8} y={dy(3.680) + 4} fontSize={10} fill={RED}>ss −40°C 1.28V: 3.68</text>
      <rect x={X0} y={246} width={10} height={10} fill={RED}/><text x={X0 + 14} y={255} fontSize={10} fill="currentColor">ss, −40°C (전압만 바꿈)</text>
      <rect x={X0 + 170} y={246} width={10} height={10} fill={ORANGE}/><text x={X0 + 184} y={255} fontSize={10} fill="currentColor">ss, 100°C</text>
      <rect x={X0 + 270} y={246} width={10} height={10} fill={BLUE_D}/><text x={X0 + 284} y={255} fontSize={10} fill="currentColor">ff, −40°C (전압만 바꿈)</text>
      <rect x={X0 + 440} y={246} width={10} height={10} fill={GREEN}/><text x={X0 + 454} y={255} fontSize={10} fill="currentColor">tt</text>
    </svg>
    <figcaption style={cap}>hold 수리에 쓰는 지연 셀 <code>dlygate4sd3_1</code>의 지연입니다. <b>같은 공정·온도에서 전압만 1.76V → 1.28V로 낮추면 0.74 → 3.68ns(약 5배)</b>가 됩니다. STA가 쓰는 세 코너만 보면 ff 0.38 · tt 0.55 · ss 1.11ns로, ss가 ff의 약 2.9배입니다. 값은 Liberty 표의 한 점(입력 slew 0.053ns, 부하 약 0.0037pF)이라 실제 경로 조건에서는 조금 다릅니다.</figcaption>
  </figure>
}

// ⑥ 열 관리 단계와 히스테리시스 (예시 값 — 이 프로젝트 칩에는 온도 센서가 없음)
export function ThermalControlFigure() {
  const X0 = 60, X1 = 610, Y0 = 210, Y1 = 24
  const tx = (t: number) => X0 + t / 12 * (X1 - X0)
  const ty = (c: number) => Y0 - (c - 40) / (110 - 40) * (Y0 - Y1)
  const curve = [[0, 55], [1.5, 68], [3, 82], [4, 92], [4.8, 95], [5.6, 93], [6.6, 88], [7.4, 85], [8.2, 88], [9.2, 92], [10, 94], [10.8, 90], [12, 86]]
  const d = curve.map(([t, c], i) => `${i ? 'L' : 'M'}${tx(t).toFixed(1)} ${ty(c).toFixed(1)}`).join(' ')
  const lines = [
    { c: 100, label: '긴급 차단 100°C (= sign-off 상한)', color: RED },
    { c: 92, label: '스로틀 시작 92°C', color: ORANGE },
    { c: 85, label: '경고 · 스로틀 해제 85°C', color: GREEN },
  ]
  return <figure style={{ margin: 0 }}>
    <svg viewBox="0 0 640 250" width="100%" style={wrap} role="img" aria-label="칩 온도에 따른 경고, 스로틀링, 긴급 차단 단계와 히스테리시스">
      <rect x={tx(4)} y={Y1} width={tx(7.4) - tx(4)} height={Y0 - Y1} fill={ORANGE} opacity={0.12}/>
      <rect x={tx(9.2)} y={Y1} width={tx(12) - tx(9.2)} height={Y0 - Y1} fill={ORANGE} opacity={0.12}/>
      <text x={(tx(4) + tx(7.4)) / 2} y={Y0 - 8} fontSize={10} textAnchor="middle" fill="#a86b05">스로틀 중</text>
      <text x={(tx(9.2) + tx(12)) / 2} y={Y0 - 8} fontSize={10} textAnchor="middle" fill="#a86b05">스로틀 중</text>
      {[40, 60, 80, 100].map(c => <g key={c}>
        <line x1={X0} y1={ty(c)} x2={X1} y2={ty(c)} stroke={GRAY} opacity={0.25}/>
        <text x={X0 - 8} y={ty(c) + 4} fontSize={10} textAnchor="end" fill="currentColor">{c}</text>
      </g>)}
      {lines.map(l => <g key={l.c}>
        <line x1={X0} y1={ty(l.c)} x2={X1} y2={ty(l.c)} stroke={l.color} strokeWidth={1.5} strokeDasharray="6 4"/>
        <text x={X0 + 6} y={ty(l.c) - 4} fontSize={10} fill={l.color}>{l.label}</text>
      </g>)}
      <path d={d} fill="none" stroke={BLUE_D} strokeWidth={2.2}/>
      <circle cx={tx(4)} cy={ty(92)} r={4} fill={ORANGE}/>
      <circle cx={tx(7.4)} cy={ty(85)} r={4} fill={GREEN}/>
      <line x1={tx(4)} y1={ty(92) + 5} x2={tx(4)} y2={ty(70) - 10} stroke={ORANGE}/>
      <text x={tx(4) + 6} y={ty(70)} fontSize={10} fill="currentColor">① 92°C 도달 → 클럭·전압 낮춤</text>
      <line x1={tx(7.4)} y1={ty(85) + 5} x2={tx(7.4)} y2={ty(62) - 10} stroke={GREEN}/>
      <text x={tx(7.4) + 6} y={ty(62)} fontSize={10} fill="currentColor">② 85°C 아래 → 해제</text>
      <text x={(X0 + X1) / 2} y={Y0 + 22} fontSize={10.5} textAnchor="middle" fill="currentColor">시간 →</text>
      <text x={16} y={(Y0 + Y1) / 2} fontSize={10.5} textAnchor="middle" fill="currentColor" transform={`rotate(-90 16 ${(Y0 + Y1) / 2})`}>칩 온도 (°C)</text>
    </svg>
    <figcaption style={cap}>온도가 스로틀 시작선(92°C)에 닿으면 클럭·전압을 낮추고, <b>그보다 낮은 해제선(85°C)</b> 아래로 내려와야 원래대로 돌아갑니다(히스테리시스). 차단선은 타이밍을 보장하는 sign-off 상한(이 프로젝트 100°C)에 맞춥니다. 임계값은 설명을 위한 <b>예시</b>이고, 이 프로젝트 칩에는 온도 센서가 없습니다.</figcaption>
  </figure>
}
