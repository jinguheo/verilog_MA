// "메모리 셀 설계" 서브탭 — 카탈로그의 실제 OpenRAM 생성 매크로
// (sky130_sram_1kbyte_1rw1r_32x256_8, 2-port: 1RW+1R, 256 words x 32bit)를
// 열어서 디코더/센스앰프/제어로직이 실제로 어디 있는지 확인하고, SRAM을
// 구성할 때 흔히 빠뜨리는 고려사항을 정리한다. 이미지는 실제 GDS 렌더링.
// 2026-09-20 작성.

const blocks = [
  ['중앙 큰 영역 (연회색 + 주황 점선줄)', '비트셀 배열 (bitcell array)', '256행 × 32열 × 6T 셀. 주황 점선이 워드라인 — 한 번에 한 행만 켜짐.'],
  ['좌/우 세로 열 (자홍색, 배열 양옆)', '행 디코더 + 워드라인 드라이버 (2개, 포트마다 독립)', '이 매크로가 2-포트(1RW+1R)라서 포트마다 자기 주소를 자기 워드라인으로 바꾸는 디코더가 따로 있음 — 포트 추가 = 디코더 통째로 하나 더.'],
  ['상단 띠 (배열 바로 위, 반복 셀)', '컬럼 mux + 감지 증폭기(sense amp) + 출력 래치', '비트라인의 작은 전압차를 읽어 dout[31:0]으로 증폭 — 타이밍이 늦으면 아직 안정 안 된 값을 읽고, 너무 이르면 노이즈를 읽음.'],
  ['하단 띠 (배열 바로 아래, 반복 셀)', '쓰기 드라이버 + 프리차지/이퀄라이제이션', '쓰기 시 셀을 강제로 뒤집을 만큼 강하게 구동, 매 접근 전 비트라인을 미리 충전 — 이걸 안 하면 이전 값이 남아 다음 읽기를 오염시킴.'],
  ['우상단 별도 박스 ("addr1_0" 라벨)', '포트1(읽기 전용) 주소 프리디코더/제어', '전체 주소를 디코더 입력 개수에 맞게 미리 조합 — 게이트 수를 줄여 디코더 자체를 작고 빠르게 만듦.'],
  ['좌하단 별도 박스 (VDD/GND 다수)', '전원 분배 + 내부 타이밍 생성 로직', 'self-timed 회로 — 외부 클록 엣지만으로는 워드라인·센스앰프·프리차지 순서를 못 맞춰서, 내부적으로 지연을 만들어 스스로 타이밍을 생성함.'],
  ['맨 바깥 테두리', '전원 링 (vddd1 / GND)', '배열 전체에 낮은 저항으로 전원을 공급 — 매크로가 클수록 IR drop이 문제가 됨.'],
] as const

const considerations = [
  ['비트셀 안정성 (read/write margin)', '6T 셀의 트랜지스터 크기 비율(beta ratio)이 안 맞으면 읽을 때 값이 뒤집히거나(read disturb) 쓸 때 안 뒤집힘(write failure). 면적을 줄이려 셀을 작게 할수록 이 마진이 줄어듦 — 순수 면적 최적화가 아니라 트레이드오프.'],
  ['감지 증폭기 타이밍', '비트라인 전압차가 아직 충분히 안 벌어졌을 때 감지하면 오독 — self-timed 지연 체인의 튜닝이 실제 동작 여부를 가름.'],
  ['다중 포트 비용', '포트 하나 늘 때마다 셀당 액세스 트랜지스터 2개(워드라인+비트라인) 추가, 디코더·워드라인 드라이버도 포트 수만큼 통째로 복제 — 이 매크로가 정확히 그 예 (좌우 대칭 디코더 2벌).'],
  ['프리차지/이퀄라이제이션 타이밍', '너무 늦게 끝내면 접근 속도 손해, 너무 일찍 끝내면 다음 워드라인이 켜지기 전에 비트라인이 다시 흔들려 오독 위험.'],
  ['전원 무결성 (power integrity)', '워드라인이 한 번에 수십~수백 셀을 동시에 켜면 순간 전류가 크게 튐 — 전원 링·디커플링이 부족하면 인접 회로까지 노이즈가 번짐.'],
  ['공정 변동 매칭', '비트셀이 수만~수백만 개 반복되므로, 셀 사이 미세한 문턱전압 편차가 곧 read margin 편차 — ADC의 커패시터 매칭과 같은 원리가 여기도 그대로 적용됨.'],
] as const

const missing = [
  ['중복행/열 (redundancy/repair)', '이 OpenRAM 생성 매크로엔 없음', '큰 SRAM(수 Mb 이상)에서는 제조 결함으로 일부 행/열이 죽어도 예비 행/열로 대체 — 수율을 크게 좌우하지만 생성기 기본 출력에는 보통 빠져 있음.'],
  ['ECC (오류 정정)', '없음', '우주선/방사선 환경이나 초고집적 공정에서는 1비트 오류를 자동 정정하는 패리티/해밍 코드가 필요 — 이 프로젝트의 daq_subsystem처럼 지상 응용이면 우선순위는 낮음.'],
  ['BIST (Built-In Self-Test)', '없음', '조립 후 자체적으로 march 알고리즘 등을 돌려 셀 결함을 찾는 회로 — 테스트 비용을 줄이지만 별도 설계 필요.'],
  ['비동기 인터페이스 옵션', '이 매크로는 완전 동기(clk0/clk1 필요)', 'daq_subsystem처럼 여러 클록 도메인이 있는 설계에 붙이려면, 이 SRAM의 clk0/clk1 각각을 어느 도메인에 물릴지 - 그리고 그 경계에 CDC가 필요한지 - 별도로 결정해야 함.'],
] as const

export default function MemoryDesign() {
  return <>
    <section className="card">
      <div className="card-title"><div><small className="kicker">실제 선정 매크로 · 2026-09-20</small><h2>sky130_sram_1kbyte_1rw1r_32x256_8 — 실제 GDS</h2></div></div>
      <p>카탈로그의 <code>sky130_sram_macros</code>(OpenRAM 생성, prebuilt)에서 실제로 받아온 매크로입니다. 256 words × 32-bit, 1개 읽기/쓰기 포트(port 0) + 1개 읽기 전용 포트(port 1)의 2-포트 구성 — 완전 동기식(<code>clk0</code>, <code>clk1</code>)이라 아날로그 ADC와 달리 디지털 RTL과 인터페이스가 훨씬 단순합니다.</p>
      <img src="/analog/sram_full.png" alt="SRAM 매크로 전체 레이아웃 (479.78 x 397.50 um)" style={{width:'100%', borderRadius:8, border:'1px solid var(--border)'}}/>
      <p className="rtl-guide-note">479.78 × 397.50 µm, 190,712.6 µm², 161개 셀. 이미지에 <code>dout</code>/<code>addr1[0]</code>/<code>clk1</code>/<code>clk0</code>/<code>VDD</code>/<code>GND</code> 라벨이 실제로 렌더링되어 있습니다.</p>
    </section>

    <section className="card">
      <div className="card-title"><div><small className="kicker">FLOORPLAN</small><h2>블록별 기능 — I/O·디코더·제어로직이 어디 있나</h2></div></div>
      <div className="data-table"><table><thead><tr><th>화면 위치</th><th>블록</th><th>기능</th></tr></thead><tbody>
        {blocks.map(([where, name, fn]) => <tr key={name}><td>{where}</td><td><b>{name}</b></td><td>{fn}</td></tr>)}
      </tbody></table></div>
      <img src="/analog/sram_mid.png" alt="비트셀 배열 확대 (60x60um)" style={{width:'100%', borderRadius:8, border:'1px solid var(--border)', marginTop:16}}/>
      <p className="rtl-guide-note">비트셀 배열 확대(60×60 µm) — 똑같은 모양의 6T 셀이 빈틈없이 반복됩니다. ADC의 unit capacitor와 같은 이유(매칭)로, 배열 안에서는 단 하나도 다르게 그리지 않습니다.</p>
    </section>

    <section className="card">
      <div className="card-title"><div><small className="kicker">이미 있는 것</small><h2>디코더·I/O·제어로직 — 이미 다 있습니다</h2></div></div>
      <p>말씀하신 세 가지(I/O, controller, decoder) 전부 위 floorplan 표에서 확인됩니다 — 이 매크로가 완전한 SRAM이라면 당연히 있어야 하는 구성요소이고, 실제로 다 있습니다. <b>2-포트라서 디코더가 좌우로 2벌</b>인 것까지 실물로 확인했습니다.</p>
      <div className="data-table"><table><thead><tr><th>설계 시 고려사항</th><th>왜 중요한가</th></tr></thead><tbody>
        {considerations.map(([title, why]) => <tr key={title}><td><b>{title}</b></td><td>{why}</td></tr>)}
      </tbody></table></div>
    </section>

    <section className="card">
      <div className="card-title"><div><small className="kicker">추가로 고려할 블록</small><h2>이 생성기 출력엔 없는 것 — daq_subsystem에 붙이기 전에 결정할 것</h2></div></div>
      <div className="data-table"><table><thead><tr><th>블록</th><th>현재 상태</th><th>필요한 이유</th></tr></thead><tbody>
        {missing.map(([name, status, why]) => <tr key={name}><td><b>{name}</b></td><td><span className="warning-badge">{status}</span></td><td>{why}</td></tr>)}
      </tbody></table></div>
      <p className="rtl-guide-note">우선순위: daq_subsystem에 실제로 붙일 계획이라면 <b>비동기 인터페이스 옵션</b>(어느 클록 도메인에 물릴지)이 가장 먼저 결정해야 할 항목이고, redundancy/ECC/BIST는 실제 tape-out을 목표로 할 때만 검토하면 됩니다 — 지금 단계에서 급한 건 아닙니다.</p>
    </section>
  </>
}
