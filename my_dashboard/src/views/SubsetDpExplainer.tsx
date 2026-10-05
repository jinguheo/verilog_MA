// 부분집합 DP(정확해)가 어떻게 동작하는지 상세히 설명하는 카드.
// 설명은 CellSaExperiment.tsx의 subsetDp 구현을 그대로 따른다. 맨 아래 3셀 예제는 렌더링할 때 같은 점화식과
// 전수 탐색을 실제로 계산해 보여 주므로, 화면의 숫자는 손으로 쓴 값이 아니다.

const mono = { fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.7, background: 'var(--surface-muted)', padding: 10, borderRadius: 6, margin: '6px 0', whiteSpace: 'pre-wrap' as const }
const p = { margin: '4px 0 8px', fontSize: 12, lineHeight: 1.8 }
const h = { fontSize: 13, display: 'block', marginTop: 14 } as const

// ---- 3셀 예제: 폭 A=2, B=4, C=2, 핀은 셀 가운데, 넷은 A–B, B–C, A–C ----
const TOY_NAMES = ['A', 'B', 'C']
const TOY_W = [2, 4, 2]
const TOY_NETS: [number, number][] = [[0, 1], [1, 2], [0, 2]]

function toyRun() {
  const n = 3, o = TOY_W.map(w => w / 2)
  const label = (S: number) => '{' + TOY_NAMES.filter((_, i) => S >> i & 1).join(',') + '}'
  // 전수 탐색: 모든 순서의 실제 배선 길이
  const orders: number[][] = []
  const rec = (cur: number[], rest: number[]) => { if (!rest.length) { orders.push(cur); return } rest.forEach((v, i) => rec([...cur, v], [...rest.slice(0, i), ...rest.slice(i + 1)])) }
  rec([], [0, 1, 2])
  const brute = orders.map(order => {
    const X = [0, 0, 0]; let x = 0
    for (const i of order) { X[i] = x; x += TOY_W[i] }
    const per = TOY_NETS.map(([u, v]) => Math.abs(X[u] + o[u] - X[v] - o[v]))
    return { order, per, total: per.reduce((a, b) => a + b, 0) }
  })
  const bruteMin = Math.min(...brute.map(b => b.total))
  // DP: 부분집합 S를 오름차순으로 훑으며 셀 v를 오른쪽 끝에 붙인다
  const dp = new Array(8).fill(Infinity), par = new Array(8).fill(-1), cut = new Array(8).fill(0)
  const cands: { S: number; v: number; sum: number; wing: number; cross: number }[][] = Array.from({ length: 8 }, () => [])
  dp[0] = 0
  for (let S = 0; S < 7; S++) {
    for (let v = 0; v < n; v++) {
      if (S >> v & 1) continue
      let wing = 0, degS = 0, deg = 0
      for (const [a, b] of TOY_NETS) {
        if (a !== v && b !== v) continue
        deg++
        const u = a === v ? b : a
        if (S >> u & 1) { degS++; wing += o[v] } else wing += TOY_W[v] - o[v]
      }
      const cross = TOY_W[v] * (cut[S] - degS), T = S | 1 << v, total = dp[S] + wing + cross
      cands[T].push({ S, v, sum: total, wing, cross })
      if (total < dp[T]) { dp[T] = total; par[T] = v }
      cut[T] = cut[S] + deg - 2 * degS
    }
  }
  const order: number[] = []
  for (let T = 7; T; T ^= 1 << par[T]) order.unshift(par[T])
  return { label, brute, bruteMin, dp, par, cut, cands, order, optimum: dp[7] }
}

export default function SubsetDpExplainer({ maxN }: { maxN: number }) {
  const t = toyRun()
  const subsets = [1, 2, 4, 3, 5, 6, 7]
  const bytes = (n: number) => 2 ** n * 10
  const mb = (n: number) => bytes(n) < 1e5 ? `${Math.round(bytes(n) / 1e3)} K` : `${bytes(n) / 1e6 < 10 ? (bytes(n) / 1e6).toFixed(1) : Math.round(bytes(n) / 1e6)} M`
  return <div className="card" style={{ padding: 12, marginTop: 14 }}>
    <div className="card-title" style={{ marginBottom: 6 }}><div><small className="kicker">SUBSET DP · 정확해 동적계획법</small><h3>부분집합 DP가 어떻게 최적을 찾나 — 이 구현 기준 상세 설명</h3></div></div>

    <b style={{ ...h, marginTop: 0 }}>1. 한 줄 요약</b>
    <p style={p}>셀을 왼쪽부터 한 칸씩 채워 갈 때, <b>"앞으로 드는 비용"은 지금까지 어떤 순서로 놓았는지가 아니라 "어떤 셀들이 이미 왼쪽에 있는지"만으로 정해집니다.</b> 그래서 순서 n!가지를 따로 보지 않고 <b>셀의 부분집합 2ⁿ개</b>만 기억하면 정확한 최적을 구할 수 있습니다(20셀: 2.4×10¹⁸ 순서 → 약 105만 부분집합).</p>

    <b style={h}>2. 왜 부분집합만 기억해도 되나</b>
    <p style={p}>배치를 왼쪽에서 오른쪽으로 만든다고 합시다. 집합 S의 셀들이 이미 왼쪽에 놓였고 다음에 셀 v를 붙인다면, v 이후의 비용을 정하는 것은 ① S가 어떤 셀들인가(어느 넷이 왼쪽에서 오른쪽으로 걸쳐 있는가), ② S의 총 폭입니다. <b>S 안의 순서는 둘 다 바꾸지 않습니다.</b> 따라서 같은 집합 S를 만드는 방법이 여러 개여도 지금까지 비용이 가장 작은 하나만 남기면 되고, 나머지는 어떤 미래에서도 이길 수 없습니다(최적 부분 구조).</p>

    <b style={h}>3. 넷 길이를 셀별 몫으로 쪼개기</b>
    <p style={p}>2핀 넷의 길이는 핀 x좌표 차이입니다. 왼쪽 끝점 셀 u와 오른쪽 끝점 셀 v 사이에 다른 셀들이 있다면 이 길이는 다음 세 부분의 합입니다.</p>
    <div style={mono}>{`길이 = (u의 오른쪽 가장자리 − u의 핀)  +  (u와 v 사이에 낀 셀들의 폭 합)  +  (v의 핀 − v의 왼쪽 가장자리)
         ───── u가 놓일 때 부담 ─────        ──── 지나가는 셀이 놓일 때 부담 ────        ──── v가 놓일 때 부담 ────`}</div>
    <p style={p}>셀 v를 집합 S의 오른쪽에 붙일 때 드는 비용을 이렇게 계산합니다(<code>o</code> = v의 왼쪽 가장자리에서 핀까지 거리, <code>W</code> = v의 폭).</p>
    <div style={mono}>{`비용(S → S∪{v}) =  Σ (v에 붙은 넷 중 상대가 아직 안 놓인 것)   (W − o)     ← v가 왼쪽 끝점: 오른쪽 가장자리까지
                 +  Σ (v에 붙은 넷 중 상대가 이미 S에 있는 것)   o           ← v가 오른쪽 끝점: 왼쪽 가장자리부터
                 +  W × (v 위를 지나가는 넷의 수)                          ← 이미 S에 한쪽 끝, 아직 안 놓인 곳에 다른 쪽 끝
v 위를 지나가는 넷의 수 = cut(S) − deg_S(v)
   cut(S)    = S 안과 밖에 끝점이 하나씩 있는 넷의 수
   deg_S(v)  = v와 S 사이의 넷 수 (이 넷들은 v에서 끝나므로 v를 지나가지 않는다)`}</div>
    <p style={p}>cut은 집합이 커질 때마다 <code>cut(S∪v) = cut(S) + deg(v) − 2·deg_S(v)</code>로 갱신하므로 별도 계산이 필요 없습니다. 이렇게 모든 넷 길이가 "셀을 놓는 순간"의 몫으로 정확히 나뉘어 더해지는 것이 DP가 성립하는 이유입니다.</p>

    <b style={h}>4. N / FN 방향은 어떻게 처리하나</b>
    <p style={p}>방향을 바꾸면 그 셀의 핀이 좌우로 뒤집혀 <code>o</code> ↔ <code>W−o</code>가 바뀝니다. 위 비용에서 방향에 의존하는 항은 <b>그 셀 자신의 핀 거리 항뿐</b>이므로, 셀 v를 붙일 때 N과 FN 두 경우의 비용을 각각 계산해 <b>작은 쪽을 바로 고르면</b> 됩니다. 방향 때문에 상태를 늘릴 필요가 없습니다(상태는 여전히 2ⁿ개, 선택한 방향은 부모 정보에 함께 저장해 역추적에 씁니다).</p>

    <b style={h}>5. 알고리즘 (구현과 같은 순서)</b>
    <div style={mono}>{`dp[0] = 0                              // 아무 셀도 안 놓은 상태
for S = 0 … 2ⁿ−2  (오름차순: 부분집합이 항상 먼저 처리됨):
  for 각 셀 v ∉ S:
    c_N, c_FN = 두 방향의 비용(위 3번 식)    // 넷마다 상대가 S에 있는지로 o 또는 W−o를 더함
    비용 = dp[S] + min(c_N, c_FN) + W[v] × (cut[S] − deg_S(v))
    T = S ∪ {v}
    if 비용 < dp[T]:  dp[T] = 비용;  parent[T] = (v, 방향)
    cut[T] = cut[S] + deg(v) − 2·deg_S(v)
답: dp[전체]. parent를 전체 집합에서부터 거꾸로 따라가며 마지막에 붙은 셀을 하나씩 떼어 순서와 방향을 복원.`}</div>

    <b style={h}>6. 계산량과 메모리</b>
    <p style={p}>상태 2ⁿ개, 상태마다 아직 안 놓인 셀 약 n/2개를 시도하고 시도마다 그 셀의 넷 수만큼 더하므로 <b>O(2ⁿ·(n + 넷 수))</b>입니다. 상태당 비용(8바이트) + 부모(1바이트) + 컷(1바이트) = 10바이트를 씁니다.</p>
    <div className="data-table"><table><thead><tr><th>셀 수 n</th><th>상태 2ⁿ</th><th>배열 메모리</th><th>전수 탐색 순서 수 n!</th></tr></thead><tbody>
      {[10, 20, 22, maxN, maxN + 1, 30].map(n => <tr key={n}><td>{n}{n === maxN ? ' (이 대시보드의 상한)' : n > maxN ? ' (막아 둠)' : ''}</td><td>{(2 ** n).toLocaleString()}</td><td>{mb(n)}B</td><td>{n <= 20 ? `${(Array.from({ length: n }, (_, i) => i + 1).reduce((a, b) => a * b, 1)).toExponential(1)}` : `약 10^${Math.floor(Array.from({ length: n }, (_, i) => Math.log10(i + 1)).reduce((a, b) => a + b, 0))}`}</td></tr>)}
    </tbody></table></div>
    <p style={{ ...p, marginTop: 6 }}>브라우저 실측은 20셀 약 0.6초, 22셀 약 2초, 23셀 약 4초입니다. 시간은 2배씩, 메모리도 2배씩 늘어 24셀부터는 탭이 버티기 어려워 막았습니다.</p>

    <b style={h}>7. "정확하다"의 범위 — 프록시 모델</b>
    <p style={p}>이 DP는 <b>실제 평가 함수와 완전히 같은 모델이 아니라, 아래처럼 단순화한 프록시 모델에서 정확한 최적</b>입니다.</p>
    <ul style={{ margin: '0 0 8px 18px', padding: 0, fontSize: 12, lineHeight: 1.8 }}>
      <li><b>핀 위치:</b> 핀마다 x 위치 하나(넷이 쓸 핀 도형의 중심)를 씁니다. 실제 평가는 넷마다 핀 도형 쌍과 met1 트랙을 거리에 따라 다시 골라 더 짧게 잡을 수 있습니다.</li>
      <li><b>수직·굴곡 항:</b> 핀 도형과 트랙만으로 정해지는 값 K로 놓고 위치와 무관한 상수로 더합니다(최적화에는 영향 없음).</li>
      <li><b>간격:</b> 셀 사이 간격은 0으로 고정합니다(SA도 모든 후보에서 간격 0을 골랐습니다).</li>
      <li><b>넷 독립:</b> 넷끼리 트랙을 공유하는 충돌은 보지 않습니다(SA·전수 탐색과 같은 가정).</li>
    </ul>
    <p style={p}>그래서 DP 해를 실제 평가 함수로 다시 재면 프록시 값과 같거나 작고, 실제 비용에서는 SA 해가 DP 해보다 조금 낮을 수도 있습니다. 비교 표의 "DP 격차"는 SA·스펙트럴 해를 <b>같은 프록시 모델로 재서</b> DP 최적과 비교한 값이라 항상 0 이상입니다.</p>

    <b style={h}>8. 구현을 어떻게 검증했나</b>
    <ul style={{ margin: '0 0 8px 18px', padding: 0, fontSize: 12, lineHeight: 1.8 }}>
      <li>7셀 이하 후보 10개에서 프록시 모델의 <b>모든 순서 × 모든 방향</b>을 직접 계산한 최솟값과 DP 값이 일치했습니다.</li>
      <li>6셀 이하 후보 9개에서 DP 해를 실제 평가 함수로 잰 값을 실제 모델의 전수 탐색 최적과 비교했습니다 — 8개는 같고 1개(AOI→OAI→INV)는 0.09% 차이였습니다.</li>
      <li>DP가 돌려준 배치를 프록시 함수로 다시 계산한 값이 DP의 최적값과 일치함을 20~23셀 후보 4개에서도 확인했습니다.</li>
    </ul>

    <b style={h}>9. 한계와 확장</b>
    <ul style={{ margin: '0 0 8px 18px', padding: 0, fontSize: 12, lineHeight: 1.8 }}>
      <li><b>규모:</b> 24셀 이상은 메모리·시간 때문에 정확해를 구할 수 없습니다. 이 구간은 SA·스펙트럴·하이브리드로 푸는 영역입니다.</li>
      <li><b>모델 차이:</b> 핀 도형 선택·트랙 충돌·간격까지 정확하게 넣으면 비용이 셀을 놓는 순간의 몫으로 쪼개지지 않아 DP 상태가 폭발합니다. 그 경우는 분기한정이나 ILP로 가야 합니다.</li>
      <li><b>활용:</b> 24셀 이상 회로를 "창(window)" 단위로 잘라 창 안만 DP로 최적화하는 방식(슬라이딩 윈도우 DP)이나, 상태를 일부만 유지하는 빔 탐색으로 확장할 수 있습니다.</li>
    </ul>

    <b style={h}>10. 3셀 예제 (화면에서 실제 계산)</b>
    <p style={p}>셀 A(폭 {TOY_W[0]}) · B(폭 {TOY_W[1]}) · C(폭 {TOY_W[2]}), 핀은 모두 셀 가운데, 넷은 A–B · B–C · A–C 세 개입니다(방향은 생략). 오른쪽 열의 "후보"는 마지막에 붙는 셀과 그때의 비용입니다.</p>
    <div className="data-table"><table><thead><tr><th>집합 S</th><th>cut(S)</th><th>마지막에 붙인 셀 후보 → 비용 (= 이전 + 핀 몫 + 지나가는 몫)</th><th>dp[S]</th><th>선택</th></tr></thead><tbody>
      <tr><td>{'{}'}</td><td>0</td><td>—</td><td>0</td><td>—</td></tr>
      {subsets.map(S => <tr key={S}><td><b>{t.label(S)}</b></td><td>{t.cut[S]}</td>
        <td style={{ fontSize: 11 }}>{t.cands[S].length ? t.cands[S].map(c => <div key={c.v}>{TOY_NAMES[c.v]} 마지막: dp{t.label(c.S)} {t.dp[c.S]} + {c.wing} + {c.cross} = <b>{c.sum}</b></div>) : '—'}</td>
        <td><b>{t.dp[S]}</b></td><td>{TOY_NAMES[t.par[S]]}</td></tr>)}
    </tbody></table></div>
    <p style={{ ...p, marginTop: 6 }}>마지막 줄 {t.label(7)}에서 선택을 거꾸로 따라가면 최적 순서는 <b>{t.order.map(i => TOY_NAMES[i]).join(' → ')}</b>, 총 배선 길이 <b>{t.optimum}</b>입니다. 6가지 순서를 전부 직접 계산한 결과는 다음과 같습니다.</p>
    <div className="data-table"><table><thead><tr><th>순서</th><th>A–B</th><th>B–C</th><th>A–C</th><th>합계</th></tr></thead><tbody>
      {t.brute.map(b => <tr key={b.order.join('')} style={b.total === t.bruteMin ? { fontWeight: 700, color: '#1D9E75' } : undefined}><td>{b.order.map(i => TOY_NAMES[i]).join(' → ')}</td>{b.per.map((x, i) => <td key={i}>{x}</td>)}<td>{b.total}</td></tr>)}
    </tbody></table></div>
    <p style={{ ...p, marginTop: 6 }}>전수 탐색의 최솟값은 <b>{t.bruteMin}</b>, DP 값은 <b>{t.optimum}</b>으로 {t.bruteMin === t.optimum ? '같습니다 — 계산량은 3! = 6가지 대신 부분집합 7개만 보고 같은 답에 도달했습니다.' : '다릅니다 — 구현 오류입니다.'}</p>
  </div>
}
