import { ReactNode } from 'react'
import AntennaExplainer from './AntennaExplainer'
import ppa3Runs from '../data/ppa3Runs.json'

// "PPA 실험 요약" 탭 — PPA1/2/3의 목적, 요구 사항, 블록 그림, 진행 상황을 한 화면에 모은다.
// 수치와 상태는 PPA 실험 1/2/3 탭, analog/README.md, ppa3_adc_capture 실행 로그에서 확인한 값만 쓴다.

type Kind = 'analog' | 'digital' | 'memory' | 'io'
type StepState = 'done' | 'partial' | 'todo'

const KIND_STYLE: Record<Kind, { fill: string; stroke: string }> = {
  analog: { fill: '#fff4d8', stroke: '#d99312' },
  digital: { fill: '#e9edff', stroke: '#5b6fd9' },
  memory: { fill: '#e5f6f5', stroke: '#168b87' },
  io: { fill: '#f1f1f1', stroke: '#8a8a8a' },
}

function Block({ x, y, w, h, kind, title, sub }: { x: number; y: number; w: number; h: number; kind: Kind; title: string; sub?: string }) {
  const s = KIND_STYLE[kind]
  return <g>
    <rect x={x} y={y} width={w} height={h} rx={8} fill={s.fill} stroke={s.stroke} strokeWidth={1.5} />
    <text x={x + w / 2} y={y + h / 2 - (sub ? 4 : -4)} textAnchor="middle" fontSize={13} fontWeight={700} fill="#1c2230">{title}</text>
    {sub && <text x={x + w / 2} y={y + h / 2 + 13} textAnchor="middle" fontSize={11} fill="#4a5263">{sub}</text>}
  </g>
}

function Arrow({ x1, y1, x2, y2, label }: { x1: number; y1: number; x2: number; y2: number; label?: string }) {
  return <g>
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#6b7385" strokeWidth={1.6} markerEnd="url(#ppaov-arrow)" />
    {label && <text x={(x1 + x2) / 2} y={y1 - 6} textAnchor="middle" fontSize={10} fill="#6b7385">{label}</text>}
  </g>
}

function Defs() {
  return <defs><marker id="ppaov-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#6b7385" /></marker></defs>
}

function Legend() {
  return <div className="ppaov-legend">
    {([['analog', '아날로그'], ['digital', '디지털 로직'], ['memory', '메모리 macro'], ['io', '입출력 / 외부']] as [Kind, string][]).map(([k, t]) =>
      <span key={k}><i style={{ background: KIND_STYLE[k].fill, borderColor: KIND_STYLE[k].stroke }} />{t}</span>)}
  </div>
}

// PPA1: 12-bit SAR ADC 기준점
function Ppa1Diagram() {
  return <svg className="ppaov-svg" viewBox="0 0 760 170" role="img" aria-label="PPA1 블록 그림: 아날로그 입력, S/H, CDAC, 비교기, SAR 로직, 12-bit 출력">
    <Defs />
    <Block x={10} y={55} w={80} h={56} kind="io" title="VIN" sub="아날로그 입력" />
    <Block x={120} y={55} w={90} h={56} kind="analog" title="S/H" sub="샘플·홀드" />
    <rect x={240} y={22} width={400} height={126} rx={12} fill="none" stroke="#d99312" strokeDasharray="5 4" />
    <text x={252} y={40} fontSize={11} fill="#8a6410">SKY130 12-bit SAR ADC (공개 IP · 65,628.68 µm²)</text>
    <Block x={256} y={55} w={100} h={56} kind="analog" title="CDAC" sub="용량 DAC · 대칭" />
    <Block x={386} y={55} w={100} h={56} kind="analog" title="비교기" sub="comparator" />
    <Block x={516} y={55} w={100} h={56} kind="digital" title="SAR 로직" sub="이진 탐색" />
    <Block x={666} y={55} w={84} h={56} kind="io" title="12-bit" sub="byte stream" />
    <Arrow x1={90} y1={83} x2={120} y2={83} />
    <Arrow x1={210} y1={83} x2={256} y2={83} />
    <Arrow x1={356} y1={83} x2={386} y2={83} />
    <Arrow x1={486} y1={83} x2={516} y2={83} />
    <Arrow x1={616} y1={83} x2={666} y2={83} />
    <path d="M566 111 V132 H306 V111" fill="none" stroke="#6b7385" strokeWidth={1.4} markerEnd="url(#ppaov-arrow)" />
    <text x={436} y={128} textAnchor="middle" fontSize={10} fill="#6b7385">비트 결정 → CDAC 재설정</text>
  </svg>
}

// PPA2: ADC 트리거 캡처 경로
function Ppa2Diagram() {
  return <svg className="ppaov-svg" viewBox="0 0 760 170" role="img" aria-label="PPA2 블록 그림: ADC, 샘플 어댑터, 비동기 FIFO, 캡처 버퍼, 4KB SRAM, 읽기 인터페이스">
    <Defs />
    <Block x={6} y={55} w={92} h={56} kind="analog" title="SAR ADC" sub="PPA1 재사용" />
    <Block x={126} y={55} w={100} h={56} kind="digital" title="샘플 어댑터" sub="byte → 12-bit" />
    <Block x={254} y={55} w={92} h={56} kind="digital" title="비동기 FIFO" sub="ADC clk → sys clk" />
    <Block x={374} y={55} w={104} h={56} kind="digital" title="캡처 버퍼" sub="ring · pre/post" />
    <Block x={506} y={34} w={104} h={98} kind="memory" title="SRAM 4 KB" sub="1,024 × 32" />
    <Block x={638} y={55} w={116} h={56} kind="io" title="읽기 인터페이스" sub="valid/ready · done" />
    <Arrow x1={98} y1={83} x2={126} y2={83} />
    <Arrow x1={226} y1={83} x2={254} y2={83} />
    <Arrow x1={346} y1={83} x2={374} y2={83} />
    <Arrow x1={478} y1={83} x2={506} y2={83} />
    <Arrow x1={610} y1={83} x2={638} y2={83} />
    <text x={300} y={26} textAnchor="middle" fontSize={11} fill="#5b6fd9">CDC 경계 (clock domain 교차)</text>
    <line x1={300} y1={30} x2={300} y2={52} stroke="#5b6fd9" strokeDasharray="3 3" />
    <text x={558} y={152} textAnchor="middle" fontSize={10} fill="#4a5263">word = 16-bit 레코드(12-bit + flag 4-bit) × 2</text>
  </svg>
}

// PPA3: ADC + SRAM + CDC 를 한 die 에 배치 (실제 좌표 · 축척)
function Ppa3Diagram() {
  const s = 0.55 // µm → px
  const X = (v: number) => 12 + v * s
  const Y = (v: number) => 12 + v * s
  const W = (v: number) => v * s
  return <svg className="ppaov-svg" viewBox="0 0 720 360" role="img" aria-label="PPA3 floorplan: 1250×600 µm die 안에 ADC, CDC, SRAM macro 배치">
    <Defs />
    <rect x={X(0)} y={Y(0)} width={W(1250)} height={W(600)} rx={4} fill="#fafbfd" stroke="#8a8a8a" strokeWidth={1.5} />
    <rect x={X(40)} y={Y(150)} width={W(223.71)} height={W(293.365)} rx={4} fill={KIND_STYLE.analog.fill} stroke={KIND_STYLE.analog.stroke} strokeWidth={1.5} />
    <text x={X(40) + W(223.71) / 2} y={Y(150) + W(293.365) / 2 - 2} textAnchor="middle" fontSize={13} fontWeight={700} fill="#1c2230">ADC / CDAC</text>
    <text x={X(40) + W(223.71) / 2} y={Y(150) + W(293.365) / 2 + 14} textAnchor="middle" fontSize={10} fill="#4a5263">223.7 × 293.4 µm · 3.3 V</text>
    <rect x={X(430)} y={Y(65)} width={W(764.24)} height={W(460.28)} rx={4} fill={KIND_STYLE.memory.fill} stroke={KIND_STYLE.memory.stroke} strokeWidth={1.5} />
    <text x={X(430) + W(764.24) / 2} y={Y(65) + W(460.28) / 2 - 2} textAnchor="middle" fontSize={13} fontWeight={700} fill="#1c2230">SRAM22 1024 × 32</text>
    <text x={X(430) + W(764.24) / 2} y={Y(65) + W(460.28) / 2 + 14} textAnchor="middle" fontSize={10} fill="#4a5263">764.2 × 460.3 µm · capture 4 KB</text>
    <rect x={X(290)} y={Y(250)} width={W(120)} height={W(110)} rx={4} fill={KIND_STYLE.digital.fill} stroke={KIND_STYLE.digital.stroke} strokeWidth={1.5} strokeDasharray="4 3" />
    <text x={X(290) + W(60)} y={Y(250) + W(55) - 2} textAnchor="middle" fontSize={11} fontWeight={700} fill="#1c2230">CDC</text>
    <text x={X(290) + W(60)} y={Y(250) + W(55) + 12} textAnchor="middle" fontSize={10} fill="#4a5263">+ 어댑터</text>
    <text x={X(0) + 2} y={Y(600) + 18} fontSize={11} fill="#4a5263">die 1250 × 600 µm · ADC/SRAM은 실제 OpenLane 좌표·크기(축척) · 점선 CDC 영역은 위치를 나타낸 개념도</text>
  </svg>
}

type Step = [StepState, string]

function StepList({ steps }: { steps: Step[] }) {
  const mark: Record<StepState, string> = { done: '완료', partial: '진행/부분', todo: '남음' }
  return <ul className="ppaov-steps">{steps.map(([st, text], i) =>
    <li key={i} className={st}><em>{mark[st]}</em><span>{text}</span></li>)}</ul>
}

function ExperimentCard({ id, title, badge, badgeKind, purpose, diagram, caption, reqs, steps, note }: {
  id: string; title: string; badge: string; badgeKind: 'ok' | 'blocked'; purpose: ReactNode; diagram: ReactNode; caption: string
  reqs: [string, string][]; steps: Step[]; note?: ReactNode
}) {
  const done = steps.filter(s => s[0] === 'done').length
  return <section className="card ppaov-card">
    <div className="card-title"><div><small className="kicker">{id}</small><h3>{title}</h3></div><span className={`analog-badge ${badgeKind}`}>{badge}</span></div>
    <p className="ppaov-purpose"><b>목적.</b> {purpose}</p>
    <div className="ppaov-diagram">{diagram}<p className="ppaov-caption">{caption}</p></div>
    <div className="ppaov-cols">
      <div>
        <span className="panel-label">요구 사항</span>
        <div className="data-table"><table><tbody>{reqs.map(([k, v]) => <tr key={k}><td><b>{k}</b></td><td>{v}</td></tr>)}</tbody></table></div>
      </div>
      <div>
        <span className="panel-label">진행 상황 · {done} / {steps.length} 단계 완료</span>
        <div className="ppaov-bar" aria-hidden="true">{steps.map((s, i) => <i key={i} className={s[0]} />)}</div>
        <StepList steps={steps} />
      </div>
    </div>
    {note && <p className="ppaov-note">{note}</p>}
  </section>
}

// PPA3 실제 run 결과 (python tools/collect_ppa3_results.py 가 run 폴더의 state_out.json / final/metrics.json 에서 읽음)
interface Ppa3Run {
  run: string; label: string; state: 'finished' | 'running' | 'stopped' | 'unknown'; exit_code: number | null
  last_step: string | null; updated: string; magic_drc_mode?: 'GDS' | 'DEF' | null
  metrics: { setup_ws?: number | null; hold_ws?: number | null; antenna_nets?: number | null; route_drc?: number | null; magic_drc?: number | null; klayout_drc?: number | null; lvs?: number | null; xor?: number | null; utilization?: number | null; power?: number | null }
}
const PPA3_RUNS = ppa3Runs.runs as unknown as Ppa3Run[]
const notRun = <span style={{ color: 'var(--text-muted)' }}>미실행</span>
const superseded = <span style={{ color: 'var(--text-muted)' }} title="더 나중 run이 이 구간을 이어받아 다시 돌므로 따로 돌릴 필요가 없습니다">대체됨</span>
const cnt = (v?: number | null, old = false) => v == null ? (old ? superseded : notRun) : <b style={{ color: v === 0 ? 'var(--success)' : 'var(--danger)' }}>{v}</b>
const ns = (v?: number | null) => v == null ? '-' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`
const stepName = (s: string | null) => s ? s.replace(/^\d+-/, '') : '-'
const ppa3State = (r: Ppa3Run) => r.state === 'running' ? <span className="connection">실행 중</span> : r.state === 'finished' ? <span className="ok-badge">완주</span>
  : <span className="warning-badge">{r.exit_code ? `중단 (exit ${r.exit_code})` : '중단·미완'}</span>

export default function PpaOverview() {
  return <section className="ppaov">
    <section className="card">
      <div className="card-title"><div><small className="kicker">PPA EXPERIMENT MAP</small><h2>PPA 실험 1 → 2 → 3 한눈에 보기</h2></div><span className="connection">2026-10-04 기준</span></div>
      <p className="ppaov-intro">세 실험은 이어져 있습니다. <b>1번</b>이 ADC 기준점(면적·DRC/LVS)을 잡고, <b>2번</b>이 그 ADC 뒤에 붙는 캡처 데이터 경로(RTL)를 검증하며, <b>3번</b>이 둘을 한 칩 안에 배치·라우팅해 물리 구현으로 묶습니다. 아날로그 측 물리 게이트(CDAC DRC 잔여 6건)는 1번에서 시작해 3번까지 이어집니다.</p>
      <div className="data-table"><table><thead><tr><th>실험</th><th>한 줄 목적</th><th>범위</th><th>상태</th></tr></thead><tbody>
        <tr><td><b>PPA 1</b></td><td>공개 12-bit SAR ADC를 골라 면적·물리 검증 기준점 확보</td><td>아날로그 IP · DRC/LVS</td><td><span className="analog-badge blocked">물리 게이트 보류</span> CDAC DRC 6건</td></tr>
        <tr><td><b>PPA 2</b></td><td>ADC 샘플을 이벤트 전후로 4 KB SRAM에 저장·전송하는 데이터 경로</td><td>RTL · 기능 검증</td><td><span className="analog-badge ok">완료</span> TB 3종 PASS · lint pass</td></tr>
        <tr><td><b>PPA 3</b></td><td>ADC + CDC + SRAM을 한 die에 배치·라우팅해 물리 구현</td><td>OpenLane · signoff</td><td><span className="analog-badge blocked">flow 완주 · signoff 위반 남음</span> antenna 0 · XOR 0 · Magic DRC/LVS는 위반 있음</td></tr>
      </tbody></table></div>
      <Legend />
    </section>

    <ExperimentCard
      id="PPA EXPERIMENT 1 · BASELINE"
      title="SKY130A 12-bit ADC 기준점"
      badge="물리 게이트 보류"
      badgeKind="blocked"
      purpose={<>이후 모든 비교의 <b>기준점</b>이 되는 ADC를 정합니다. 공개 SKY130 12-bit SAR ADC 후보를 평가해 선택하고, 실제 면적과 DRC/LVS 통과 여부를 측정합니다. DRC 0 · LVS match가 되어야 PEX와 Pareto(성능 : 전력 : 면적 = 2 : 1 : 1) 비교로 넘어갑니다.</>}
      diagram={<Ppa1Diagram />}
      caption="SAR ADC 기본 구조. 이 중 CDAC(용량 DAC)의 대칭·매칭이 12-bit 선형성(INL/DNL)을 좌우하므로 DRC 수정도 대칭을 깨지 않게 합니다."
      reqs={[
        ['공정 / 기능', 'SKY130A · 12-bit ADC'],
        ['동작 조건', '3.3 V · TT · 25 °C'],
        ['성능', '1 MS/s'],
        ['전력 / 면적', '≤ 20 mW · ≤ 0.5 mm² (실측 0.0656 mm²)'],
        ['물리 검증', 'Magic/KLayout DRC 0 · Netgen LVS match'],
        ['비교 방식', 'Pareto — 성능 : 전력 : 면적 = 2 : 1 : 1'],
      ]}
      steps={[
        ['done', 'ADC 후보 선정 — Efabless SKY130 12-bit SAR (score 104)'],
        ['done', '면적 측정 — 65,628.68 µm², 예산 통과'],
        ['done', 'Netgen LVS match (adapter 수정)'],
        ['done', 'switch dependency 교정(34a2361) · EF_SW_RST 경계 보정 (CDAC Magic DRC 84 → 6)'],
        ['done', 'CDAC 잔여 DRC 6건(diff/tap.18,20) → 0건 — 검증용 복사본에서 수정 (LVS/KLayout 결과는 수정 전과 동일, 2026-10-05)'],
        ['partial', 'ADC 단독(mag 기준) Magic DRC에는 같은 규칙 19건이 CDAC 밖(비교기)에 남음 — 단, PPA3 top-level GDS DRC 결과에는 이 규칙이 나타나지 않음(2026-10-08 확인)'],
        ['todo', '새 GDS 기준 KLayout DRC · CDAC LVS 재실행'],
        ['todo', 'PEX 후 성능·전력 실측 · Pareto 비교'],
      ]}
      note="CDAC 단독의 6건은 닫혔습니다. PPA 3 top-level GDS DRC에서는 CDAC/비교기의 diff/tap.18,20 규칙이 나타나지 않았으므로(2026-10-08), 이 수정이 PPA3 DRC 통과에 필요한지는 따로 확인해야 합니다."
    />

    <ExperimentCard
      id="PPA EXPERIMENT 2 · IMPLEMENTATION"
      title="ADC 트리거 캡처 · 4 KB SRAM"
      badge="완료 (RTL verified)"
      badgeKind="ok"
      purpose={<>ADC 출력을 그냥 흘려보내지 않고, <b>트리거 이벤트 전후의 파형을 4 KB SRAM에 보관</b>했다가 필요할 때 읽어 가는 경로를 만듭니다. ADC clock과 시스템 clock 사이의 CDC, SRAM 저장 형식, 읽기 프로토콜까지 RTL 수준에서 먼저 고정해 PPA 3의 배치 입력으로 넘깁니다.</>}
      diagram={<Ppa2Diagram />}
      caption="ADC 한 개와 캡처 전용 SRAM 한 개. 이 SRAM은 ADC 보정(calibration) LUT용 4 KB와는 별도의 두 번째 macro입니다."
      reqs={[
        ['ADC 입력', '12-bit · 1 MS/s byte stream (PPA 1 ADC 재사용)'],
        ['저장 형식', '32-bit word = (12-bit sample + 4-bit flag) × 2'],
        ['버퍼 용량', '4 KB · 1,024 × 32 · 최대 2,048 samples'],
        ['관측 창', '2.048 ms (1 MS/s 기준, trigger 전/후 분할)'],
        ['CDC', 'ADC clock → system clock, 비동기 FIFO 한 경계'],
        ['읽기', 'valid/ready + done · backpressure 처리'],
      ]}
      steps={[
        ['done', 'adc_byte_to_sample — 12-bit 복원, 단위 테스트 PASS'],
        ['done', 'adc_capture_buffer — ring · pre/post trigger · freeze · readout 테스트 PASS'],
        ['done', 'adc_stream_capture wrapper — 통합 테스트 PASS · lint pass'],
        ['done', '재사용 확인 — sar_adc_ch, prim_fifo_async'],
        ['done', 'SRAM macro 선정 — SRAM22 1024×32 (물리 view 확인)'],
        ['todo', '합성·STA, 배치·라우팅, DRC/LVS는 PPA 3 wrapper에서 수행 (이 실험의 범위 밖)'],
      ]}
      note="2026-10-04에 테스트벤치 3종을 직접 실행해 PASS를 확인했습니다. 폴더 asic/ppa3_adc_capture/ 안의 ppa2_*.log는 이름만 PPA2이고 실제로는 PPA 3 wrapper의 물리 실행 로그입니다."
    />

    <ExperimentCard
      id="PPA EXPERIMENT 3 · PHYSICAL INTEGRATION"
      title="ADC · CDC · SRAM 배치 · 라우팅"
      badge="routed · signoff 대기"
      badgeKind="blocked"
      purpose={<>PPA 1의 ADC와 PPA 2의 캡처 경로를 <b>하나의 1250×600 µm die에 올려 실제 배치·CTS·라우팅</b>까지 실행하고, DRC/LVS/PEX를 거쳐 최종 PPA(성능·전력·면적)를 처음으로 측정하는 단계입니다.</>}
      diagram={<Ppa3Diagram />}
      caption="실제 macro 좌표와 크기를 축척대로 그렸습니다. 아날로그(좌) · CDC(중간) · SRAM(우)을 분리해 ADC 전원·잡음 영역을 디지털에서 떼어 놓았습니다."
      reqs={[
        ['성능 / PVT', '12-bit · 1 MS/s · 3.3 V · TT/25 °C'],
        ['전력 / 면적', '≤ 15 mW · ≤ 100,000 µm² (ADC 65,629 + CDAC 수리 여유)'],
        ['Pareto 가중', '2 : 1 : 2'],
        ['아날로그 macro', '좌측 고정 · CDAC 대칭축 · dummy · guard ring 보존'],
        ['디지털 / SRAM', '우측 분리 · CDC는 두 영역 사이 · readout 핀이 외곽을 향함'],
        ['실행 게이트', 'antenna 0 · XOR 0 확인됨 → Magic DRC(SRAM 내부 제외 판정) · KLayout DRC 1건 · LVS 불일치 해소 → PEX'],
      ]}
      steps={[
        ['done', 'wrapper RTL (ppa3_adc_capture_top) lint pass'],
        ['done', 'floorplan 고정 — ADC (40,150) · SRAM (430,65)'],
        ['done', 'baseline: OpenLane 59/74단계까지 실행 — route DRC 0 · setup/hold 위반 0 · util 64.9%'],
        ['done', 'antenna 수리 재실행 — 7건 → 0건 (ppa3_antfix2, 2026-10-04: 긴 배선 300µm 분할 repair + heuristic diode) · route DRC 0 · 최악 setup +10.39 ns'],
        ['done', 'Magic.WriteLEF 통과 — SRAM macro GDS의 읽기 오류 97건을 무시하는 설정으로 (MAGIC_CAPTURE_ERRORS=false)'],
        ['done', 'OpenLane 전 단계 완주 (ppa3_antfix4_signoff, 2026-10-05) — 위반이 있어도 끝까지 돌리는 설정, 개수는 그대로 기록'],
        ['partial', 'signoff 결과: Magic DRC 15,861,362건(GDS 전체 기준, 그중 15,859,501건이 SRAM macro 내부 — 공급자 IP 내부라 제외 범위를 명시해서 따로 보고하며, 제조 쪽이 알아서 처리해 주는 것이 아님 · 나머지 1,861건은 macro 밖 top-level 위반: 래치업 규칙 LU.2/LU.3 1,804건(diffusion이 tap에서 15 µm 이상 멀리 있음)과 nwell.4 57건(nwell 안 N+ tap 없음)이며 전부 ADC 왼쪽 띠(x 20~30 µm, y 141~452 µm)에 몰려 있음 — 이 설계의 실제 확인 대상) · KLayout DRC 1건(npc.2) · LVS 363건 불일치 · 겹침 84건'],
        ['partial', 'CDAC 6건은 복사본에서 해결(0건). 단, PPA3 top-level GDS DRC에는 이 규칙이 나타나지 않아 반영 필요 여부는 확인 전'],
        ['partial', 'LVS 불일치 원인 확인됨(2026-10-05): 레이아웃에서 SRAM·ADC macro의 전원 핀이 어느 net에도 안 연결돼 있고(추출 netlist에 u_sram22/vdd, u_adc/vccd 같은 단독 net), 표준셀 전원은 VPWR/VGND인데 설계 netlist는 macro를 vccd/vssd/vdda/vssa에 묶음. PDN 설정(PDN_MACRO_CONNECTIONS = vccd vssd)이 실제 grid 전원 이름과 달라서 macro가 PDN에 안 붙은 것으로 보임 — 전원 구조(1.8 V 디지털 / 3.3 V 아날로그) 결정이 필요'],
        ['partial', '전원 단순화(단일 전원) + 사용자 정의 PDN 완주 결과(ppa3_pdn_a_signoff, 2026-10-08): SRAM 전원 핀은 met2→met4 via 스택으로 grid에 연결됐지만 LVS는 363 → 387건으로 오히려 늘었고(미연결 pin 36 → 59), KLayout DRC가 1 → 185건(via4.1/via4.2 규칙 184건, ADC 전원 핀 위치 x 188~240 µm)으로 늘었으며 Magic 겹침 검사가 84 → 23,768건이 됨. ADC 전원 rail에 직접 붙인 연결 조각이 LVS를 해결하지 못했고, 자동 생성된 via가 규칙을 위반한 것으로 보임(원인 미확인). 이 방식은 현재 상태로는 개선이 아님'],
        ['todo', 'KLayout npc.2 1건 · ADC 왼쪽 띠의 LU.2/LU.3/nwell.4 1,861건 원인 확인(표준셀·decap이 tap에서 먼 것으로 보이나 미확인) · 단일 전원 PDN 실행에서 ADC 안 16건("겹치면 안 되는 layer", x 228~238 µm, PDN via 때문으로 추정, 미확인)'],
        ['todo', 'PEX 기반 최종 PPA · Pareto 비교'],
      ]}
      note="지금까지의 라우팅 결과는 '후보 기준선'이며 signoff 결과가 아닙니다. vendor GDS는 SHA-256 전후 동일하게 보호되고 검증 복사본만 변경됩니다."
    />
    <section className="card">
      <div className="card-title"><div><small className="kicker">PPA 3 · REAL RUNS</small><h3>PPA 3 실제 실행 결과 (run 폴더에서 자동 수집)</h3></div><span className="connection">{(ppa3Runs.generated as string).replace('T', ' ')} 기준</span></div>
      <div className="data-table"><table><thead><tr><th>실행</th><th>상태</th><th>마지막 완료 단계</th><th>setup / hold WNS (ns)</th><th>antenna</th><th>route DRC</th><th>Magic DRC</th><th>KLayout DRC</th><th>LVS</th><th>XOR</th></tr></thead><tbody>
        {PPA3_RUNS.map(r => { const old = ['ppa3_antenna_fix', 'ppa3_antfix2'].includes(r.run) || r.run.startsWith('RUN_'); return <tr key={r.run}>
          <td><b>{r.run.startsWith('RUN_') ? 'baseline' : r.run}</b><small style={{ display: 'block', color: 'var(--text-muted)' }}>{r.label}</small></td>
          <td>{ppa3State(r)}</td><td>{stepName(r.last_step)}<small style={{ display: 'block', color: 'var(--text-muted)' }}>{r.updated.replace('T', ' ')}</small></td>
          <td>{ns(r.metrics.setup_ws)} / {ns(r.metrics.hold_ws)}</td><td>{cnt(r.metrics.antenna_nets, old)}</td><td>{cnt(r.metrics.route_drc, old)}</td><td>{cnt(r.metrics.magic_drc, old)}{r.metrics.magic_drc != null || r.run.includes('antfix3') || r.run.includes('antfix5') ? <small style={{ display: 'block', color: 'var(--text-muted)' }}>{r.magic_drc_mode === 'DEF' ? 'DEF 기준 · macro 내부 제외' : r.magic_drc_mode === 'GDS' ? 'GDS 전체 기준' : ''}</small> : null}</td><td>{cnt(r.metrics.klayout_drc, old)}</td><td>{cnt(r.metrics.lvs, old)}</td><td>{cnt(r.metrics.xor, old)}</td>
        </tr> })}
      </tbody></table></div>
      <p className="ppaov-note"><b>macro 내부 DRC 위반의 취급:</b> SRAM22 내부 위반(15,859,501건, 일반 로직용 규칙인 local interconnect·diffusion 폭 등)은 hard macro IP 내부라 배치·라우팅으로 줄일 수 없습니다. bitcell이 별도 규칙으로 만들어졌을 가능성이 있지만 공급자에게 확인한 것은 아니며, <b>제조 쪽이 알아서 처리해 주는 것이 아니므로</b> 실제 제조 제출 때는 대상 foundry/MPW의 규칙 파일과 waiver, 공급자 검증서를 확인해야 합니다. 이 실험에서는 macro 내부를 제외한 top-level 위반(1,861건: LU.2/LU.3 래치업 1,804 + nwell.4 57)을 실제 확인 대상으로 보고, 제외한 범위를 이렇게 명시합니다. DEF 기준 DRC는 macro 내부를 보지 않으므로 통과로 세지 않습니다.</p>
      <p className="ppaov-note">&quot;미실행&quot;은 통과가 아니라 <b>그 단계까지 아직 안 갔다</b>는 뜻이고 최종 run에서는 반드시 채워져야 합니다. &quot;대체됨&quot;은 이전 run이라 따로 돌릴 필요가 없다는 뜻입니다. 이어받은 run(<code>ppa3_antfix3_signoff</code>, <code>ppa3_fin*</code>)은 앞 단계 값을 이전 run의 상태에서 물려받습니다. 위반이 있어도 flow를 끝까지 돌리는 설정(<code>config_antfix4</code>)에서도 개수는 숨기지 않고 그대로 기록됩니다.</p>
    </section>
    <section className="card">
      <div className="card-title"><div><small className="kicker">GLOSSARY</small><h3>antenna 위반이란? (PPA 3 baseline 2건 → 재실행 0건)</h3></div><span className="connection">용어 설명</span></div>
      <AntennaExplainer defaultOpen />
    </section>
  </section>
}
