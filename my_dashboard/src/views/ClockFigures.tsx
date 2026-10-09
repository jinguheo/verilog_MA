// Evolution SA 배경 지식 15절의 launch/capture 클럭, skew, slew, setup·hold 그림.
//  - LaunchCaptureFigure: 같은 클럭이 두 플롭에 도착하고, 데이터를 내보내는 쪽이 launch, 받는 쪽이 capture
//  - ClockSkewSlewExplorer: skew·slew·데이터 경로 지연을 움직여 setup/hold slack이 어떻게 변하는지 보는 그림
// 탐색기의 숫자는 개념을 보이기 위한 예시 모델이다(주기 10 ns, clk→Q 0.5, uncertainty 0.5, setup 시간 = 0.30 + 0.20·slew, hold 시간 = 0.05 + 0.10·slew).
// chan_top의 실측값은 TimingFigures.tsx의 그림과 15절의 표에 있다.
import { useState } from 'react'

const AMBER = '#EF9F27', TEAL = '#1D9E75', CORAL = '#D85A30', GRAY = '#888780', GOOD = '#1D9E75', BAD = '#E24B4A', PURPLE = '#7F77DD'
const wrap = { maxWidth: 680, display: 'block', margin: '6px 0 10px' } as const
const cap = { margin: '0 0 8px', fontSize: 12, lineHeight: 1.7, color: 'var(--text-secondary)' } as const

// ① launch 플롭과 capture 플롭: 같은 클럭이 두 플롭에 도착하고, 역할만 다르다
export function LaunchCaptureFigure() {
  const box = (x: number, y: number, w: number, h: number, c: string) => <rect x={x} y={y} width={w} height={h} rx={8} fill={c} fillOpacity={0.22} stroke={c} strokeWidth={1}/>
  const arrow = (d: string) => <path d={d} fill="none" stroke="currentColor" strokeWidth={1.4} markerEnd="url(#lcArrow)"/>
  return <figure style={{ margin: 0 }}>
    <svg viewBox="0 0 680 270" width="100%" style={wrap} role="img" aria-label="하나의 클럭이 launch 플롭과 capture 플롭에 도착하는 구조">
      <defs><marker id="lcArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/></marker></defs>
      {box(270, 20, 140, 42, GRAY)}
      <text x={340} y={46} textAnchor="middle" fontSize={13} fontWeight={600} fill="currentColor">클럭 소스</text>
      {arrow('M340 62 L340 112 L135 112 L135 160')}
      {arrow('M340 112 L545 112 L545 160')}
      <text x={135} y={98} textAnchor="middle" fontSize={11} fill="currentColor">이 엣지 = launch 엣지</text>
      <text x={545} y={98} textAnchor="middle" fontSize={11} fill="currentColor">이 엣지 = capture 엣지</text>
      {box(60, 164, 150, 58, PURPLE)}
      <text x={135} y={187} textAnchor="middle" fontSize={13} fontWeight={600} fill="currentColor">플롭 A</text>
      <text x={135} y={206} textAnchor="middle" fontSize={11} fill="currentColor">launch flop</text>
      {box(270, 172, 140, 42, GRAY)}
      <text x={340} y={198} textAnchor="middle" fontSize={13} fontWeight={600} fill="currentColor">조합 로직</text>
      {box(470, 164, 150, 58, TEAL)}
      <text x={545} y={187} textAnchor="middle" fontSize={13} fontWeight={600} fill="currentColor">플롭 B</text>
      <text x={545} y={206} textAnchor="middle" fontSize={11} fill="currentColor">capture flop</text>
      {arrow('M210 193 L268 193')}
      {arrow('M410 193 L468 193')}
      <text x={135} y={246} textAnchor="middle" fontSize={11} fill="currentColor">데이터를 내보내는 쪽</text>
      <text x={545} y={246} textAnchor="middle" fontSize={11} fill="currentColor">데이터를 받아 저장하는 쪽</text>
    </svg>
    <figcaption style={cap}>클럭이 둘인 것이 아니라 <b>같은 클럭이 두 플롭에 각각 도착</b>한 것입니다. 플롭 A에 도착한 클럭이 <b>launch clock</b>, 플롭 B에 도착한 클럭이 <b>capture clock</b>입니다. 이름은 클럭의 종류가 아니라 <b>그 경로에서 플롭이 맡은 역할</b>입니다. B의 출력이 다시 로직을 거쳐 플롭 C로 간다면 그 경로에서는 B가 launch, C가 capture입니다.</figcaption>
  </figure>
}

// ② skew · slew · 경로 지연을 움직여 보는 setup/hold 그림
const T = 10, CQ = 0.5, U = 0.5, DS = 0.3
const X = (t: number) => 40 + (t + 1.5) * 36
const clampT = (t: number) => Math.min(15, Math.max(-1.5, t))
const f2 = (v: number) => v.toFixed(2)
const sg = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2)

function clockPath(cy: number, off: number, slew: number): string {
  const w = slew / 0.8, lo = cy + 14, hi = cy - 14
  const ev: Array<[number, boolean]> = []
  for (let k = -3; k <= 3; k++) { ev.push([off + 10 * k, true]); ev.push([off + 10 * k + 5, false]) }
  ev.sort((a, b) => a[0] - b[0])
  let up0 = false
  for (const e of ev) if (e[0] + w / 2 < -1.5) up0 = e[1]
  let cur = up0 ? hi : lo
  let d = `M${X(-1.5)} ${cur}`
  for (const [t, up] of ev) {
    if (t + w / 2 < -1.5 || t - w / 2 > 15) continue
    const fr = up ? lo : hi, to = up ? hi : lo
    d += ` L${X(clampT(t - w / 2))} ${fr} L${X(clampT(t + w / 2))} ${to}`
    cur = to
  }
  return d + ` L${X(15)} ${cur}`
}

export function ClockSkewSlewExplorer() {
  const [sk, setSk] = useState(0.5), [s, setS] = useState(0.3), [dl, setDl] = useState(5)
  const A = CQ + dl, E0 = sk, Ec = T + sk, tsu = 0.30 + 0.20 * s, th = 0.05 + 0.10 * s
  const sLim = Ec - tsu - U, hLim = E0 + th + U, sS = sLim - A, hS = A - hLim
  const col = sS >= 0 && hS >= 0 ? GOOD : BAD, w = s / 0.8
  const a0 = clampT(A - DS / 2), a1 = clampT(A + DS / 2), tp = 222, bt = 242
  const txt = { fontSize: 11, fill: 'currentColor' } as const
  const arr = (xa: number, xb: number, v: number) => Math.abs(xb - xa) > 3 ? <line x1={xa} y1={280} x2={xb} y2={280} stroke={v >= 0 ? GOOD : BAD} strokeWidth={2} markerEnd="url(#ckArrow)"/> : null
  const slider = (label: string, value: number, set: (v: number) => void, min: number, max: number, step: number, shown: string) =>
    <label style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, margin: '4px 0' }}>
      <span style={{ minWidth: 150 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => set(Number(e.target.value))} style={{ flex: 1, maxWidth: 360 }}/>
      <b style={{ minWidth: 80, textAlign: 'right' }}>{shown}</b>
    </label>
  const card = (k: string, v: string, f: string, ok?: boolean) => <div style={{ flex: '1 1 190px', padding: '8px 12px', borderRadius: 8, background: 'var(--surface-muted)' }}>
    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{k}</div>
    <div style={{ fontSize: 20, fontWeight: 700, color: ok === undefined ? 'inherit' : ok ? 'var(--success)' : 'var(--danger)' }}>{v}</div>
    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{f}</div>
  </div>
  return <figure style={{ margin: 0 }}>
    <svg viewBox="0 0 680 336" width="100%" style={wrap} role="img" aria-label="launch 클럭, skew와 slew를 가진 capture 클럭, 데이터, setup·hold 창과 slack">
      <defs><marker id="ckArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/></marker></defs>
      <text x={44} y={48} {...txt}>launch clock (플롭 A)</text>
      <text x={44} y={128} {...txt}>capture clock (플롭 B)</text>
      <text x={44} y={212} {...txt}>data (A → B)</text>
      <rect x={X(sLim)} y={30} width={X(Ec - tsu) - X(sLim)} height={220} fill={AMBER} fillOpacity={0.22}/>
      <rect x={X(Ec - tsu)} y={30} width={Math.max(1, X(Ec) - X(Ec - tsu))} height={220} fill={AMBER} fillOpacity={0.6}/>
      <rect x={X(E0)} y={30} width={Math.max(1, X(E0 + th) - X(E0))} height={220} fill={TEAL} fillOpacity={0.6}/>
      <rect x={X(E0 + th)} y={30} width={X(hLim) - X(E0 + th)} height={220} fill={TEAL} fillOpacity={0.22}/>
      <line x1={X(0)} y1={56} x2={X(0)} y2={250} stroke="var(--border-strong)" strokeWidth={0.8} strokeDasharray="4 3"/>
      <path d={clockPath(70, 0, 0.2)} fill="none" stroke="var(--text-secondary)" strokeWidth={1.5}/>
      <path d={clockPath(150, sk, s)} fill="none" stroke="currentColor" strokeWidth={1.5}/>
      <line x1={X(clampT(E0 - w / 2))} y1={164} x2={X(clampT(E0 + w / 2))} y2={136} stroke={CORAL} strokeWidth={3} strokeLinecap="round"/>
      <text x={X(E0) + 10} y={180} {...txt}>slew {f2(s)} ns</text>
      <line x1={X(Math.min(0, sk))} y1={104} x2={X(Math.max(0, sk))} y2={104} stroke="var(--text-secondary)" strokeWidth={1.5}/>
      <line x1={X(0)} y1={98} x2={X(0)} y2={110} stroke="var(--text-secondary)" strokeWidth={1.5}/>
      <line x1={X(sk)} y1={98} x2={X(sk)} y2={110} stroke="var(--text-secondary)" strokeWidth={1.5}/>
      <text x={X(Math.max(0, sk)) + 10} y={108} {...txt}>skew {sg(sk)} ns</text>
      <path d={`M${X(-1.5)} ${tp} L${X(a0)} ${tp} M${X(-1.5)} ${bt} L${X(a0)} ${bt}`} fill="none" stroke={GRAY} strokeWidth={1.5}/>
      <path d={`M${X(a0)} ${tp} L${X(a1)} ${bt} L${X(15)} ${bt} M${X(a0)} ${bt} L${X(a1)} ${tp} L${X(15)} ${tp}`} fill="none" stroke={TEAL} strokeWidth={1.5}/>
      <line x1={X(A)} y1={218} x2={X(A)} y2={286} stroke={col} strokeWidth={1} strokeDasharray="4 3"/>
      <text x={X(A) + 4} y={212} {...txt}>새 데이터 도착</text>
      <text x={X((sLim + Ec) / 2)} y={266} textAnchor="middle" {...txt}>setup</text>
      <text x={X((E0 + hLim) / 2)} y={266} textAnchor="middle" {...txt}>hold</text>
      {arr(X(A), X(hLim), hS)}{arr(X(A), X(sLim), sS)}
      <line x1={X(hLim)} y1={274} x2={X(hLim)} y2={286} stroke={hS >= 0 ? GOOD : BAD} strokeWidth={1.5}/>
      <line x1={X(sLim)} y1={274} x2={X(sLim)} y2={286} stroke={sS >= 0 ? GOOD : BAD} strokeWidth={1.5}/>
      <text x={X(A) - 6} y={298} textAnchor="end" fontSize={11} fill={hS >= 0 ? GOOD : BAD}>hold slack {sg(hS)}</text>
      <text x={X(A) + 6} y={298} textAnchor="start" fontSize={11} fill={sS >= 0 ? GOOD : BAD}>setup slack {sg(sS)}</text>
      <line x1={40} y1={304} x2={640} y2={304} stroke="var(--border-strong)" strokeWidth={0.8}/>
      {[[0, '0 (launch 엣지)'], [5, '5 ns'], [10, '10 ns (다음 엣지)']].map(([t, label]) => <g key={String(t)}>
        <line x1={X(Number(t))} y1={300} x2={X(Number(t))} y2={308} stroke="var(--border-strong)" strokeWidth={0.8}/>
        <text x={X(Number(t))} y={324} textAnchor="middle" {...txt}>{label}</text></g>)}
    </svg>
    <div style={{ margin: '0 0 6px' }}>
      {slider('skew (capture − launch)', sk, setSk, -1.5, 3, 0.1, `${sg(sk)} ns`)}
      {slider('capture clock slew', s, setS, 0.1, 2, 0.05, `${f2(s)} ns`)}
      {slider('데이터 경로 지연', dl, setDl, 0.1, 10.5, 0.1, `${f2(dl)} ns`)}
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, margin: '8px 0' }}>
      {card('Setup slack', `${sg(sS)} ns${sS >= 0 ? '' : ' 위반'}`, `도착 ${f2(A)} ≤ 한계 ${f2(sLim)} (= T + skew − setup 시간 − uncertainty)`, sS >= 0)}
      {card('Hold slack', `${sg(hS)} ns${hS >= 0 ? '' : ' 위반'}`, `도착 ${f2(A)} ≥ 한계 ${f2(hLim)} (= skew + hold 시간 + uncertainty)`, hS >= 0)}
      {card('필요한 setup / hold 시간', `${f2(tsu)} / ${f2(th)} ns`, `slew ${f2(s)} ns일 때 (slew가 크면 둘 다 커짐)`)}
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 11, color: 'var(--text-secondary)' }}>
      <span><i style={{ display: 'inline-block', width: 11, height: 11, background: AMBER, opacity: 0.6, marginRight: 5, verticalAlign: -1 }}/>setup 창 + 여유(진한 부분 = 플롭 시간, 옅은 부분 = uncertainty)</span>
      <span><i style={{ display: 'inline-block', width: 11, height: 11, background: TEAL, opacity: 0.6, marginRight: 5, verticalAlign: -1 }}/>hold 창 + 여유</span>
      <span><i style={{ display: 'inline-block', width: 11, height: 11, background: CORAL, marginRight: 5, verticalAlign: -1 }}/>capture 엣지의 slew(10~90 %)</span>
    </div>
    <figcaption style={cap}>
      <b>읽는 법.</b> capture 클럭은 launch 클럭과 같은 클럭이 <b>skew만큼 늦게(또는 일찍) 도착</b>한 것입니다. 데이터는 launch 엣지(0)에서 출발해 경로 지연 뒤에 바뀌고, <b>capture 엣지 앞쪽(setup)과 뒤쪽(hold)의 금지 구간을 피해야</b> 합니다. 데이터 도착 위치에서 두 색 띠 끝까지의 화살표 길이가 slack이며 초록이면 여유, 빨강이면 위반입니다.
      <br/>직접 해 볼 것: ① <b>경로 지연을 키우면</b> setup 위반, <b>줄이면</b> hold 위반입니다. ② <b>skew를 +로 키우면</b> setup 여유는 늘고 hold 여유는 줄며, −로 하면 반대입니다(그래서 한쪽만 고치려고 skew를 조절하기 어렵습니다). ③ <b>slew를 키우면</b> 두 띠가 함께 넓어져 양쪽 여유가 줄어듭니다.
      <br/>이 그림의 숫자는 개념을 보이기 위한 <b>예시 모델</b>이며 실제 라이브러리 값이 아닙니다. chan_top의 실측은 아래 표와 뒤의 막대 그림에 있습니다(skew ≈ +0.001 ns, 위반 원인은 clock uncertainty와 hold 지연 셀).
    </figcaption>
  </figure>
}
