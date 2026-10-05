// "SA가 아닌 방식" 설명 카드: 한 줄 배치(셀 순서 + N/FN + 간격) 문제를 푸는 방법들을 분류하고,
// 이 대시보드에서 구현해 SA와 비교하는 방식(스펙트럴 정렬 + 결정적 국소 개선)이 하는 일을 설명한다.
// 상수(윈도우 크기·최대 반복 횟수·거듭제곱법 반복 수)는 실제 구현에서 받아 와 설명과 코드가 어긋나지 않게 한다.

type Status = '구현됨' | '일부 구현' | '미구현'
type Row = { group: string; name: string; idea: string; fit: string; status: Status; note?: string }

const fmtBig = (x: number) => { if (x < 1e12) return Math.round(x).toLocaleString(); const e = Math.floor(Math.log10(x)); return `${(x / 10 ** e).toFixed(1)}×10^${e}` }
const fact = (n: number): number => n <= 1 ? 1 : n * fact(n - 1)
const placements = (n: number) => fact(n) * 2 ** n * 3 ** (n - 1)

const ROWS: Row[] = [
  { group: '정확한 방식', name: '전수 탐색', idea: '가능한 배치를 전부 평가해 최솟값을 고른다.', fit: '배치 수 n!·2ⁿ·3ⁿ⁻¹ — 6셀(약 1,120만)이 현실적 한계.', status: '구현됨', note: '1단계·6셀 검증' },
  { group: '정확한 방식', name: '부분집합 DP', idea: '"왼쪽에 이미 놓인 셀의 집합"을 상태로 두고, 셀을 하나 붙일 때 그 셀 위를 지나가는 넷 수 × 셀 폭과 핀~셀 가장자리 거리를 더한다. N/FN은 셀마다 독립적으로 최선을 고른다.', fit: '상태 2ⁿ·n개. 23셀까지 브라우저에서 계산(23셀 약 6초). 핀 위치를 도형 중심 하나로 단순화한 프록시 모델에서 정확하다.', status: '구현됨', note: '정확해 DP 버튼' },
  { group: '정확한 방식', name: '분기한정 (B&B)', idea: '부분 배치의 비용 하한이 지금까지의 최선보다 크면 그 가지를 통째로 버린다.', fit: '하한이 잘 서면 10~14셀까지. 하한을 만드는 것이 관건.', status: '미구현' },
  { group: '정확한 방식', name: 'ILP / CP-SAT', idea: '순서·위치를 정수 변수로 쓰고 솔버가 최적임을 증명하며 푼다.', fit: '중간 규모에서 최적 증명이 따라온다. 솔버 라이브러리가 필요.', status: '미구현' },

  { group: '메타휴리스틱', name: 'SA (simulated annealing)', idea: '나빠지는 이동도 확률 e^(−Δ/T)로 받아들이고 온도 T를 서서히 낮춘다.', fit: '구현이 단순하고 이 실험의 기준선. 큰 회로(40셀 이상)는 seed마다 결과가 크게 흔들림 — 위 비교 표의 "직전 대비" 열에서 확인.', status: '구현됨', note: '위 SA 카드' },
  { group: '메타휴리스틱', name: '유전 알고리즘 / memetic', idea: '배치 여러 개를 교배·변이시키고 자손에 국소 개선을 붙인다.', fit: '순서 교차(OX 등)가 잘 맞는다. 집단을 쓰므로 seed 편차가 작은 편.', status: '미구현' },
  { group: '메타휴리스틱', name: '하이브리드 (스펙트럴 해에서 시작하는 SA)', idea: '스펙트럴 + 다듬기의 결과를 SA의 시작 배치로 쓰고, 시작 온도를 낮춰(보통의 0.3배) 좋은 구조를 한 번에 무너뜨리지 않으면서 국소 최적을 넘는다.', fit: '스펙트럴의 속도·안정성과 SA의 탈출 능력을 합친다. 큰 회로에서 무작위 출발 SA가 헤맬 때 첫 번째로 시도할 방법.', status: '구현됨', note: '보완 실험 버튼' },
  { group: '메타휴리스틱', name: 'Tabu search', idea: '최근에 한 이동을 일정 기간 금지해 국소 최적에서 빠져나온다.', fit: '이동 평가가 싼 이 문제에 맞는다.', status: '미구현' },
  { group: '메타휴리스틱', name: 'Late acceptance / threshold accepting', idea: '확률 대신 "최근 값 대비" 또는 "문턱값 이내"면 받아들인다.', fit: 'SA보다 튜닝 변수가 적다.', status: '미구현' },
  { group: '메타휴리스틱', name: 'Iterated local search / multi-start', idea: '국소 개선 → 일부 흔들기 → 다시 개선을 반복하거나 여러 출발점에서 돌린다.', fit: '구현이 쉽고 seed 편차를 줄인다.', status: '미구현' },
  { group: '메타휴리스틱', name: 'Parallel tempering', idea: '온도가 다른 SA 여러 개를 동시에 돌리며 주기적으로 상태를 교환한다.', fit: '지금 겪는 "seed에 따라 결과가 다름"을 직접 줄인다.', status: '미구현' },

  { group: '구성적·해석적', name: '스펙트럴 정렬 + 결정적 국소 개선', idea: '연결 그래프의 Fiedler 벡터로 순서를 정한 뒤, 무작위 없이 뒤집기·재삽입·윈도우 재배열로 내려간다.', fit: '계산이 빠르고 매번 같은 결과(seed 없음). 국소 최적에 갇힐 수 있다.', status: '구현됨', note: '아래에서 SA와 비교' },
  { group: '구성적·해석적', name: 'Min-cut 이분할 (FM / KL)', idea: '셀을 연결이 적게 끊기도록 둘로 나누고 재귀한다.', fit: '실제 배치 도구가 쓰는 방식. 한 줄 배치에서는 순서가 이분할의 결과로 나온다.', status: '미구현' },
  { group: '구성적·해석적', name: 'Force-directed / 2차 배치', idea: '배선 길이를 2차식으로 풀어 연속 좌표를 얻고 행 격자에 맞춘다.', fit: 'OpenROAD의 RePlAce가 이 계열. 연속 해를 합법화하는 단계가 필요.', status: '미구현' },
  { group: '구성적·해석적', name: '슬라이딩 윈도우 재배열', idea: '순서를 고정하고 k개씩 묶어 모든 순열을 시험하며 훑는다.', fit: '후처리로 좋다. 이 대시보드에서는 위 방식의 3단계로 쓴다.', status: '일부 구현' },
  { group: '구성적·해석적', name: '탐욕 / GRASP', idea: '연결이 많은 셀부터 이웃에 붙이고, 무작위를 섞어 여러 번 만든다.', fit: '초기해 생성용.', status: '미구현' },

  { group: '학습 기반', name: '강화학습 / GNN', idea: '정책 망이 배치를 한 셀씩 정한다(칩 배치 연구).', fit: '이 규모에서는 과하다. 학습 비용이 문제 자체보다 크다.', status: '미구현' },
]

const STATUS_COLOR: Record<Status, string> = { '구현됨': '#1D9E75', '일부 구현': '#C0A02B', '미구현': 'var(--text-muted)' }
const mono = { fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.7, background: 'var(--surface-muted)', padding: 10, borderRadius: 6, margin: '6px 0', whiteSpace: 'pre-wrap' as const }

export default function PlacementMethodsExplainer({ window: win, maxPasses, iterations }: { window: number; maxPasses: number; iterations: number }) {
  const sizes = [6, 10, 20, 30, 40, 48]
  return <div className="card" style={{ padding: 12, marginTop: 14 }}>
    <div className="card-title" style={{ marginBottom: 6 }}><div><small className="kicker">OTHER METHODS · SA가 아닌 방식들</small><h3>한 줄 배치 문제를 푸는 다른 방법들 — 그리고 그중 하나를 SA와 비교</h3></div></div>
    <p className="chip-note" style={{ margin: '0 0 8px' }}>이 실험의 문제는 <b>셀 순서(순열) + 셀별 N/FN + 간격</b>을 정해 넷 배선 길이와 면적을 줄이는 1차원 배치입니다. 셀 폭의 합이 거의 고정이라 사실상 <b>"선형 배치(linear arrangement) 문제"</b>이고, 이 문제에는 정확한 방식, 메타휴리스틱, 구성적 방식이 모두 쓰입니다. 아래 표의 "상태"는 이 대시보드에 실제로 구현돼 돌아가는지를 뜻합니다.</p>

    <div className="data-table"><table><thead><tr><th>분류</th><th>방식</th><th>핵심 아이디어</th><th>이 문제에서</th><th>상태</th></tr></thead><tbody>
      {ROWS.map(r => <tr key={r.name}>
        <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{r.group}</td><td><b>{r.name}</b></td><td style={{ fontSize: 12 }}>{r.idea}</td><td style={{ fontSize: 12 }}>{r.fit}</td>
        <td style={{ color: STATUS_COLOR[r.status], fontWeight: 700, whiteSpace: 'nowrap' }}>{r.status}{r.note ? <div style={{ fontSize: 10, fontWeight: 400 }}>{r.note}</div> : null}</td></tr>)}
    </tbody></table></div>

    <b style={{ fontSize: 13, display: 'block', marginTop: 12 }}>탐색 규모: 전수 탐색과 부분집합 DP</b>
    <div className="data-table" style={{ marginTop: 4 }}><table><thead><tr><th>셀 수 n</th><th>전수 탐색 n!·2ⁿ·3ⁿ⁻¹</th><th>부분집합 DP 2ⁿ·n</th></tr></thead><tbody>
      {sizes.map(n => <tr key={n}><td>{n}</td><td>{fmtBig(placements(n))}</td><td>{fmtBig(2 ** n * n)}</td></tr>)}
    </tbody></table></div>
    <p className="chip-note" style={{ margin: '6px 0 10px' }}>DP는 "어떤 순서로 놓였는지"가 아니라 "어떤 셀들이 왼쪽에 있는지"만 기억하기 때문에 n!이 2ⁿ으로 줄어듭니다. 이 대시보드의 DP는 <b>핀 위치를 핀 도형 중심 하나로 단순화한 프록시 모델</b>에서 정확합니다(간격 0, 넷 비용 = 핀 x 차이 + 위치와 무관한 수직·굴곡 항). 구현 검증: 7셀 이하 후보 10개에서 프록시 모델의 전수 탐색과 같은 최적값이 나왔고, 6셀 이하 후보 9개 중 8개는 <b>실제 모델의 전수 최적과도 같은 비용</b>이었습니다(나머지 1개는 0.09% 차이). 자세한 원리는 아래 "부분집합 DP" 카드에 있습니다. 실측 계산 시간은 20셀 약 0.7초, 22셀 약 3초, 23셀 약 6초이며 24셀부터는 메모리(2ⁿ 상태)가 부담이라 막아 두었습니다.</p>

    <b style={{ fontSize: 13, display: 'block', marginTop: 12 }}>이 대시보드에서 SA와 비교하는 방식: 스펙트럴 정렬 + 결정적 국소 개선</b>
    <div style={mono}>{`1) 셀 그래프: 셀 = 정점, 넷 = 간선(두 셀 사이 넷 수 = 가중치). 라플라시안 L = D − A.
2) Fiedler 벡터: L의 두 번째로 작은 고유벡터를 거듭제곱법으로 구한다(${iterations.toLocaleString()}회 반복, 시작 벡터 고정 → 항상 같은 결과).
   연결된 셀은 비슷한 값을 가져서, 값 순서로 세우면 이웃한 셀끼리 가까이 놓인다.
3) 시작 배치: 벡터 값 오름차순 = 셀 순서, 방향은 전부 N, 간격 0.
4) 개선 루프(최대 ${maxPasses}회, 한 회 동안 좋아진 게 없으면 종료):
     (a) 셀마다 N ↔ FN을 뒤집어 보고, 비용이 줄면 유지
     (b) 셀 하나를 빼서 가능한 모든 위치에 넣어 보고, 가장 좋은 위치로
     (c) 길이 ${win} 윈도우를 한 칸씩 밀며 윈도우 안 ${Array.from({ length: win }, (_, i) => i + 1).reduce((a, b) => a * b, 1)}가지 순열을 모두 시험
5) 종료 = 국소 최적. 무작위·온도·seed가 없고, 나빠지는 이동은 절대 받아들이지 않는다.`}</div>
    <p style={{ margin: '4px 0 0', fontSize: 12, lineHeight: 1.7 }}>
      <b>SA와의 차이:</b> SA는 나빠지는 이동도 받아들여 국소 최적을 넘지만 시간이 오래 걸리고 seed마다 결과가 다릅니다. 이 방식은 좋은 시작점에서 곧바로 내려가므로 <b>훨씬 빠르고 결과가 항상 같습니다</b>. 대신 한 번 갇히면 못 나옵니다. 간격은 0으로 고정합니다(SA도 간격 0을 고르는 경우가 대부분이었습니다). 같은 비용 모델·같은 규칙에서 계산하므로 위 비교 표의 값은 SA와 직접 비교할 수 있습니다.</p>
  </div>
}
