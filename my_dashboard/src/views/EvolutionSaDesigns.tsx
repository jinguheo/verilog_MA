// Evolution SA 설계안 모음. 수평 탭의 설계안은 CANDIDATES 배열에 등록한다.
// 이 파일은 읽기 전용 설계 문서 컴포넌트이며, 다른 화면의 코드나 상태를 바꾸지 않는다.
// 화면의 계산값(통과율, 격자 후보 수, 면적 비율)은 아래 상수에서 렌더링할 때 계산한다. 실측값은 출처와 확인 상태를 함께 적었다.
import { useState } from 'react'
import DpStepByStep from './DpStepByStep'

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
        <tr><td>매크로 전원 핀이 PDN에 미연결</td><td>PDN이 <code>vccd/vssd</code>를 보고 VPWR/VGND 격자와 이어지지 않음 → LVS 363의 주원인</td><td>{badge('확정')}</td><td>다른 창의 추출 SPICE 검증</td></tr>
        <tr><td>매크로 간격</td><td>100 µm는 DPL-0036 실패, 300 µm는 통과</td><td>{badge('확정')}</td><td>엔진 주석(daq_subsystem 실측)</td></tr>
        <tr><td>최종 DEF의 fill/decap 점유</td><td>fill 3,307개 · decap 15,586개 (셀 개수, 사이트 면적 아님). 기존 83,347 사이트·86.7% 집계는 산정 범위와 단위 재검증 필요</td><td>개수 {badge('확정')} · 가용률 {badge('미측정')}</td><td><code>ppa3_antfix5_signoff</code> 최종 DEF의 component 분류</td></tr>
        <tr><td><b>ADC를 x=30.24로 옮기면 위 위반이 사라진다</b></td><td>tap 단계까지는 조각 0개 확인. LVS·DRC 결과 없음</td><td>{badge('가설')}</td><td><code>adcshift</code> 실행이 64번(Magic DRC)에서 중단</td></tr>
        <tr><td>조각 폭의 위반 임계값 T</td><td>9.66 위반 · 25.3 무위반 → 그 사이는 모름 (tap 격자 위상에도 의존할 수 있음)</td><td>{badge('미측정')}</td><td>—</td></tr>
        <tr><td>L0(게임 점수)와 실제 결과의 상관</td><td>비교할 실제 결과가 PPA3 몇 건뿐</td><td>{badge('미측정')}</td><td>—</td></tr>
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
        <tr><td><b>P-1</b></td><td>선행: x=30.24 가설 검증(<code>adcshift</code>를 Magic DRC부터 이어서), PDN 연결 결과 확인</td><td>실측 위반 수</td><td>위반 0 또는 남은 원인 확정</td><td>미착수</td></tr>
        <tr><td><b>P0</b></td><td>위반 기억 스키마·시드 7건·수집 스크립트</td><td><code>violation_memory.json</code>, <code>tools/collect_violations.py</code></td><td>antfix4·5에서 수동 분석과 같은 숫자(조각 116, 섬 57, DRC 1,853)</td><td>미착수</td></tr>
        <tr><td><b>P1</b></td><td>규칙 계측기 + 규칙에 맞는 후보 생성기(L0)</td><td><code>game/evolutionSa.ts</code></td><td>무작위 vs 생성의 규칙 통과율이 5절 모델과 일치</td><td>미착수</td></tr>
        <tr><td><b>P2</b></td><td>L1 판정기, 조각 폭 스윕으로 T 실측</td><td><code>tools/wsl/*</code> 스크립트</td><td>T 곡선 확보</td><td>미착수</td></tr>
        <tr><td><b>P3</b></td><td>진화 루프(규칙 유도 변이, 부모 선택, 정체 시 확장), 계보와 비용 항목 분해 표시</td><td><code>views/EvolutionSa.tsx</code></td><td>동일 평가 횟수에서 기존 방식보다 규칙 통과 후보가 많음</td><td>미착수</td></tr>
        <tr><td><b>P4</b></td><td>L2·L3 승격, 실제 결과로 L0 가중치 보정</td><td>기존 <code>/api/layout-candidates</code> 연동</td><td>L0 점수와 실제 결과의 상관 확인</td><td>미착수</td></tr>
      </tbody></table></div>
      <p style={p}><b>기존 코드와의 관계:</b> 신규 파일로 만들고 엔진(<code>chipTetrisEngine.ts</code>)에는 <code>placementValue</code>·<code>enumerate</code> 등 몇 개를 export하는 정도로만 수정합니다. 기존 "Continuous evolution"과의 역할 분담은 <b>결정이 필요합니다.</b></p>
    </Section>

    <Section title="7. 이 설계로 풀 수 없는 것 · 위험 · 결정 필요">
      <ul style={ul}>
        <li><b>위치로 풀리지 않는 위반:</b> SRAM 내부 DRC 15,861,362건(99.99%가 SRAM 내부), 비교기 19건, 셀 npc.2, PDN 설정. 목표는 "signoff 전체 통과"가 아니라 <b>"위치로 풀 수 있는 위반 0"</b>입니다.</li>
        <li><b>LVS 원인이 둘:</b> 행 조각이 만드는 floating n-well(device 차이와 정확히 일치)과 매크로 전원 미연결(다른 창 검증). 어느 쪽이 363건의 주원인인지는 PDN 실행 결과가 나와야 알 수 있습니다. 전원 연결이 안 되면 배치를 아무리 잘 해도 LVS는 그대로입니다.</li>
        <li><b>L0 점수가 실제와 어긋날 수 있음:</b> 상관 측정 전이라, 점수 최적화가 헛돌 위험이 있습니다(P4에서 보정).</li>
        <li><b>실행 안정성:</b> 이번에 <code>adcshift</code>·<code>adcslew</code>가 결과 없이 끊겼습니다. 수 시간짜리 실행을 반복하려면 이어서 돌리는 장치가 필수입니다.</li>
        <li><b>후보 풀 분포 미확인:</b> 후보 저장소(<code>chip-tetris-legal-candidates-v2</code>)는 사용자 브라우저에만 있어 분포를 보지 못했습니다.</li>
        <li><b>결정 필요:</b> ① P-1 실험(자원이 다른 창의 PDN 실행과 겹침) 일정 ② 기존 Continuous evolution과의 역할 분담 ③ 성공 기준(예: L3 몇 번 안에 위치 위반 0 후보 확보).</li>
      </ul>
    </Section>
  </div>
}


function Candidate2() {
  return <div>
    <p style={p}><b>목표:</b> DRC·LVS·STA·전원·배선 제약을 만족하는 <b>최소 칩 면적</b>을 찾습니다. 배치가 끝난 뒤 남는 틈에만 필요한 filler를 넣고, decap은 검증된 최소 전원 용량·위치만 확보합니다. 소수 실험의 지식을 DP 탐색에 재사용하고 동일한 배치·설정은 다시 실행하지 않습니다.</p>
    <div className="data-table"><table><thead><tr><th>설계</th><th>구현</th><th>검증</th><th>적용 범위</th></tr></thead><tbody>
      <tr><td><b>설계 후보 2 · DP 보조 탐색</b></td><td>{badge('미측정')} 미착수</td><td>{badge('미측정')} 성능 비교 전</td><td>매크로 위치와 주변 영역 shape</td></tr>
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

    <Section title="2. DP 상태와 전이" open>
      <div className="data-table"><table><thead><tr><th>요소</th><th>저장·계산할 값</th><th>이유</th></tr></thead><tbody>
        <tr><td>상태</td><td>가변 칩 폭·높이와 core 경계, 배치된 블록 집합, 점유 영역, 행/경계 여유, net별 위치 요약, PDN 위상</td><td>면적과 뒤에 놓을 블록의 합법성·추가 비용 결정</td></tr>
        <tr><td>전이</td><td>다음 블록의 위치·방향·이웃 영역 shape 선택; 칩 폭·높이를 각각 조절하거나 같은 면적에서 종횡비 변경</td><td>면적과 모양이 모두 탐색 변수이며 hard rule 위반이면 즉시 가지치기</td></tr>
        <tr><td>값</td><td>hard rule 통과 후 die 면적 우선, 같은 면적에서 기존 게임 점수 − DRC·timing·혼잡 risk</td><td>면적을 고정하지 않고 유망한 부분 상태 보존</td></tr>
        <tr><td>출력</td><td>서로 다른 상위 K개 완성 배치와 부모·변이 계보</td><td>다단계 물리 검증 입력</td></tr>
      </tbody></table></div>
      <div style={mono}>최선값(다음 상태) = max[ 최선값(현재 상태) + 새 배치의 점수 변화 ]</div>
      <p style={p}>서로 다른 배치를 같은 상태로 합치면 최적해를 잃습니다. 미래 비용에 필요한 점유·경계·net 정보와 <b>행별 예약 용량</b>을 상태에 유지하고, 상태가 너무 많아지면 상위 K개를 남기는 제한된 DP(beam 방식)로 실행합니다. 이 경우 전역 최적 보장은 없습니다.</p>
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
        <li><b>L0:</b> DP 전이 때 겹침·확정 DRC 간격·halo·tap/PDN 접근 규칙을 즉시 검사합니다. 불확실한 규칙은 soft risk로 둡니다.</li>
        <li><b>L1:</b> 서로 다른 상위 배치만 floorplan·tap·PDN 단계로 보내고, 실패 결과를 규칙 기억에 반영합니다.</li>
        <li><b>L2:</b> placement/global route의 경로·혼잡·STA 추정으로 순위를 다시 매깁니다. 초기 timing 예측과 최종 STA를 구분해 표시합니다.</li>
        <li><b>L3:</b> 최종 소수 후보에 전체 DRC/LVS와 signoff STA를 실행합니다. 같은 fingerprint의 결과는 재사용합니다.</li>
      </ol>
    </Section>

    <Section title="5. 구현 순서와 비교 기준">
      <div className="data-table"><table><thead><tr><th>단계</th><th>산출물</th><th>확인할 것</th></tr></thead><tbody>
        <tr><td>D0</td><td>run fingerprint·초기 calibration·ROW/LEF 기반 공간 회계</td><td>같은 배치·설정의 재실행 0건; fill/decap·고정 셀·예약량의 사이트 단위 합계 검증</td></tr>
        <tr><td>D1</td><td>규칙 기반 legal 위치·쌍별 호환성 표</td><td>기존 엔진 hard rule과 일치</td></tr>
        <tr><td>D2</td><td>부분 상태 DP와 상위 K개 고유 후보</td><td>동일 계산 예산에서 후보 1과 품질·다양성 비교</td></tr>
        <tr><td>D3</td><td>DRC/STA 결과 피드백과 L1~L3 승격</td><td>실제 위반 수·slack·실행 시간 비교</td></tr>
      </tbody></table></div>
      <p style={p}>PPA3는 hard macro가 ADC·SRAM 두 개여서 거친 위치 조합은 이미 전수 열거가 가능합니다. DP의 이득은 이웃 영역 shape와 세밀한 좌표·규칙 상태까지 확장할 때 실측으로 판단합니다. 전역 DRC와 최종 STA는 DP 점수로 대체하지 않습니다.</p>
    </Section>

    <Section title="5. 유사 코드와 시제품 검증 (위상 DP + 간격 DP)">
      <p style={p}>위 2절의 상태·전이·값을 그대로 따르는 유사 코드입니다. DP를 <b>두 단계</b>로 나눕니다. ① <b>위상 DP(beam)</b>는 블록 순서대로 위치·방향·shape를 고르고, ② <b>간격 DP(정확)</b>는 ①이 정한 위상에서 µm 단위 간격을 규칙에 맞게 최적으로 나눕니다. 두 알고리즘 모두 실제 코드로 만들어 돌렸습니다.</p>

      <p style={{ ...p, marginBottom: 2 }}><b>① 위상 DP — 상위 K개를 남기는 제한된 DP (beam)</b></p>
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
        <li><b>K를 키우면 좋아집니다</b>: 후보를 이웃 띠로 제한한 뒤 K=8은 4.4초에 −185.1, K=32는 17.9초에 −136.5, <b>K=128은 71.7초에 −135.0</b>입니다(제한 전에는 K=128이 시간 초과). 32 이후에는 개선 폭이 작아졌습니다. K=512는 확인하지 못했습니다.</li>
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
        <li><b>이 DP가 정확한 범위:</b> 한 행 띠에서 매크로 순서가 정해져 있고 비용이 간격·매크로 x에만 의존할 때입니다. 세로 겹침 여부에 따라 행 종류가 달라지므로 위상 DP가 고른 위상마다 행 종류별로 따로 적용합니다.</li>
      </ul>
      <p style={p}><b>두 DP의 연결:</b> ①이 거친 위상(블록 집합·방향·shape)을 상위 K개 고르면, ②가 각 위상의 µm 좌표를 규칙에 맞게 정합니다. 그 결과가 L1(floorplan·tap·PDN) 판정 입력이 됩니다.</p>
    </Section>

    <Section title="6. DP 단계별 그림 설명 (한 단계씩 따라가기)" open>
      <DpStepByStep/>
    </Section>

    <Section title="7. 상태 키 요약 실험 — 비슷한 상태를 합치면 빔이 좋아진다 (측정)" open>
      <p style={p}>6절 그림에서 보듯 <b>상태 키가 보드 전체</b>이면 서로 다른 부모에서 같은 보드가 나오지 않아 <b>병합이 한 번도 일어나지 않습니다.</b> 키를 "블록마다 (모양, x÷N, y÷N)"으로 뭉친 <b>요약 키</b>로 바꾸면 비슷한 상태가 합쳐집니다(같은 키에서는 점수가 높은 것 하나만 유지). 같은 엔진·같은 beam에서 키만 바꿔 쟀습니다.</p>
      <div className="data-table"><table><thead><tr><th>빔 폭 K</th><th>상태 키</th><th>시간</th><th>최고 게임 점수 (높을수록 좋음)</th><th>서로 다른 opamp 위치 (최종 K개 중)</th></tr></thead><tbody>
        <tr><td rowSpan={4}>8</td><td>정확(보드 전체)</td><td>4.6초</td><td>−185.1</td><td>3</td></tr>
        <tr><td>2칸 버킷</td><td>5.5초</td><td>−138.1</td><td>1</td></tr>
        <tr><td>3칸 버킷</td><td>4.9초</td><td>−138.1</td><td>2</td></tr>
        <tr><td>4칸 버킷</td><td>5.0초</td><td><b>−136.5</b></td><td>2</td></tr>
        <tr><td rowSpan={4}>32</td><td>정확(보드 전체)</td><td>21.0초</td><td>−136.5</td><td>5</td></tr>
        <tr><td>2칸 버킷</td><td>21.2초</td><td>−137.5</td><td>9</td></tr>
        <tr><td>3칸 버킷</td><td>15.6초</td><td>−135.0</td><td>10</td></tr>
        <tr><td>4칸 버킷</td><td><b>13.2초</b></td><td><b>−133.1</b></td><td>12</td></tr>
        <tr><td>128 (참고)</td><td>정확(보드 전체)</td><td>71.7초</td><td>−135.0</td><td>측정 안 함</td></tr>
      </tbody></table></div>
      <div className="data-table"><table><thead><tr><th>단계별 후보 수 (K=32), 생성 → 병합 후</th><th>ADC</th><th>SRAM</th><th>SAR NEAR</th><th>CDC EDGE</th><th>CAPTURE NEAR</th></tr></thead><tbody>
        <tr><td>정확한 키</td><td>135 → 135</td><td>117 → 117</td><td>2,877 → 2,877</td><td>897 → 897</td><td>3,857 → 3,857</td></tr>
        <tr><td>4칸 버킷 키</td><td>135 → 12</td><td>36 → 8</td><td>718 → 226</td><td>887 → 379</td><td>3,806 → 1,146</td></tr>
      </tbody></table></div>
      <ul style={ul}>
        <li><b>결과:</b> K=8에서 4칸 버킷(−136.5)이 K=32 정확한 키(−136.5)와 같은 점수를 4분의 1 시간으로 냅니다. K=32 + 4칸 버킷(−133.1, 13.2초)은 <b>K=128 정확한 키(−135.0, 71.7초)보다 점수도 좋고 약 5배 빠릅니다.</b> 최고 상태의 위반은 모두 0건이었습니다.</li>
        <li><b>해석(추정):</b> 정확한 키의 빔은 "한 칸 옮긴 거의 같은 상태"가 자리를 채우는 것으로 보이고(최종 K개 중 opamp 위치가 5가지뿐), 요약 키가 그 중복을 합쳐 <b>빔 자리를 서로 다른 상태에 쓰게 합니다</b>(12가지). 중복이 실제로 빔을 채우는지는 직접 확인하지 않았습니다.</li>
        <li><b>한계:</b> 점수는 게임 proxy이고, 문제 인스턴스는 하나, 시간은 단일 실행입니다. 합치는 것은 <b>근사</b>라서 좋은 상태를 잃을 수 있고, 버킷 크기에 민감합니다(K=32에서 2칸이 3·4칸보다 나쁨). 4칸보다 큰 버킷은 측정하지 않았습니다.</li>
        <li><b>설계로의 연결(제안):</b> 위치 버킷은 가장 단순한 요약입니다. 설계 후보 2의 "상태"(점유·경계 여유·net 요약·PDN 위상)를 <b>규칙에 민감한 특징</b>(행 조각 폭, strap 위상 등)으로 요약해 키로 쓰면, "규칙 기준으로 같은 상태"를 합칠 수 있습니다. 6절 그림의 "상태 키" 선택에서 같은 효과를 직접 볼 수 있습니다.</li>
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
        <li><b>이 프로젝트의 DP 세 가지:</b> ① <b>표준셀 부분집합 DP</b>(상태 = 왼쪽에 놓인 셀의 집합, 2<sup>n</sup>개 → 23셀까지 정확), ② <b>간격 DP</b>(규칙 아래 µm 간격 나누기, 전수 탐색과 일치), ③ <b>위상 beam DP</b>(블록을 순서대로 놓고 상위 K개만 유지).</li>
        <li><b>정확한 DP와 beam의 차이:</b> 정확한 DP는 모든 상태를 유지해 최적을 보장하고, beam은 상위 K개만 남겨 <b>빠른 대신 보장이 없습니다.</b></li>
        <li>단계별 그림은 <b>설계 후보 2의 6절</b>에서 실제 엔진으로 따라갈 수 있습니다.</li>
      </ul>
    </Section>

    <Section title="3. SA와 DP의 차이" open>
      <div className="data-table"><table><thead><tr><th></th><th>SA</th><th>DP</th></tr></thead><tbody>
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
        <tr><td>칩 배치 (5블록) — <b>처음부터</b> SA (무작위 합법 시작, 직접 구현, seed 4개)</td><td><b>15초:</b> 최고 −153.9 · 중앙값 −173.6 · 최악 −180.0<br/><b>60초:</b> 최고 −140.8 · 중앙값 −150.8 · 최악 −190.1<br/>이동의 약 1/3이 불법(예: 1,872회 중 600회)</td><td><b>beam DP(4칸 버킷, K=32): −133.1 (13.2초)</b><br/>무작위 합법 완성 −258.9 (같은 시간)</td></tr>
        <tr><td>칩 배치 — 게임에 있는 기존 SA (6~60회, 짧음)</td><td>6회 중앙값 −589.7 · 60회 중앙값 −362.5 (300회는 시간 초과)</td><td>위와 같음</td></tr>
      </tbody></table></div>
      <ul style={ul}>
        <li><b>SA도 기존 배치 없이 처음부터 잘 동작합니다.</b> 이번에 직접 구현한 단순 SA(블록 하나를 골라 그 뒤 블록들을 무작위 합법 위치로 다시 뽑는 이동, 온도 60→1.5 지수 냉각, 튜닝 없음)는 60초에 최고 −140.8까지 갔습니다. <b>같은 시간(약 15초)에서는 beam이 앞서고(−133.1 대 −153.9~−180.0), 시간을 4배 주면 SA가 따라오지만 seed 편차가 큽니다</b>(60초에서 −140.8 ~ −190.1). 더 오래·잘 조정한 SA가 beam을 넘는지는 측정하지 못했습니다.</li>
        <li>점수는 게임 proxy이며, 두 문제 모두 단일 인스턴스입니다. 게임의 기존 SA 행(−362.5)은 짧은 반복이라 SA 자체의 한계로 읽으면 안 됩니다.</li>
      </ul>
    </Section>

    <Section title="5. 어떤 경우에 무엇을 돌리나" open>
      <div className="data-table"><table><thead><tr><th>상황</th><th>유리한 쪽</th><th>이유</th></tr></thead><tbody>
        <tr><td>블록을 순서대로 놓는 단계 구조, 합법 후보 비율이 낮음 (칩 배치: 40,500쌍 중 333개)</td><td><b>DP(beam)</b></td><td>규칙으로 먼저 거르는 편이 빠르고 합법 후보만 만듦</td></tr>
        <tr><td>정확해나 재현성이 필요하고 문제가 작음 (간격, 표준셀 23셀 이하)</td><td><b>DP</b></td><td>모델 안에서 최적 보장, 결과가 항상 같음</td></tr>
        <tr><td>서로 다른 상위 후보가 필요 (비싼 L1~L3 검증에 3개만 보냄)</td><td><b>DP(beam)</b></td><td>상위 K개와 계보를 함께 얻음</td></tr>
        <tr><td>비용이 배치 전체에 얽혀 분해되지 않음 (라우팅·타이밍이 포함된 실제 평가)</td><td><b>SA</b></td><td>완성 배치의 비용만 알면 됨</td></tr>
        <tr><td>상태가 너무 커서 DP 불가 (표준셀 24셀 이상)</td><td><b>SA</b> 또는 스펙트럴</td><td>상태 폭발 회피</td></tr>
        <tr><td>이미 있는 해를 다듬는 후처리</td><td><b>SA</b></td><td>어떤 시작 해에서도 개선 가능</td></tr>
        <tr><td>기존 배치가 없는 처음부터의 배치</td><td><b>둘 다 가능</b></td><td>SA는 무작위 합법 시작에서 15~60초에 −154~−141, beam은 13초에 −133(4칸 버킷). 빠른 결과·다양한 후보는 beam, 시간 여유와 유연한 비용은 SA</td></tr>
      </tbody></table></div>
      <p style={p}><b>함께 쓰기는 문제에 따라 다릅니다.</b> 표준셀 40셀에서는 스펙트럴 해로 시작한 SA(185.3)가 스펙트럴(188.6)과 SA 단독(200.5)보다 좋았습니다. 반면 <b>칩 배치에서는 DP(beam) 뒤에 SA로 국소 이동해도 개선이 없었습니다</b>(9절 측정). "DP 뒤에 SA"가 항상 좋은 것은 아니며, 앞 단계의 결과가 국소 최적이 아닐 때만 효과가 있습니다.</p>
    </Section>

    <Section title="6. 용어">
      <div className="data-table"><table><thead><tr><th>용어</th><th>뜻</th></tr></thead><tbody>
        <tr><td><b>상태 / 전이 / 값</b></td><td>지금까지 정한 것의 요약 / 다음 선택 하나 / 그 상태의 점수(게임 점수에서 risk를 뺀 값)</td></tr>
        <tr><td><b>최적 부분 구조</b></td><td>앞 부분의 최적 결과가 전체 최적의 일부가 되는 성질. DP가 정확하려면 필요</td></tr>
        <tr><td><b>beam(빔)</b></td><td>각 단계에서 값이 높은 상위 K개 상태만 남기는 제한된 DP</td></tr>
        <tr><td><b>상태 병합 / 상태 키</b></td><td>같은 키의 상태 중 값이 높은 하나만 유지. 키를 요약할수록 많이 합쳐지지만 근사</td></tr>
        <tr><td><b>가지치기</b></td><td>하드 규칙을 어기는 전이를 만들지 않고 버리는 것</td></tr>
        <tr><td><b>온도 T · 수락 확률</b></td><td>SA가 나빠지는 변경을 받아들이는 정도. 확률 e<sup>−Δ/T</sup>, T가 클수록 자주 수락</td></tr>
        <tr><td><b>지역 최소</b></td><td>주변보다는 좋지만 전체 최선은 아닌 해. SA는 이걸 넘으려 하고, 국소 개선은 갇힘</td></tr>
        <tr><td><b>L0 ~ L3</b></td><td>평가 단계: 게임 proxy / floorplan·tap·PDN / 배치·배선 / 전체 signoff</td></tr>
        <tr><td><b>sliver · tap · halo · PDN</b></td><td>tap 셀이 못 들어가는 좁은 행 조각 / 웰 전위를 잡는 셀 / 매크로 주변 비움 띠 / 전원 공급망</td></tr>
      </tbody></table></div>
    </Section>

    <Section title="7. DP의 차원 — 1D인가 2D인가, NP-hard는 어떻게 다뤘나" open>
      <p style={p}>이 프로젝트의 DP 세 가지는 <b>차원도, 정확성도 서로 다릅니다.</b> "2D에서 정확한 DP"는 시도하지 않았고, 2D 문제(칩 배치)는 <b>일부러 정확성을 포기한 beam</b>으로 다뤘습니다.</p>
      <div className="data-table"><table><thead><tr><th>DP</th><th>차원</th><th>상태</th><th>시간</th><th>정확성</th><th>어려움을 다룬 방법</th></tr></thead><tbody>
        <tr><td><b>표준셀 부분집합 DP</b></td><td><b>1D</b> (한 줄 안의 셀 순서)</td><td>왼쪽에 놓인 셀의 집합 (2<sup>n</sup>개)</td><td>지수: O(2<sup>n</sup>·(n+넷 수))</td><td>프록시 모델에서 정확</td><td>선형 배치는 일반적으로 NP-hard 계열이라 <b>지수 시간을 감수하고 n ≤ 23으로 제한</b>(메모리 84MB). 24셀 이상은 SA·스펙트럴로</td></tr>
        <tr><td><b>간격 DP</b></td><td><b>1D</b> (한 행 띠의 x 방향)</td><td>(간격 번호, 사용한 길이)</td><td>다항: O(k·LU²)</td><td>정확</td><td>1D 분할 문제라 NP-hard가 아님. 매크로 순서는 고정</td></tr>
        <tr><td><b>위상 beam DP</b></td><td><b>2D</b> (25×12 격자)</td><td>지금까지 놓은 블록의 배치(보드)</td><td>다항: 단계당 K × 후보 × 합법 검사</td><td><b>보장 없음</b></td><td>아래 6가지로 <b>정확한 2D DP를 포기</b></td></tr>
      </tbody></table></div>
      <p style={p}><b>왜 정확한 2D DP가 어려운가:</b> 2D에서는 상태가 "보드의 점유 패턴"이 되어야 하는데, 25×12 = 300칸이면 가능한 패턴이 2<sup>300</sup>가지입니다. 폭이 좁은 보드에서 같은 크기의 타일을 채우는 문제(profile DP)는 가능하지만, 크기가 다른 큰 블록을 임의 위치에 놓는 배치/플로어플랜은 일반적으로 NP-hard입니다.</p>
      <p style={p}><b>위상 beam DP가 2D를 다룬 방법 (6가지):</b></p>
      <ol style={ul}>
        <li><b>놓는 순서를 고정</b>했습니다(ADC → SRAM → SAR NEAR → CDC EDGE → CAPTURE NEAR). 순서를 찾는 탐색이 사라집니다.</li>
        <li><b>블록 5개, 50 µm 격자</b>로 문제 크기가 작습니다. 하드 매크로 쌍은 40,500개 중 규칙을 통과하는 333개뿐이고 전수 열거에 2.8초입니다.</li>
        <li><b>하드 규칙으로 즉시 가지치기</b>합니다(겹침, 영역, 이웃, 간격).</li>
        <li><b>이웃 규칙은 이웃 띠에서만 후보를 만듭니다</b>(합법 위치는 전체 스캔과 동일, 시간 약 3.3배 단축).</li>
        <li><b>상위 K개만 유지</b>(beam)합니다. 지금 점수가 낮아 버려진 상태가 나중에 더 좋았을 수 있어 <b>최적을 보장하지 않습니다.</b></li>
        <li><b>상태 키를 요약해 병합</b>합니다(4칸 버킷). 이것도 근사입니다.</li>
      </ol>
      <p style={p}><b>다른 길(미구현):</b> 슬라이싱 플로어플랜(블록을 가로·세로로 반복 분할한 구조)으로 제한하면 DP가 다항 시간에 정확해집니다(Stockmeyer 방식). 대신 슬라이싱으로 표현되지 않는 배치는 놓칩니다. 매크로가 수십 개로 늘면 검토할 만합니다.</p>
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

    <Section title="9. DP 뒤에 SA로 국소 이동하면 좋은가 — 측정 결과" open>
      <p style={p}>DP(beam)의 결과를 시작점으로 낮은 온도(T 8 → 0.3)의 SA로 <b>블록 하나를 ±2칸(모양 변경 포함) 옮기는 국소 이동</b>을 10초 돌렸습니다. 먼저 DP 결과가 단일 블록 변경으로 더 좋아질 수 있는지 <b>전수</b>로 확인했습니다.</p>
      <div className="data-table"><table><thead><tr><th>시작점 (DP, 4칸 버킷 키)</th><th>DP 점수</th><th>단일 블록 변경 전수 확인</th><th>DP 뒤 국소 SA 10초</th><th>블록+의존 블록 묶음 이동 (±4칸)</th></tr></thead><tbody>
        <tr><td>K=8 (4.7초)</td><td><b>−136.51</b></td><td>대안 7,495개 중 합법 149개, <b>개선 0</b></td><td>seed 4개 모두 <b>−136.51</b> (이동 약 4,100회, 수락 123~168회, 불법 약 91%)</td><td>400개 중 합법 6개, 상위 8개 상태에서 <b>개선 0</b></td></tr>
        <tr><td>K=8의 2·3위 상태</td><td>−138.13 / −138.38</td><td>—</td><td>각 3.3초: 변화 없음</td><td>—</td></tr>
        <tr><td>K=32 (12.9초)</td><td><b>−133.14</b></td><td><b>개선 0</b></td><td><b>−133.14</b> (이동 3,901회, 수락 134회)</td><td>400개 중 합법 18개, 상위 8개 상태에서 <b>개선 0</b></td></tr>
      </tbody></table></div>
      <ul style={ul}>
        <li><b>이 문제에서는 DP 뒤의 국소 SA가 아무것도 개선하지 못했습니다.</b> DP 결과는 이미 단일 블록 이동과 묶음 이동에 대해 <b>국소 최적</b>입니다.</li>
        <li><b>점수를 올린 것은 국소 이동이 아니라 빔 폭입니다.</b> K=8(−136.51) → K=32(−133.14)로 키우면 좋아졌는데, 국소 SA가 K=8 결과에서 −133.14에 도달하지 못했습니다. 두 해는 여러 블록의 위치가 함께 달라서 <b>국소 이동으로는 건널 수 없는 거리</b>에 있습니다.</li>
        <li><b>이동이 경직된 탓도 있습니다.</b> 필수 이웃 규칙(맞닿아야 함) 때문에 블록 하나만 옮기면 91%가 불법이고, 묶음 이동도 합법인 것이 400개 중 6~18개뿐입니다.</li>
        <li><b>한계:</b> 점수는 게임 proxy입니다. 시험한 이동은 ±2칸 단일 블록과 ±4칸 묶음뿐이고, 여러 블록을 동시에 다시 놓는 큰 이동이나 높은 온도의 SA는 시험하지 않았습니다. 한 문제 인스턴스입니다.</li>
      </ul>
      <p style={p}><b>그래서 이 문제에서 DP 결과를 더 좋게 하는 방법은 SA가 아니라 이런 것들입니다(제안):</b> ① 빔 폭 K와 상태 키(버킷 크기) 조정, ② 간격 DP로 50 µm 격자보다 세밀한 <b>µm 좌표 정밀화</b>(정확), ③ <b>실제 비용(L1~L3 결과)을 기준</b>으로 한 국소 개선 — DP가 쓴 게임 점수와 실제 결과가 어긋나는 곳이 개선 여지입니다. 국소 SA가 유효한 경우는 앞 단계 결과가 국소 최적이 아닐 때(스펙트럴 해, 표준셀 24셀 이상)입니다.</p>
    </Section>
  </div>
}

type DesignCandidate = { id: string; label: string; title: string; summary: string; render: () => React.ReactNode }
const CANDIDATES: DesignCandidate[] = [
  { id: 'c1', label: '설계 후보 1', title: '규칙 인지 진화 — 위반 기억 + 규칙에 맞는 후보 생성 + 다단계 평가',
    summary: 'LVS·DRC 실측 규칙과 남은 공간을 적합도·변이·생성에 직접 반영한다', render: () => <Candidate1/> },
  { id: 'c2', label: '설계 후보 2', title: 'DP 보조 탐색 — 초기 학습 + 부분 배치 재사용 + 중복 실행 방지',
    summary: '소수의 서로 다른 실험에서 얻은 DRC·STA 지식을 DP 전이와 검증 우선순위에 반영한다', render: () => <Candidate2/> },
  { id: 'bg', label: '배경 지식', title: 'SA와 DP — 무엇이 다르고 언제 쓰나',
    summary: '설계안을 읽는 데 필요한 개념과, 이 프로젝트에서 실제로 잰 SA·DP 비교', render: () => <Background/> },
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
