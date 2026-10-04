// 안테나(antenna) 위반이 무엇이고 RC(기생 저항·용량)와 어떻게 다른지 설명하는 접이식 블록.
// MacroAreaTetris(AREA FINDING)와 PpaOverview에서 같이 쓴다.
export default function AntennaExplainer({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return <details className="ant-explain" open={defaultOpen}>
    <summary><b>안테나(antenna) 위반이란?</b> — 배선 때문에 생기지만 RC(타이밍)와는 다른 문제</summary>
    <div className="ant-explain-body">
      <p><b>원리.</b> 칩은 금속 배선을 한 층씩 쌓고 플라즈마로 깎아서 만듭니다. 아직 완성되지 않은 긴 배선이 트랜지스터 <b>gate(아주 얇은 절연막)</b>에만 연결돼 있으면 그 배선이 안테나처럼 전하를 모읍니다. 전하가 빠져나갈 곳이 없으면 gate가 손상되어 수율·신뢰성이 떨어집니다. 그래서 <code>배선 금속 면적 ÷ gate 면적</code> 비율에 제조 규칙 상한(우리 설정은 400)을 둡니다. 표의 <code>P/R</code>은 이 상한의 몇 배인지입니다(예: 1.27 = 상한의 1.27배).</p>
      <div className="data-table"><table><thead><tr><th></th><th>RC (기생 저항·용량)</th><th>안테나 효과</th></tr></thead><tbody>
        <tr><td><b>언제</b></td><td>칩이 완성된 뒤 동작할 때</td><td>칩을 만드는 도중 (플라즈마 식각)</td></tr>
        <tr><td><b>영향</b></td><td>신호가 느려지고 전력이 늘어남 → <b>타이밍</b></td><td>gate 손상 → <b>수율·신뢰성</b></td></tr>
        <tr><td><b>배선의 어떤 성질</b></td><td>길이, 폭, 이웃 배선과의 간격 — 길수록 항상 나쁨</td><td>금속 면적 ÷ gate 면적 — <b>gate가 작을수록</b> 더 나쁨(입력 핀 하나뿐인 net이 취약)</td></tr>
        <tr><td><b>확인</b></td><td>PEX/RCX 추출 후 STA</td><td><code>check_antennas</code> 규칙 검사</td></tr>
        <tr><td><b>고치는 법</b></td><td>배치 개선, 버퍼, 배선 폭, 클럭 주기 완화</td><td><b>다이오드</b> 추가(전하의 방전 경로), 윗 금속층으로 우회</td></tr>
        <tr><td><b>클럭 주기와의 관계</b></td><td>주기를 늘리면 완화됨</td><td>무관 (axi 52→54 ns로 늘려도 줄지 않음)</td></tr>
      </tbody></table></div>
      <p><b>왜 계속 남나.</b> 다이오드는 라우팅 <i>전에</i> 넣는데, 라우팅이 끝나면 배선이 다시 바뀝니다. 앞에서 고친 net 대신 <b>다른 net 하나</b>에 위반이 새로 생기는 일이 반복됩니다(2026-10-04 실측: 수리를 강화해도 net이 바뀌며 1건씩 남음). chan_top의 signoff 기준은 <b>antenna 0건</b>이며, 800×800에서는 17건 → 0건으로 닫았습니다(<code>DIODE_INSERTION_STRATEGY: 6</code>).</p>
    </div>
  </details>
}
