// Evolution SA 설계안 모음. 수평 탭의 설계안은 CANDIDATES 배열에 등록한다.
// 이 파일은 읽기 전용 설계 문서 컴포넌트이며, 다른 화면의 코드나 상태를 바꾸지 않는다.
// 화면의 계산값(통과율, 격자 후보 수, 면적 비율)은 아래 상수에서 렌더링할 때 계산한다. 실측값은 출처와 확인 상태를 함께 적었다.
import { useState } from 'react'
import DpStepByStep from './DpStepByStep'
import SaStepByStep from './SaStepByStep'
import SaMechanics from './SaMechanics'
import { SetupHoldConceptFigure, SetupBudgetFigure, HoldBudgetFigure, TimingChainFigure, CornerDelayFigure, ThermalControlFigure } from './TimingFigures'
import { LaunchCaptureFigure, ClockSkewSlewExplorer } from './ClockFigures'
import CombinedSearch from './CombinedSearch'
import ResultCompare from './ResultCompare'

type Status = '확정' | '가설' | '미측정'
const STATUS_COLOR: Record<Status, string> = { '확정': 'var(--success)', '가설': 'var(--warning)', '미측정': 'var(--text-muted)' }
const badge = (s: Status) => <b style={{ color: STATUS_COLOR[s], whiteSpace: 'nowrap' }}>{s}</b>
const p = { margin: '4px 0 8px', fontSize: 13, lineHeight: 1.8 } as const
const ul = { margin: '0 0 8px 18px', padding: 0, fontSize: 13, lineHeight: 1.8 } as const
const mono = { fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.7, background: 'var(--surface-muted)', padding: 10, borderRadius: 6, margin: '6px 0 10px', whiteSpace: 'pre-wrap' as const }

// ---- PPA3 실제 치수 (LEF·DEF에서 확인한 값) ----
const CORE_LEFT = 20.24, CORE_RIGHT = 1229.6, ADC_W = 223.71, SRAM_W = 764.24, HALO = 10
const CORE_W = CORE_RIGHT - CORE_LEFT
const L = CORE_W - ADC_W - SRAM_W - 4 * HALO // ADC·SRAM이 모두 걸치는 행에서 세 간격이 나눠 갖는 x 방향 여유 길이
const passRate = (T: number) => Math.max(0, (L - 3 * T) / L) ** 2 // 간격 3개가 모두 T 이상일 확률(균등 분포 가정)
const latticeCount = (T: number, step: number) => {
  const vals = [0, ...Array.from({ length: Math.floor((L - T) / step) + 1 }, (_, k) => T + k * step)]
  let n = 0
  for (const g1 of vals) for (const g3 of vals) { const g2 = L - g1 - g3; if (g2 > -1e-9 && (Math.abs(g2) < 1e-9 || g2 >= T)) n++ }
  return n
}
const pct = (x: number) => `${(x * 100).toFixed(1)}%`

function Section({ title, open = false, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  return <details open={open} style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
    <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>{title}</summary>
    <div style={{ marginTop: 6 }}>{children}</div>
  </details>
}

function Candidate1() {
  return <div>
    <p style={p}><b>목표:</b> 현재 배치 후보가 <b>LVS·DRC에서 실제로 문제가 되는 규칙과 남은 공간</b>을 고려해 더 잘 배치되도록 진화시킨다. 위반을 평가 후 버리는 대신 <b>기록해서 재사용</b>하고, 규칙을 알면 <b>처음부터 규칙에 맞게 만들어</b> 더 적은 평가로 더 많은 후보를 탐색한다.</p>
    <div className="data-table"><table><thead><tr><th>상태</th><th>설계</th><th>구현</th><th>검증</th></tr></thead><tbody>
      <tr><td><b>설계 후보 1</b></td><td style={{ color: 'var(--success)' }}><b>작성됨 (2026-10-08)</b></td><td style={{ color: 'var(--text-muted)' }}><b>미착수</b></td><td style={{ color: 'var(--warning)' }}><b>핵심 가설 미검증</b></td></tr>
    </tbody></table></div>

    <Section title="1. 설계의 근거가 된 실측" open>
      <p style={p}>아래는 PPA3(1250 × 600 µm) 최신 완주 실행의 DEF·보고서에서 직접 읽은 값입니다. "가설"은 아직 측정으로 확인되지 않은 것입니다.</p>
      <div className="data-table"><table><thead><tr><th>항목</th><th>값</th><th>상태</th><th>출처</th></tr></thead><tbody>
        <tr><td>ADC 왼쪽 행 조각</td><td>폭 9.66 µm, tap 없음, 116개 행 → n-well 섬 57개</td><td>{badge('확정')}</td><td><code>ppa3_antfix5_signoff</code> DEF·추출 SPICE</td></tr>
        <tr><td>그 조각의 GDS 기준 DRC</td><td>LU.3 908 · LU.2 888 · nwell.4 57 (그 외 top 8건)</td><td>{badge('확정')}</td><td><code>ppa3_antfix4_signoff</code> Magic 보고서</td></tr>
        <tr><td>LVS 셀 차이</td><td>decap_12 +57 · decap_3 +57 · fill_1 +2 = device +116, net +59</td><td>{badge('확정')}</td><td><code>lvs.netgen.rpt</code></td></tr>
        <tr><td>같은 유형의 반대 사례</td><td>SRAM 오른쪽 25.3 µm 조각 88개, 위반 없음</td><td>{badge('확정')}</td><td>antfix4 DRC·LVS</td></tr>
        <tr><td>SRAM 신호 핀 위치</td><td>82개 전부 아래쪽 변, 그 아래 띠 높이 약 44 µm</td><td>{badge('확정')}</td><td>SRAM LEF·DEF</td></tr>
        <tr><td>SRAM 입력 핀 max slew</td><td>21핀 위반, 한계 0.351 ns, 최대 0.849 ns (<code>din[26]</code>, ss 코너)</td><td>{badge('확정')}</td><td>antfix2 STA <code>checks.rpt</code></td></tr>
        <tr><td>매크로 전원 핀이 PDN에 미연결</td><td>PDN이 <code>vccd/vssd</code>를 보고 VPWR/VGND 격자와 이어지지 않음 → LVS 363의 주원인</td><td>{badge('확정')}</td><td>추출 SPICE 검증 (signoff 실행의 LVS 보고서)</td></tr>
        <tr><td>매크로 간격</td><td>100 µm는 DPL-0036 실패, 300 µm는 통과</td><td>{badge('확정')}</td><td>엔진 주석(daq_subsystem 실측)</td></tr>
        <tr><td>최종 DEF의 fill/decap 점유</td><td>fill 3,307개 · decap 15,586개 (셀 개수, 사이트 면적 아님). 기존 83,347 사이트·86.7% 집계는 산정 범위와 단위 재검증 필요</td><td>개수 {badge('확정')} · 가용률 {badge('미측정')}</td><td><code>ppa3_antfix5_signoff</code> 최종 DEF의 component 분류</td></tr>
        <tr><td><b>ADC를 x=30.24로 옮기면 위 위반이 사라진다</b></td><td>tap 단계까지는 조각 0개 확인. LVS·DRC 결과 없음</td><td>{badge('가설')}</td><td><code>adcshift</code> 실행이 64번(Magic DRC)에서 중단</td></tr>
        <tr><td>조각 폭의 위반 임계값 T</td><td>9.66 위반 · 25.3 무위반 → 그 사이는 모름 (tap 격자 위상에도 의존할 수 있음)</td><td>{badge('미측정')}</td><td>—</td></tr>
        <tr><td>L0(게임 점수)와 실제 결과의 상관</td><td>비교할 실제 결과가 PPA3 몇 건뿐. 다만 실제 PPA3 기준 위상은 L0에서 333개 중 87위(−239.1, 최선 −133.9)이고 그 차이의 대부분이 테트리스식 "구멍" 항(11-2절 5번)</td><td>{badge('미측정')}</td><td>—</td></tr>
      </tbody></table></div>
      <p style={p}><b>공간 해석 주의:</b> 최종 DEF에서 fill/decap이 차지한 면적은 곧바로 배치 가능한 여유가 아닙니다. fill은 잘라낸 뒤 적법하게 재삽입해야 하고, decap은 전원 무결성 목표에 필요한 최소량을 보호해야 합니다. tap·diode·endcap, 매크로 halo, timing ECO와 배선 용량도 별도 제약입니다. 따라서 실제 가용률은 후보 2의 동일 실행·동일 단위 기반 계측을 거쳐 확정합니다.</p>
    </Section>

    <Section title="2. 핵심 아이디어 4가지" open>
      <ol style={ul}>
        <li><b>규칙 위반이 변이 방향을 알려준다.</b> 무작위로 옮기지 않고 위반 위치와 크기에서 이동 방향·양을 계산합니다(예: 조각 9.66 µm → ADC −9.7 µm).</li>
        <li><b>평가를 단계로 나눈다(multi-fidelity).</b> 싼 평가로 거르고, 비싼 평가는 유망하거나 불확실한 후보에만 씁니다.</li>
        <li><b>진화 대상을 바꾼다.</b> 거친 50 µm 격자의 매크로 위상은 전수로 고정하고, 규칙이 민감한 <b>서브격자 좌표(µm)·방향·이웃 영역 shape</b>를 유전자로 씁니다.</li>
        <li><b>규칙을 알면 처음부터 맞게 만든다.</b> 만든 뒤 평가해서 거르는 대신 규칙에 맞는 좌표 격자에서 후보를 생성합니다(5절).</li>
      </ol>
      <div className="data-table"><table><thead><tr><th>단계</th><th>평가</th><th>비용</th><th>판별하는 것</th></tr></thead><tbody>
        <tr><td>L0</td><td>게임 proxy <code>placementValue</code></td><td>0.27 ms/호출 <span style={{ color: 'var(--text-muted)' }}>(측정)</span></td><td>인접·간격·혼잡 등 기존 17개 항</td></tr>
        <tr><td>L1</td><td>OpenLane을 floorplan → tap → PDN까지만</td><td>수 분 <span style={{ color: 'var(--text-muted)' }}>(tap 단계까지 관측)</span></td><td>tap 없는 조각, 매크로 전원 핀 연결</td></tr>
        <tr><td>L2</td><td>배치·CTS·배선까지</td><td>수십 분~1시간대 <span style={{ color: 'var(--text-muted)' }}>(추정)</span></td><td>slew, 혼잡, 타이밍</td></tr>
        <tr><td>L3</td><td>전체 flow + signoff</td><td>수 시간 <span style={{ color: 'var(--text-muted)' }}>(GDS DRC만 약 1.5시간 관측)</span></td><td>DRC, LVS</td></tr>
      </tbody></table></div>
    </Section>

    <Section title="3. 규칙 → 후보 변수 → 적합도 항 → 변이">
      <div className="data-table"><table><thead><tr><th>실측 규칙</th><th>후보가 정하는 것</th><th>새 적합도 항</th><th>변이 연산</th></tr></thead><tbody>
        <tr><td>tap 없는 행 조각</td><td>매크로–코어 가장자리·매크로 간 거리</td><td>폭이 T보다 좁은 행 수</td><td>조각 폭만큼 매크로 스냅 이동</td></tr>
        <tr><td>매크로 전원 핀 ↔ PDN</td><td>매크로 x/y 오프셋, 방향</td><td>strap이 닿지 않는 전원 핀 수</td><td>strap 격자에 정렬되도록 이동</td></tr>
        <tr><td>SRAM 입력 핀 slew</td><td>SRAM 방향, 아래 띠 높이</td><td>핀 근처 구동 셀·버퍼 여유</td><td>방향 뒤집기, 핀 쪽 띠 확보</td></tr>
        <tr><td>300 µm 채널</td><td>매크로 간격</td><td>기존 <code>macroClearanceRisk</code></td><td>유지</td></tr>
        <tr><td>SRAM 내부 DRC · 비교기 19건 · 셀 npc.2 · PDN 설정</td><td>위치로 풀리지 않음</td><td><b>적합도에서 제외</b></td><td>"위치로 해결 불가"로 표시</td></tr>
      </tbody></table></div>
      <p style={p}>현재 비용 항에는 첫 두 규칙에 대응하는 항이 없습니다(가장 가까운 <code>powerAccessPenalty</code>·<code>pinAccessPenalty</code>의 내부 정의는 확인하지 못했습니다).</p>
    </Section>

    <Section title="4. 위반 기억 (violation memory)">
      <p style={p}>평가에서 나온 위반을 개수만 세지 않고 <b>원인 특징값</b>과 함께 기록합니다. 좌표만 저장하면 같은 좌표에서만 쓸모가 있지만 "조각 폭 9.66 µm에서 위반"처럼 저장하면 다른 매크로·위치에도 적용됩니다.</p>
      <div style={mono}>{`{ ruleId, level(L0~L3), run/step, macros[{id,x,y,orient,shape}],
  features{조각폭, 폭_tap위상, strap오프셋, 핀변_띠높이 ...},
  outcome{violated, count, locations}, suspectedCause,
  fix{delta, status: untested|verified}, confidence: confirmed|hypothesis }`}</div>
      <ul style={ul}>
        <li><b>평가 전 차단(nogood):</b> 확정된 위반 영역의 후보는 평가하지 않고 버립니다.</li>
        <li><b>임계값 이분 탐색:</b> 위반 경계를 좁히려고 중간값(≈17.5 µm)을 L1로 판정합니다. ADC x 오프셋을 30.24 + {'{0, 5, 10, 15, 20, 25, 30}'} µm로 스윕하는 약 7회로 곡선을 얻습니다.</li>
        <li><b>부드러운 벌점:</b> 경계까지의 여유를 비용에 넣어 경계 직전에 몰리는 것을 막습니다. 가설 기록은 차단하지 않고 벌점으로만 씁니다.</li>
        <li><b>해결법 재사용:</b> 검증된 이동량을 같은 규칙의 다른 위반에서 먼저 시도합니다.</li>
        <li><b>비싼 평가의 우선순위:</b> L3는 상위 3개만 보내고, 그중 경계 근처(불확실한) 후보를 먼저 보냅니다.</li>
      </ul>
      <p style={p}><b>저장:</b> 여러 창이 함께 쓰므로 브라우저 <code>localStorage</code>가 아니라 저장소 파일(<code>physical_design/layout_candidates/violation_memory.json</code> 제안)로 하고, 실행 폴더에서 자동 추출하는 수집 스크립트(<code>tools/collect_violations.py</code> 제안)로 채웁니다. 지금 기록할 수 있는 항목은 위 1절의 확정 7건입니다.</p>
    </Section>

    <Section title="5. 규칙에 맞게 만드는 후보 생성기 (간격 예산)">
      <p style={p}>ADC와 SRAM이 모두 걸치는 행에서는 x 방향 여유 길이 <b>L = {CORE_W.toFixed(2)} − {ADC_W} − {SRAM_W} − 4×{HALO} = {L.toFixed(2)} µm</b>를 세 간격(ADC 왼쪽 g1, 사이 g2, SRAM 오른쪽 g3)이 나눠 갖습니다. 실제 실행은 g1 = 9.66(위반), g3 ≈ 25.3(무위반)이었습니다.</p>
      <div className="data-table"><table><thead><tr><th>조각 한계 T</th><th>위치를 무작위로 고르면 규칙을 통과하는 비율</th><th>규칙에 맞는 간격 격자(단계)에서의 유효 후보 수</th></tr></thead><tbody>
        {[[10, 5], [15, 5], [20, 5], [25.76, 12.88]].map(([T, s]) => <tr key={T}><td>{T} µm</td><td><b>{pct(passRate(T))}</b></td><td>{latticeCount(T, s)}개 (단계 {s} µm)</td></tr>)}
      </tbody></table></div>
      <p style={p}>T는 아직 모릅니다. 어느 값이어도 무작위 후보의 <b>{pct(1 - passRate(10))}~{pct(1 - passRate(25.76))}</b>가 조각 규칙에서 이미 실패합니다. 규칙이 여러 개면 통과 확률이 곱해집니다(독립 가정, 예시). 이 표는 <b>균등 분포를 가정한 계산</b>이며 측정값이 아닙니다.</p>
      <p style={p}><b>더 중요한 점:</b> g1 = 0(바짝 붙임) 같은 배치는 무작위 샘플링에서는 확률이 0인데, 여유 공간을 한 덩어리 채널로 모으는 가장 좋은 배치입니다. 규칙으로 직접 만들어야만 탐색할 수 있는 해입니다.</p>
      <div style={mono}>{`for 매크로 위상 333개 (게임 규칙을 통과한 ADC×SRAM 조합, 전수 열거 2.8초 — 측정):
    행 종류마다 여유 길이 L 계산
    간격 격자 G = {0} ∪ {T + margin + j·step}
    g1, g3 ∈ G 열거, g2 = L − g1 − g3 가 0 또는 ≥ T 인 것만 채택
    y는 행 경계(21.76 + k·2.72)에 정렬, x는 PDN strap 격자와 교집합
    방향은 SRAM 핀 쪽 띠 규칙으로 결정
    → L0로 점수화·정렬 → 상위 N개만 L1`}</div>
      <p style={p}><b>위험:</b> 규칙이 불완전하면 격자가 좋은 해를 잘라낼 수 있어, <b>격자 밖 후보를 10~20% 섞는 탐험 몫</b>과 L1 확인을 항상 유지합니다. 4절의 위반 기억이 T와 정렬 격자를 갱신하고, 생성기는 그 규칙으로 후보를 만들고, 평가 결과가 다시 기록을 갱신합니다.</p>
    </Section>

    <Section title="6. 구현 단계">
      <div className="data-table"><table><thead><tr><th>단계</th><th>내용</th><th>산출물(제안)</th><th>통과 기준</th><th>상태</th></tr></thead><tbody>
        <tr><td><b>P-1</b></td><td>선행: x=30.24 가설 검증(<code>adcshift</code>를 Magic DRC부터 이어서), PDN 연결 결과 확인</td><td>실측 위반 수</td><td>위반 0 또는 남은 원인 확정</td><td>실행은 있으나 <b>결과 없음</b> — <code>ppa3_adcshift_signoff</code>·<code>ppa3_adcslew_signoff</code>가 Magic DRC 단계에서 멈춤(보고서 0바이트)</td></tr>
        <tr><td><b>P0</b></td><td>위반 기억 스키마·시드 7건·수집 스크립트</td><td><code>violation_memory.json</code>, <code>tools/collect_violations.py</code></td><td>antfix4·5에서 수동 분석과 같은 숫자(조각 116, 섬 57, DRC 1,853)</td><td><b>부분</b> — 관측 3건·회피 패턴을 담은 <code>drc_knowledge.json</code>과 <code>tools/build_ppa3_constraint_db.py</code>가 있음(위 이름·스키마와는 다름, 수집 스크립트는 미구현)</td></tr>
        <tr><td><b>P1</b></td><td>규칙 계측기 + 규칙에 맞는 후보 생성기(L0)</td><td><code>game/evolutionSa.ts</code></td><td>무작위 vs 생성의 규칙 통과율이 5절 모델과 일치</td><td>미착수</td></tr>
        <tr><td><b>P2</b></td><td>L1 판정기, 조각 폭 스윕으로 T 실측</td><td><code>tools/wsl/*</code> 스크립트</td><td>T 곡선 확보</td><td>미착수 — L1에 보낼 후보 선정 방법(기준 위상 + ADC x 오프셋 스윕)은 배경 지식 11-2절 5번 참고</td></tr>
        <tr><td><b>P3</b></td><td>진화 루프(규칙 유도 변이, 부모 선택, 정체 시 확장), 계보와 비용 항목 분해 표시</td><td><code>views/EvolutionSa.tsx</code></td><td>동일 평가 횟수에서 기존 방식보다 규칙 통과 후보가 많음</td><td>미착수</td></tr>
        <tr><td><b>P4</b></td><td>L2·L3 승격, 실제 결과로 L0 가중치 보정</td><td>기존 <code>/api/layout-candidates</code> 연동</td><td>L0 점수와 실제 결과의 상관 확인</td><td>미착수</td></tr>
      </tbody></table></div>
      <p style={p}><b>기존 코드와의 관계:</b> 신규 파일로 만들고 엔진(<code>chipTetrisEngine.ts</code>)에는 <code>placementValue</code>·<code>enumerate</code> 등 몇 개를 export하는 정도로만 수정합니다. 기존 "Continuous evolution"과의 역할 분담은 <b>결정이 필요합니다.</b></p>
    </Section>

    <Section title="7. 이 설계로 풀 수 없는 것 · 위험 · 결정 필요">
      <ul style={ul}>
        <li><b>위치로 풀리지 않는 위반:</b> SRAM 내부 DRC 15,861,362건(99.99%가 SRAM 내부), 비교기 19건, 셀 npc.2, PDN 설정. 목표는 "signoff 전체 통과"가 아니라 <b>"위치로 풀 수 있는 위반 0"</b>입니다.</li>
        <li><b>LVS 원인이 둘:</b> 행 조각이 만드는 floating n-well(device 차이와 정확히 일치)과 매크로 전원 미연결(추출 SPICE 검증). 어느 쪽이 363건의 주원인인지는 PDN 실행 결과가 나와야 알 수 있습니다. 전원 연결이 안 되면 배치를 아무리 잘 해도 LVS는 그대로입니다.</li>
        <li><b>L0 점수가 실제와 어긋날 수 있음:</b> 상관 측정 전이라, 점수 최적화가 헛돌 위험이 있습니다(P4에서 보정).</li>
        <li><b>실행 안정성:</b> 이번에 <code>adcshift</code>·<code>adcslew</code>가 결과 없이 끊겼습니다. 수 시간짜리 실행을 반복하려면 이어서 돌리는 장치가 필수입니다.</li>
        <li><b>후보 풀 분포 미확인:</b> 후보 저장소(<code>chip-tetris-legal-candidates-v2</code>)는 사용자 브라우저에만 있어 분포를 보지 못했습니다.</li>
        <li><b>결정 필요:</b> ① P-1 실험(WSL·OpenLane 자원이 진행 중인 PDN 실행과 겹침) 일정 ② 기존 Continuous evolution과의 역할 분담 ③ 성공 기준(예: L3 몇 번 안에 위치 위반 0 후보 확보).</li>
      </ul>
    </Section>
  </div>
}


function Candidate2() {
  return <div>
    <p style={p}><b>목표:</b> DRC·LVS·STA·전원·배선 제약을 만족하는 <b>최소 칩 면적</b>을 찾습니다. 배치가 끝난 뒤 남는 틈에만 필요한 filler를 넣고, decap은 검증된 최소 전원 용량·위치만 확보합니다. 소수 실험의 지식을 beam search 탐색에 재사용하고 동일한 배치·설정은 다시 실행하지 않습니다.</p>
    <div className="data-table"><table><thead><tr><th>설계</th><th>구현</th><th>검증</th><th>적용 범위</th></tr></thead><tbody>
      <tr><td><b>설계 후보 2 · beam search 보조 탐색</b></td><td>{badge('미측정')} 미착수</td><td>{badge('미측정')} 성능 비교 전</td><td>매크로 위치와 주변 영역 shape</td></tr>
    </tbody></table></div>

    <Section title="1. 초기 실험으로 규칙과 timing을 보정" open>
      <ol style={ul}>
        <li>기준 배치와 경계·tap·PDN·critical path 조건이 서로 다른 소수 후보를 먼저 선정합니다. 같은 배치를 seed만 바꿔 반복하지 않습니다.</li>
        <li>Magic sky130 deck의 nwell·LU·diff/tap 규칙, OpenLane의 halo·tap/endcap·PDN 설정을 읽고 확정 규칙과 미확인 가설을 구분합니다.</li>
        <li>실행별 위반 rule·좌표·instance와 STA critical path·slack을 수집하고, 실제 실패를 다음 후보의 금지 조건 또는 risk 비용으로 전환합니다.</li>
        <li>칩 폭·높이, core 경계와 매크로 배치 signature에 PDK·deck·config·SDC·도구 버전·검증 단계를 묶은 fingerprint로 실행 중/완료된 실험을 조회합니다. 면적이 다른 후보는 별도 실험으로 기록합니다.</li>
      </ol>
      <p style={p}>초기 실행 횟수는 고정하지 않습니다. 서로 다른 실패 원인을 구분할 만큼만 실행하고, 새 결과가 예측 규칙을 바꿀 때 추가 실험을 선택합니다.</p>
    </Section>

    <Section title="2. beam search 상태와 전이" open>
      <div className="data-table"><table><thead><tr><th>요소</th><th>저장·계산할 값</th><th>이유</th></tr></thead><tbody>
        <tr><td>상태</td><td>가변 칩 폭·높이와 core 경계, 배치된 블록 집합, 점유 영역, 행/경계 여유, net별 위치 요약, PDN 위상</td><td>면적과 뒤에 놓을 블록의 합법성·추가 비용 결정</td></tr>
        <tr><td>전이</td><td>다음 블록의 위치·방향·이웃 영역 shape 선택; 칩 폭·높이를 각각 조절하거나 같은 면적에서 종횡비 변경</td><td>면적과 모양이 모두 탐색 변수이며 hard rule 위반이면 즉시 가지치기</td></tr>
        <tr><td>값</td><td>hard rule 통과 후 die 면적 우선, 같은 면적에서 기존 게임 점수 − DRC·timing·혼잡 risk</td><td>면적을 고정하지 않고 유망한 부분 상태 보존</td></tr>
        <tr><td>출력</td><td>서로 다른 상위 K개 완성 배치와 부모·변이 계보</td><td>다단계 물리 검증 입력</td></tr>
      </tbody></table></div>
      <div style={mono}>최선값(다음 상태) = max[ 최선값(현재 상태) + 새 배치의 점수 변화 ]</div>
      <p style={p}>서로 다른 배치를 같은 상태로 합치면 최적해를 잃습니다. 미래 비용에 필요한 점유·경계·net 정보와 <b>행별 예약 용량</b>을 상태에 유지하고, 상태가 너무 많아지면 상위 K개를 남기는 beam search(DP의 틀을 쓰되 상태를 제한)로 실행합니다. 이 경우 전역 최적 보장은 없습니다.</p>
    </Section>

    <Section title="3. fill·decap 보호와 최소 여유·밀도 규칙" open>
      <p style={p}><b>서로 다른 분모를 섞지 않습니다.</b> 같은 run의 filler 삽입 전 DEF/ODB에서 실제 ROW 사이트를 합산하고, 매크로·halo·blockage로 잘린 행과 배치 금지 구역을 제외합니다. 각 셀의 LEF 폭을 사이트 수로 바꿔 점유를 집계합니다. 최종 DEF의 fill·decap 점유율이나 OpenLane의 stdcell utilization은 이 가용률과 다른 지표입니다.</p>
      <div className="data-table"><table><thead><tr><th>공간 항목</th><th>규칙</th><th>검증</th></tr></thead><tbody>
        <tr><td>tap·endcap·diode</td><td>고정·필수 점유로 보호; 짧은 행 조각에도 tap과 well 연속성 확인</td><td>tap/endcap 단계와 DRC·LVS</td></tr>
        <tr><td>fill</td><td>사전 예약 개수 없음. 유효 셀 배치·면적 축소 후 남은 틈에만 필요한 폭을 삽입하고 rail/well 연속성 확인</td><td>legalization → fill 삽입 → DRC·LVS; 셀 개수가 아닌 총 점유 면적 기록</td></tr>
        <tr><td>decap</td><td>기존 15,586개를 보존하지 않음. IR drop·전원 잡음 기준을 만족하는 최소 총 용량과 위치만 power domain별로 확보</td><td>PDN/전원 분석; 기준 미정이면 회수 가능량 미확정으로 표시</td></tr>
        <tr><td>timing·routing</td><td>버퍼/ECO·antenna 수리용 사이트와 pin access·배선 용량을 구역별로 예약</td><td>placement/global route/STA, 최종 배선</td></tr>
      </tbody></table></div>
      <div style={mono}>{`배치 가능 사이트 = 실제 legal ROW 사이트 − 고정 셀 − 보호 decap − ECO/repair 예약
순가용률 = (배치 가능 사이트 − 현재 유효 셀 점유) / 실제 legal ROW 사이트
유효 셀 밀도 = 유효 셀 점유 / 배치 가능 사이트
최종 fill 후 빈 사이트 0 ≠ 순가용률 0; fill/decap 셀 개수 ≠ 사이트 면적`}</div>
      <p style={p}>위 수치는 <b>전체 평균과 행·채널·pin 주변 window별</b>로 동시에 계산합니다. 총량이 충분해도 연속된 배치 길이가 짧거나 특정 window가 과밀하면 실패하므로, 최소 연속 사이트 수·local density 상한·배선 혼잡 상한을 hard rule로 둡니다. decap 최소량, ECO 예약률, local density 상한은 PDK/PDN/STA 실측으로 보정하고 미측정 상태에서는 임의의 “여유율”을 확정하지 않습니다.</p>
      <p style={p}><b>최적화 순서:</b> hard rule 통과 → 칩 면적 최소화 → 같은 면적의 후보 중 불필요한 decap 용량·남은 fill 면적 최소화 → timing·전력·배선 품질 비교. fill·decap의 <b>셀 개수</b>는 크기가 달라 비교 기준이 아닙니다. 폭과 높이는 독립 변수입니다. 위반 시 먼저 같은 면적에서 가로 확대·세로 축소 또는 세로 확대·가로 축소와 매크로 재배치를 시험합니다. 이로 해결되지 않을 때만 필요한 edge를 최소한 늘립니다. 모든 변형에서 행 조각·macro channel·PDN/IO·배선 길이를 다시 계산합니다.</p>
      <p style={p}><b>면적·종횡비 탐색 폐루프:</b> 완전 통과한 기준 배치에서 x/y 외곽을 단계적으로 줄입니다. 위반이 나오면 rule ID·위치·원인을 분류하고, 같은 면적의 가로형·세로형 후보를 먼저 평가합니다. 예를 들어 폭을 ΔW 늘리면 높이는 대략 A/(W+ΔW)로 줄인 뒤 site·row 격자에 맞춰 실제 면적을 다시 계산합니다. 둘 다 실패할 때만 위반 구역을 풀 수 있는 방향으로 최소 단위 확장합니다. <b>실측 통과 후보 중 면적이 가장 작은 것</b>을 남기며, 배치 결과가 비단조적일 수 있어 한 번의 통과로 주변 구간 전체를 통과했다고 가정하지 않습니다.</p>
      <p style={p}>매크로 내부 DRC, 잘못된 PDN 연결·LVS 설정처럼 면적을 늘려도 풀리지 않는 위반은 이 탐색의 신호로 쓰지 않고 별도 수리 항목으로 보냅니다. 현재 PPA3 antfix5는 route DRC만 0이고 Magic DRC·LVS·max-slew가 남아 있으므로 <b>완전 통과 기준 배치로 표시하지 않습니다.</b></p>
      <p style={p}><b>PPA3 현재 위치의 1차 면적 스크리닝:</b> ADC·SRAM 위치는 그대로 두고 현재 core inset과 매크로 halo 10 µm를 유지한 기하 계산입니다. 기존 최종 DEF의 ROW 사이트 175,564개를 동일 계산이 재현했습니다. 아래 축소안은 <b>배치·배선·DRC·LVS 통과 결과가 아닙니다.</b></p>
      <div className="data-table"><table><thead><tr><th>다이 폭 × 높이</th><th>면적</th><th>기준 대비</th><th>예상 ROW 사이트</th><th>상태</th></tr></thead><tbody>
        <tr><td>1250 × 600 µm</td><td>750,000 µm²</td><td>기준</td><td>175,564</td><td>기존 DEF 실측; 전체 signoff 미통과</td></tr>
        <tr><td>1230 × 580 µm</td><td>713,400 µm²</td><td>−4.9%</td><td>145,864</td><td>기하 계산만</td></tr>
        <tr><td>1225 × 556 µm</td><td>681,100 µm²</td><td>−9.2%</td><td>122,236</td><td>고정 매크로 위치의 halo/경계 하한; 물리 검증 필요</td></tr>
      </tbody></table></div>
      <p style={p}>매크로 이동까지 허용하면 더 줄어들 수도 있습니다. 반대로 tap·PDN·pin 접근·STA·DRC 때문에 위 표보다 큰 면적이 필요할 수 있습니다. 따라서 면적 축소율의 확정값은 실제 통과한 후보를 얻은 뒤 기록합니다.</p>
    </Section>

    <Section title="4. 빠른 판정에서 실제 검증까지">
      <ol style={ul}>
        <li><b>L0:</b> beam search 전이 때 겹침·확정 DRC 간격·halo·tap/PDN 접근 규칙을 즉시 검사합니다. 불확실한 규칙은 soft risk로 둡니다.</li>
        <li><b>L1:</b> 서로 다른 상위 배치만 floorplan·tap·PDN 단계로 보내고, 실패 결과를 규칙 기억에 반영합니다.</li>
        <li><b>L2:</b> placement/global route의 경로·혼잡·STA 추정으로 순위를 다시 매깁니다. 초기 timing 예측과 최종 STA를 구분해 표시합니다.</li>
        <li><b>L3:</b> 최종 소수 후보에 전체 DRC/LVS와 signoff STA를 실행합니다. 같은 fingerprint의 결과는 재사용합니다.</li>
      </ol>
    </Section>

    <Section title="5. 구현 순서와 비교 기준">
      <div className="data-table"><table><thead><tr><th>단계</th><th>산출물</th><th>확인할 것</th></tr></thead><tbody>
        <tr><td>D0</td><td>run fingerprint·초기 calibration·ROW/LEF 기반 공간 회계</td><td>같은 배치·설정의 재실행 0건; fill/decap·고정 셀·예약량의 사이트 단위 합계 검증</td></tr>
        <tr><td>D1</td><td>규칙 기반 legal 위치·쌍별 호환성 표</td><td>기존 엔진 hard rule과 일치</td></tr>
        <tr><td>D2</td><td>부분 상태 beam search와 상위 K개 고유 후보</td><td>동일 계산 예산에서 후보 1과 품질·다양성 비교</td></tr>
        <tr><td>D3</td><td>DRC/STA 결과 피드백과 L1~L3 승격</td><td>실제 위반 수·slack·실행 시간 비교</td></tr>
      </tbody></table></div>
      <p style={p}>PPA3는 hard macro가 ADC·SRAM 두 개여서 거친 위치 조합은 이미 전수 열거가 가능합니다. beam search의 이득은 이웃 영역 shape와 세밀한 좌표·규칙 상태까지 확장할 때 실측으로 판단합니다. 전역 DRC와 최종 STA는 beam search 점수로 대체하지 않습니다.</p>
    </Section>

    <Section title="6. 유사 코드와 시제품 검증 (beam search + 간격 DP)">
      <p style={p}>위 2절의 상태·전이·값을 그대로 따르는 유사 코드입니다. 탐색을 <b>두 단계</b>로 나눕니다. ① <b>beam search</b>는 블록 순서대로 위치·방향·shape를 고르고, ② <b>간격 DP(정확)</b>는 ①이 정한 위상에서 µm 단위 간격을 규칙에 맞게 최적으로 나눕니다. 두 알고리즘 모두 실제 코드로 만들어 돌렸습니다.</p>

      <p style={{ ...p, marginBottom: 2 }}><b>① beam search — 상위 K개만 남기는 제한된 탐색 (정확한 DP 아님)</b></p>
      <div style={mono}>{`입력: 블록 순서 SEQ = [adc, sram, opamp, fifo, control], 빔 폭 K, 위반 기억 M
layer ← [ 빈 보드 ]
for id in SEQ:
    next ← {}
    for state in layer:
        for (shape, x, y) in 후보 위치(state, id):        # 이웃 규칙이 있으면 이웃 주변만 보면 된다
            if not 합법(state.board, id, shape, x, y):     # hard rule: 겹침, 확정 DRC 간격, halo, 필수 이웃
                continue                                   #   -> 즉시 가지치기
            if M.금지(특징값(state, id, shape, x, y)):     # 확정된 위반 기억은 평가 전에 차단
                continue
            child ← 배치(state, id, shape, x, y)
            v     ← 게임점수(child.board) − risk(M, child) # 가설 기록은 차단하지 않고 벌점으로만
            key   ← 상태키(child)                          # 배치된 블록 집합 + 점유 마스크 (+ PDN 위상)
            if key not in next or v > next[key].v:
                next[key] ← child                          # 같은 상태는 병합하고 더 좋은 값만 유지
    layer ← 상위 K개(next, 같은 (adc,sram) 위상당 최대 q개)   # 다양성 제한
return layer                                               # 서로 다른 상위 K개 완성 배치 + 계보`}</div>
      <p style={p}>최선값(다음 상태) = max[ 최선값(현재 상태) + 새 배치의 점수 변화 ] 이고, 상위 K개만 남기므로 <b>전역 최적을 보장하지 않습니다.</b> 중간 단계의 점수는 블록이 덜 놓인 상태라 서로 비교하기 어려운 근사값입니다.</p>
      <div className="data-table"><table><thead><tr><th>시제품 측정(엔진 직접 호출, node, 단일 코어)</th><th>K = 8</th><th>K = 32</th><th>무작위 합법 완성(같은 시간)</th></tr></thead><tbody>
        <tr><td>소요 시간</td><td>15.0 초</td><td>58.9 초</td><td>15.0 초 / 58.9 초</td></tr>
        <tr><td>최고 게임 점수 (높을수록 좋음)</td><td><b>−185.1</b></td><td><b>−136.5</b></td><td>−258.9 (표본 10개 / 33개)</td></tr>
        <tr><td>서로 다른 완성 배치 · 위반</td><td>8개 · 0건</td><td>32개 · 0건</td><td>—</td></tr>
        <tr><td><code>evaluatePlacement</code> 호출 · 합법성 검사</td><td>2,146 · 55,800</td><td>7,883 · 221,400</td><td>—</td></tr>
        <tr><td>단계별 후보 수 (adc · sram · opamp · fifo · control)</td><td>135 · 36 · 639 · 240 · 1,096</td><td>135 · 117 · 2,877 · 897 · 3,857</td><td>—</td></tr>
      </tbody></table></div>
      <ul style={ul}>
        <li><b>측정 조건:</b> 이 표와 아래 수치는 2026-10-08, <b>모양 8개·<code>rotationsFor</code> 캐시 전</b> 엔진에서 잰 시제품 값입니다. 같은 beam을 현재 엔진(모양 23개·캐시·이웃 띠 제한)에서 다시 재면 <b>K=8은 1.5초에 −134.77, K=32는 5.3초에 −132.70, K=128은 23.2초에 −132.70</b>(정확한 키)이며, 그 표는 8절에 있습니다.</li>
        <li><b>K를 키우면 좋아집니다</b>(당시 값): 후보를 이웃 띠로 제한한 뒤 K=8은 4.4초에 −185.1, K=32는 17.9초에 −136.5, <b>K=128은 71.7초에 −135.0</b>입니다(제한 전에는 K=128이 시간 초과). 32 이후에는 개선 폭이 작아졌습니다. K=512는 확인하지 못했습니다.</li>
        <li><b>속도 개선(측정):</b> 엔진의 필수 이웃 규칙은 "이웃 블록의 한 칸과 맨해튼 거리 정확히 1"이므로, 후보를 <b>이웃 블록 바로 바깥 칸을 모양이 덮는 위치</b>로만 만들어도 합법 위치를 놓치지 않습니다. 실제로 25개 상태에서 합법 위치 집합이 전체 스캔과 <b>1,640 = 1,640으로 일치(불일치 0)</b>했습니다. 합법성 검사가 K=8에서 55,800 → 8,796회, K=32에서 221,400 → 35,100회로 줄고, 시간은 <b>15.0 → 4.4초, 58.9 → 17.9초</b>(약 3.3배)가 됐습니다. 위 표의 시간은 제한 전(전체 스캔) 값입니다.</li>
        <li>시제품에는 위반 기억의 금지·risk, PDN 위상, 다양성 제한을 <b>넣지 않았습니다.</b> 점수는 기존 게임 점수(proxy)이며 실제 DRC·LVS 결과가 아닙니다.</li>
        <li>시제품 코드는 저장소에 넣지 않았습니다(스크래치). 구현 단계 D2에서 정식 파일로 만듭니다.</li>
      </ul>

      <p style={{ ...p, marginBottom: 2 }}><b>② 간격 DP — 규칙 아래 µm 간격을 정확히 최적화</b></p>
      <div style={mono}>{`입력: 매크로 폭 w[1..k], halo h, 코어 폭 W, 격자 u, 임계 T, gapCost(i,g), macroCost(i,x)
L  ← W − Σ w − 2·h·k ;  LU ← L / u               # k+1개 간격이 나눠 갖는 여유 길이
f[0][0] ← 0                                        # f[i][s]: 간격 0..i−1을 정했고 합이 s일 때 최소 비용
for i in 0 .. k−1:                                 # 간격 i를 선택 (마지막 간격은 나머지)
    for s in 0 .. LU where f[i][s] 유한:
        for g in 0 .. LU − s:
            if not (g == 0 or g ≥ T/u): continue   # sliver 규칙: 0 또는 T 이상만 허용
            s2 ← s + g
            c  ← f[i][s] + gapCost(i, g·u) + macroCost(i, 왼쪽가장자리 x_i(s2))
            if c < f[i+1][s2]: f[i+1][s2] ← c, 부모 ← (s, g)
r ← LU − s : 마지막 간격 = 나머지이며 이것도 규칙을 통과해야 한다
역추적 → 최적 간격 벡터 (g_0 .. g_k)`}</div>
      <div className="data-table"><table><thead><tr><th>시제품 검증 (PPA3 치수: L = {L.toFixed(2)} µm, T = 15 µm, 격자 0.5 µm)</th><th>결과</th></tr></thead><tbody>
        <tr><td>DP 최적 비용 · 간격</td><td><b>1.6535</b> · 32.5 / 116.5 / 32.5 µm ({'(ADC 왼쪽 / 사이 / SRAM 오른쪽)'})</td></tr>
        <tr><td>전수 탐색과 비교</td><td><b>비용·간격 모두 일치</b> (DP 122 ms, 전수 154 ms)</td></tr>
        <tr><td>규칙을 통과하는 간격 조합 수</td><td>38,590개 (0.5 µm 격자, T=15 µm)</td></tr>
        <tr><td>PPA3 실제 실행 (g_0 = 9.66 µm)</td><td>규칙 위반으로 판정됨</td></tr>
      </tbody></table></div>
      <ul style={ul}>
        <li><b>복잡도:</b> O(k · LU²) — 매크로 2개, 격자 0.5 µm에서 약 0.1초라 위상마다 돌려도 부담이 없습니다.</li>
        <li><b>주의:</b> 비용식의 PDN strap 격자(피치 40 µm, 오프셋 22.66 µm)와 300 µm 채널 벌점은 <b>알고리즘 확인용 예시 값</b>입니다. 실제 PDN 정렬 규칙과 임계값 T는 아직 측정되지 않았습니다(1절 규칙 보정).</li>
        <li><b>이 간격 DP가 정확한 범위:</b> 한 행 띠에서 매크로 순서가 정해져 있고 비용이 간격·매크로 x에만 의존할 때입니다. 세로 겹침 여부에 따라 행 종류가 달라지므로 beam search가 고른 위상마다 행 종류별로 따로 적용합니다.</li>
      </ul>
      <p style={p}><b>두 알고리즘의 연결:</b> ①이 거친 위상(블록 집합·방향·shape)을 상위 K개 고르면, ②가 각 위상의 µm 좌표를 규칙에 맞게 정합니다. 그 결과가 L1(floorplan·tap·PDN) 판정 입력이 됩니다.</p>
    </Section>

    <Section title="7. beam search · 간격 DP 단계별 그림 설명 (한 단계씩 따라가기)" open>
      <DpStepByStep/>
    </Section>

    <Section title="8. 상태 키 요약 실험 — 비슷한 상태를 합치면 빔이 좋아지는가 (측정, 엔진에 따라 결과가 달라짐)" open>
      <p style={p}>7절 그림에서 보듯 <b>상태 키가 보드 전체</b>이면 서로 다른 부모에서 같은 보드가 나오지 않아 <b>병합이 한 번도 일어나지 않습니다.</b> 키를 "블록마다 (모양, x÷N, y÷N)"으로 뭉친 <b>요약 키</b>로 바꾸면 비슷한 상태가 합쳐집니다(같은 키에서는 점수가 높은 것 하나만 유지). 같은 beam에서 키만 바꿔 쟀습니다. <b>아래 표는 2026-10-09, 현재 엔진(모양 23개·캐시·이웃 띠 제한)의 값입니다.</b></p>
      <div className="data-table"><table><thead><tr><th>빔 폭 K</th><th>상태 키</th><th>시간</th><th>최고 게임 점수 (높을수록 좋음)</th><th>서로 다른 SAR 위치 (최종 K개 중)</th></tr></thead><tbody>
        <tr><td rowSpan={4}>8</td><td>정확(보드 전체)</td><td>1.5초</td><td>−134.77</td><td>2</td></tr>
        <tr><td>2칸 버킷</td><td>1.2초</td><td>−134.77</td><td>2</td></tr>
        <tr><td>3칸 버킷</td><td>1.3초</td><td>−134.77</td><td>1</td></tr>
        <tr><td>4칸 버킷</td><td>1.2초</td><td>−134.77</td><td>2</td></tr>
        <tr><td rowSpan={4}>32</td><td>정확(보드 전체)</td><td>5.3초</td><td><b>−132.70</b></td><td>4</td></tr>
        <tr><td>2칸 버킷</td><td>5.0초</td><td>−132.70</td><td>7</td></tr>
        <tr><td>3칸 버킷</td><td>4.0초</td><td>−132.70</td><td>7</td></tr>
        <tr><td>4칸 버킷</td><td>4.6초</td><td>−132.74</td><td>9</td></tr>
        <tr><td rowSpan={2}>128</td><td>정확(보드 전체)</td><td>23.2초</td><td>−132.70</td><td>17</td></tr>
        <tr><td>4칸 버킷</td><td>13.3초</td><td>−132.74</td><td>31</td></tr>
        <tr><td>256 (참고)</td><td>4칸 버킷</td><td>24.2초</td><td>−132.74</td><td>34</td></tr>
      </tbody></table></div>
      <div className="data-table"><table><thead><tr><th>단계별 후보 수 (K=32), 생성 → 병합 후</th><th>ADC</th><th>SRAM</th><th>SAR NEAR</th><th>CDC EDGE</th><th>CAPTURE NEAR</th></tr></thead><tbody>
        <tr><td>정확한 키</td><td>135 → 135</td><td>117 → 117</td><td>7,875 → 7,875</td><td>1,057 → 1,057</td><td>10,470 → 10,470</td></tr>
        <tr><td>4칸 버킷 키</td><td>135 → 12</td><td>36 → 8</td><td>1,915 → 603</td><td>1,011 → 426</td><td>10,178 → 3,055</td></tr>
      </tbody></table></div>
      <p style={{ ...p, marginBottom: 2 }}><b>같은 실험을 이전 엔진(2026-10-08, 모양 8개·캐시 전)에서 했을 때</b></p>
      <div className="data-table"><table><thead><tr><th>빔 폭 K</th><th>상태 키</th><th>시간</th><th>최고 점수</th></tr></thead><tbody>
        <tr><td rowSpan={2}>8</td><td>정확(보드 전체)</td><td>4.6초</td><td>−185.1</td></tr>
        <tr><td>4칸 버킷</td><td>5.0초</td><td>−136.5</td></tr>
        <tr><td rowSpan={2}>32</td><td>정확(보드 전체)</td><td>21.0초</td><td>−136.5</td></tr>
        <tr><td>4칸 버킷</td><td>13.2초</td><td>−133.1</td></tr>
        <tr><td>128 (참고)</td><td>정확(보드 전체)</td><td>71.7초</td><td>−135.0</td></tr>
      </tbody></table></div>
      <ul style={ul}>
        <li><b>결과(현재 엔진):</b> 키를 바꿔도 <b>점수가 거의 같습니다</b>(K=8은 모두 −134.77, K=32는 −132.70 ~ −132.74). 정확한 키 K=32가 이미 −132.70(5.3초)에 닿습니다. 4칸 키는 <b>시간을 줄이지만</b>(K=128에서 23.2 → 13.3초) 점수는 0.04 낮아 근사 손실이 보이고, <b>서로 다른 SAR 위치는 더 많이 남깁니다</b>(K=128에서 17 → 31). 최고 상태의 위반은 모두 0건이었습니다.</li>
        <li><b>이전 결과와 달라진 점:</b> 이전 엔진에서는 4칸 키가 같은 시간에 훨씬 좋은 점수를 냈지만(K=32 −136.5 → −133.1) 현재 엔진에서는 그 이득이 없습니다. 왜 사라졌는지는 <b>측정하지 않았습니다.</b> 가설: 모양이 늘고 이웃 띠 제한이 적용되면서 정확한 키의 빔에도 좋은 후보가 충분히 남게 되었을 수 있습니다.</li>
        <li><b>한계:</b> 점수는 게임 proxy이고, 문제 인스턴스는 하나이며, 시간은 단일 실행입니다. 합치는 것은 <b>근사</b>라서 좋은 상태를 잃을 수 있고 버킷 크기에 민감합니다. 4칸보다 큰 버킷은 측정하지 않았습니다.</li>
        <li><b>설계로의 연결(제안):</b> 요약 키의 값은 <b>점수가 아니라 시간 절감과 후보의 다양성</b>일 수 있습니다. 설계 후보 2의 "상태"(점유·경계 여유·net 요약·PDN 위상)를 규칙에 민감한 특징으로 요약해 키로 쓸 때는, 이전 엔진의 큰 이득을 기대하지 말고 <b>현재 설정에서 다시 재서</b> 판단해야 합니다. 7절 그림의 "상태 키" 선택에서 병합 효과를 직접 볼 수 있습니다.</li>
      </ul>
    </Section>
  </div>
}

function Background() {
  const stageNodes = [0, 1, 2, 3, 4]
  return <div>
    <p style={p}>설계 후보 1·2를 읽는 데 필요한 개념을 모았습니다. 숫자는 이 프로젝트에서 <b>실제로 잰 값</b>이고, 재지 못한 것은 그렇게 적었습니다.</p>

    <Section title="1. SA(simulated annealing)란" open>
      <p style={p}><b>완성된 배치에서 시작해</b> 작은 변경(셀 교환·이동·뒤집기)을 반복합니다. 비용이 줄면 받아들이고, <b>늘어나는 변경도 확률 e<sup>−Δ/T</sup>로 받아들입니다.</b> 온도 T를 서서히 낮추면 처음에는 많이 헤매다가 나중에는 안정되어, 지역 최소에서 빠져나올 수 있습니다.</p>
      <svg viewBox="0 0 400 120" width="100%" style={{ maxWidth: 420, display: 'block' }} role="img" aria-label="SA 비용 지형: 지역 최소와 전역 최소, 오르막 수락">
        <defs><marker id="sa-arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="#C0A02B"/></marker></defs>
        <path d="M10 70 C50 15 90 15 125 75 S200 112 235 62 S300 28 335 85 S370 100 392 88" fill="none" stroke="#5a8dee" strokeWidth={2.2}/>
        <circle cx={124} cy={75} r={5} fill="#e57373"/><text x={124} y={96} textAnchor="middle" fontSize={10} fill="currentColor">지역 최소</text>
        <circle cx={208} cy={101} r={5} fill="#1D9E75"/><text x={208} y={116} textAnchor="middle" fontSize={10} fill="currentColor">전역 최소</text>
        <path d="M118 60 L134 38" stroke="#C0A02B" strokeWidth={2} markerEnd="url(#sa-arr)"/><text x={150} y={34} fontSize={10} fill="currentColor">오르막도 확률로 수락</text>
        <text x={10} y={12} fontSize={10} fill="currentColor">비용 (낮을수록 좋음)</text>
      </svg>
      <ul style={ul}>
        <li><b>이 프로젝트의 표준셀 SA:</b> 온도를 ×0.93씩 낮추는 127단계, 단계당 이동 max(100, 40n)번, 이동 종류는 교환 35% · 삽입 20% · 뒤집기 30% · 간격 15%입니다.</li>
        <li><b>칩 배치의 기존 SA</b>(<code>runReplaceThenAnnealing</code>): 블록 하나를 무작위로 골라 합법 위치로 옮기고 점수 변화로 수락 여부를 정합니다. 기본 반복은 6회로 짧습니다.</li>
        <li><b>장점:</b> 완성 배치의 비용만 계산할 수 있으면 어떤 비용이든 쓸 수 있고 구현이 단순합니다. <b>단점:</b> 최적 보장이 없고 seed마다 결과가 다릅니다.</li>
        <li>이동 하나씩 따라가는 <b>단계별 그림은 10절</b>에서 실제 엔진으로 볼 수 있습니다.</li>
      </ul>
    </Section>

    <Section title="2. DP(동적계획법)란" open>
      <p style={p}>큰 문제를 <b>겹치는 작은 부분 문제</b>로 나눠, 각 부분 문제를 <b>한 번만 풀어 표에 저장</b>하고 재사용합니다. 앞 단계의 최적 결과가 전체 최적의 일부가 되는 <b>최적 부분 구조</b>가 있고 <b>상태 수가 작을 때</b> 정확한 답을 줍니다.</p>
      <svg viewBox="0 0 400 130" width="100%" style={{ maxWidth: 420, display: 'block' }} role="img" aria-label="DP 단계와 beam: 각 단계에서 상위 K개 상태만 유지">
        {stageNodes.map(c => [0, 1, 2, 3, 4].map(r => {
          const kept = r === 1 || r === 3
          return <g key={`${c}-${r}`}>
            {c < 4 && [0, 1, 2, 3, 4].map(r2 => { const k2 = r2 === 1 || r2 === 3; return kept && k2 ? <line key={r2} x1={40 + c * 80} y1={20 + r * 22} x2={40 + (c + 1) * 80} y2={20 + r2 * 22} stroke="#5a8dee" strokeWidth={1.2} opacity={0.6}/> : null })}
            <circle cx={40 + c * 80} cy={20 + r * 22} r={7} fill={kept ? '#5a8dee' : 'var(--surface-muted)'} stroke={kept ? '#3f6fd0' : 'var(--border-strong)'} strokeDasharray={kept ? undefined : '2 2'}/>
          </g>
        }))}
        {['1단계', '2단계', '3단계', '4단계', '5단계'].map((t, c) => <text key={t} x={40 + c * 80} y={124} textAnchor="middle" fontSize={10} fill="currentColor">{t}</text>)}
        <text x={392} y={12} textAnchor="end" fontSize={10} fill="currentColor">파랑 = 유지(상위 K), 점선 = 버림</text>
      </svg>
      <ul style={ul}>
        <li><b>이 프로젝트에서 쓴 탐색 세 가지:</b> ① <b>표준셀 부분집합 DP</b>(상태 = 왼쪽에 놓인 셀의 집합, 2<sup>n</sup>개 → 23셀까지 정확), ② <b>간격 DP</b>(규칙 아래 µm 간격 나누기, 전수 탐색과 일치), ③ <b>위상 beam search</b>(블록을 순서대로 놓고 상위 K개만 유지 — DP의 단계 구조를 쓰지만 <b>정확한 DP가 아님</b>).</li>
        <li><b>정확한 DP와 beam의 차이:</b> 정확한 DP는 모든 상태를 유지해 최적을 보장하고, beam은 상위 K개만 남겨 <b>빠른 대신 보장이 없습니다.</b></li>
        <li>단계별 그림은 <b>설계 후보 2의 7절</b>에서 실제 엔진으로 따라갈 수 있습니다.</li>
      </ul>
    </Section>

    <Section title="3. SA와 DP · beam search의 차이" open>
      <div className="data-table"><table><thead><tr><th></th><th>SA</th><th>DP / beam search</th></tr></thead><tbody>
        <tr><td><b>만드는 방식</b></td><td><b>완성된 배치</b>에서 시작해 무작위로 조금씩 바꿈. 시작 배치는 <b>무작위로 만든 것이어도 되고, 기존 배치가 필요하지 않음</b></td><td><b>부분 배치</b>를 단계별로 키우며 앞 결과를 표에 저장·재사용</td></tr>
        <tr><td><b>기존 배치가 없을 때</b></td><td><b>가능.</b> 무작위 합법 배치에서 시작(아래 4절 실측). 단, 규칙이 많으면 합법 시작 배치를 만드는 것부터 일</td><td><b>가능.</b> 빈 보드에서 시작해 단계별로 구성</td></tr>
        <tr><td><b>해 표현</b></td><td>좌표를 직접 쓰거나, 겹침 없는 해만 만드는 표현(B*-tree·sequence pair, 8절)</td><td>상태 키(보드 전체 또는 요약)</td></tr>
        <tr><td><b>보장</b></td><td>없음. seed마다 결과가 다름</td><td>모델 안에서 <b>정확</b>(분해가 맞을 때). 자르면(beam) 보장 없음</td></tr>
        <tr><td><b>필요한 조건</b></td><td>완성 배치의 비용만 계산하면 됨. 어떤 비용이든 가능</td><td>비용이 단계별로 <b>분해</b>되고 상태가 작아야 함</td></tr>
        <tr><td><b>하드 규칙</b></td><td>위반 후보를 만든 뒤 거르거나 벌점</td><td><b>전이 단계에서 즉시 가지치기</b></td></tr>
        <tr><td><b>결과</b></td><td>실행마다 해 1개</td><td><b>서로 다른 상위 K개 + 계보</b></td></tr>
        <tr><td><b>커질 때</b></td><td>시간이 이동 횟수에 비례, 품질 저하</td><td>상태 수 폭발(부분집합 DP는 2<sup>n</sup>)</td></tr>
        <tr><td><b>재현성</b></td><td>seed가 같아야 같은 결과</td><td>결정적(항상 같은 결과)</td></tr>
      </tbody></table></div>
    </Section>

    <Section title="4. 이 프로젝트에서 잰 비교" open>
      <div className="data-table"><table><thead><tr><th>문제</th><th>SA</th><th>DP / 대안</th></tr></thead><tbody>
        <tr><td>표준셀 20~23셀 (후보 4개)</td><td>후보당 수십 초(측정된 두 후보 12~34초, seed 2개). 정확해보다 평균 <b>+1.3%</b> 나쁨(프록시 기준)</td><td><b>정확해 DP 0.6~4.1초</b> (20셀 0.6초, 22셀 2.1초, 23셀 4.1초)</td></tr>
        <tr><td>표준셀 10셀 이하 (후보 9개)</td><td>정확해보다 평균 <b>+1.1%</b> 나쁨(프록시 기준)</td><td>정확해 DP, 스펙트럴은 평균 +2.6%</td></tr>
        <tr><td>표준셀 40셀 (12비트 카운터)</td><td>seed 4개가 <b>200.5 ~ 298.6</b>로 크게 흔들림</td><td>DP 불가(24셀 이상). 스펙트럴 188.6, <b>스펙트럴 해에서 시작한 SA 185.3</b></td></tr>
        <tr><td>ADC–SRAM 간격 나누기</td><td>불필요</td><td>간격 DP가 <b>전수 탐색과 일치</b>(비용 1.7435, 5 µm 칸)</td></tr>
        <tr><td>칩 배치 (5블록) — <b>처음부터</b> SA (무작위 합법 시작, 직접 구현, seed 4개)</td><td><b>15초:</b> 최고 −132.9 · 중앙값 −136.4 · 최악 −165.8<br/><b>60초:</b> 최고 −133.2 · 중앙값 −140.1 · 최악 −147.6<br/>(T0=60→1.5, seed 4개, 2026-10-09 현재 엔진) 같은 설정에서 T0=5로 시작하면 15초 중앙값 −140.2(최악 −163.4), 60초 중앙값 −134.1(최악 −143.0)로 <b>T0 5와 60의 우열은 구별되지 않습니다.</b><br/>이동의 약 1/3이 불법(예: 17,641회 중 5,758회)</td><td><b>beam search K=32: 정확한 키 −132.70 (5.3초), 4칸 버킷 −132.74 (4.6초)</b><br/>무작위 합법 배치는 300번 시도 중 109개가 완성되고 최고 −307.4, 중앙값 −767.5 (11절 ⑤)</td></tr>
        <tr><td>칩 배치 — 게임에 있는 기존 SA (6~60회, 짧음)</td><td>6회 중앙값 −589.7 · 60회 중앙값 −362.5 (300회는 시간 초과; 2026-10-08, 모양 8개 엔진, 재측정 안 함)</td><td>위와 같음</td></tr>
      </tbody></table></div>
      <ul style={ul}>
        <li><b>SA도 기존 배치 없이 처음부터 잘 동작합니다.</b> 직접 구현한 단순 SA(블록 하나를 골라 그 뒤 블록들을 무작위 합법 위치로 다시 뽑는 이동, 온도 60→1.5 지수 냉각, 튜닝 없음)는 15초에 중앙값 −136.4, 최고 −132.9까지 갔습니다. <b>점수만 보면 SA도 seed에 따라 beam이 5초에 닿는 −132.70 근처에 닿지만, 편차가 큽니다</b>(15초 최악 −165.8, 60초에도 최악 −147.6). 이 문서의 이전 판에 있던 −153.9 ~ −180.0(15초)은 모양 8개·캐시 전 엔진의 값이며, 같은 SA의 이동 수가 캐시로 약 5배가 되었으므로 <b>엔진 속도가 큰 몫이었던 것으로 보입니다</b>(모양 수도 달라 원인을 단정하지는 않습니다). 더 오래·잘 조정한 SA가 beam을 넘는지는 측정하지 못했고, −132.70을 넘은 방법은 없었습니다.</li>
        <li>점수는 게임 proxy이며, 두 문제 모두 단일 인스턴스입니다. 게임의 기존 SA 행(−362.5)은 짧은 반복이라 SA 자체의 한계로 읽으면 안 됩니다.</li>
      </ul>
    </Section>

    <Section title="5. 어떤 경우에 무엇을 돌리나" open>
      <div className="data-table"><table><thead><tr><th>상황</th><th>유리한 쪽</th><th>이유</th></tr></thead><tbody>
        <tr><td>블록을 순서대로 놓는 단계 구조, 합법 후보 비율이 낮음 (칩 배치: 40,500쌍 중 333개)</td><td><b>beam search</b></td><td>규칙으로 먼저 거르는 편이 빠르고 합법 후보만 만듦</td></tr>
        <tr><td>정확해나 재현성이 필요하고 문제가 작음 (간격, 표준셀 23셀 이하)</td><td><b>DP</b></td><td>모델 안에서 최적 보장, 결과가 항상 같음</td></tr>
        <tr><td>서로 다른 상위 후보가 필요 (비싼 L1~L3 검증에 3개만 보냄)</td><td><b>beam search</b></td><td>상위 K개와 계보를 함께 얻음</td></tr>
        <tr><td>비용이 배치 전체에 얽혀 분해되지 않음 (라우팅·타이밍이 포함된 실제 평가)</td><td><b>SA</b></td><td>완성 배치의 비용만 알면 됨</td></tr>
        <tr><td>상태가 너무 커서 DP 불가 (표준셀 24셀 이상)</td><td><b>SA</b> 또는 스펙트럴</td><td>상태 폭발 회피</td></tr>
        <tr><td>이미 있는 해를 다듬는 후처리</td><td><b>SA</b></td><td>어떤 시작 해에서도 개선 가능</td></tr>
        <tr><td>기존 배치가 없는 처음부터의 배치</td><td><b>둘 다 가능</b></td><td>SA는 무작위 합법 시작에서 15~60초에 중앙값 −134 ~ −140(최악 −143 ~ −166), beam은 5초에 −132.7. 빠른 결과·다양한 후보는 beam, 시간 여유와 유연한 비용은 SA</td></tr>
      </tbody></table></div>
      <p style={p}><b>함께 쓰기는 문제에 따라 다릅니다.</b> 표준셀 40셀에서는 스펙트럴 해로 시작한 SA(185.3)가 스펙트럴(188.6)과 SA 단독(200.5)보다 좋았습니다. 반면 <b>칩 배치에서는 beam search 뒤에 SA로 국소 이동해도 개선이 없었습니다</b>(9절 측정). "beam search 뒤에 SA"가 항상 좋은 것은 아니며, 앞 단계의 결과가 국소 최적이 아닐 때만 효과가 있습니다.</p>
    </Section>

    <Section title="6. 용어">
      <div className="data-table"><table><thead><tr><th>용어</th><th>뜻</th></tr></thead><tbody>
        <tr><td><b>상태 / 전이 / 값</b></td><td>지금까지 정한 것의 요약 / 다음 선택 하나 / 그 상태의 점수(게임 점수에서 risk를 뺀 값)</td></tr>
        <tr><td><b>최적 부분 구조</b></td><td>앞 부분의 최적 결과가 전체 최적의 일부가 되는 성질. DP가 정확하려면 필요</td></tr>
        <tr><td><b>beam search</b></td><td>각 단계에서 값이 높은 상위 K개 상태만 남기는 탐색. DP의 단계 구조를 쓰지만 나머지를 버려 정확하지 않음</td></tr>
        <tr><td><b>상태 병합 / 상태 키</b></td><td>같은 키의 상태 중 값이 높은 하나만 유지. 키를 요약할수록 많이 합쳐지지만 근사</td></tr>
        <tr><td><b>가지치기</b></td><td>하드 규칙을 어기는 전이를 만들지 않고 버리는 것</td></tr>
        <tr><td><b>온도 T · 수락 확률</b></td><td>SA가 나빠지는 변경을 받아들이는 정도. 확률 e<sup>−Δ/T</sup>, T가 클수록 자주 수락</td></tr>
        <tr><td><b>지역 최소</b></td><td>주변보다는 좋지만 전체 최선은 아닌 해. SA는 이걸 넘으려 하고, 국소 개선은 갇힘</td></tr>
        <tr><td><b>L0 ~ L3</b></td><td>평가 단계: 게임 proxy / floorplan·tap·PDN / 배치·배선 / 전체 signoff</td></tr>
        <tr><td><b>sliver · tap · halo · PDN</b></td><td>tap 셀이 못 들어가는 좁은 행 조각 / 웰 전위를 잡는 셀 / 매크로 주변 비움 띠 / 전원 공급망</td></tr>
      </tbody></table></div>
    </Section>

    <Section title="7. 탐색의 차원 — 1D인가 2D인가, NP-hard는 어떻게 다뤘나" open>
      <p style={p}>이 프로젝트의 탐색 세 가지는 <b>차원도, 정확성도 서로 다릅니다.</b> "2D에서 정확한 DP"는 시도하지 않았고, 2D 문제(칩 배치)는 <b>일부러 정확성을 포기한 beam search</b>로 다뤘습니다.</p>
      <div className="data-table"><table><thead><tr><th>알고리즘</th><th>차원</th><th>상태</th><th>시간</th><th>정확성</th><th>어려움을 다룬 방법</th></tr></thead><tbody>
        <tr><td><b>표준셀 부분집합 DP</b></td><td><b>1D</b> (한 줄 안의 셀 순서)</td><td>왼쪽에 놓인 셀의 집합 (2<sup>n</sup>개)</td><td>지수: O(2<sup>n</sup>·(n+넷 수))</td><td>프록시 모델에서 정확</td><td>선형 배치는 일반적으로 NP-hard 계열이라 <b>지수 시간을 감수하고 n ≤ 23으로 제한</b>(메모리 84MB). 24셀 이상은 SA·스펙트럴로</td></tr>
        <tr><td><b>간격 DP</b></td><td><b>1D</b> (한 행 띠의 x 방향)</td><td>(간격 번호, 사용한 길이)</td><td>다항: O(k·LU²)</td><td>정확</td><td>1D 분할 문제라 NP-hard가 아님. 매크로 순서는 고정</td></tr>
        <tr><td><b>위상 beam search</b></td><td><b>2D</b> (25×12 격자)</td><td>지금까지 놓은 블록의 배치(보드)</td><td>다항: 단계당 K × 후보 × 합법 검사</td><td><b>보장 없음</b></td><td>아래 6가지로 <b>정확한 2D DP를 포기</b></td></tr>
      </tbody></table></div>
      <p style={p}><b>왜 정확한 2D DP가 어려운가:</b> 2D에서는 상태가 "보드의 점유 패턴"이 되어야 하는데, 25×12 = 300칸이면 가능한 패턴이 2<sup>300</sup>가지입니다. 폭이 좁은 보드에서 같은 크기의 타일을 채우는 문제(profile DP)는 가능하지만, 크기가 다른 큰 블록을 임의 위치에 놓는 배치/플로어플랜은 일반적으로 NP-hard입니다.</p>
      <p style={p}><b>위상 beam search가 2D를 다룬 방법 (6가지):</b></p>
      <ol style={ul}>
        <li><b>놓는 순서를 고정</b>했습니다(ADC → SRAM → SAR NEAR → CDC EDGE → CAPTURE NEAR). 순서를 찾는 탐색이 사라집니다.</li>
        <li><b>블록 5개, 50 µm 격자</b>로 문제 크기가 작습니다. 하드 매크로 쌍은 40,500개 중 규칙을 통과하는 333개뿐이고 전수 열거에 2.8초입니다.</li>
        <li><b>하드 규칙으로 즉시 가지치기</b>합니다(겹침, 영역, 이웃, 간격).</li>
        <li><b>이웃 규칙은 이웃 띠에서만 후보를 만듭니다</b>(합법 위치는 전체 스캔과 동일, 시간 약 3.3배 단축).</li>
        <li><b>상위 K개만 유지</b>(beam)합니다. 지금 점수가 낮아 버려진 상태가 나중에 더 좋았을 수 있어 <b>최적을 보장하지 않습니다.</b></li>
        <li><b>상태 키를 요약해 병합</b>합니다(4칸 버킷). 이것도 근사입니다.</li>
      </ol>
      <p style={p}><b>다른 길(미구현):</b> 슬라이싱 플로어플랜(블록을 가로·세로로 반복 분할한 구조)으로 제한하면 DP가 다항 시간에 정확해집니다(Stockmeyer 방식). 대신 슬라이싱으로 표현되지 않는 배치는 놓칩니다. 매크로가 수십 개로 늘면 검토할 만합니다. 정의·표현·이 프로젝트와의 관계는 <b>12절</b>에 따로 정리했습니다.</p>
    </Section>

    <Section title="8. SA의 해 표현 — B*-tree가 필요한가">
      <p style={p}><b>B*-tree</b>와 <b>sequence pair</b>는 사각형 블록의 배치를 <b>"겹침 없는 해"만 만드는 방식</b>으로 표현하는 자료구조입니다. B*-tree는 이진 트리로, 왼쪽 자식은 "오른쪽에 붙는 블록", 오른쪽 자식은 "위에 쌓이는 블록"을 뜻하고, 트리를 읽으면 왼쪽·아래로 <b>빽빽이 압축된</b> 배치가 하나 정해집니다. SA의 이동(노드 교환, 서브트리 이동, 회전)이 항상 겹침 없는 새 배치를 만듭니다.</p>
      <div className="data-table"><table><thead><tr><th></th><th>좌표를 직접 쓰는 방식 (지금 이 프로젝트)</th><th>B*-tree · sequence pair</th></tr></thead><tbody>
        <tr><td><b>겹침</b></td><td>이동 뒤 합법 검사로 걸러냄(불법 이동이 약 1/3: 6,980회 중 2,246회 등)</td><td>표현 자체가 겹침을 만들지 않음</td></tr>
        <tr><td><b>배치의 모양</b></td><td>어디에 놓든 자유(의도적 간격 가능)</td><td>항상 <b>압축된</b> 배치. 의도적 간격이 필요하면 별도 장치 필요</td></tr>
        <tr><td><b>이 프로젝트의 규칙</b></td><td>영역·필수 이웃·간격·sliver·PDN 정렬을 합법 검사와 비용에 직접 넣음</td><td>겹침 외 규칙은 <b>표현이 해결해 주지 않아</b> 검사가 여전히 필요</td></tr>
        <tr><td><b>적합한 규모</b></td><td>블록이 적거나 규칙이 많을 때</td><td>자유 크기 블록이 수십~수백 개이고 겹침만 문제일 때</td></tr>
      </tbody></table></div>
      <ul style={ul}>
        <li><b>이 프로젝트의 5블록 문제에서는 필수가 아닙니다.</b> 블록이 5개이고 합법성의 대부분이 겹침이 아닌 <b>영역·이웃·간격 규칙</b>이며, 압축이 오히려 필요한 의도적 간격(tap·PDN 정렬)과 충돌합니다.</li>
        <li><b>불법 이동 중 겹침 때문인 비율은 측정하지 않았습니다.</b> 전체 불법 비율(약 1/3)만 알고 있어서, B*-tree가 줄여 줄 몫은 그 일부입니다.</li>
        <li><b>채택을 검토할 때:</b> 계층 설계처럼 매크로가 수십 개로 늘어나 불법 이동이 대부분 겹침일 때입니다. 그때도 halo는 블록 크기를 키워 반영하고, tap·sliver 규칙은 압축 뒤에 스냅하는 후처리가 필요합니다.</li>
      </ul>
    </Section>

    <Section title="9. beam search 뒤에 SA로 국소 이동하면 좋은가 — 측정 결과" open>
      <p style={{ ...p, color: 'var(--text-secondary)' }}><b>이 절의 숫자는 2026-10-08, 모양 8개·캐시 전 엔진의 값입니다.</b> 현재 엔진에서 beam은 K=8 −134.77, K=32 이상 −132.70이라 "시작점"이 달라졌고, 아래 국소 SA 실험은 다시 재지 않았습니다.</p>
      <p style={p}>beam search의 결과를 시작점으로 낮은 온도(T 8 → 0.3)의 SA로 <b>블록 하나를 ±2칸(모양 변경 포함) 옮기는 국소 이동</b>을 10초 돌렸습니다. 먼저 beam search 결과가 단일 블록 변경으로 더 좋아질 수 있는지 <b>전수</b>로 확인했습니다.</p>
      <div className="data-table"><table><thead><tr><th>시작점 (beam search, 4칸 버킷 키)</th><th>beam search 점수</th><th>단일 블록 변경 전수 확인</th><th>beam search 뒤 국소 SA 10초</th><th>블록+의존 블록 묶음 이동 (±4칸)</th></tr></thead><tbody>
        <tr><td>K=8 (4.7초)</td><td><b>−136.51</b></td><td>대안 7,495개 중 합법 149개, <b>개선 0</b></td><td>seed 4개 모두 <b>−136.51</b> (이동 약 4,100회, 수락 123~168회, 불법 약 91%)</td><td>400개 중 합법 6개, 상위 8개 상태에서 <b>개선 0</b></td></tr>
        <tr><td>K=8의 2·3위 상태</td><td>−138.13 / −138.38</td><td>—</td><td>각 3.3초: 변화 없음</td><td>—</td></tr>
        <tr><td>K=32 (12.9초)</td><td><b>−133.14</b></td><td><b>개선 0</b></td><td><b>−133.14</b> (이동 3,901회, 수락 134회)</td><td>400개 중 합법 18개, 상위 8개 상태에서 <b>개선 0</b></td></tr>
      </tbody></table></div>
      <p style={p}><b>더 큰 이동으로 다시 시험했습니다.</b> 블록 하나와 그 뒤 블록들을 합법 위치로 다시 뽑는 이동, 시작은 beam search K=8 최선(−136.51), 30초, seed 3개, 온도를 바꿔 가며 쟀습니다. beam은 K를 키워 어디까지 가는지 기준값도 쟀습니다.</p>
      <div className="data-table"><table><thead><tr><th>방법</th><th>결과</th></tr></thead><tbody>
        <tr><td>큰 이동 SA, T0 = 5 → 1</td><td>seed 3개 모두 <b>−136.51</b> (개선 0)</td></tr>
        <tr><td>큰 이동 SA, T0 = 20 → 1</td><td>seed 1개 <b>−133.14</b>, 나머지 2개 −136.51</td></tr>
        <tr><td>큰 이동 SA, T0 = 60 → 1</td><td>seed 3개 모두 <b>−136.51</b> (개선 0)</td></tr>
        <tr><td>beam search K=32 / 128 / 256 (4칸 버킷)</td><td>모두 <b>−133.14</b> (12.9초 / 37.4초 / 74.2초) — 32 이후로 더 오르지 않음</td></tr>
      </tbody></table></div>
      <ul style={ul}>
        <li><b>국소 이동(±2칸 단일 블록, ±4칸 묶음)의 SA는 개선하지 못했습니다.</b> beam search 결과는 이미 이런 이동에 대해 <b>국소 최적</b>입니다.</li>
        <li><b>큰 이동의 SA는 가끔만 개선합니다.</b> 9번의 30초 실행 중 <b>1번</b>(T0=20)만 −136.51에서 −133.14로 올랐고, 그 값은 beam K=32가 13초에 결정적으로 얻는 값과 같습니다. <b>SA는 어떤 실행에서도 −133.14를 넘지 못했고</b>(처음부터 60초 SA의 최고도 −140.8), K=32~256의 beam도 −133.14에서 멈췄습니다. 이전 엔진에서는 −133.14가 도달 상한으로 보였고 현재 엔진에서는 −132.70입니다. 어느 쪽도 <b>전역 최적이라는 증명은 아닙니다.</b></li>
        <li><b>점수를 올린 것은 국소 이동이 아니라 빔 폭입니다.</b> K=8(−136.51) → K=32(−133.14)로 키우면 좋아졌는데, 국소 SA가 K=8 결과에서 −133.14에 도달하지 못했습니다. 두 해는 여러 블록의 위치가 함께 달라서 <b>국소 이동으로는 건널 수 없는 거리</b>에 있습니다.</li>
        <li><b>이동이 경직된 탓도 있습니다.</b> 필수 이웃 규칙(맞닿아야 함) 때문에 블록 하나만 옮기면 91%가 불법이고, 묶음 이동도 합법인 것이 400개 중 6~18개뿐입니다.</li>
        <li><b>한계:</b> 점수는 게임 proxy이고 한 문제 인스턴스입니다. 큰 이동 SA는 온도 3가지 × seed 3개(총 9회)뿐이라 "가끔 개선"의 빈도(1/9)는 거친 추정이며, 냉각 스케줄·이동 비율은 튜닝하지 않았습니다.</li>
      </ul>
      <p style={p}><b>그래서 이 문제에서 beam search 결과를 더 좋게 하는 방법은 SA가 아니라 이런 것들입니다(제안):</b> ① 빔 폭 K와 상태 키(버킷 크기) 조정, ② 간격 DP로 50 µm 격자보다 세밀한 <b>µm 좌표 정밀화</b>(정확), ③ <b>실제 비용(L1~L3 결과)을 기준</b>으로 한 국소 개선 — beam search가 쓴 게임 점수와 실제 결과가 어긋나는 곳이 개선 여지입니다. 국소 SA가 유효한 경우는 앞 단계 결과가 국소 최적이 아닐 때(스펙트럴 해, 표준셀 24셀 이상)입니다.</p>
    </Section>

    <Section title="10. SA 단계별 그림 설명 (이동 하나씩 따라가기)" open>
      <SaStepByStep/>
    </Section>

    <Section title="11. SA는 어떻게 구현되어 있나 — seed·후보 영역·온도·설정값, 그리고 beam search와의 성능 차이 분석" open>
      <SaMechanics/>
    </Section>

    <Section title="11-2. beam search + SA + 간격 DP 결합, 그리고 GA(유전 알고리즘)는 필요한가 — 같은 시간 예산 비교 측정" open>
      <CombinedSearch/>
    </Section>

    <Section title="12. 슬라이싱 플로어플랜 — 정의, 표현, 이 프로젝트와의 관계" open>
      <p style={p}><b>슬라이싱(slicing) 플로어플랜</b>은 사각형 영역을 <b>끝에서 끝까지 한 번에 자르는 선(guillotine cut)</b>으로 재귀적으로 나눠서 만들 수 있는 배치입니다. 영역을 가로 또는 세로로 한 번 잘라 두 조각으로 나누고, 조각마다 같은 방식으로 또 자르기를 블록 하나만 남을 때까지 반복합니다. 이렇게 만들 수 없는 배치가 <b>non-slicing</b>입니다.</p>
      <svg viewBox="0 0 460 160" width="100%" style={{ maxWidth: 480, display: 'block' }} role="img" aria-label="왼쪽: 4×2 격자는 슬라이싱, 오른쪽: 풍차 5블록은 non-slicing">
        {[0, 1].map(r => [0, 1, 2, 3].map(c => <g key={`${r}-${c}`}>
          <rect x={10 + c * 48} y={18 + r * 56} width={44} height={40} rx={3} fill="#85B7EB" stroke="#185FA5"/>
          <text x={32 + c * 48} y={42 + r * 56} textAnchor="middle" fontSize={11} fill="#042C53">{r * 4 + c}</text>
        </g>))}
        <line x1={4} y1={66} x2={206} y2={66} stroke="#C0A02B" strokeWidth={2} strokeDasharray="5 3"/>
        <text x={10} y={12} fontSize={10} fill="currentColor">슬라이싱: 4×2 격자 (H 자르기 한 줄이 영역 전체를 가로지름)</text>
        <text x={10} y={140} fontSize={10} fill="currentColor">위·아래 행 안에서는 V 자르기로 4개씩 나눔</text>
        <rect x={260} y={20} width={100} height={30} fill="#E8C7F0" stroke="#7B3F8F"/><text x={310} y={39} textAnchor="middle" fontSize={11} fill="#3B1346">A</text>
        <rect x={360} y={20} width={60} height={70} fill="#C7E8D4" stroke="#2E7D55"/><text x={390} y={58} textAnchor="middle" fontSize={11} fill="#10341F">B</text>
        <rect x={260} y={50} width={40} height={80} fill="#F5D9B5" stroke="#B5701F"/><text x={280} y={92} textAnchor="middle" fontSize={11} fill="#4A2A08">D</text>
        <rect x={300} y={90} width={120} height={40} fill="#C7DDF5" stroke="#185FA5"/><text x={360} y={114} textAnchor="middle" fontSize={11} fill="#042C53">C</text>
        <rect x={300} y={50} width={60} height={40} fill="#F5C7C7" stroke="#A32D2D"/><text x={330} y={74} textAnchor="middle" fontSize={11} fill="#501313">E</text>
        <text x={250} y={12} fontSize={10} fill="currentColor">non-slicing: 풍차(pinwheel) 5블록</text>
        <text x={250} y={146} fontSize={10} fill="currentColor">어떤 선을 그어도 중간 블록에 막혀 끝까지 못 감</text>
      </svg>

      <p style={p}><b>표현.</b> 자르기 순서를 이진 트리(잎 = 블록, 안쪽 노드 = <code>H</code> 또는 <code>V</code>)로 쓰고, 그 트리를 후위 표기로 적은 것이 <b>Polish expression</b>입니다. 연산자가 연속으로 같지 않게 쓴 <b>normalized</b> 형태는 배치마다 표현이 하나로 정해집니다(Wong &amp; Liu, 1986). 여기서 <code>V</code>는 두 조각을 <b>좌우로 나란히</b>, <code>H</code>는 <b>위아래로 쌓는</b> 자르기입니다. 이 프로젝트의 4×2 격자(윗줄 ch0~3, 아랫줄 ch4~7)는 다음과 같습니다.</p>
      <div style={mono}>0 1 V 2 V 3 V   4 5 V 6 V 7 V   H</div>
      <p style={p}>윗줄 4개를 좌우로 이어 붙이고, 아랫줄 4개도 그렇게 한 뒤, 두 줄을 위아래로 쌓은 것입니다. 블록이 8개이고 연산자가 7개입니다.</p>

      <div className="data-table"><table><thead><tr><th></th><th>Slicing</th><th>Non-slicing</th></tr></thead><tbody>
        <tr><td><b>표현</b></td><td>슬라이싱 트리, Polish expression</td><td>B*-tree, sequence pair, O-tree 등 (8절)</td></tr>
        <tr><td><b>크기 계산</b></td><td><code>V</code>는 너비를 더하고 높이는 큰 쪽, <code>H</code>는 높이를 더하고 너비는 큰 쪽. 모양을 바꿀 수 있는 블록은 가능한 (너비, 높이) 곡선을 합쳐 올라가며 최소 면적 모양을 정확히 고름(Stockmeyer, 7절)</td><td>일반적으로 이런 정확한 합성이 안 됨</td></tr>
        <tr><td><b>SA 이동</b></td><td>피연산자 교환, 연산자 사슬 반전, 피연산자-연산자 교환 세 가지가 <b>항상 유효한 배치</b>를 유지</td><td>표현마다 유효성 처리가 필요</td></tr>
        <tr><td><b>배치 공간</b></td><td><b>좁음</b> — 풍차처럼 만들 수 없는 배치가 있어 면적 낭비가 생길 수 있음</td><td>넓음 — 이론상 더 촘촘히 배치 가능</td></tr>
        <tr><td><b>배선 채널</b></td><td>자르는 선이 곧 배선 채널이 되고, 안쪽 조각부터 바깥으로 배선 순서가 정해짐</td><td>채널 순서가 꼬일 수 있고, 채널 폭을 따로 보장해야 함</td></tr>
        <tr><td><b>계층 설계</b></td><td>트리가 모듈 계층과 자연스럽게 대응</td><td>대응이 약함</td></tr>
      </tbody></table></div>

      <p style={p}><b>이 프로젝트와의 관계:</b></p>
      <ul style={ul}>
        <li>{badge('확정')} <b>검증된 격자 baseline은 slicing입니다.</b> <code>config_hierarchical.json</code>의 좌표(윗줄 y=100, 아랫줄 y=1200, 행 사이 300µm)는 영역 전체를 가로지르는 H 자르기 선 하나가 채널이 되는 구조입니다.</li>
        <li>{badge('가설')} <b>macro tetris 모델의 <code>CHANNEL_SAFE_MARGIN=300</code> 제약("다이를 가로지르는 빈 띠")은 slicing의 H/V 자르기 채널과 같은 개념입니다.</b> 영역 끝에서 끝까지 이어진 빈 띠가 일정 폭 이상 있어야 한다는 조건이기 때문입니다. 그 제약이 slicing을 염두에 두고 만든 것은 아니며, 이건 비교하는 해석입니다.</li>
        <li>{badge('확정')} 실패한 macrotetris 후보의 <b>실패 사실은 실측으로 확인됐습니다.</b> v1은 <code>DPL-0036</code>(합법 자리를 못 찾은 hold 수리 버퍼 약 300개 — 실행 로그로 진단됐고, 행 사이 채널을 300→100µm로 좁힌 것이 원인), v2는 <code>GRT-0118</code>(라우팅 혼잡 과다)로 실패했습니다. v2가 왜 혼잡했는지는 로그만으로는 확정하지 못했습니다.</li>
        <li>{badge('가설')} 두 후보 모두 <b>영역 전체를 가로지르는 가로 방향의 넓은 빈 띠가 사라졌거나 좁아진 배치</b>입니다. v1은 그 띠가 100µm로 좁아졌고, v2는 저장된 좌표로 확인해 보면 가로 방향 전체를 가로지르는 빈 띠가 아예 없고 세로 방향 틈(약 90µm)만 있습니다. 그래서 "slicing 구조를 유지하면 이런 실패를 구조적으로 피할 수 있다"는 가설이 서지만, <b>slicing 구조 자체가 원인이라는 인과는 검증하지 않았습니다</b>(실패 2건 대 성공 baseline 1건뿐).</li>
        <li><b>ParSAC은 non-slicing 쪽입니다.</b> B*-tree로 매크로를 왼쪽·아래로 압축해 배치하므로 면적에는 유리하지만, 채널 폭을 따로 보장해 주지는 않습니다(8절의 "의도적 간격과 충돌" 항목과 같은 이야기).</li>
      </ul>
      <p style={p}><b>한계.</b> slicing이 항상 더 좋은 것은 아닙니다. 매크로가 같은 크기 8개뿐인 지금은 격자가 이미 slicing이라 이득이 작고, 면적이 크게 중요한 문제에서는 non-slicing이 유리합니다. 미구현이지만 매크로가 수십 개로 늘면 "slicing 구조를 유지하는 SA(Polish expression 기반)"와 지금의 자유 좌표 SA·B*-tree를 비교해 볼 만합니다. 비교 지표는 합법 비율과 실제 OpenLane 통과 여부여야 합니다(점수 proxy만으로는 v1·v2 실패를 못 걸러냈습니다).</p>
    </Section>

    <Section title="13. seed와 시작 배치 — 셀 SA와 Macro Tetris는 어떻게 다른가 (코드 확인)">
      <p style={p}>10~11절의 칩 배치 SA 외에, 이 대시보드에는 SA가 두 개 더 있습니다. 셋 모두 <code>mulberry32(seed)</code> 난수 생성기를 쓰지만 <b>seed로 만드는 시작 배치의 표현이 다릅니다.</b> 아래는 소스를 읽고 정리한 내용입니다.</p>
      <div className="data-table"><table><thead><tr><th></th><th>셀 SA (CellSaExperiment)</th><th>Macro Tetris (macroTetrisModel)</th></tr></thead><tbody>
        <tr><td><b>배치의 표현</b></td><td>한 행에 일렬: <code>order</code>(셀 순서) · <code>flip</code>(좌우 반전) · <code>gaps</code>(셀 사이 빈 site 0~2)</td><td>매크로 8개의 <code>x, y</code> 좌표 + 허브(점)</td></tr>
        <tr><td><b>seed 정하기</b></td><td>단일 실행은 1, 2, 3…. 비교·보완 실험은 <code>Math.random()</code>으로 뽑은 기준값에 0, 1, 2…를 더함. 내부에서 <code>seed × 7919</code>로 섞음</td><td>누를 때마다 <code>Math.floor(Math.random() × 1e9)</code>. 병렬 lane마다 서로 다른 seed</td></tr>
        <tr><td><b>시작 배치</b></td><td><code>order</code>는 Fisher–Yates 셔플, <code>flip</code>은 셀마다 50%, <code>gaps</code>는 전부 0</td><td>"처음부터 랜덤" lane만 <code>randomStart</code>: 크기·HARD/SOFT는 그대로, 위치만 <code>x = rng() × (DIE_W − w)</code>, <code>y = rng() × (DIE_H − h)</code>. 허브는 고정 좌표</td></tr>
        <tr><td><b>합법성</b></td><td>순서로 x를 누적 계산하므로 <b>시작 배치부터 겹침이 없음</b></td><td>겹침·최소 간격(100µm) 위반이 있을 수 있어 <b>합법이 아님</b>. 이어지는 RePlAce 스타일 합법화가 밀어내서 풂</td></tr>
        <tr><td><b>이동</b></td><td>swap / insert / flip / gap ±1 중 하나를 난수로 고름</td><td>매크로나 허브 하나를 골라 <code>±max(80, 0.6·T)</code> 범위의 난수만큼 평행이동 후 다이 안으로 가둠</td></tr>
        <tr><td><b>시작 온도</b></td><td>난수 이동 200개를 시험해 올라가는 이동의 평균이 80% 확률로 수용되도록 T0를 정함</td><td>고정값 <code>SA_T0=1500</code>, <code>SA_T_MIN=20</code>, 5000번에 걸쳐 식고 다시 데움</td></tr>
      </tbody></table></div>
      <ul style={ul}>
        <li>{badge('확정')} Macro Tetris의 병렬 lane이 모두 랜덤 시작은 아닙니다. 일부는 <code>bestState</code>(현재 최선)에서 이어서 탐색합니다. "처음부터 랜덤" lane만 위 표의 <code>randomStart</code>를 씁니다.</li>
        <li>{badge('확정')} 표현을 순서·반전·간격으로 잡은 셀 SA는 불법 배치가 아예 생기지 않고, 좌표로 잡은 Macro Tetris는 불법 배치를 허용하되 합법화·비용 페널티로 처리합니다. 둘은 <b>"합법을 항상 유지하며 탐색"과 "불법을 허용하고 나중에 고침"</b>이라는 서로 다른 설계입니다.</li>
        <li>{badge('확정')} Macro Tetris는 후보에 seed를 항상 남기지는 않습니다. RePlAce 스타일 후보만 이름에 <code>seed N</code>이 들어갑니다. 그래서 좋은 후보가 나와도 같은 seed로 재현하지 못할 수 있습니다.</li>
        <li>{badge('가설')} 재현성을 위해 후보와 함께 seed를 저장하도록 바꾸면 좋은 후보를 다시 만들 수 있습니다. 아직 구현하지 않았습니다.</li>
      </ul>
    </Section>
    <Section title="14. 표준셀 부분집합 DP — 문제 정의, 풀이, 그리고 실제 배치 문제와의 차이" open>
      <p style={p}><b>한 줄 요약.</b> 이 DP는 <b>"한 행에 놓는 셀 n개(n ≤ 23)의 순서와 좌우 반전"</b>을 정확히 푸는 방법입니다(프록시 비용 모델 기준). 칩 전체의 다중 행 배치를 푸는 방법이 아니므로, 결과를 실제 배치 성능으로 읽으면 안 됩니다. 아래는 소스(<code>CellSaExperiment.tsx</code>의 <code>subsetDp</code>, <code>proxyNets</code>, <code>evaluate</code>)를 읽고 정리한 내용입니다.</p>

      <p style={{ ...p, marginBottom: 2 }}><b>1) 문제 정의</b></p>
      <div className="data-table"><table><thead><tr><th style={{ width: '18%' }}>항목</th><th>내용</th></tr></thead><tbody>
        <tr><td><b>입력</b></td><td>셀 n개(폭 W<sub>i</sub>, 핀의 정규화된 x 위치와 y 범위), 2핀 넷 목록(드라이버 → 싱크), 규칙(행 높이, site 폭, 배선 트랙), 가중치(면적 · 굴곡 · 수직)</td></tr>
        <tr><td><b>결정 변수</b></td><td><b>순서</b> π (n!가지)와 셀별 <b>좌우 반전</b> f<sub>i</sub> ∈ {'{'}N, FN{'}'} (2<sup>n</sup>가지)</td></tr>
        <tr><td><b>고정한 가정</b></td><td>① 셀은 <b>한 행</b>에 일렬 ② 셀 사이 <b>간격 0</b> ③ 셀의 y좌표는 변수가 아님 ④ 넷은 met1과 트랙으로 배선, 넷마다 가장 좋은 트랙을 고름</td></tr>
        <tr><td><b>목적 함수</b></td><td>면적 항(전체 폭 × 행 높이) + 모든 넷의 배선 비용(가로 길이 + 수직 이동 + 굴곡 가중치)</td></tr>
        <tr><td><b>출력</b></td><td>비용이 최소인 (순서, 반전). 간격은 전부 0</td></tr>
        <tr><td><b>규모 제한</b></td><td>n ≤ 23 (<code>MAX_DP_N</code>). 상태 2<sup>n</sup>개 × (비용 8B + 부모 1B + 컷 1B) ≈ 23셀에서 약 80MB</td></tr>
      </tbody></table></div>

      <p style={{ ...p, marginBottom: 2, marginTop: 10 }}><b>2) 풀이: 왜 "왼쪽 집합"만 알면 되나</b></p>
      <p style={p}>간격이 0이면 셀 v의 x좌표는 <b>왼쪽 셀들의 폭의 합</b>이고, 왼쪽 셀들의 순서와는 무관합니다. 왼쪽 셀 a와 오른쪽 셀 b를 잇는 넷의 가로 길이를 이렇게 쪼갭니다.</p>
      <div style={mono}>{`가로 길이 = (a의 핀 ~ a의 오른쪽 가장자리) + (둘 사이에 낀 셀들의 폭의 합) + (b의 왼쪽 가장자리 ~ b의 핀)

dp[S]        = 집합 S를 가장 왼쪽 |S|칸에 놓는 최소 비용
dp[S ∪ {v}]  = min over v ∉ S : dp[S] + 증분(S, v)
증분(S, v)   = (v의 핀 부분: 상대가 S 안이면 왼쪽 가장자리~핀, 밖이면 핀~오른쪽 가장자리)
             + Wv × (v 위를 지나가는 넷 수)         // = cut[S] − (v의 S쪽 넷 수)
cut[S ∪ {v}] = cut[S] + (v의 넷 수) − 2 × (v의 S쪽 넷 수)
반전: 셀마다 독립이라 두 경우(c0, c1) 중 작은 쪽을 고른다`}</div>
      <p style={p}>증분이 <b>S와 v만으로 정해지므로</b> 순서를 따로 기억하지 않아도 됩니다. 상태가 n!이 아니라 2<sup>n</sup>개가 되고, 시간은 대략 O(2<sup>n</sup>·(n + 넷 수))입니다. 부모 포인터에 마지막 셀(하위 5비트)과 반전 여부(비트 5)를 담아 끝에서 거꾸로 따라가며 순서를 복원합니다. 외판원 문제의 비트마스크 DP(Held–Karp)와 같은 모양입니다.</p>

      <p style={{ ...p, marginBottom: 2 }}><b>3) 어디까지 "정확"한가</b></p>
      <ul style={ul}>
        <li>{badge('확정')} <b>프록시 모델에서만 정확합니다.</b> 프록시는 넷마다 핀 도형을 하나로 고정하고 그 중심 x만 씁니다. 넷 비용은 <code>|x 차이| + K</code>이고, K는 위치와 무관한 수직·굴곡 항으로 핀 도형과 트랙만으로 정해져 미리 계산합니다.</li>
        <li>{badge('확정')} 실제 모델은 거리에 따라 핀 도형을 바꿔 고를 수 있어서, DP 해를 실제 모델로 다시 평가하면 프록시 값과 같거나 <b>작아집니다.</b> 그래서 DP 값은 "프록시 최적"이자 "실제 최적의 근사"입니다.</li>
        <li>{badge('확정')} 간격이 0이면 전체 폭이 일정해 면적 항은 상수가 됩니다. DP 값에는 넣지 않고 마지막에 더합니다.</li>
        <li>{badge('미측정')} 이번에 DP와 전수 탐색(<code>exhaustiveSearch</code>)의 답이 일치하는지는 새로 대조해 보지 않았습니다.</li>
      </ul>

      <p style={{ ...p, marginBottom: 2 }}><b>4) 실제 배치 문제와의 차이</b></p>
      <div className="data-table"><table><thead><tr><th style={{ width: '16%' }}>항목</th><th style={{ width: '26%' }}>이 DP의 모델</th><th>실제 문제에서 생기는 일</th><th style={{ width: '9%' }}>근거</th></tr></thead><tbody>
        <tr><td><b>행 수</b></td><td>한 행. 셀의 y는 고정</td><td>칩은 수십~수백 행. 셀이 <b>어느 행에 들어갈지(행 배정)</b>, 행 사이를 잇는 넷, 행 길이 균형이 문제가 됨. 행마다 따로 DP를 돌려 합치는 것으로는 풀리지 않음</td><td>{badge('확정')}</td></tr>
        <tr><td><b>규모</b></td><td>n ≤ 23</td><td>이 프로젝트의 hierarchical 기준 실행(top만)도 라우팅한 넷이 <b>38,198개</b>(final/metrics.json). 2<sup>n</sup> 상태는 이 규모에서 불가능</td><td>{badge('확정')}</td></tr>
        <tr><td><b>간격</b></td><td>0으로 고정</td><td>채움·탭·decap 셀, 혼잡을 풀기 위한 여유 간격이 필요함. SA는 간격 0~2를 변수로 쓰지만 DP는 쓰지 않음</td><td>{badge('확정')}</td></tr>
        <tr><td><b>넷 모양</b></td><td>2핀 넷만. 팬아웃은 같은 드라이버에서 2핀 넷 여러 개로 적음</td><td>다핀 넷은 HPWL이나 Steiner 트리로 길이를 재며, 2핀 넷 분해와 값이 다를 수 있음</td><td>{badge('가설')}</td></tr>
        <tr><td><b>비용 항</b></td><td>면적 · 가로 길이 · 굴곡 · 수직. 비용식에 타이밍·전력·혼잡 항이 없음</td><td>sign-off는 setup/hold 타이밍, 혼잡(GRT), antenna까지 본다. baseline 실행에서도 setup WNS −6.44ns, antenna 121 nets가 남음</td><td>{badge('확정')}</td></tr>
        <tr><td><b>방향</b></td><td>N / FN(좌우 반전)만</td><td>실제 행은 전원 레일 공유를 위해 위아래 행을 뒤집어(FS) 놓는 것이 일반적. 이 모델엔 행 간 반전이 없음</td><td>{badge('가설')}</td></tr>
        <tr><td><b>주변 요소</b></td><td>셀끼리의 넷만 봄. IO 핀·매크로와의 연결 항 없음</td><td>실제 블록은 외부 핀과 매크로까지 포함한 배선 길이가 비용임</td><td>{badge('확정')}</td></tr>
        <tr><td><b>검증</b></td><td>프록시 비용 비교. DRC/LVS와 연결 안 됨</td><td>배치 결과는 라우팅 후 DRC·LVS·STA로 판정함</td><td>{badge('확정')}</td></tr>
      </tbody></table></div>

      <p style={{ ...p, marginBottom: 2, marginTop: 10 }}><b>5) 그래서 이 DP로 말할 수 있는 것과 없는 것</b></p>
      <ul style={ul}>
        <li>{badge('확정')} <b>말할 수 있는 것:</b> 한 행에 들어가는 20~23셀 복합 셀의 순서·반전 문제에서, SA가 정확해에서 얼마나 떨어지는지 재는 <b>기준선(ground truth)</b>이 됩니다. 이 대시보드의 기록으로 SA는 평균 +1.3% 나빴습니다(프록시 기준).</li>
        <li>{badge('확정')} <b>말할 수 없는 것:</b> 칩 전체 배치의 최적성, 타이밍·혼잡·sign-off 통과 여부, 간격을 쓴 배치와의 우열.</li>
        <li>{badge('가설')} <b>넓히는 방향(미구현):</b> 일반적으로는 행 배정을 분할이나 전역 배치로 먼저 정하고, 각 행 안의 순서를 따로 최적화하는 2단계로 풉니다. 이때 이 DP는 두 번째 단계(행 안 순서)의 부품이 될 수 있습니다. 간격은 간격 DP(6절 후보 2)와 결합하는 쪽이 자연스럽습니다. 슬라이싱 구조로 제한하는 방법은 12절을 보세요. 이 프로젝트에서 시도한 것은 아닙니다.</li>
      </ul>
    </Section>
    <Section title="15. STA 이후 — setup · hold · slack · WNS, 위반을 고치는 법, 그리고 왜 오래 걸리나 (chan_top 실측)" open>
      <p style={p}>타이밍 위반이 "배선이 길어서"가 아니라는 것을 chan_top 재성형 4개 풀 실행(<code>runs/reshape_full_*</code>)의 STA 리포트와 단계별 실행 시간(<code>runtime.txt</code>)으로 확인했습니다. 수치는 <code>55-openroad-stapostpnr</code>(RCX 이후 sign-off STA)와 <code>35-openroad-stamidpnr-1</code>(CTS 이후)의 <code>max.rpt</code>·<code>min.rpt</code>에서 읽었습니다.</p>

      <p style={{ ...p, marginBottom: 2 }}><b>0) 먼저 용어 — launch 클럭 · capture 클럭 · skew · slew</b></p>
      <LaunchCaptureFigure/>
      <div className="data-table"><table><thead><tr><th style={{ width: '18%' }}>용어</th><th>뜻</th><th>이 프로젝트에서</th></tr></thead><tbody>
        <tr><td><b>launch 클럭</b></td><td>데이터를 <b>내보내는</b> 플롭(A)에 들어가는 클럭. 이 엣지에서 A의 출력이 바뀌며 데이터가 출발</td><td>같은 클럭 신호가 경로마다 역할만 다르게 불림</td></tr>
        <tr><td><b>capture 클럭</b></td><td>데이터를 <b>받는</b> 플롭(B)에 들어가는 클럭. 이 엣지에서 B가 입력을 읽어 저장</td><td>한 플롭이 앞 경로에서는 capture, 뒤 경로에서는 launch</td></tr>
        <tr><td><b>skew</b></td><td>같은 클럭이 두 플롭에 <b>도착하는 시간 차이</b> (capture − launch). 클럭 트리의 배선·버퍼 차이에서 생김</td><td>chan_top setup 분해에서 launch 0.7466 ns, capture 0.7478 ns → <b>약 +0.001 ns</b> (3절 표)</td></tr>
        <tr><td><b>slew</b></td><td>엣지가 0에서 1로 바뀌는 데 걸리는 시간(보통 10~90 %). 느릴수록 파형이 기울어지고 플롭이 값을 확정하는 시간이 더 필요</td><td>cell 라이브러리가 slew에 따라 setup/hold 시간을 다르게 줌 (이 그림의 계수는 예시)</td></tr>
        <tr><td><b>clock uncertainty</b></td><td>skew가 아니라, 지터·스큐 등 클럭 불확실성에 대비해 SDC에서 <b>마진으로 지정한 값</b></td><td>chan_top.sdc: 주기의 5 % (axi_clk 52 ns → 2.6 ns)</td></tr>
      </tbody></table></div>
      <ClockSkewSlewExplorer/>

      <p style={{ ...p, marginBottom: 2 }}><b>1) Setup과 Hold — 두 조건</b></p>
      <SetupHoldConceptFigure/>
      <div className="data-table"><table><thead><tr><th style={{ width: '16%' }}></th><th>Setup</th><th>Hold</th></tr></thead><tbody>
        <tr><td><b>묻는 것</b></td><td>데이터가 <b>다음 클럭 엣지 전에</b> 충분히 일찍 도착하는가</td><td>데이터가 <b>같은 엣지 직후에</b> 너무 일찍 바뀌지 않는가</td></tr>
        <tr><td><b>부등식</b></td><td>launch 클럭 + clk→Q + 경로 지연 ≤ 주기 + capture 클럭 − <b>setup 시간</b> − <b>uncertainty</b></td><td>launch 클럭 + clk→Q + 경로 지연 ≥ capture 클럭 + <b>hold(removal) 시간</b> + <b>uncertainty</b></td></tr>
        <tr><td><b>쓰는 지연</b></td><td>가장 긴 경로 (max)</td><td>가장 짧은 경로 (min)</td></tr>
        <tr><td><b>주기와의 관계</b></td><td>주기가 길수록 유리</td><td><b>주기와 무관</b>. 단 이 프로젝트는 uncertainty가 주기의 5%라서 주기를 늘리면 오히려 불리해짐</td></tr>
        <tr><td><b>불리한 코너</b></td><td>셀이 가장 느린 ss</td><td>셀이 가장 빠른 ff</td></tr>
        <tr><td><b>이 프로젝트의 값</b></td><td>플롭 setup 시간 0.265~0.275ns (dfrtp_1, ss)</td><td>library hold 시간 약 −0.02~−0.04ns(ff), 비동기 리셋 removal 0.358ns(tt)</td></tr>
        <tr><td><b>기본 수리</b></td><td>경로를 줄이거나(셀 키우기·버퍼·RTL 파이프라인) 주기를 늘림</td><td>경로에 <b>지연 셀을 넣어</b> 데이터를 늦춤</td></tr>
      </tbody></table></div>

      <p style={{ ...p, marginBottom: 2, marginTop: 10 }}><b>2) slack과 WNS는 어떻게 재나</b></p>
      <ul style={ul}>
        <li><b>끝점(endpoint)마다 계산합니다.</b> 끝점은 플롭의 D·RESET_B 핀과 출력 포트입니다. STA는 시뮬레이션 없이 그 끝점에 닿는 모든 경로의 도착 시간(setup은 최대, hold는 최소)과 필요 시간을 그래프로 전파해 구합니다.</li>
        <li><b>slack = 필요 시간 − 도착 시간</b>(setup), <b>도착 시간 − 필요 시간</b>(hold). 음수면 위반입니다.</li>
        <li><b>WS</b>는 모든 끝점 중 가장 나쁜 slack(부호 포함), <b>WNS</b>는 그중 음수인 값, <b>TNS</b>는 음수 slack의 합입니다. WNS는 "가장 나쁜 한 경로가 얼마나 모자라나", TNS는 "위반이 얼마나 넓게 퍼졌나"를 말합니다.</li>
        <li><b>코너 9개</b>(min/nom/max 배선 × tt/ss/ff 공정·전압·온도)에서 따로 재고, 최종 WNS는 그중 최악입니다. 이 실행들에서는 setup이 <b>max_ss_100C_1v60</b>에서만 음수였습니다.</li>
      </ul>
      <div className="data-table"><table><thead><tr><th>OpenLane 단계</th><th>시점</th><th>배선 기생값</th><th>클럭</th><th>믿을 수 있는 정도</th></tr></thead><tbody>
        <tr><td>12 STAPrePNR</td><td>합성 직후</td><td>없음</td><td>이상적(지연 0)</td><td>로직 깊이만 확인</td></tr>
        <tr><td>30 STAMidPNR</td><td>전역 배치 후</td><td>배치 거리로 추정</td><td>이상적</td><td>대략</td></tr>
        <tr><td>35 / 37 STAMidPNR</td><td>CTS 후 / 리페어 후</td><td>추정</td><td>실제 클럭 트리</td><td>스큐 반영</td></tr>
        <tr><td>43 STAMidPNR</td><td>전역 라우팅 후</td><td>라우팅 경로로 추정</td><td>실제</td><td>더 가까움</td></tr>
        <tr><td><b>55 STAPostPNR</b></td><td><b>상세 라우팅 + RCX 후</b></td><td><b>추출한 실제 값(SPEF)</b></td><td>실제</td><td><b>sign-off 기준. 코너 9개 전부</b></td></tr>
      </tbody></table></div>

      <p style={{ ...p, marginBottom: 2, marginTop: 10 }}><b>3) Setup 위반을 숫자로 분해 — 500×1280 (WNS −2.690ns, max_ss)</b></p>
      <div className="data-table"><table><thead><tr><th>항목</th><th>값 (ns)</th><th>설명</th></tr></thead><tbody>
        <tr><td>주기 (axi_clk)</td><td>52.000</td><td>capture 엣지는 한 주기 뒤</td></tr>
        <tr><td>− clock uncertainty</td><td>−2.600</td><td>SDC가 <b>주기의 5%</b>로 지정 (<code>chan_top.sdc</code> 130~131행)</td></tr>
        <tr><td>− setup 시간</td><td>−0.265</td><td>capture 플롭 <code>dfrtp_1</code>의 라이브러리 값</td></tr>
        <tr><td>+ capture 클럭 − launch 클럭</td><td>≈ +0.001</td><td>launch 0.7466, capture 0.7478 — 스큐가 거의 없음</td></tr>
        <tr><td><b>허용 데이터 지연</b></td><td><b>49.136</b></td><td>= 52 − 2.6 − 0.265 (+ 스큐)</td></tr>
        <tr><td>실제 데이터 지연</td><td>51.826</td><td>= 도착 52.572 − launch 클럭 0.747</td></tr>
        <tr><td>　그중 hold 지연 셀 18개</td><td>20.25</td><td><code>holdNNN</code> · <code>dlygate4sd3_1</code> (셀 하나가 ss에서 약 1.1~1.2ns)</td></tr>
        <tr><td>　그중 배선(net) 지연</td><td>0.25</td><td><b>전체의 약 0.5%</b></td></tr>
        <tr><td>　나머지 (원래 로직 + clk→Q 1.0)</td><td>≈ 31.3</td><td>FIFO 읽기 포인터에서 <code>_17532_</code>까지 셀 약 50개</td></tr>
        <tr><td><b>slack</b></td><td><b>−2.690</b></td><td>= 49.136 − 51.826</td></tr>
      </tbody></table></div>
      <SetupBudgetFigure/>
      <ul style={ul}>
        <li>{badge('확정')} <b>배선 길이와 setup WNS는 상관이 없습니다.</b> 실제 배선 길이는 650×985 830,680 · 590×1085 857,715 · <b>500×1280 824,297(가장 짧음)</b> · 450×1422 849,663µm인데, 가장 짧은 500×1280이 WNS가 가장 나쁩니다. 최악 경로의 배선 지연은 0.24~0.36ns뿐입니다.</li>
        <li>{badge('확정')} <b>setup WNS는 ss 코너에서만 음수입니다.</b> 500×1280의 같은 경로가 nom 기준 tt에서는 +3.59, ss에서는 −2.09ns입니다. 허용 시간(49.1ns)은 코너와 무관한데 셀 지연만 느려지기 때문입니다.</li>
        <li>{badge('확정')} 모양에 따라 달라진 것은 <b>이 경로에 붙은 hold 지연 셀 수</b>입니다. 11개(650×985·590×1085)면 −0.14~−0.18, 12개면 −0.46, 18개면 −2.69입니다.</li>
      </ul>

      <p style={{ ...p, marginBottom: 2, marginTop: 10 }}><b>4) Hold 위반을 숫자로 분해 — 590×1085, 35번 단계(CTS 이후), nom_tt</b></p>
      <HoldBudgetFigure/>
      <ul style={ul}>
        <li>{badge('확정')} 경로는 리셋 동기화 플롭 <code>_18177_</code>에서 다른 플롭 <code>_17504_</code>의 <code>RESET_B</code>로 가는 removal 검사입니다. 두 플롭의 클럭 도착 차이는 0.002ns뿐이고, <b>uncertainty 2.6ns를 빼면 +0.24ns 여유</b>입니다. 이 최악 경로는 uncertainty 때문에 위반으로 잡힌 것입니다.</li>
        <li>{badge('가설')} 위반 끝점 약 4,170개가 대부분 같은 이유로 보입니다(레지스터 간 경로는 대부분 2.6ns보다 짧음). 다만 전부를 경로별로 확인하지는 않았습니다.</li>
        <li>{badge('확정')} 36번 단계 resizer 로그: <code>RSZ-0046 Found 4176 endpoints with hold violations</code>, <code>RSZ-0032 Inserted 8084 hold buffers</code>(590×1085). 4개 모양 모두 8,075~8,085개로 <b>총량은 같습니다.</b></li>
        <li>{badge('확정')} 수리 후 hold는 4개 모양 모두 +0.12~+0.14ns로 통과합니다. 이때 최악 hold 경로는 uncertainty가 0.7ns(14ns × 5%)인 src_clk 경로입니다.</li>
        <li>{badge('확정')} SDC 주석에도 "axi 주기를 키우면 uncertainty·transition 마진이 주기에 비례해 커져 axi_clk 자신의 위반이 더 나빠졌다"고 기록돼 있습니다.</li>
      </ul>

      <p style={{ ...p, marginBottom: 2, marginTop: 10 }}><b>5) 원인의 사슬</b></p>
      <TimingChainFigure/>
      <ul style={ul}>
        <li>{badge('확정')} 같은 지연 셀 <code>dlygate4sd3_1</code>이 Liberty 기준 ff 0.377ns · tt 0.550ns · ss 1.112ns로, <b>ss가 ff의 약 2.9배</b>입니다(16절).</li>
        <li>{badge('가설')} 그래서 hold가 위험한 ff에서 맞추려고 넣은 지연이 setup이 위험한 ss에서는 약 3배로 커지는 구조로 보입니다. resizer가 어느 코너를 기준으로 지연 양을 정했는지는 확인하지 못했습니다.</li>
        <li>{badge('미측정')} 지연 셀이 왜 하필 그 경로에 18개 몰렸는지는 확인하지 못했습니다. 모양당 1회 실행이라 우연일 수 있습니다.</li>
      </ul>

      <p style={{ ...p, marginBottom: 2, marginTop: 10 }}><b>6) 위반이 나면 무엇을 고치고, 왜 다시 검증하나</b></p>
      <div className="data-table"><table><thead><tr><th>위반</th><th>고치는 방법</th><th>부작용 (그래서 다시 검증)</th><th>이 프로젝트에서</th></tr></thead><tbody>
        <tr><td>setup</td><td>셀 키우기(upsizing)·버퍼 삽입·로직 재구성</td><td>입력 부하·면적·전력 증가, 배치 밀도가 바뀌어 배선과 기생값이 달라짐</td><td>36번 resizer가 자동으로 수행</td></tr>
        <tr><td>setup</td><td>RTL 파이프라인(레지스터 추가)</td><td>사이클 지연이 바뀌어 기능 검증부터 다시</td><td><code>ch_cause_o</code>를 레지스터 출력으로 바꿔 axi_clk 위반 해소(SDC 주석, 9/20)</td></tr>
        <tr><td>setup</td><td>클럭 주기 늘리기</td><td>성능 저하. 이 SDC에선 uncertainty도 커져 hold가 나빠짐</td><td>axi 52 → 54ns로 완화하면 setup 통과(완화를 "닫힘"으로 인정할지는 미정)</td></tr>
        <tr><td>hold</td><td>지연 셀 삽입</td><td><b>같은 경로의 setup이 느려짐</b></td><td>8,080개 삽입 → 이 절의 setup 위반</td></tr>
        <tr><td>hold</td><td>hold 여유(<code>HOLD_SLACK_MARGIN</code>) 줄이기</td><td>setup은 좋아지고 hold가 깨질 수 있음</td><td>650×985에서 0.1 → 0: setup −0.139 → −0.096, hold +0.125 → <b>−0.003</b>(새로 위반)</td></tr>
        <tr><td>hold</td><td>clock uncertainty 조정</td><td>sign-off 근거(지터·스큐 마진)가 약해짐</td><td>미시도. 제약 결정이 필요</td></tr>
      </tbody></table></div>
      <ul style={ul}>
        <li><b>고치면 반드시 다시 검증하는 이유:</b> 수리 하나가 다른 것을 바꿉니다. hold 수리는 setup을 깎고, 셀을 키우거나 넣으면 배치 밀도와 배선이 바뀌어 기생값이 달라집니다. 진짜 기생값은 상세 라우팅과 RCX 뒤에만 있으므로 <b>55번 sign-off STA를 다시 돌려야</b> 최종 타이밍을 알 수 있습니다.</li>
        <li><b>레이아웃이 바뀌었으니 물리 검증도 다시 합니다.</b> 셀이 늘거나 옮겨지면 DRC(규칙)·LVS(회로 일치)·antenna 결과가 달라질 수 있어 함께 다시 확인합니다.</li>
        <li>{badge('확정')} 위 표의 hold 여유 실험이 그 예입니다. setup을 줄이려는 조치가 없던 hold 위반을 새로 만들었습니다.</li>
      </ul>

      <p style={{ ...p, marginBottom: 2, marginTop: 10 }}><b>7) 왜 이렇게 오래 걸리나 (runtime.txt 실측)</b></p>
      <div className="data-table"><table><thead><tr><th>실행</th><th>전체</th><th>hold·setup 리페어 (36번)</th><th>상세 라우팅</th><th>DRC (Magic+KLayout)</th><th>STA 전부</th><th>LVS+추출</th></tr></thead><tbody>
        <tr><td>chan_top 650×985</td><td>64.1분</td><td><b>19.7분</b></td><td>8.9분</td><td>10.0분</td><td>4.0분</td><td>2.4분</td></tr>
        <tr><td>chan_top 590×1085</td><td>67.6분</td><td><b>21.0분 (31%)</b></td><td>9.3분</td><td>10.5분</td><td>4.2분</td><td>2.6분</td></tr>
        <tr><td>chan_top 500×1280</td><td>66.4분</td><td><b>20.8분</b></td><td>9.4분</td><td>10.1분</td><td>4.1분</td><td>2.6분</td></tr>
        <tr><td>chan_top 450×1422</td><td>64.9분</td><td><b>19.7분</b></td><td>9.4분</td><td>9.3분</td><td>4.5분</td><td>2.4분</td></tr>
        <tr><td>daq_subsystem hierarchical (top)</td><td>293.6분</td><td>52.2분</td><td>17.4분</td><td><b>133.4분</b></td><td>37.9분</td><td>12.4분</td></tr>
      </tbody></table></div>
      <ul style={ul}>
        <li>{badge('확정')} <b>chan_top에서 가장 오래 걸리는 단계는 36번 리페어(약 20분, 전체의 약 30%)</b>입니다. STA 자체는 6번 돌아도 합쳐서 4분 남짓입니다.</li>
        <li>{badge('가설')} 리페어가 오래 걸리는 이유는 위반 끝점 약 4,170개마다 지연 셀을 하나씩 넣고 타이밍을 다시 갱신하는 일을 8,000번 넘게 반복하기 때문으로 보입니다. hold 위반 수가 줄면 이 시간도 줄 것입니다(미측정).</li>
        <li>{badge('확정')} hierarchical top은 DRC가 가장 깁니다. 이 실행은 중간에 WSL 재시작으로 끊겨 단계를 다시 돌렸으므로, 이 합계에는 <b>반복된 단계 시간이 포함</b>돼 있습니다.</li>
        <li>{badge('확정')} 한 번 고칠 때마다 최소 "리페어 → 라우팅 → RCX → STA"를 다시 돌려야 합니다. chan_top 기준으로 배치까지 재사용해도 약 25분입니다(<code>tools/wsl/118_run_reshape_variant.sh</code> 주석).</li>
      </ul>

      <p style={{ ...p, marginBottom: 2 }}><b>8) 시간을 줄이는 방법</b></p>
      <div className="data-table"><table><thead><tr><th>방법</th><th>효과</th><th>상태</th></tr></thead><tbody>
        <tr><td>배치 결과 재사용: 상세 배치 상태(<code>33-…/state_out.json</code>)에서 <code>--from OpenROAD.CTS</code>로 시작</td><td>합성·배치 약 20분 생략. 한 번 시험에 약 25분</td><td>{badge('확정')} 사용 중 (118번 스크립트)</td></tr>
        <tr><td>타이밍 실험은 <code>--to OpenROAD.STAPostPNR</code>에서 멈춤</td><td>DRC·LVS·스트림아웃(chan_top 약 15분) 생략. 최종 후보만 끝까지</td><td>{badge('확정')} 사용 중</td></tr>
        <tr><td>hold 수리 직후 ss 코너 STA로 미리 거르기</td><td>라우팅 전에 setup 위반 후보를 버림</td><td>{badge('미측정')}</td></tr>
        <tr><td>hold 위반 자체 줄이기 (예: hold용 uncertainty를 따로 지정)</td><td>지연 셀 수와 36번 리페어 시간이 함께 줄 가능성</td><td>{badge('가설')} 제약 결정 필요</td></tr>
        <tr><td>hierarchical로 블록 재사용</td><td>chan_top은 한 번만 sign-off하고 top은 glue만 P&amp;R</td><td>{badge('확정')} 사용 중</td></tr>
        <tr><td>병렬 실행</td><td>여러 후보를 동시에</td><td>{badge('확정')} 이 호스트(8코어)에서는 전체 P&amp;R을 사실상 한 번에 하나씩만 돌림</td></tr>
      </tbody></table></div>
      <ul style={ul}>
        <li>{badge('가설')} 중간 STA는 사실상 nom_tt만 갱신합니다(43번의 nom_ss·nom_ff 값이 30번과 똑같음). 위반은 ss에서만 생기므로 지금은 55번까지 가야 보입니다. 미리 거르기가 가능한지는 이 점을 바꿔 봐야 압니다.</li>
        <li>{badge('확정')} 4개 모양에서 CTS 이후 STA의 setup WS는 +3.78~+3.89로 거의 같았고, 최종 WNS는 −0.14~−2.69로 갈렸습니다. 지금 있는 중간 값으로는 최종 위반을 예측하지 못했습니다.</li>
      </ul>
    </Section>
    <Section title="16. 공정 코너(PVT) — ss · tt · ff는 무엇이고, 전압·온도는 얼마나 영향을 주나, 모두 통과해야 하나" open>
      <p style={p}>STA가 코너 9개에서 따로 재는 이유와, 코너 이름에 들어 있는 공정·배선·전압·온도가 각각 무엇인지 정리했습니다. 설정 값은 chan_top 실행의 <code>resolved.json</code>에서, 셀 지연은 sky130 PDK의 Liberty 파일(<code>sky130_fd_sc_hd__*.lib</code>)에서 직접 읽었습니다.</p>

      <p style={{ ...p, marginBottom: 2 }}><b>1) 코너 이름 읽는 법 — <code>max_ss_100C_1v60</code></b></p>
      <div className="data-table"><table><thead><tr><th>부분</th><th>무엇의 변동인가</th><th>누가 정하나</th><th>이 프로젝트 설정</th></tr></thead><tbody>
        <tr><td><b>max</b> (min / nom / max)</td><td><b>배선 공정 편차</b>: 금속선 두께·폭, 절연막 두께 → 배선 저항·용량</td><td>파운드리 (RC 추출 규칙)</td><td><code>RCX_RULESETS</code>: <code>rules.openrcx.sky130A.min/nom/max.calibre</code></td></tr>
        <tr><td><b>ss</b> (ss / tt / ff)</td><td><b>트랜지스터 공정 편차</b>: 도핑·게이트 길이·산화막 두께 → NMOS·PMOS 속도</td><td>파운드리 (SPICE 모델 → 코너별 Liberty)</td><td><code>LIB</code>: tt_025C_1v80 · ss_100C_1v60 · ff_n40C_1v95 세 파일</td></tr>
        <tr><td><b>100C</b></td><td>동작 <b>온도</b> (공정 아님)</td><td>사용 환경</td><td>공정과 짝지어진 값</td></tr>
        <tr><td><b>1v60</b></td><td>전원 <b>전압</b> (공정 아님)</td><td>전원 사양</td><td>공정과 짝지어진 값</td></tr>
      </tbody></table></div>
      <ul style={ul}>
        <li>{badge('확정')} 공정(P)·전압(V)·온도(T)를 합쳐 <b>PVT 코너</b>라고 부릅니다. 배선 RC 3가지 × 트랜지스터 3가지 = <code>STA_CORNERS</code> 9개이고, 기본 코너(<code>DEFAULT_CORNER</code>)는 <code>nom_tt_025C_1v80</code>입니다.</li>
        <li>{badge('확정')} ss는 <b>느린 공정 + 높은 온도 + 낮은 전압</b>, ff는 <b>빠른 공정 + 낮은 온도 + 높은 전압</b>으로 묶여 있습니다. 가장 나쁜 경우를 만들려는 조합이고, sky130 PDK가 정한 값입니다.</li>
        <li><b>한 칩이 코너를 오가는 것이 아닙니다.</b> 만들어진 칩마다 공정 분포의 어딘가에 놓이고, ss와 ff는 그 분포의 느린 끝과 빠른 끝입니다. 어느 칩이 어느 쪽일지 모르므로 <b>양 끝에서 모두 통과해야</b> 합니다.</li>
      </ul>

      <p style={{ ...p, marginBottom: 2, marginTop: 10 }}><b>2) 왜 ss와 ff를 둘 다 보나 — 이 프로젝트의 실제 값</b></p>
      <div className="data-table"><table><thead><tr><th>코너 (daq_subsystem hierarchical, final/metrics.json)</th><th>setup WS (ns)</th><th>hold WS (ns)</th></tr></thead><tbody>
        <tr><td>max_ss_100C_1v60</td><td><b style={{ color: '#c0392b' }}>−6.44 (위반)</b></td><td>+1.94</td></tr>
        <tr><td>max_tt_025C_1v80</td><td>+2.32</td><td>+0.69</td></tr>
        <tr><td>max_ff_n40C_1v95</td><td>+2.93</td><td><b style={{ color: '#c0392b' }}>−0.15 (위반)</b></td></tr>
      </tbody></table></div>
      <p style={p}>같은 회로에서 <b>setup은 ss에서만, hold는 ff에서만</b> 깨집니다. 셀이 느리면 데이터가 늦게 도착해 setup이 위험하고, 빠르면 너무 일찍 바뀌어 hold가 위험하기 때문입니다.</p>

      <p style={{ ...p, marginBottom: 2, marginTop: 10 }}><b>3) 전압과 온도는 얼마나 영향을 주나 (Liberty 실측)</b></p>
      <CornerDelayFigure/>
      <div className="data-table"><table><thead><tr><th>비교 (나머지 조건은 같음)</th><th>inv_1</th><th>dlygate4sd3_1</th><th>변화</th></tr></thead><tbody>
        <tr><td><b>전압</b>: ss 100°C, 1.60V → 1.40V</td><td>0.091 → 0.132</td><td>1.112 → 1.657</td><td><b>+45~49%</b></td></tr>
        <tr><td><b>전압</b>: ss −40°C, 1.76V → 1.28V</td><td>0.061 → 0.158</td><td>0.742 → 3.680</td><td><b>약 2.6~5배</b></td></tr>
        <tr><td><b>전압</b>: ff −40°C, 1.95V → 1.56V</td><td>0.038 → 0.049</td><td>0.377 → 0.644</td><td><b>+29~71%</b></td></tr>
        <tr><td><b>온도</b>: tt 1.80V, 25°C → 100°C</td><td>0.049 → 0.048</td><td>0.550 → 0.565</td><td>−2~+3%</td></tr>
        <tr><td><b>온도</b>: ss 1.60V, −40°C → 100°C</td><td>0.096 → 0.091</td><td>1.077 → 1.112</td><td>−5~+3%</td></tr>
        <tr><td><b>온도</b>: ff 1.65V, −40°C → 100°C</td><td>0.046 → 0.043</td><td>0.548 → 0.503</td><td>−7~−8%</td></tr>
        <tr><td><b>STA 코너 전체</b>: ff_n40C_1v95 → tt_025C_1v80 → ss_100C_1v60</td><td>0.038 → 0.049 → 0.091</td><td>0.377 → 0.550 → 1.112</td><td>ss가 ff의 <b>약 2.4~2.9배</b></td></tr>
      </tbody></table></div>
      <ul style={ul}>
        <li>{badge('확정')} <b>전압의 영향이 가장 큽니다.</b> 같은 공정·온도에서 전압만 낮춰도 지연이 크게 늘고, 저전압으로 갈수록 급격히 늘어납니다(1.76V → 1.28V에서 지연 셀 약 5배).</li>
        <li>{badge('확정')} <b>이 범위에서 온도의 영향은 작고 방향도 일정하지 않습니다</b>(−8~+3%). 낮은 전압에서는 뜨거울 때 오히려 빨라지는 경우도 표에 있습니다.</li>
        <li>{badge('확정')} 이 표의 ss 값(dlygate 1.112ns)은 15절 최악 경로의 리포트 값(ss에서 셀당 1.11~1.20ns)과 일치합니다.</li>
        <li>{badge('미측정')} 값은 Liberty 표의 한 점(입력 slew 0.053ns, 부하 약 0.0037pF)입니다. 실제 경로의 slew·부하는 셀마다 달라서 비율도 조금씩 다릅니다.</li>
      </ul>

      <p style={{ ...p, marginBottom: 2, marginTop: 10 }}><b>4) 코너로 잡지 못하는 것</b></p>
      <div className="data-table"><table><thead><tr><th>변동</th><th>다루는 방법</th><th>이 프로젝트</th></tr></thead><tbody>
        <tr><td>같은 칩 안 셀마다의 속도 차이 (on-chip variation)</td><td><b>derating</b>: 지연에 일정 비율을 곱해 비관적으로 계산</td><td><code>TIME_DERATING_CONSTRAINT</code> = 5(%)</td></tr>
        <tr><td>클럭 지터·스큐 등 불확실성</td><td><b>clock uncertainty</b> 마진</td><td>주기의 5% (axi 2.6ns, src 0.7ns) — 15절</td></tr>
        <tr><td>동작 중 전원 강하 (IR drop)</td><td>전원망 분석</td><td>daq_subsystem top의 IR drop worst 0.4mV (1.6V의 약 0.03%)</td></tr>
      </tbody></table></div>
      <p style={p}>세 가지 모두 공정 코너와 <b>별개</b>로 더해지는 마진입니다. 코너가 "어떤 칩이 만들어지나", derating·uncertainty는 "한 칩 안에서 얼마나 흔들리나"를 덮습니다.</p>

      <p style={{ ...p, marginBottom: 2, marginTop: 10 }}><b>5) 모든 코너를 통과해야 하나 — OpenLane 기본값, 이 프로젝트, 실제 sign-off</b></p>
      <p style={p}><b>모두 통과해야 합니다.</b> 코너는 해석용이 아니라 판정 기준입니다. 만들어진 칩이 공정 분포의 어디에 놓일지 모르기 때문에, 한 코너라도 위반이 있으면 그쪽에 걸린 칩은 동작하지 않을 수 있습니다. 특히 <b>hold 위반은 클럭을 늦춰도 고쳐지지 않아서</b> 제조 후에는 방법이 없습니다.</p>
      <div className="data-table"><table><thead><tr><th style={{ width: '16%' }}>기준</th><th>무엇에서 멈추나 / 무엇을 통과로 보나</th><th>빠진 것</th></tr></thead><tbody>
        <tr><td><b>OpenLane 기본값</b></td><td><code>TIMING_VIOLATION_CORNERS: ['*tt*']</code> — <b>tt 위반에서만 흐름을 멈춥니다.</b> ss·ff 위반은 <code>warning.log</code>에 경고만 남기고 끝까지 진행해 "Flow complete"가 됩니다.</td><td>ss의 setup, ff의 hold 판정이 통째로 빠짐</td></tr>
        <tr><td><b>이 프로젝트의 판정</b></td><td>9개 코너(배선 RC 3 × 공정 3) <b>전부</b> setup·hold 위반 0 + DRC·LVS·antenna 0일 때만 "signoff clean". Flow complete는 통과로 치지 않습니다.</td><td>sf/fs 공정, 저온 setup, 모드별 검사, 크로스토크(SI), 정교한 OCV</td></tr>
        <tr><td><b>실제 상용 sign-off</b> (일반적인 방식)</td><td>setup은 가장 느린 코너들(고온·저온 모두), hold는 <b>모든 코너</b>. 코너 × 모드(정상·스캔 테스트·저전력)를 전부 검사(MCMM). 보통 수십 개 이상의 조합</td><td>—</td></tr>
      </tbody></table></div>
      <ul style={ul}>
        <li>{badge('확정')} daq_subsystem hierarchical 실행은 "Flow complete"로 끝났지만, <code>warning.log</code>에 <code>Setup violations found in the following corners: max/min/nom_ss_100C_1v60</code>과 <code>Hold violations found in the following corners: max/min/nom_ff_n40C_1v95</code>가 남아 있습니다. chan_top 500×1280도 ss 코너 3개의 setup 위반이 경고로만 남았습니다.</li>
        <li>{badge('확정')} 그래서 <b>"흐름이 끝났다"와 "타이밍이 닫혔다"는 다른 말</b>입니다. 판정은 <code>warning.log</code>의 코너별 위반이나 <code>final/metrics.json</code>의 코너별 값으로 합니다.</li>
        <li><b>실제 sign-off가 더 보는 것</b>(일반론, 이 프로젝트에서 확인한 것 아님): ① <b>sf·fs</b> — NMOS·PMOS 중 한쪽만 빠른 공정, 상승·하강 지연이 비대칭이 됨 ② <b>temperature inversion</b> — 미세 공정에서는 저온에서 더 느려질 수 있어 setup도 고온·저온을 모두 봄(위 3번 표에서도 일부 조건은 뜨거울 때 더 빨랐음) ③ <b>배선 코너</b> — Cbest·Cworst·RCbest·RCworst처럼 용량과 저항을 따로 뒤틈 ④ <b>모드</b> — 모드마다 클럭과 제약이 다름 ⑤ <b>SI</b> — 이웃 배선의 간섭으로 바뀌는 지연 ⑥ <b>AOCV·POCV</b> — 경로 깊이·통계에 따른 derating.</li>
        <li><b>setup은 제품에 따라 여지가 있습니다.</b> 대부분은 최악 코너에서 목표 주파수를 맞추지만, 속도 등급을 나눠 파는 제품(speed binning)은 느린 칩을 낮은 등급으로 팝니다. 이때도 최저 등급 주파수는 최악 코너에서 맞춰야 합니다. <b>hold는 타협하지 않습니다.</b></li>
        <li>{badge('가설')} OpenLane 기본값이 tt만 막는 것은 흐름을 끝까지 돌려 결과를 얻기 위한 편의로 보입니다. 실험 단계에서는 이 방식이 DRC·LVS까지 정보를 더 얻지만, 최종 sign-off 실행에서는 <code>TIMING_VIOLATION_CORNERS</code>를 전체 코너로 바꾸는 것이 맞습니다(아직 바꾸지 않음).</li>
        <li>{badge('확정')} 따라서 이 대시보드의 <b>"signoff clean"은 "이 OpenLane 흐름의 9개 코너 기준으로 clean"</b>이라는 뜻입니다. 실제 상용 sign-off보다 좁은 범위입니다.</li>
      </ul>
    </Section>
    <Section title="17. 칩 온도 측정과 열 관리 — 어떻게 재고, 뜨거워지면 어떻게 동작하게 만드나" open>
      <p style={p}>칩 안의 온도는 <b>온도 센서 회로로 재고</b>, 온도가 오르면 <b>경고 → 성능 낮추기 → 강제 차단</b>의 단계로 대응하게 구성합니다. 아래 1~3은 업계의 일반적인 방식이고, 4는 이 프로젝트의 상황입니다.</p>

      <p style={{ ...p, marginBottom: 2 }}><b>1) 칩 안에서 온도를 재는 방법</b></p>
      <div className="data-table"><table><thead><tr><th style={{ width: '18%' }}>방식</th><th>원리</th><th>장점</th><th>단점</th></tr></thead><tbody>
        <tr><td><b>BJT·다이오드 센서</b> (가장 흔함)</td><td>트랜지스터의 베이스-이미터 전압(Vbe)이 온도에 따라 거의 직선으로 변함. 전류가 다른 두 트랜지스터의 Vbe 차이(ΔVbe)는 절대온도에 비례(PTAT)</td><td>정확함 (보정 후 ±1~2°C 수준)</td><td>아날로그 회로와 ADC가 필요하고, 제조 후 보정(trim)이 필요</td></tr>
        <tr><td><b>링 오실레이터 센서</b></td><td>인버터 고리의 발진 주파수가 온도에 따라 변함 → 카운터로 셈</td><td>표준셀만으로 만들 수 있음 (디지털 흐름으로 배치 가능)</td><td>정확도가 낮고 <b>전압 영향을 크게 받음</b></td></tr>
        <tr><td><b>외부 열 다이오드</b></td><td>칩 안의 다이오드를 핀으로 빼서 보드의 측정 칩이 읽음</td><td>칩 안 회로가 단순함</td><td>핀이 필요하고, 판단을 칩 밖에서 함</td></tr>
      </tbody></table></div>
      <ul style={ul}>
        <li>{badge('확정')} <b>링 오실레이터 방식의 약점은 16절 측정과 연결됩니다.</b> sky130 <code>inv_1</code>은 온도를 25 → 100°C로 바꿔도 지연이 −2~+3%만 변했지만, 전압을 1.60 → 1.40V로 낮추면 +45% 변했습니다(Liberty 값).</li>
        <li>{badge('가설')} 그래서 그대로 쓰면 온도보다 전압을 재게 됩니다. 전압을 따로 재서 보정하거나 전압에 둔감한 구조가 필요해 보입니다. Liberty 한 점의 값에서 나온 판단이고, 실제 센서로 시험하지는 않았습니다.</li>
        <li><b>배치:</b> 온도는 칩 안에서도 고르지 않습니다. 활동이 많은 블록 근처(핫스팟)에 센서를 여러 개 둡니다.</li>
        <li><b>보정:</b> 공정 편차 때문에 칩마다 센서 출력이 다르므로, 테스트 단계에서 알려진 온도로 한두 점을 재서 보정값을 저장합니다.</li>
      </ul>

      <p style={{ ...p, marginBottom: 2, marginTop: 10 }}><b>2) 온도가 오르면 어떻게 동작하게 구성하나</b></p>
      <ThermalControlFigure/>
      <div className="data-table"><table><thead><tr><th style={{ width: '14%' }}>단계</th><th>조건 (예시)</th><th>동작</th><th>누가 처리</th></tr></thead><tbody>
        <tr><td><b>경고</b></td><td>임계 1 초과</td><td>인터럽트로 알림, 기록</td><td>펌웨어·OS</td></tr>
        <tr><td><b>스로틀링</b></td><td>임계 2 초과</td><td>클럭 분주·게이팅, 작업량 줄이기</td><td>하드웨어(빠름) 또는 소프트웨어</td></tr>
        <tr><td><b>DVFS</b></td><td>과열이 계속됨</td><td>전압과 주파수를 함께 낮춤. 동적 전력은 대략 C·V²·f에 비례해 전압을 낮추는 효과가 큼</td><td>전력 관리 유닛</td></tr>
        <tr><td><b>긴급 차단</b> (thermal trip)</td><td>임계 3 초과</td><td>리셋 또는 전원 차단</td><td><b>소프트웨어와 무관한 하드웨어 경로</b> (소프트웨어가 멈춰도 동작해야 함)</td></tr>
      </tbody></table></div>
      <ul style={ul}>
        <li><b>히스테리시스:</b> 올라갈 때와 내려갈 때의 임계값을 다르게 둡니다(그림의 92°C 시작 / 85°C 해제). 경계에서 켜졌다 꺼졌다를 반복하지 않게 하려는 것입니다.</li>
        <li><b>센서 값 평균:</b> 순간 잡음으로 오동작하지 않게 여러 번 재서 평균을 씁니다.</li>
        <li><b>시스템 수준:</b> 팬·방열판 제어, 멀티코어에서는 뜨거운 코어의 작업을 다른 코어로 옮기기도 합니다.</li>
      </ul>

      <p style={{ ...p, marginBottom: 2, marginTop: 10 }}><b>3) 설계할 때 온도를 고려하는 이유</b></p>
      <ul style={ul}>
        <li><b>타이밍 보장 범위:</b> sign-off는 정해진 온도 범위에서만 합니다. 이 프로젝트는 −40°C(ff)부터 100°C(ss)입니다. 그 밖에서는 타이밍이 보장되지 않으므로 <b>스로틀 임계값은 sign-off 상한보다 낮게</b> 잡아야 합니다.</li>
        <li><b>누설 전류:</b> 온도가 오르면 누설 전류가 크게 늘고, 그 전력이 다시 열을 만듭니다. 이 고리가 커지면 <b>열폭주(thermal runaway)</b>가 생길 수 있어 차단 단계가 필요합니다.</li>
        <li><b>수명:</b> 배선의 전자이동(EM)과 트랜지스터 노화가 온도가 높을수록 빨라집니다.</li>
      </ul>

      <p style={{ ...p, marginBottom: 2, marginTop: 10 }}><b>4) 이 프로젝트에서는</b></p>
      <ul style={ul}>
        <li>{badge('확정')} Sample Test 4 RTL(<code>samples/sample_test_4/rtl</code>)에는 <b>온도 센서나 열 관리 로직이 없습니다</b>(<code>therm</code>·<code>temperature</code>·<code>tsens</code>로 검색해 확인).</li>
        <li>{badge('확정')} 이 칩은 정해진 온도 범위(−40~100°C) 안에서 동작한다는 전제로만 검증된 상태입니다. 온도 관리는 칩 밖(보드·시스템)에 맡기는 구조입니다.</li>
        <li>{badge('가설')} 넣는다면: 센서 출력을 CSR 레지스터로 읽게 하고, 임계값 초과 시 기존 <code>irq_ctrl</code>로 인터럽트를 보내고, 차단은 별도 하드웨어 경로로 두는 구성을 생각할 수 있습니다(미구현, 설계 아이디어).</li>
        <li>{badge('미측정')} sky130용 오픈소스 온도 센서 생성기(OpenFASoC 등)가 있는 것으로 알려져 있지만, 이 환경에서 확인하지는 않았습니다.</li>
      </ul>
    </Section>
  </div>
}

type DesignCandidate ={ id: string; label: string; title: string; summary: string; render: () => React.ReactNode }
const CANDIDATES: DesignCandidate[] = [
  { id: 'c1', label: '설계 후보 1', title: '규칙 인지 진화 — 위반 기억 + 규칙에 맞는 후보 생성 + 다단계 평가',
    summary: 'LVS·DRC 실측 규칙과 남은 공간을 적합도·변이·생성에 직접 반영한다', render: () => <Candidate1/> },
  { id: 'c2', label: '설계 후보 2', title: 'beam search 보조 탐색 — 초기 학습 + 부분 배치 재사용 + 중복 실행 방지',
    summary: '소수의 서로 다른 실험에서 얻은 DRC·STA 지식을 beam search 전이와 검증 우선순위에 반영한다', render: () => <Candidate2/> },
  { id: 'cmp', label: '결과 비교', title: 'SA와 beam search의 최종 결과, 그리고 설계 후보 1·2 비교',
    summary: '같은 문제를 두 방법으로 이 화면에서 직접 풀어 최종 배치를 나란히 보고, 두 설계 후보를 표로 비교한다', render: () => <ResultCompare/> },
  { id: 'bg', label: '배경 지식', title: 'SA와 beam search · DP — 무엇이 다르고 언제 쓰나',
    summary: '설계안을 읽는 데 필요한 개념과, 이 프로젝트에서 실제로 잰 SA·beam search 비교', render: () => <Background/> },
]

export default function EvolutionSaDesigns() {
  const [active, setActive] = useState(CANDIDATES[0].id)
  const cand = CANDIDATES.find(c => c.id === active) ?? CANDIDATES[0]
  return <section className="card" style={{ marginTop: 14 }}>
    <div className="card-title"><div><small className="kicker">EVOLUTION SA · DESIGN CANDIDATES</small><h2>구현 방안 설계안</h2></div><span className="connection">설계 단계 · 미구현</span></div>
    <div className="analog-tabs" role="tablist" aria-label="설계 후보" style={{ marginBottom: 8 }}>
      {CANDIDATES.map(c => <button key={c.id} type="button" role="tab" aria-selected={c.id === active} className={c.id === active ? 'active' : ''} onClick={() => setActive(c.id)}>{c.label}</button>)}
    </div>
    <h3 style={{ margin: '4px 0', fontSize: 15 }}>{cand.label}: {cand.title}</h3>
    <p style={{ ...p, color: 'var(--text-secondary)' }}>{cand.summary}</p>
    {cand.render()}
  </section>
}
