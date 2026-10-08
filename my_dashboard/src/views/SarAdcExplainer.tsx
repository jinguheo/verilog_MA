// "전체 아날로그 회로도" 탭용 SAR ADC · CDAC · Comparator 설명 카드.
// 아래 이진 탐색 표는 입력 전압·비트 수에 맞춰 화면에서 실제로 계산한다(손으로 쓴 값이 아님).
// 프로젝트 사실(12-bit, 1 MS/s 목표, IP 이름, DRC 건수)은 AnalogDesign.tsx 의 기록을 따른다.
import { useState } from 'react'

const VREF = 3.3 // 설명용 기준전압. 이 IP의 실제 기준전압·입력 범위는 IP 문서/CACE 설정으로 확인해야 한다.
const box = { padding: 10, borderRadius: 8, border: '1px solid var(--border-strong)', background: 'var(--surface)' } as const
const p = { margin: '4px 0 8px', fontSize: 13, lineHeight: 1.8 } as const
const h = { fontSize: 14, display: 'block', margin: '16px 0 4px' } as const

const fmtV = (v: number) => `${v.toFixed(4)} V`

function BlockDiagram() {
  const stroke = 'var(--border-strong)', fill = 'var(--surface)'
  const node = (x: number, y: number, w: number, hgt: number, title: string, sub: string, accent?: string) => <g>
    <rect x={x} y={y} width={w} height={hgt} rx={10} fill={fill} stroke={accent ?? stroke} strokeWidth={accent ? 2 : 1.2}/>
    <text x={x + w / 2} y={y + hgt / 2 - 4} textAnchor="middle" fontSize={13} fontWeight={700} fill="currentColor">{title}</text>
    <text x={x + w / 2} y={y + hgt / 2 + 14} textAnchor="middle" fontSize={10.5} fill="currentColor" opacity={0.7}>{sub}</text>
  </g>
  const arrow = (d: string) => <path d={d} fill="none" stroke="currentColor" strokeWidth={1.4} opacity={0.75} markerEnd="url(#sar-arrow)"/>
  return <svg viewBox="0 0 800 230" style={{ width: '100%', maxWidth: 800, display: 'block', color: 'var(--text)' }} role="img" aria-label="SAR ADC 블록 구성: 샘플홀드, CDAC, 비교기, SAR 로직의 되먹임 루프">
    <defs><marker id="sar-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="currentColor"/></marker></defs>
    {node(10, 70, 90, 60, 'VIN', '아날로그 입력')}
    {node(140, 70, 130, 60, 'Sample & Hold', '입력 전압을 붙잡음')}
    {node(320, 70, 150, 60, 'Comparator', '입력 ≷ 후보 전압', '#C0392B')}
    {node(520, 70, 130, 60, 'SAR 로직', '비트 하나씩 결정')}
    {node(690, 70, 100, 60, 'D[11:0]', '12-bit 코드')}
    {node(320, 165, 150, 55, 'CDAC', '후보 코드 → 전압', '#1D9E75')}
    {arrow('M100 100 H138')}{arrow('M270 100 H318')}{arrow('M470 100 H518')}{arrow('M650 100 H688')}
    {arrow('M585 130 V192 H472')}
    {arrow('M320 192 H290 V118 H320')}
    <text x={590} y={160} fontSize={10.5} fill="currentColor" opacity={0.75}>후보 코드</text>
    <text x={258} y={160} fontSize={10.5} fill="currentColor" opacity={0.75} textAnchor="end">후보 전압</text>
    <text x={495} y={92} fontSize={10.5} fill="currentColor" opacity={0.75}>1-bit</text>
    <text x={10} y={30} fontSize={12} fontWeight={700} fill="currentColor">매 사이클: ① 후보 코드 → CDAC가 전압 생성 ② 비교기가 입력과 비교 ③ SAR이 그 비트를 확정하고 다음 비트로</text>
  </svg>
}

export default function SarAdcExplainer() {
  const [vin, setVin] = useState(2.0)
  const [bits, setBits] = useState(4)
  const levels = 2 ** bits, lsb = VREF / levels
  let code = 0
  const steps: { n: number; bit: number; trial: number; vdac: number; keep: boolean }[] = []
  for (let b = bits - 1; b >= 0; b--) {
    const trial = code | (1 << b), vdac = trial * lsb, keep = vin >= vdac
    steps.push({ n: bits - b, bit: b, trial, vdac, keep })
    if (keep) code = trial
  }
  const bin = (c: number) => c.toString(2).padStart(bits, '0')
  const recon = code * lsb, err = vin - recon
  const lsb12 = VREF / 4096

  return <section className="card" style={{ marginTop: 14 }}>
    <div className="card-title"><div><small className="kicker">SAR ADC · CDAC · COMPARATOR</small><h2>SAR ADC는 어떻게 아날로그를 12비트로 바꾸나</h2></div><span className="connection">PPA3 입력단 · 12-bit · 1 MS/s 목표</span></div>
    <p style={p}><b>SAR(Successive Approximation Register, 축차 근사 레지스터)</b> ADC는 입력 전압을 <b>이진 탐색</b>으로 찾아 코드로 바꿉니다. 최상위 비트(MSB)부터 "이 비트를 1로 두면 후보 전압이 입력을 넘나?"를 한 비트씩 물어서, 12비트면 비교 <b>12번</b>으로 4096단계 중 하나를 확정합니다. 이 프로젝트의 PPA3 캡처 경로가 쓰는 <b>Efabless SKY130 12-bit SAR ADC</b>(<code>sky130_ef_ip__adc3v_12bit</code>)가 이 방식입니다. 저장소 구조로 확인한 구성은, ADC가 <b>CDAC IP</b>(<code>cdac3v_12bit</code>)와 <b>비교기 IP</b>(<code>ccomp3v</code>)를 포함하고, <b>샘플홀드와 아날로그 스위치 IP는 CDAC IP의 하위 의존 IP</b>라는 것입니다. 아래 블록 그림은 SAR ADC의 일반 구조이고, IP 경계와는 다를 수 있습니다.</p>

    <BlockDiagram/>

    <b style={h}>1. 이진 탐색을 직접 돌려 보기</b>
    <p style={p}>입력 전압과 비트 수를 바꾸면 아래 표가 즉시 다시 계산됩니다. (기준전압은 설명용으로 {VREF} V로 둔 예시이며, 이 IP의 실제 기준·입력 범위는 IP 문서로 확인해야 합니다.)</p>
    <div style={{ ...box, display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', marginBottom: 8 }}>
      <label style={{ display: 'grid', gap: 3, fontSize: 12, flex: '1 1 260px' }}>입력 전압 VIN: <b>{vin.toFixed(3)} V</b>
        <input type="range" min={0} max={VREF - 0.001} step={0.001} value={vin} onChange={e => setVin(Number(e.target.value))} aria-label="입력 전압"/></label>
      <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>비트 수
        <select value={bits} onChange={e => setBits(Number(e.target.value))}>{[4, 8, 12].map(b => <option key={b} value={b}>{b}-bit</option>)}</select></label>
      <div style={{ fontSize: 12 }}>1 LSB = {VREF} V ÷ {levels.toLocaleString()} = <b>{lsb < 0.01 ? `${(lsb * 1000).toFixed(3)} mV` : `${lsb.toFixed(5)} V`}</b></div>
    </div>
    <div className="data-table"><table><thead><tr><th>사이클</th><th>결정할 비트</th><th>후보 코드</th><th>CDAC 후보 전압</th><th>비교기: VIN ≥ 후보?</th><th>이 비트</th><th>지금까지 코드</th></tr></thead><tbody>
      {(() => { let acc = 0; return steps.map(s => { if (s.keep) acc = s.trial; return <tr key={s.n}>
        <td>{s.n}</td><td>D[{s.bit}]</td><td><code>{bin(s.trial)}</code></td><td>{fmtV(s.vdac)}</td>
        <td>{vin.toFixed(4)} {s.keep ? '≥' : '<'} {s.vdac.toFixed(4)}</td><td><b style={{ color: s.keep ? '#1D9E75' : 'var(--text-muted)' }}>{s.keep ? '1 유지' : '0 되돌림'}</b></td><td><code>{bin(acc)}</code></td></tr> }) })()}
    </tbody></table></div>
    <p style={p}>결과 코드 <b><code>{bin(code)}</code></b> = {code} → 복원 전압 {code} × LSB = <b>{fmtV(recon)}</b>, 양자화 오차 {(err * 1000).toFixed(3)} mV (항상 0 이상 1 LSB 미만). 비교는 {bits}번이면 끝나고, {levels.toLocaleString()}가지를 하나씩 대조할 필요가 없다는 것이 SAR의 핵심입니다.</p>

    <b style={h}>2. CDAC — 후보 전압을 만들고, 정확도를 결정하는 블록</b>
    <p style={p}><b>CDAC(Capacitive DAC)</b>는 이진 가중치 커패시터(C, C/2, C/4 …)를 배열하고, 스위치로 각 커패시터를 기준전압 또는 접지에 연결해 <b>전하 재분배</b>로 후보 전압을 만듭니다. 입력을 샘플링하는 저장 소자도 겸하는 경우가 많습니다. 기본(이진 가중) 구조라면 12비트는 단위 커패시터 4096개가 필요하고 MSB 커패시터는 그 절반(2048개)입니다. 이 IP가 실제로 어떤 분할 구조를 쓰는지는 IP 문서로 확인해야 합니다.</p>
    <ul style={{ margin: '0 0 8px 18px', padding: 0, fontSize: 13, lineHeight: 1.8 }}>
      <li><b>정확도는 커패시터 비율(matching)이 정합니다.</b> 12비트에서 1 LSB는 {VREF} V 기준 약 <b>{(lsb12 * 1000).toFixed(2)} mV</b>이므로, 큰 커패시터의 작은 오차 하나가 코드 여러 개를 틀어지게 합니다. 이 오차가 선형성(<b>INL / DNL</b>)으로 나타납니다.</li>
      <li>그래서 레이아웃이 <b>중심 대칭, dummy 커패시터, guard ring</b>을 지켜야 합니다. 이 프로젝트가 CDAC DRC를 고칠 때 대칭을 깨지 않는 방식으로 고친 이유입니다.</li>
    </ul>

    <b style={h}>3. Comparator — 매 사이클 1비트를 판정하는 블록</b>
    <p style={p}>비교기는 <b>입력(샘플된 전압)이 CDAC 후보 전압보다 큰지 작은지</b>를 0/1로 판정합니다. 보통 <b>프리앰프로 작은 차이를 키운 뒤, 재생(regenerative) 래치의 양의 되먹임으로 한쪽 끝까지 밀어 확정</b>합니다. 래치는 클록에 맞춰 동작하고, 12비트 변환 동안 12번 쓰입니다.</p>
    <div className="data-table"><table><thead><tr><th>성능 항목</th><th>의미</th><th>12-bit에서의 기준</th></tr></thead><tbody>
      <tr><td><b>오프셋</b></td><td>두 입력이 같아도 한쪽으로 치우치는 정도</td><td>1 LSB(약 {(lsb12 * 1000).toFixed(2)} mV)보다 충분히 작아야 함</td></tr>
      <tr><td><b>노이즈</b></td><td>판정이 흔들리는 정도. 입력과 후보가 거의 같을 때 특히 문제</td><td>LSB 이하로 억제</td></tr>
      <tr><td><b>판정 시간</b></td><td>래치가 0/1로 확정되는 시간. 차이가 작을수록 오래 걸림(메타스테이블)</td><td>한 클록 안에 끝나야 함</td></tr>
      <tr><td><b>킥백</b></td><td>래치 전환 때 입력·CDAC 쪽으로 새는 잡음</td><td>CDAC 전압을 흔들지 않아야 함</td></tr>
    </tbody></table></div>

    <b style={h}>4. 1 MS/s 목표의 타이밍 (추정)</b>
    <p style={p}>변환 1회에 1 µs입니다. 샘플링 1~2 사이클 + 비교 12 사이클 = <b>약 13~14 사이클</b>이므로 클록은 대략 <b>13~14 MHz(주기 약 71~77 ns)</b>이고, 비교기·CDAC 정착은 이 한 사이클 안에 끝나야 합니다. 이 값은 목표 변환 속도와 비교 횟수로 계산한 <b>내 추정</b>이며, 실제 클록은 IP 문서나 시뮬레이션 결과로 확인해야 합니다.</p>

    <b style={h}>5. 이 프로젝트에서의 위치</b>
    <div className="analog-circuit-facts">
      <article><b>IP 구성</b><span>ADC <code>sky130_ef_ip__adc3v_12bit</code> = CDAC <code>sky130_ef_ip__cdac3v_12bit</code> + 비교기 <code>sky130_ef_ip__ccomp3v</code>. CDAC IP는 <code>samplehold</code>·<code>analog_switches</code> 하위 IP에 의존합니다. 3.3 V 아날로그 영역입니다.</span></article>
      <article><b>물리 검증 기록</b><span>Magic DRC 기준값 103건 = CDAC 84 + 비교기 4 + 상위 15. 검증용 복사본에서 CDAC는 0이 됐고 ADC 전체에는 19건이 남아 있습니다(대시보드 기록).</span></article>
      <article><b>배치 원칙</b><span>SAR ADC는 아날로그 섬으로 두고 디지털과는 경계에서만 CDC를 둡니다. 비교기는 스위칭 잡음에 민감해 디지털 쪽과 떨어뜨립니다.</span></article>
      <article><b>다음 확인 사항</b><span>수정한 CDAC를 ADC에 합친 새 GDS에서 LVS와 PEX를 다시 돌려, 비율 대칭이 유지됐는지 선형성(INL/DNL)으로 확인해야 합니다.</span></article>
    </div>

    <b style={h}>6. 왜 SAR인가 — 다른 ADC 구조와 비교 (일반적인 범위)</b>
    <div className="data-table"><table><thead><tr><th>구조</th><th>흔한 해상도</th><th>흔한 속도</th><th>특징</th></tr></thead><tbody>
      <tr><td><b>Flash</b></td><td>6~8 bit</td><td>수백 MS/s ~ GS/s</td><td>비교기 2ᴺ−1개를 한 번에 사용 → 빠르지만 12비트에는 면적·전력이 비현실적</td></tr>
      <tr style={{ fontWeight: 700 }}><td>SAR (이 프로젝트)</td><td>8~16 bit</td><td>kS/s ~ 수십 MS/s</td><td>비교기 1개를 N번 재사용 → 작은 면적, 낮은 전력. 커패시터 matching이 정확도를 결정</td></tr>
      <tr><td><b>Pipeline</b></td><td>10~14 bit</td><td>수십 ~ 수백 MS/s</td><td>단계별 잔차 증폭 → 빠르고 정밀하나 증폭기 때문에 전력·면적이 큼</td></tr>
      <tr><td><b>Sigma-delta</b></td><td>16~24 bit</td><td>kS/s ~ 수 MS/s</td><td>오버샘플링과 디지털 필터로 고정밀 → 속도가 느리고 디지털 필터가 필요</td></tr>
    </tbody></table></div>
    <p style={{ ...p, marginTop: 6 }}>12비트 1 MS/s 센서/캡처용 입력은 SAR의 최적 영역에 들어갑니다.</p>
  </section>
}
