// 연구 동향 탭 — EXPlace 상세 분석.
// 근거: 논문 원문 "Expertise Can Be Helpful for Reinforcement Learning-based Macro Placement"(ICLR 2026, Gao·Shi·Xue 외, 난징대·화웨이 Noah's Ark Lab) PDF 본문을
//       2026-10-17 에 텍스트로 추출해 읽음(본문·부록 표 포함, 그림은 못 봄), GitHub lamda-bbo/EXPlace README.
// 표의 수치는 논문 표 값이다. "재계산" 표시가 붙은 값은 논문 표 값으로 내가 다시 계산한 것이다(PDF 텍스트 추출이라 표 파싱 오류 가능성은 있으나,
// 논문이 인용한 32.53% / 7.74% / 3.41% 를 표 값으로 정확히 재현했으므로 Table 2 파싱은 신뢰할 만하다).

const FACTS: [string, string][] = [
  ['논문', 'Expertise Can Be Helpful for Reinforcement Learning-based Macro Placement (ICLR 2026)'],
  ['저자·소속', 'Chengrui Gao, Yunqi Shi, Ke Xue, Ruo-Tong Chen, Siyuan Xu, Mingxuan Yuan, Chao Qian, Zhi-Hua Zhou — 난징대(LAMDA) · 화웨이 Noah’s Ark Lab'],
  ['코드', 'github.com/lamda-bbo/EXPlace (공개, 라이선스 미표기)'],
  ['한 줄 요약', 'macro 배치용 RL(PPO)에 EDA 전문가 지식 4종(dataflow, macro grouping, periphery biasing, I/O keepout)을 상태·밀집 보상으로 넣고, 선택적으로 STA 결과 선호로 DPO 미세조정해 TNS·WNS 같은 실제 PPA 지표를 개선'],
  ['확인 수준', '원문 PDF 본문·부록 직접 확인. 그림(Fig. 1~10)은 못 봄. 독립 재현 결과는 찾지 못함'],
]

const PROBLEM: string[] = [
  '기존 RL macro placer(AlphaChip, MaskPlace, MaskRegulate 등)는 macro HPWL, 균일 배선 밀도 같은 단순 proxy를 최적화해서 최종 TNS·WNS가 전문가 배치와 벌어진다.',
  '빈틈 1 — 전문 지식의 일부만 사용: 주기(periphery) 편향 하나만 쓰거나(MaskRegulate), BBO 계열은 규칙을 넣기 어렵다.',
  '빈틈 2 — 후단 PPA 피드백을 무시: 타이밍 평가 비용이 커서 대부분 proxy에 과적합한다. 실제 백엔드 PPA를 쓰는 LaMPlace는 이력 데이터에 의존한다.',
  '저자의 주장: 이 격차가 학술 RL이 실제 설계 흐름에 못 들어가는 이유이며, 전문가 지식을 넣으면 "실무에서 쓸 만한" RL 배치가 된다.',
]

type Know = { name: string; why: string; cost: string; how: string; w: string; note: string }
const KNOW: Know[] = [
  { name: 'Dataflow', why: 'RTL 연결 신호. 강한 dataflow의 macro는 가깝게. 데이터가 FF를 거치는 경로가 WNS/TNS의 임계 경로와 겹침',
    cost: 'cost_df = Σi Σj w(i,j)·‖pos_i − pos_j‖₁,  w(i,j) = Σ_{p∈P_ij} 1/2^N(p)  (N(p)=경로의 FF 홉 수)',
    how: '합성된 넷리스트에서 BFS로 macro→(FF)→macro 경로를 찾고 조합 셀은 제거, 홉 수를 2로 제한. 한 스텝의 보상 = −Σ(이미 놓은 macro와의 w × 맨해튼 거리). 격자 위치마다 값을 계산해 2D 마스크로 상태에 넣음',
    w: 'ICCAD 0.15 / OpenROAD 0.15', note: 'dataflow 그래프 밀도 6~51% vs 원 넷리스트(HPWL) 0.08~2.1% (Table 8)' },
  { name: 'Macro grouping', why: '같은 모듈에서 반복 생성된 동일 macro(예: 1KB 메모리 4개)는 함께 타일링하면 배선·클럭·전원이 쉬워짐',
    cost: 'cost_g = Σ 그룹의 bounding box 면적 (w_i × h_i)',
    how: '세 조건을 모두 만족하면 같은 그룹: 같은 셀 클러스터와 30개 초과 net 공유 · 비슷한 footprint · 같은 설계 계층. 계층이 없으면 Louvain 클러스터링으로 대용 계층 추정. 새 macro를 놓을 때 그룹 bbox 면적 증가분이 보상',
    w: 'ICCAD 0.20 / OpenROAD 0.30', note: 'OpenROAD 설계는 계층이 뚜렷하고 macro가 균일해서 가중치를 올림' },
  { name: 'Periphery biasing', why: 'macro를 중앙에 두면 하위 금속층을 막아 우회·혼잡이 생기고 표준셀이 밖으로 밀림. 전원·클럭 계획에도 유리',
    cost: 'cost_peri = Σ (d_x + d_y), 가장 가까운 칩 가장자리까지의 x, y 거리',
    how: '격자 위치마다 증분 비용을 마스크로 계산. 선택 변형 "corner stitching": 이미 놓인 macro 모서리나 캔버스 경계로만 위치를 스냅(정규 배치, 데드 스페이스 감소)',
    w: 'ICCAD 0.45 / OpenROAD 0.35', note: 'corner stitching은 OpenROAD 벤치마크에서만 켬. 엄격한 주기 배치가 늘 좋은 건 아니라고 논문도 인정(Kahng 2023 인용)' },
  { name: 'I/O keepout', why: 'I/O 신호는 긴 경로와 버퍼가 필요한데 가장자리 macro가 금속층과 면적을 점유하면 막힘',
    cost: 'cost_IO = Σ macro와 예약된 keepout 영역의 겹침 면적',
    how: 'I/O 포트 위치 기준으로 영역을 미리 정하고, macro별 겹침이 서로 독립이라 스텝 보상·마스크를 바로 계산',
    w: 'ICCAD 0.05 / OpenROAD 0.05', note: '유연성을 위해 낮게 둠' },
]

const MDP: [string, string][] = [
  ['State', '격자 G 위 다채널 이미지: ① 현재 배치 캔버스(이진) ② 다음 macro가 겹치지 않고 들어갈 수 있는 위치 마스크 ③ 전문가 마스크 4종 + wiremask(macro 간 직접 연결) ④ MaskPlace식 next-step 마스크(장기 시야)'],
  ['Action', '미리 정한 macro 순서(연결 밀도 높고 큰 것 먼저)로, 다음 macro를 놓을 격자 칸 선택. 변형: corner-stitching으로 모서리에 스냅'],
  ['Reward', '각 전문가 비용의 음수를 단계별 밀집 보상으로 만들고 항목별 최대·최소로 정규화(첫 궤적 통계 사용)한 뒤 가중합. 가중치는 아래 표를 사람이 정함'],
  ['Policy', 'CNN(작은 커널의 local 분기 + 전치 합성곱으로 올리는 global 분기)과 선형층이 격자 위 행동 분포를 출력, MLP critic, PPO'],
  ['학습 설정', '1,500 에피소드, 10 epoch, 버퍼 = 궤적 길이의 10배, 배치 256. 병렬 환경으로 한 번의 rollout이 버퍼를 채움. 설계(케이스)마다 따로 학습'],
  ['배치 범위', 'RL은 macro 위치만 정함. 표준셀은 DREAMPlace(ICCAD)나 OpenROAD(OpenROAD 벤치마크)가 배치'],
]

const DPO: string[] = [
  '목적: proxy(macro HPWL)와 최종 WNS·TNS의 격차를 메움. 사람이 후단 피드백을 보고 설계를 반복 수정하는 과정을 흉내.',
  '절차: 정책에서 여러 궤적을 샘플 → OpenTimer(STA)로 post-placement TNS·WNS 평가 → 더 좋은 쪽을 선호, 나쁜 쪽을 거절로 짝지음 → DPO 손실로 정책 갱신. TNS와 WNS가 서로 지배하지 않는 후보가 있어 파레토 전선으로 품질을 요약.',
  '노이즈 억제: TNS/WNS 차이가 상위 10%인, 가장 구분되는 쌍만 사용. DPO 배치 20, 반복당 5 epoch.',
  '규모: 25회 반복 × 반복당 20회 타이밍 평가 = 설계당 약 500회 STA. 논문은 ICCAD 케이스당 약 15~30시간이 든다고 명시하며 이를 한계로 인정.',
  '중요: 본문 Table 2·3의 EXPlace 결과는 DPO 미세조정 없는 사전학습 정책 값이다(다른 RL과 공정 비교를 위해). 미세조정 효과는 별도(Fig. 5, Table 9).',
]

const SETUP: { item: string; ico: string; ord: string }[] = [
  { item: '설계', ico: 'ICCAD 2015 대회 8개(superblue1,3,4,5,7,10,16,18)', ord: 'OpenROAD-flow-scripts 6개(ariane133, ariane136, bp, bp_be, bp_fe, swerv_wrapper)' },
  { item: '후단 평가', ico: 'DREAMPlace로 전역 배치, EarlyGlobalRoute로 "post-route" 지표(rWL, 가로·세로 overflow, NVP, TNS, WNS)', ord: 'OpenROAD 전체 흐름(전역 배치, CTS, 전역·상세 배선)으로 rWL, WNS, TNS, DRC, 전력, 면적' },
  { item: '비교 대상', ico: 'DREAMPlace 4.1.0(mixed-size), LaMPlace, MaskPlace, MaskRegulate', ord: '위 + Hier-RTLMP(OpenROAD 안에 통합돼 이쪽에서만)' },
  { item: '공정성 장치', ico: '면적 필터로 macro만 선별(작은 부품이 macro로 오인되는 것 방지), 모든 baseline에 같은 설정', ord: '같음' },
]

// Table 2 (ICCAD 2015) 평균 순위 — 낮을수록 좋음
const ICCAD_METRICS = ['rWL', 'rOverflowH', 'rOverflowV', 'NVP', 'WNS', 'TNS']
const ICCAD_RANK: { m: string; r: number[] }[] = [
  { m: 'DREAMPlace', r: [4.38, 4.50, 4.62, 4.50, 3.75, 4.12] },
  { m: 'MaskPlace', r: [4.12, 4.12, 3.88, 4.25, 4.00, 4.50] },
  { m: 'MaskRegulate', r: [3.00, 2.00, 1.88, 2.25, 3.38, 2.75] },
  { m: 'LaMPlace', r: [2.12, 2.12, 2.12, 2.75, 2.12, 2.50] },
  { m: 'EXPlace', r: [1.38, 2.00, 2.00, 1.25, 1.75, 1.12] },
]

// Table 3 (OpenROAD) 평균 순위
const OR_METRICS = ['rWL', 'WNS', 'TNS', 'DRC', 'Power', 'Area']
const OR_RANK: { m: string; r: number[] }[] = [
  { m: 'DREAMPlace', r: [2.83, 4.67, 3.67, 3.17, 4.00, 2.67] },
  { m: 'Hier-RTLMP', r: [3.83, 3.33, 5.00, 3.50, 3.33, 4.00] },
  { m: 'MaskPlace', r: [3.33, 4.33, 4.33, 4.00, 3.83, 3.33] },
  { m: 'MaskRegulate', r: [5.33, 2.67, 2.83, 4.33, 5.00, 4.67] },
  { m: 'LaMPlace', r: [3.50, 4.17, 3.83, 3.67, 2.50, 4.00] },
  { m: 'EXPlace', r: [2.17, 1.83, 1.33, 1.60, 2.33, 2.33] },
]

const bestCols = (rows: { r: number[] }[]) => rows[0].r.map((_, c) => Math.min(...rows.map(x => x.r[c])))

// 재계산: 논문 Table 2 값으로 계산. "합계 기준 감소율" = (ΣLaMPlace − ΣEXPlace)/ΣLaMPlace
const RECALC: { metric: string; paper: string; sum: string; mean: string; wins: string; worst: string }[] = [
  { metric: 'TNS', paper: '32.53%', sum: '32.53% (재현됨)', mean: '설계별 평균 12.58% (설계별 차순위 대비)', wins: '7/8 설계에서 최고', worst: 'superblue3: LaMPlace 3.49 대 EXPlace 7.80 (−123%)' },
  { metric: 'WNS', paper: '7.74%', sum: '7.74% (재현됨)', mean: '설계별 평균 2.54%', wins: '4/8 설계에서 최고', worst: 'superblue5: −55% , superblue1: −24%' },
  { metric: 'rWL', paper: '3.41%', sum: '3.41% (재현됨)', mean: '설계별 평균 0.49%', wins: '5/8 설계에서 최고', worst: 'superblue3: −30%' },
]

const ABL: { m: string; r: number[] }[] = [
  { m: 'w/o Dataflow', r: [3.33, 1.33, 1.67, 3.00, 4.00, 4.00] },
  { m: 'w/o Grouping', r: [3.67, 2.67, 2.33, 3.33, 2.00, 3.67] },
  { m: 'w/o I/O keepout', r: [2.67, 3.00, 3.33, 2.33, 4.00, 2.33] },
  { m: 'w/o Periphery', r: [4.33, 5.00, 4.67, 4.67, 2.33, 3.67] },
  { m: '전체 EXPlace', r: [1.00, 3.00, 3.00, 1.67, 2.67, 1.33] },
]

const RUNTIME: { m: string; test: string; train: string }[] = [
  { m: 'DREAMPlace', test: '157.9 s (superblue1: 287.3 s)', train: '- (해석적, 학습 없음)' },
  { m: 'LaMPlace', test: '2,187 s (superblue1: 792 s)', train: '학습 모델 사용(표에 학습 시간 없음)' },
  { m: 'MaskPlace', test: '3.20 s', train: '평균 5,142 s' },
  { m: 'MaskRegulate', test: '7.72 s', train: '평균 12,633 s' },
  { m: 'EXPlace', test: '8.64 s (superblue1: 5.28 s)', train: '평균 8,625 s (약 2.4시간, 1.4~4.4시간 범위) + 선택적 DPO 15~30시간' },
]

const LIMITS: { title: string; body: string; kind: string }[] = [
  { kind: '수치 해석', title: '대표 수치는 "합계 기준" 감소율이다', body: '32.53%(TNS), 7.74%(WNS), 3.41%(rWL)는 LaMPlace 대비 8개 설계 합계의 감소율로 정확히 재현된다. 큰 설계가 지배하므로, 설계별로 보면 TNS는 7/8, WNS는 4/8, rWL은 5/8에서만 1위다. superblue3의 TNS는 LaMPlace가 더 낫다(3.49 대 7.80). 논문이 거짓말을 한 것은 아니지만 "평균 32.53% 개선"이라는 읽기는 과하다.' },
  { kind: '조건', title: '본문 표는 DPO 미세조정 없는 값', body: '타이밍을 직접 겨냥한 DPO 단계(약 500회 STA, 케이스당 15~30시간)는 본문 비교표에 반영되지 않았다. 미세조정은 8개 설계 평균 TNS +12.29%, WNS +22.68%를 더하지만 superblue10의 TNS는 오히려 나빠졌다(−2168.76 → −2499.09, WNS는 개선).' },
  { kind: '평가 방식', title: 'ICCAD의 "post-route"는 EarlyGlobalRoute 추정', body: 'ICCAD 8개 설계의 배선 후 지표는 상세 배선이 아니라 EarlyGlobalRoute 결과다. DRC·전력·면적까지 완전한 흐름으로 본 것은 OpenROAD 설계 6개뿐이다(읽은 본문에서 공정/플랫폼은 확인하지 못함).' },
  { kind: '일관성', title: 'OpenROAD에서도 설계별로는 엇갈림', body: '평균 순위는 최고지만, 예: ariane133의 rWL은 DREAMPlace가 더 짧고(7.13 대 7.92), bp_be의 TNS는 MaskPlace가 더 낫다(−226.37 대 −257.73). swerv_wrapper의 DRC는 1,167건으로 여전히 크다.' },
  { kind: '튜닝', title: '가중치를 벤치마크별로 사람이 정함', body: '보상 가중치(Table 4)와 grouping 가중치, corner stitching 사용 여부를 벤치마크 특성(계층, macro 균일성)에 맞춰 다르게 설정한다. 민감도 분석은 읽은 본문에 없다. 새 설계에서 어떻게 정할지는 열려 있다.' },
  { kind: '가정', title: '계층·macro 형상 가정', body: 'grouping은 설계 계층(없으면 Louvain 대용)과 비슷한 footprint를 전제한다. 주기 편향은 논문 스스로 "항상 바람직하지는 않다"고 인정한다. 다양한 형상·계층 없는 설계에서의 효과는 불명.' },
  { kind: '비용', title: '설계마다 따로 학습', body: '추론은 5~20초지만 설계(케이스)별 학습이 평균 약 2.4시간이다. "빠르다"는 학습 뒤 추론 속도이며, 한 설계만 학습해 다른 설계에 적용한 일반화 실험(superblue1 학습)도 같은 ICCAD 계열 안에서 한 것이다.' },
  { kind: '소거 실험', title: '소거는 3개 설계, 지표별로는 일부 역전', body: 'Table 6은 superblue1·3·4 세 개만 본다. 평균 순위로는 전체가 최고(rWL 1.00, TNS 1.33)지만, 일부 구성 요소를 뺀 쪽이 일부 지표에서 더 낫다(예: dataflow 제거 시 overflowH 순위 1.33 대 전체 3.00). 반복(seed)·분산은 보고되지 않았다.' },
  { kind: '범위', title: 'macro만, 그리고 저자 보고', body: 'RL은 macro 위치만 정하고 표준셀은 다른 도구가 배치한다. 결과는 저자 보고(화웨이 연구소 공저)이며 독립 재현이나 상용 도구·tapeout과의 비교는 찾지 못했다. "산업 실무에 쓸 만하다"는 주장은 이번 근거로는 입증되지 않았다.' },
]

const REPRO: string[] = [
  '구성: PPO(actor-critic), 궤적 버퍼, Ray 병렬 환경. 보상 마스크 reg, hier, df, wire, port, pos 6개와 가중치 목록 [0.45, 0.2, 0.15, 0.15, 0.05](5개)가 설정에서 맞지 않는다는 README의 불일치가 있음.',
  '의존: DREAMPlace(전역 배치), OpenTimer(타이밍), Docker+GPU, Ray. 배선·사인오프 평가는 별도의 상용 또는 학술 도구가 필요하다고 README가 말하며 도구 이름은 적지 않음.',
  '데이터: Docker 이미지, 벤치마크, 사전 처리 데이터를 Google Drive에서 받아야 함. 라이선스, seed, 통계 정보는 README에 없음.',
  '실행 예: python -m src.main --benchmark superblue3 --config iccad --gpu 0 --seed 3 (평가는 --test --model_path).',
]

const IDEAS: { idea: string; why: string; cost: string }[] = [
  { idea: '비용 함수 4개를 RL 없이 탐색 휴리스틱 항으로 사용', why: 'periphery(Σ(dx+dy)), grouping(그룹 bbox 면적), dataflow 가중 맨해튼 거리, I/O keepout 겹침은 모두 닫힌 식이라 우리 Macro Tetris의 beam/SA 목적 함수에 바로 더할 수 있음', cost: '낮음 (RL 학습 불필요)' },
  { idea: 'dataflow 가중치를 합성 넷리스트에서 추출', why: '논문 방식(FF 홉 2 이하, w = Σ 1/2^홉)은 Yosys 합성 결과의 macro–FF–macro 경로 탐색으로 구현 가능. chan_top 등 우리 macro 8개 설계에 적용 가능', cost: '중간' },
  { idea: '지난 실패 원인과의 대응 가설', why: '우리 후보가 OpenLane에서 hold buffer 배치와 routing 혼잡으로 실패했던 것은 I/O keepout, periphery 편향이 겨냥하는 문제와 비슷함. 가설이며 검증하지 않았음', cost: '검증 필요' },
  { idea: 'DPO 미세조정은 보류', why: '설계당 약 500회 STA 평가가 필요. 우리에게 OpenLane 실평가는 훨씬 비싸므로 빠른 STA/추정(pnr_est 같은) 대체가 선행돼야 함', cost: '높음' },
]

const Rank = ({ rows, cols }: { rows: { m: string; r: number[] }[]; cols: string[] }) => {
  const best = bestCols(rows)
  return <div className="data-table"><table>
    <thead><tr><th>방법</th>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
    <tbody>{rows.map(x => <tr key={x.m}><td><b>{x.m}</b></td>{x.r.map((v, i) => <td key={i} style={v === best[i] ? { fontWeight: 700, color: '#1D9E75' } : undefined}>{v.toFixed(2)}</td>)}</tr>)}</tbody>
  </table></div>
}

export default function ExplaceDeepDive() {
  return <>
    <section className="card vb-card">
      <div className="card-title"><div><small className="kicker">DEEP DIVE · EXPlace</small><h2>EXPlace 상세 분석 — 전문가 지식을 넣은 RL macro placement (ICLR 2026)</h2></div><span className="connection">원문 본문 확인 · 2026-10-17</span></div>
      <div className="data-table"><table><tbody>{FACTS.map(([k, v]) => <tr key={k}><td style={{ width: 120 }}><b>{k}</b></td><td>{v}</td></tr>)}</tbody></table></div>

      <h3 className="vb-sub">1. 풀려는 문제</h3>
      <ul className="vb-limits">{PROBLEM.map((s, i) => <li key={i}>{s}</li>)}</ul>

      <h3 className="vb-sub">2. 방법 ① 전문가 지식 주입 (Expert Knowledge Injection)</h3>
      <p className="vb-lead">모든 지식은 "비용 함수 → 새 macro를 놓을 때의 증분 비용 → 보상 + 격자 위치별 마스크(상태 입력)"의 같은 틀로 바뀝니다. 증분 합이 전체 비용과 같아서 밀집 보상이 됩니다.</p>
      <div className="data-table"><table>
        <thead><tr><th>지식</th><th>왜</th><th>비용 함수</th><th>구현</th><th>가중치</th><th>비고</th></tr></thead>
        <tbody>{KNOW.map(k => <tr key={k.name}><td><b>{k.name}</b></td><td>{k.why}</td><td><code>{k.cost}</code></td><td>{k.how}</td><td>{k.w}</td><td>{k.note}</td></tr>)}</tbody>
      </table></div>
      <p className="vb-note">가중치: ICCAD(dataflow 0.15, grouping 0.20, periphery 0.45, I/O 0.05, HPWL 0.15), OpenROAD(0.15, 0.30, 0.35, 0.05, 0.15). 차이는 grouping 가중치(0.30)와 periphery(0.35) 뿐이다(Table 4).</p>

      <h3 className="vb-sub">3. 강화학습 설정 (MDP)</h3>
      <div className="data-table"><table><tbody>{MDP.map(([k, v]) => <tr key={k}><td style={{ width: 90 }}><b>{k}</b></td><td>{v}</td></tr>)}</tbody></table></div>

      <h3 className="vb-sub">4. 방법 ② 타이밍 기반 미세조정 (Expert Workflow Imitation, DPO)</h3>
      <ul className="vb-limits">{DPO.map((s, i) => <li key={i}>{s}</li>)}</ul>
    </section>

    <section className="card vb-card">
      <div className="card-title"><div><small className="kicker">EXPlace · EXPERIMENT</small><h2>EXPlace 실험과 결과</h2></div><span className="connection">논문 Table 2·3·5·6·7·9</span></div>
      <h3 className="vb-sub">실험 설정</h3>
      <div className="data-table"><table>
        <thead><tr><th></th><th>ICCAD 2015</th><th>OpenROAD</th></tr></thead>
        <tbody>{SETUP.map(s => <tr key={s.item}><td><b>{s.item}</b></td><td>{s.ico}</td><td>{s.ord}</td></tr>)}</tbody>
      </table></div>

      <h3 className="vb-sub">ICCAD 2015 — 평균 순위 (낮을수록 좋음, 초록 = 열 최고)</h3>
      <Rank rows={ICCAD_RANK} cols={ICCAD_METRICS}/>
      <p className="vb-note">EXPlace가 6개 중 5개에서 평균 순위 1위 또는 공동 1위(rOverflowV는 MaskRegulate 1.88이 최고, rOverflowH는 MaskRegulate와 같은 2.00). 논문 설명: MaskRegulate는 주기 비용에만 집중해 가장자리에 매우 촘촘히 쌓아 overflow에 유리.</p>

      <h3 className="vb-sub">OpenROAD — 평균 순위 (6개 설계, 전체 흐름 후 지표)</h3>
      <Rank rows={OR_RANK} cols={OR_METRICS}/>
      <p className="vb-note">논문이 인용한 수치: DREAMPlace 대비 TNS 크기 23.06% 감소, MaskRegulate 대비 5.97%. Hier-RTLMP 대비 rWL 5.77%, WNS 4.77%, TNS 20.54%, DRC 84.48% 개선. bp_fe의 DRC는 0건.</p>

      <h3 className="vb-sub">대표 수치 재계산 (논문 Table 2 값 기준, 내가 계산)</h3>
      <div className="data-table"><table>
        <thead><tr><th>지표</th><th>논문 수치</th><th>LaMPlace 대비 합계 기준</th><th>설계별 평균</th><th>설계별 1위 횟수</th><th>가장 나쁜 설계</th></tr></thead>
        <tbody>{RECALC.map(r => <tr key={r.metric}><td><b>{r.metric}</b></td><td>{r.paper}</td><td>{r.sum}</td><td>{r.mean}</td><td>{r.wins}</td><td>{r.worst}</td></tr>)}</tbody>
      </table></div>
      <p className="vb-note">논문의 "runner-up 대비 평균 개선"은 LaMPlace 대비 8개 설계 합계의 감소율과 소수점까지 일치합니다. 합계는 큰 설계(superblue10 등)가 좌우하므로 설계별 평균은 더 작습니다. 어느 쪽이 맞다는 문제가 아니라 무엇을 보고했는지 알고 읽어야 합니다.</p>

      <h3 className="vb-sub">소거 실험 (superblue1, 3, 4 — 평균 순위)</h3>
      <Rank rows={ABL} cols={ICCAD_METRICS}/>
      <p className="vb-note">dataflow를 빼면 WNS·TNS가 가장 나빠지고(둘 다 4.00), periphery를 빼면 overflow(H 5.00, V 4.67)와 rWL(4.33)이 크게 나빠집니다. 논문의 해석과 같습니다. 다만 5개 변형 사이의 순위이고 3개 설계뿐입니다.</p>

      <h3 className="vb-sub">타이밍 미세조정 효과 (Table 9)</h3>
      <p className="vb-lead">DPO 미세조정 평균 개선: TNS +12.29%, WNS +22.68%, global HPWL +1.77%. 예) superblue1 TNS −1070.14 → −821.20, WNS −51.48 → −36.48. 단 superblue10은 TNS가 −2168.76 → −2499.09로 나빠졌고 WNS는 −96.34 → −65.08로 좋아졌습니다. 단위는 Table 2와 달라(OpenTimer post-placement) 두 표의 수치를 직접 비교하면 안 됩니다.</p>

      <h3 className="vb-sub">런타임 (Table 5)</h3>
      <div className="data-table"><table>
        <thead><tr><th>방법</th><th>추론(Test) 평균</th><th>학습</th></tr></thead>
        <tbody>{RUNTIME.map(r => <tr key={r.m}><td><b>{r.m}</b></td><td>{r.test}</td><td>{r.train}</td></tr>)}</tbody>
      </table></div>
      <p className="vb-note">"superblue1에서 5.28초 대 DREAMPlace 287초"는 학습이 끝난 뒤의 추론 시간입니다. 설계마다 평균 2.4시간 학습이 따로 필요합니다. 병렬 환경 덕에 MaskRegulate 원 구현보다 학습은 빠릅니다.</p>

      <h3 className="vb-sub">일반화 (Table 7)</h3>
      <p className="vb-lead">superblue1에서만 학습한 정책을 나머지 7개 설계에 그대로 적용했을 때도 평균 순위는 rWL 1.38, NVP 1.88, TNS 1.62로 1위입니다. WNS는 2.75, overflowH 2.12(MaskRegulate 1.38). 같은 ICCAD superblue 계열 안에서의 결과이며 다른 공정이나 설계 유형에서의 일반화는 아닙니다.</p>
    </section>

    <section className="card vb-card">
      <div className="card-title"><div><small className="kicker">EXPlace · ASSESSMENT</small><h2>EXPlace 비판적 평가와 재현성</h2></div><span className="connection">내 해석 포함</span></div>
      <h3 className="vb-sub">평가할 때 주의할 점</h3>
      <div className="data-table"><table>
        <thead><tr><th>구분</th><th>항목</th><th>내용</th></tr></thead>
        <tbody>{LIMITS.map(l => <tr key={l.title}><td>{l.kind}</td><td><b>{l.title}</b></td><td>{l.body}</td></tr>)}</tbody>
      </table></div>
      <p className="vb-note"><b>강점도 분명합니다.</b> 전문가 지식을 비용 함수 4개로 명시하고 소거 실험으로 기여를 보였고, OpenROAD 전체 흐름에서 DRC까지 본 것, 코드를 공개한 것은 이 분야에서 드문 투명성입니다. 지식이 "블랙박스 속"이 아니라 읽을 수 있는 식이라는 점이 가장 큰 가치입니다.</p>

      <h3 className="vb-sub">재현성</h3>
      <ul className="vb-limits">{REPRO.map((s, i) => <li key={i}>{s}</li>)}</ul>

      <h3 className="vb-sub">우리 프로젝트에 가져올 만한 것 (제 해석, 미검증)</h3>
      <div className="data-table"><table>
        <thead><tr><th>아이디어</th><th>이유</th><th>비용</th></tr></thead>
        <tbody>{IDEAS.map(i => <tr key={i.idea}><td><b>{i.idea}</b></td><td>{i.why}</td><td>{i.cost}</td></tr>)}</tbody>
      </table></div>
      <p className="vb-note">이 표는 논문 내용이 아니라 우리 Macro Tetris 맥락에서 제가 붙인 가설입니다. 어느 것도 아직 실험하지 않았습니다. 논문의 4개 비용 함수는 EXPlace의 RL과 별개로 쓸 수 있는 부품이라는 점이 핵심입니다.</p>
    </section>
  </>
}
