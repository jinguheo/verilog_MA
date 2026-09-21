import { useState } from 'react'

// "아날로그 vs 디지털" 서브탭 — Analog & Memory 탭에서 선정된 실제 회로
// (Efabless SKY130 12-bit SAR ADC, analog/third_party/sky130_ef_ip__adc3v_12bit)를
// 직접 열어서 실측한 내용. 숫자와 핀 이름은 전부 실제 레이아웃 넷리스트
// (netlist/layout/*.spice)와 실제 최상위 서브서킷 선언에서 그대로 가져왔고,
// 이미지는 그 실제 GDS를 KLayout으로 렌더링한 것 — 삽화가 아니라 실물이다.
// 2026-09-20 작성.

const deviceCounts = [
  ['NMOS (sky130_fd_pr__nfet_*)', 50, '입력 스위치, 비교기 차동쌍/증폭단, SAR 래치'],
  ['PMOS (sky130_fd_pr__pfet_*)', 39, '비교기 로드/바이어스, 레벨시프터'],
  ['MIM 커패시터', 4, '보상·필터 커패시터 (12비트 CDAC 본체와 별개)'],
  ['고저항 폴리 저항', 5, '바이어스 전류 설정'],
  ['다이오드', 1, 'ESD/보호'],
] as const

const pins = [
  ['adc_in', 'analog in', 'Vin — 샘플링할 아날로그 입력 전압'],
  ['adc_vrefH / adc_vrefL', 'analog in', '기준전압 상/하한 — 이 범위가 12비트 전체 스케일'],
  ['adc_vCM', 'analog in', '공통모드 전압 (차동 비교기 기준점)'],
  ['adc_hold', 'digital in', 'Sample/Hold 제어 — 0이면 샘플링, 1이면 값 고정'],
  ['adc_dac_val[11:0]', 'digital in', '외부 SAR 로직이 매 사이클 갱신하는 12비트 근사값 — CDAC를 직접 구동'],
  ['adc_comp_out', 'digital out', '비교기 판정 결과 1비트 — 외부 SAR 로직이 다음 근사값을 결정하는 데 씀'],
  ['adc_ena', 'digital in', '비교기 인에이블'],
  ['adc_reset / adc_trim', 'digital in', '리셋 / 오프셋 보정'],
  ['vdda / vssa', 'analog power', '아날로그 전용 전원·접지 — 디지털 스위칭 잡음과 분리'],
  ['vccd / vssd', 'digital power', '디지털 전용 전원·접지 — vdda/vssa와 물리적으로 별도 도메인'],
] as const

const regions = [
  ['중앙 격자 (노란 사각형들)', 'CDAC — 12비트 이진 가중 커패시터 배열', '동일한 unit capacitor를 수백 개 반복 배치 — 하나하나의 절대 정전용량이 아니라 서로의 "비율"이 정확해야 하므로, 공정 편차를 평균화하려고 똑같은 모양을 촘촘히 반복한다.'],
  ['좌우 세로 열 (자홍색)', '커패시터 스위치 배열', '각 unit cap을 adc_vrefH/adc_vrefL/adc_in 중 하나에 연결하는 부트스트랩 스위치 — adc_dac_val 비트마다 하나씩.'],
  ['오른쪽 별도 블록', '비교기 + 바이어스 + 트림 회로', '차동 입력 증폭단(comparator_high_gain), 래치, 바이어스 전류원 — adc_comp_out을 만드는 실제 아날로그 판정 회로.'],
  ['상하 노란 굵은 띠', '전원 링 (vdda/vccd 등)', '칩 가장자리를 두르는 전원 배선 — 다이 전체에 걸쳐 저저항 경로를 만든다.'],
] as const

const threeWayComparison = [
  ['다루는 값', '연속 전압·전류·주파수', '저장된 0/1 상태와 읽기·쓰기 전압', '논리 0/1과 클럭별 상태'],
  ['대표 구성', '트랜지스터, 저항, 커패시터, 바이어스', 'bitcell array, decoder, sense amp, write driver', '표준 셀, 플립플롭, 조합 논리'],
  ['설계 핵심', '매칭·대칭·잡음·선형성·PVT', '용량·접근시간·수율·저전력·안정성', '기능·setup/hold·처리량·면적'],
  ['물리 구현', '소자와 배선을 맞춤 배치', '검증된 반복 배열을 하드매크로로 사용', '자동 합성 후 표준 셀 자동 배치·배선'],
  ['주요 검증', 'SPICE, corner, Monte Carlo, DRC/LVS, PEX', 'read/write margin, bitcell 안정성, BIST, DRC/LVS, Liberty corner', '시뮬레이션, lint, CDC, formal, STA, DRC/LVS'],
  ['대표 도구', 'Xschem, ngspice, CACE, Magic, Netgen', 'OpenRAM/메모리 컴파일러, SPICE, BIST, STA', 'Yosys, Verilator, OpenROAD/OpenSTA'],
  ['강점', '현실 세계의 센서·전원·RF 신호를 직접 처리', '작은 면적에 대량 데이터 저장', '자동화가 높고 복잡한 기능을 빠르게 구현'],
  ['약점', '공정 편차와 잡음에 민감하고 자동화가 어려움', '공정 의존성이 높고 내부 수정이 어려움', '연속 신호를 직접 처리하지 못하고 메모리 밀도가 낮음'],
] as const

const handoffFlow = [
  ['아날로그 → 디지털', 'ADC가 센서 전압을 코드로 변환', '샘플 속도·해상도·클럭 경계·전원 잡음 확인'],
  ['디지털 → 메모리', 'DMA/제어기가 주소·데이터·enable 생성', 'setup/hold, read latency, byte write mask 확인'],
  ['메모리 → 디지털', 'SRAM이 저장 데이터를 정해진 지연 후 반환', '동기/비동기 read 방식과 출력 유효 시점 확인'],
] as const

const toolFlowComparison = [
  ['설계 입력', 'Xschem · SPICE netlist', 'OpenRAM 설정 또는 검증된 SRAM hard macro', 'SystemVerilog RTL'],
  ['기능/전기 시뮬레이션', 'ngspice · CACE', 'SPICE(bitcell/margin) + Verilog model(시스템)', 'Verilator · UVM simulator'],
  ['생성/합성', '회로도를 직접 설계하거나 OpenFASoC 생성', 'OpenRAM/상용 memory compiler', 'Yosys 논리 합성'],
  ['배치·배선', 'Magic 수동·제약 중심 레이아웃', '컴파일러가 내부 배열 생성, OpenROAD는 매크로 외부만 배치', 'OpenROAD 자동 표준 셀 P&R'],
  ['타이밍 모델', 'SPICE transient/AC/noise 결과', 'Liberty의 read/write delay와 corner', 'OpenSTA의 setup/hold·경로 분석'],
  ['물리 검증', 'Magic/KLayout DRC · Netgen LVS · PEX', '매크로 내부 signoff + top-level DRC/LVS', 'OpenLane의 DRC/LVS/antenna/STA'],
] as const

const toolDetails = [
  ['Xschem', '아날로그', '트랜지스터·저항·커패시터 회로도 작성과 SPICE netlist 생성', '파형 계산기가 아니라 회로 입력 도구', '이 프로젝트의 SKY130 아날로그 IP 회로 확인'],
  ['ngspice', '아날로그·메모리 내부', '소자 방정식을 풀어 전압·전류·잡음·PVT를 계산', '정확하지만 RTL 시뮬레이터보다 매우 느림', 'CACE 특성평가의 실제 시뮬레이션 엔진'],
  ['CACE', '아날로그', 'ngspice/Magic/Netgen 실행을 규격·corner별로 자동화하고 판정', '시뮬레이터 자체가 아니라 검증 오케스트레이터', '면적·DRC·LVS와 향후 PEX PPA 자동화'],
  ['OpenRAM', '메모리', '용량·폭·포트를 받아 SRAM array와 GDS/LEF/Liberty 생성', 'Yosys처럼 임의 RTL을 합성하지 않고 SRAM 구조에 특화', 'SKY130 SRAM 생성 후보; 현재 기본은 실리콘 검증 SRAM22'],
  ['SRAM22 macro', '메모리', '제조·측정 이력이 있는 완성 SRAM 하드매크로 제공', '생성기보다 선택 폭은 좁지만 검증 근거가 강함', '현재 4KB·32bit·1-port 최적 후보'],
  ['Verilator', '디지털·메모리 외부', 'SystemVerilog를 C++로 변환해 빠르게 기능 시뮬레이션', '트랜지스터 전압이나 메모리 read margin은 계산하지 못함', 'RTL 테스트벤치와 메모리 behavioral model 검증'],
  ['Yosys', '디지털', 'RTL을 게이트/표준 셀 netlist로 논리 합성', 'OpenRAM과 달리 고밀도 bitcell array를 만들지 못함', 'Sample Test RTL 합성과 OpenLane 전단'],
  ['OpenROAD / OpenSTA', '디지털·매크로 통합', '표준 셀 P&R, 매크로 배치, 배선 및 setup/hold 분석', '아날로그/메모리 매크로 내부는 수정하지 않고 블랙박스로 취급', 'RTL-to-GDS와 PARSAC 매크로 배치 후 최종 통합'],
  ['Magic / Netgen / KLayout', '공통 signoff', 'DRC, LVS, GDS 검사로 제조 가능성과 회로 일치 확인', '기능 시뮬레이션이 아니라 물리 규칙·연결 검증', '아날로그·SRAM·디지털 top 모두에 공통 적용'],
] as const

type LiveTool = { name:string; status:string; purpose:string; path:string }
type LiveCatalog = { id:string; name:string; installed:boolean; kind:string }

const toolGoals = {
  analog_characterization: {
    label:'아날로그 PVT·전력 검증', flow:['Xschem','CACE','ngspice','Magic / Netgen / KLayout'],
    reason:'회로도에서 시작해 PVT·Monte Carlo를 측정하고 DRC/LVS와 PEX로 레이아웃 영향을 확인합니다.',
  },
  sram_macro: {
    label:'SRAM 매크로 선정·생성', flow:['SRAM22 또는 OpenRAM','SPICE / Liberty 검증','LEF·GDS·Verilog export','OpenROAD top 통합'],
    reason:'검증된 매크로가 있으면 SRAM22를 우선 사용하고, 필요한 용량·폭이 없을 때 OpenRAM 생성기를 사용합니다.',
  },
  rtl_verification: {
    label:'RTL 기능·타이밍 검증', flow:['SystemVerilog','Verilator / UVM','Yosys','OpenROAD / OpenSTA'],
    reason:'기능 검증 후 합성하고, 실제 배치·배선과 STA로 setup/hold 및 제조 가능성을 확인합니다.',
  },
  mixed_integration: {
    label:'아날로그+메모리+디지털 통합', flow:['검증 완료 hard macro','behavioral model 검증','OpenROAD macro placement','top-level STA·DRC·LVS'],
    reason:'매크로 내부는 다시 합성하지 않고 LEF/GDS/Liberty/Verilog 모델을 함께 사용해 경계 연결과 타이밍을 검증합니다.',
  },
} as const

function Callout({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rtl-guide-note"><b>{title}</b> {children}</div>
}

export default function AnalogVsDigital({tools,catalog}:{tools:LiveTool[];catalog:LiveCatalog[]}) {
  const [goal,setGoal] = useState<keyof typeof toolGoals>('mixed_integration')
  const recommendation = toolGoals[goal]
  return <>
    <section className="card">
      <div className="card-title"><div><small className="kicker">THREE-WAY OVERVIEW</small><h2>아날로그·메모리·디지털 회로의 차이</h2></div><span className="connection">역할은 다르지만 하나의 칩에서 연결</span></div>
      <p>아날로그는 현실의 연속 신호를 처리하고, 메모리는 데이터를 유지하며, 디지털은 그 데이터를 계산하고 제어합니다. 메모리, 특히 SRAM은 외부 인터페이스는 디지털이지만 내부에는 매우 작은 저장 셀과 감지 증폭기가 있어 <b>아날로그 특성과 디지털 제어가 함께 있는 특수 하드매크로</b>입니다.</p>
      <div className="data-table"><table><thead><tr><th>구분</th><th>아날로그 회로</th><th>메모리 회로</th><th>디지털 회로</th></tr></thead><tbody>
        {threeWayComparison.map(([item,analog,memory,digital])=><tr key={item}><td><b>{item}</b></td><td>{analog}</td><td>{memory}</td><td>{digital}</td></tr>)}
      </tbody></table></div>
    </section>

    <section className="card">
      <div className="card-title"><div><small className="kicker">HOW THEY CONNECT</small><h2>DAQ 시스템에서 서로 데이터를 넘기는 방법</h2></div></div>
      <div className="data-table"><table><thead><tr><th>경계</th><th>주요 역할</th><th>반드시 확인할 것</th></tr></thead><tbody>
        {handoffFlow.map(([boundary,role,check])=><tr key={boundary}><td><b>{boundary}</b></td><td>{role}</td><td>{check}</td></tr>)}
      </tbody></table></div>
      <p className="rtl-guide-note"><b>현재 프로젝트 예:</b> SKY130 SAR ADC가 전압을 12-bit 값으로 바꾸고, <code>chan_top</code> 같은 디지털 로직이 검사·전송하며, SRAM22 4KB 매크로가 데이터를 임시 저장합니다. 세 영역 사이의 인터페이스와 타이밍을 함께 검증해야 전체 시스템이 정상 동작합니다.</p>
    </section>

    <section className="card">
      <div className="card-title"><div><small className="kicker">TOOL FLOW COMPARISON</small><h2>설계 단계별로 사용하는 도구가 어떻게 다른가</h2></div><span className="connection">현재 프로젝트 기준</span></div>
      <div className="data-table"><table><thead><tr><th>단계</th><th>아날로그</th><th>메모리</th><th>디지털</th></tr></thead><tbody>
        {toolFlowComparison.map(([stage,analog,memory,digital])=><tr key={stage}><td><b>{stage}</b></td><td>{analog}</td><td>{memory}</td><td>{digital}</td></tr>)}
      </tbody></table></div>
      <p className="rtl-guide-note"><b>핵심 차이:</b> 아날로그는 SPICE로 소자 물리를 계산하고, 메모리는 내부를 전용 컴파일러/검증 매크로로 만든 뒤 Liberty·LEF·GDS 모델로 넘기며, 디지털은 RTL에서 표준 셀까지 자동 합성합니다. 그래서 하나의 도구로 세 영역을 모두 대체할 수 없습니다.</p>
    </section>

    <section className="card">
      <div className="card-title"><div><small className="kicker">SOFTWARE DETAILS</small><h2>주요 소프트웨어의 기능·차이·강점</h2></div></div>
      <div className="data-table"><table><thead><tr><th>도구</th><th>주 사용 영역</th><th>주요 기능</th><th>유사 도구와 차이 / 장단점</th><th>현재 사용처</th></tr></thead><tbody>
        {toolDetails.map(([tool,domain,purpose,difference,usage])=><tr key={tool}><td><b>{tool}</b></td><td>{domain}</td><td>{purpose}</td><td>{difference}</td><td>{usage}</td></tr>)}
      </tbody></table></div>
    </section>

    <section className="card">
      <div className="card-title"><div><small className="kicker">LIVE TOOL STATUS</small><h2>현재 설치·실행 가능한 도구</h2></div><span className="connection">API 실시간 값</span></div>
      <div className="comparison-tool-status">
        {tools.map(tool=><article key={tool.name}><i className={tool.status==='available'?'online':''}/><div><b>{tool.name}</b><span>{tool.purpose}</span><code>{tool.path}</code></div><em>{tool.status}</em></article>)}
      </div>
      <div className="data-table"><table><thead><tr><th>메모리 자원</th><th>형태</th><th>설치 상태</th></tr></thead><tbody>
        {catalog.filter(item=>item.kind.includes('memory')||item.kind.includes('macro_library')||item.kind==='digital_controller').map(item=><tr key={item.id}><td><b>{item.name}</b></td><td>{item.kind}</td><td><span className={'analog-badge '+(item.installed?'ok':'blocked')}>{item.installed?'installed':'missing'}</span></td></tr>)}
      </tbody></table></div>
    </section>

    <section className="card tool-guide">
      <div className="card-title"><div><small className="kicker">TOOL SELECTOR</small><h2>하려는 작업에 맞는 도구 조합</h2></div></div>
      <label>작업 목적<select value={goal} onChange={event=>setGoal(event.target.value as keyof typeof toolGoals)}>{Object.entries(toolGoals).map(([id,item])=><option key={id} value={id}>{item.label}</option>)}</select></label>
      <div className="tool-guide-flow">{recommendation.flow.map((item,index)=><div key={item}><i>{index+1}</i><b>{item}</b>{index<recommendation.flow.length-1&&<span>→</span>}</div>)}</div>
      <p className="rtl-guide-note"><b>선정 이유:</b> {recommendation.reason}</p>
    </section>

    <section className="card">
      <div className="card-title"><div><small className="kicker">SRAM INTERNALS &amp; TIMING</small><h2>메모리 내부 구조와 읽기·쓰기 시점</h2></div><span className="connection">SRAM22 4KB 기준 개념도</span></div>
      <div className="sram-visual-grid">
        <figure><svg viewBox="0 0 760 330" role="img" aria-label="SRAM 내부 블록 구조">
          <defs><marker id="memArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>
          <rect x="20" y="20" width="720" height="285" rx="16" fill="var(--surface-muted)" stroke="var(--border-strong)"/>
          <g className="memory-block"><rect x="50" y="70" width="120" height="70" rx="10"/><text x="110" y="100">Address</text><text x="110" y="122">register</text></g>
          <g className="memory-block"><rect x="220" y="55" width="120" height="100" rx="10"/><text x="280" y="95">Row / Column</text><text x="280" y="118">decoder</text></g>
          <g className="memory-array"><rect x="390" y="45" width="160" height="190" rx="10"/><path d="M410 70H530M410 95H530M410 120H530M410 145H530M410 170H530M410 195H530M430 60V220M455 60V220M480 60V220M505 60V220"/><text x="470" y="258">6T bitcell array</text></g>
          <g className="memory-block"><rect x="590" y="45" width="120" height="75" rx="10"/><text x="650" y="78">Sense amp</text><text x="650" y="101">read</text></g>
          <g className="memory-block write"><rect x="590" y="160" width="120" height="75" rx="10"/><text x="650" y="193">Write driver</text><text x="650" y="216">write</text></g>
          <g className="memory-control"><rect x="220" y="210" width="120" height="60" rx="10"/><text x="280" y="247">CS · WE · CLK</text></g>
          <g className="memory-arrows"><path d="M170 105H220"/><path d="M340 105H390"/><path d="M550 82H590"/><path d="M590 198H550"/><path d="M280 210V155"/></g>
        </svg><figcaption>주소 decoder가 한 행/열을 선택하고, 읽을 때는 sense amplifier가 작은 bitline 전압 차이를 0/1로 증폭합니다. 쓸 때는 write driver가 저장 셀 상태를 강제로 변경합니다.</figcaption></figure>
        <figure><svg viewBox="0 0 760 330" role="img" aria-label="동기 SRAM 읽기 쓰기 타이밍">
          <rect x="20" y="20" width="720" height="285" rx="16" fill="var(--surface-muted)" stroke="var(--border-strong)"/>
          <g className="timing-label"><text x="40" y="70">CLK</text><text x="40" y="120">CS</text><text x="40" y="170">WE</text><text x="40" y="220">ADDR</text><text x="40" y="270">DATA</text></g>
          <g className="timing-grid"><path d="M120 50V285M260 50V285M400 50V285M540 50V285M680 50V285"/></g>
          <g className="timing-wave"><path d="M100 85H120V50H190V85H260V50H330V85H400V50H470V85H540V50H610V85H700"/><path d="M100 135H680V115H700"/><path d="M100 185H390V165H530V185H700"/><path d="M100 235H245L275 205H385L415 235H525L555 205H685"/><path d="M100 285H385L415 255H525L555 285H700"/></g>
          <g className="timing-text"><text x="285" y="228">READ A</text><text x="430" y="228">WRITE B</text><text x="565" y="228">READ B</text><text x="430" y="278">DATA A</text><text x="565" y="278">DATA B</text></g>
        </svg><figcaption>주소와 제어 신호는 클럭 상승 전 setup 시간만큼 안정돼야 합니다. 동기 SRAM은 선택한 주소의 데이터가 즉시가 아니라 정해진 read latency 뒤에 출력됩니다.</figcaption></figure>
      </div>
    </section>

    <section className="card">
      <div className="card-title"><div><small className="kicker">알아야 할 핵심 용어</small><h2>DAC와 CDAC는 무엇이 다른가</h2></div><span className="connection">CDAC ⊂ DAC</span></div>
      <p><b>DAC</b>(Digital-to-Analog Converter)는 디지털 값을 아날로그 전압이나 전류로 바꾸는 회로 전체를 뜻합니다. <b>CDAC</b>(Capacitive DAC)는 그중 커패시터 배열로 변환값을 만드는 구현 방식입니다. 따라서 모든 CDAC는 DAC이지만, 저항식·전류원식 DAC는 CDAC가 아닙니다.</p>
      <div className="data-table"><table><thead><tr><th>구분</th><th>DAC</th><th>CDAC</th></tr></thead><tbody>
        <tr><td><b>범위</b></td><td>디지털→아날로그 변환기의 총칭</td><td>커패시터 방식 DAC</td></tr>
        <tr><td><b>구현</b></td><td>저항, 전류원, 커패시터 등 여러 방식</td><td>이진 가중 또는 분할 커패시터 배열</td></tr>
        <tr><td><b>주요 사용처</b></td><td>오디오 출력, 기준전압, 제어 신호</td><td>SAR ADC 내부의 비교 전압 생성</td></tr>
        <tr><td><b>강점</b></td><td>목적에 따라 구조를 선택할 수 있음</td><td>정적 전력이 작고 CMOS 공정에 적합</td></tr>
        <tr><td><b>주의점</b></td><td>구조별 선형성·속도·전력 특성이 다름</td><td>해상도가 커질수록 면적과 커패시터 매칭이 어려움</td></tr>
      </tbody></table></div>
      <div className="cdac-flow" aria-label="SAR ADC에서 CDAC가 동작하는 순서">
        <div><i>1</i><b>SAR 로직</b><span>시험할 비트를 정함</span></div><em>→</em>
        <div><i>2</i><b>CDAC</b><span>해당 아날로그 전압 생성</span></div><em>→</em>
        <div><i>3</i><b>Comparator</b><span>입력 전압과 비교</span></div><em>→</em>
        <div><i>4</i><b>SAR 로직</b><span>비트를 유지하거나 제거</span></div>
      </div>
      <p className="rtl-guide-note"><b>현재 12-bit SAR ADC에서:</b> 중앙의 반복 커패시터 배열이 CDAC이고, <code>adc_dac_val[11:0]</code>이 시험할 값을 전달합니다. 비교기의 <code>adc_comp_out</code> 결과를 받아 가장 높은 비트부터 하나씩 확정합니다.</p>
    </section>

    <section className="card">
      <div className="card-title"><div><small className="kicker">실제 선정 회로 · 2026-09-20</small><h2>Efabless SKY130 12-bit SAR ADC — 진짜 GDS를 열어봄</h2></div></div>
      <p>Analog &amp; Memory 탭에서 선정한 후보(<code>sky130_ef_adc3v_12bit</code>)의 실제 레이아웃(GDS)을 KLayout으로 그대로 렌더링했습니다. 아래 소자 개수·핀 이름은 전부 <code>netlist/layout/sky130_ef_ip__adc3v_12bit.spice</code>(추출된 실제 넷리스트)와 최상위 서브서킷 선언에서 가져온 실측치입니다 — 만들어낸 예시가 아닙니다.</p>
      <img src="/analog/adc_full.png" alt="ADC 전체 다이 레이아웃 (223.71 x 293.37 um)" style={{width:'100%', borderRadius:8, border:'1px solid var(--border)'}}/>
      <p className="rtl-guide-note">223.71 × 293.37 µm, 65,628.7 µm², 56개 셀, 45개 레이어에 실제 형상 존재. 축척 막대(왼쪽 아래)는 10 µm.</p>
    </section>

    <section className="card">
      <div className="card-title"><div><small className="kicker">FLOORPLAN</small><h2>블록별 기능 — 이 그림의 어디가 뭔지</h2></div></div>
      <div className="data-table"><table><thead><tr><th>화면 위치</th><th>블록</th><th>기능</th></tr></thead><tbody>
        {regions.map(([where, name, fn]) => <tr key={name}><td>{where}</td><td><b>{name}</b></td><td>{fn}</td></tr>)}
      </tbody></table></div>
      <div className="two-col-images" style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginTop:16}}>
        <figure style={{margin:0}}>
          <img src="/analog/adc_detail.png" alt="CDAC unit capacitor 배열 확대 (20x20um)" style={{width:'100%', borderRadius:8, border:'1px solid var(--border)'}}/>
          <figcaption className="rtl-guide-note">CDAC 확대(20×20 µm) — 동심원 사각형 하나하나가 unit MIM 커패시터 1개. 전부 같은 모양·같은 크기로, 개별 소자 오차가 아니라 <b>서로의 비율</b>만 정확하면 되도록 설계됨.</figcaption>
        </figure>
        <figure style={{margin:0}}>
          <img src="/analog/adc_comparator_zoom.png" alt="비교기/스위치/SAR 로직 경계 확대" style={{width:'100%', borderRadius:8, border:'1px solid var(--border)'}}/>
          <figcaption className="rtl-guide-note">비교기·스위치·제어로직 경계 확대 — 왼쪽은 CDAC 스위치 열(반복 구조), 오른쪽 위는 실제 트랜지스터 게이트(폴리 위 세로줄 패턴)가 보이는 비교기/바이어스 회로.</figcaption>
        </figure>
      </div>
    </section>

    <section className="card">
      <div className="card-title"><div><small className="kicker">실측 소자 구성</small><h2>PMOS / NMOS 개수 — 실제 넷리스트 기준</h2></div></div>
      <div className="data-table"><table><thead><tr><th>소자</th><th>개수</th><th>역할</th></tr></thead><tbody>
        {deviceCounts.map(([name, count, role]) => <tr key={name}><td><b>{name}</b></td><td>{count}</td><td>{role}</td></tr>)}
      </tbody></table></div>
      <Callout title="디지털과 비교하면:">
        <code>chan_top</code>은 29,510개 표준 셀(전부 라이브러리에서 미리 만든 완성품을 고르기만 함)인데, 이 ADC는 <b>99개의 트랜지스터/수동소자를 하나하나 직접 배치</b>했습니다. 표준 셀 개수 자릿수가 3자리 다른 이유가 바로 "완제품 조립"과 "부품 하나하나 수작업"의 차이입니다.
      </Callout>
    </section>

    <section className="card">
      <div className="card-title"><div><small className="kicker">신호 인터페이스</small><h2>핀 이름과 입출력 — 실제 서브서킷 선언</h2></div></div>
      <div className="data-table"><table><thead><tr><th>핀</th><th>종류</th><th>의미</th></tr></thead><tbody>
        {pins.map(([pin, kind, desc]) => <tr key={pin}><td><code>{pin}</code></td><td><span className={kind.includes('power') ? 'warning-badge' : kind.includes('analog') ? 'ok-badge' : ''}>{kind}</span></td><td>{desc}</td></tr>)}
      </tbody></table></div>
      <Callout title="이게 왜 중요한가:">
        SAR 제어 로직(<code>sar_ctrl.v</code>)이 이 매크로 <b>안에 없습니다</b> — <code>adc_dac_val[11:0]</code>과 <code>adc_comp_out</code>을 통해 매 사이클 값을 주고받는 외부 디지털 RTL입니다. 즉 이 아날로그 매크로를 <code>daq_subsystem</code>에 붙이려면, 그 사이의 12비트 버스 + 1비트 비교 결과가 실제 클록 경계를 넘나드는 진짜 디지털-아날로그 인터페이스가 됩니다.
      </Callout>
    </section>

    <section className="card">
      <div className="card-title"><div><small className="kicker">개념 비교</small><h2>왜 값 표현부터 다른가</h2></div></div>
      <div className="two-col-images" style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16}}>
        <svg viewBox="0 0 300 180" role="img" aria-label="아날로그 연속 신호">
          <rect x="10" y="10" width="280" height="160" rx="12" className="box"/>
          <text x="24" y="34" className="th">아날로그: 연속 전압</text>
          <path d="M30,140 C55,100 70,155 95,120 C115,90 130,145 150,110 C170,80 185,130 205,115" fill="none" stroke="#D85A30" strokeWidth="2"/>
        </svg>
        <svg viewBox="0 0 300 180" role="img" aria-label="디지털 이산 신호">
          <rect x="10" y="10" width="280" height="160" rx="12" className="box"/>
          <text x="24" y="34" className="th">디지털: 0 / 1 두 준위</text>
          <path d="M30,140 L30,90 L60,90 L60,140 L90,140 L90,90 L120,90 L120,140 L150,140 L150,90 L180,90 L180,140" fill="none" stroke="#1D9E75" strokeWidth="2"/>
        </svg>
      </div>
      <p className="rtl-guide-note">이 값 표현 차이가 그대로 배치·배선 규칙 차이로 이어집니다 — 위 CDAC 확대 사진의 "전부 똑같은 모양을 반복"하는 이유, 좌우 스위치 열의 대칭 배치 이유가 전부 여기서 나옵니다: 디지털은 0/1만 맞으면 되지만, 아날로그는 <b>소자 사이의 상대적 비율과 대칭성</b>이 곧 정확도입니다.</p>
    </section>

    <section className="card">
      <div className="card-title"><div><small className="kicker">실제적인 차이 요약</small><h2>이 회로로 확인한 것 vs chan_top(디지털)</h2></div></div>
      <div className="data-table"><table><thead><tr><th>항목</th><th>디지털 (chan_top)</th><th>아날로그 (이 ADC)</th></tr></thead><tbody>
        <tr><td>배치 단위</td><td>완성된 표준 셀 29,510개</td><td>트랜지스터/수동소자 99개, 수작업 배치</td></tr>
        <tr><td>배치 도구</td><td>RePlAce (자동, 경사하강법)</td><td>수동/전용 아날로그 툴 — 이 IP는 이미 손으로 배치된 완성 매크로</td></tr>
        <tr><td>전원 도메인</td><td>단일 (vdd/vss 격자 하나)</td><td>vdda/vssa(아날로그)와 vccd/vssd(디지털) <b>물리적으로 분리</b></td></tr>
        <tr><td>정확도의 기준</td><td>타이밍(setup/hold), 논리적 참/거짓</td><td>소자 간 상대 매칭 — 절대값이 아니라 비율 오차(%)</td></tr>
        <tr><td>신호 표현</td><td>0/1 두 준위 + 노이즈 마진</td><td>연속 전압, 잡음이 곧 오차로 직결</td></tr>
        <tr><td>이 세션에서 실제로 돌린 도구</td><td>Yosys → OpenROAD (synthesis→P&amp;R)</td><td>CACE(ngspice 기반 특성평가) → Magic DRC → Netgen LVS, 지금 LVS에서 <code>netgen</code> 오류로 blocked</td></tr>
      </tbody></table></div>
    </section>
  </>
}
