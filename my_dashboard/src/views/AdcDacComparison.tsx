const comparison = [
  ['변환 방향', '아날로그 전압/전류 → 디지털 코드', '디지털 코드 → 아날로그 전압/전류'],
  ['외부 입력', '센서 신호, 마이크, RF/계측 전압', 'CPU/FPGA/제어기의 N-bit 코드'],
  ['외부 출력', 'N-bit 데이터와 변환 완료 신호', '연속적인 전압 또는 전류'],
  ['대표 구조', 'SAR, Flash, Pipeline, Sigma-Delta', 'R-2R, Current-steering, Resistor-string, CDAC'],
  ['속도 결정 요소', '샘플링, 비교 횟수, comparator settling', '스위치 전환과 출력 settling time'],
  ['주요 오차', '양자화, 샘플 잡음, comparator offset', '소자 mismatch, glitch, 출력 buffer 오차'],
  ['핵심 지표', 'Sample rate, SNR/SNDR, ENOB, INL/DNL', 'Update rate, settling, SFDR, glitch, INL/DNL'],
] as const

const blocks = [
  ['S/H', 'Sample and Hold', '변환하는 동안 입력 전압을 고정', '일반적으로 없음'],
  ['SAR', 'Successive Approximation Register', 'MSB부터 시험값을 결정하는 디지털 제어기', '독립 DAC에는 없음'],
  ['CDAC', 'Capacitive DAC', 'SAR가 시험한 코드를 비교 전압으로 변환', 'DAC 구현 방식으로 직접 출력 전압 생성'],
  ['CMP', 'Comparator', '입력과 CDAC 전압의 크기를 1bit로 판정', '일반적으로 없음'],
  ['VREF', 'Reference Voltage', 'ADC 입력 범위와 각 코드 경계를 결정', '출력 full-scale과 각 코드 전압을 결정'],
  ['SW', 'Switch Matrix / Driver', 'CDAC 커패시터를 VREFH/VREFL에 연결', '입력 코드에 맞춰 저항·전류원·커패시터를 연결'],
  ['REG', 'Register', '최종 변환 코드를 보관하고 출력', '입력 코드를 안정적으로 유지'],
  ['BUF', 'Output Buffer', '대부분 디지털 출력이므로 불필요', '부하를 구동하고 출력 임피던스를 낮춤(선택 사항)'],
] as const

const glossary = [
  ['ADC', 'Analog-to-Digital Converter', '아날로그 입력을 디지털 코드로 변환'],
  ['DAC', 'Digital-to-Analog Converter', '디지털 코드를 아날로그 출력으로 변환'],
  ['SAR', 'Successive Approximation Register', '이진 탐색 방식으로 ADC 비트를 결정하는 로직'],
  ['CDAC', 'Capacitive DAC', '커패시터 배열로 코드를 전압으로 변환'],
  ['S/H', 'Sample and Hold', '입력을 샘플링하고 변환 동안 일정하게 유지'],
  ['CMP', 'Comparator', '두 전압의 대소를 1bit로 판정'],
  ['VREF', 'Reference Voltage', '변환 범위와 full-scale을 정하는 기준전압'],
  ['MSB / LSB', 'Most / Least Significant Bit', '가장 큰 가중치 비트 / 가장 작은 가중치 비트'],
  ['FS / FSR', 'Full Scale / Full-Scale Range', '변환기가 표현할 수 있는 전체 입력·출력 범위'],
  ['SNR', 'Signal-to-Noise Ratio', '신호 전력과 잡음 전력의 비'],
  ['SNDR', 'Signal-to-Noise-and-Distortion Ratio', '잡음과 왜곡을 모두 포함한 신호 품질'],
  ['ENOB', 'Effective Number of Bits', '잡음·왜곡을 반영한 실제 유효 해상도'],
  ['INL', 'Integral Non-Linearity', '이상적인 직선 전달함수에서 벗어난 최대 오차'],
  ['DNL', 'Differential Non-Linearity', '인접 코드 한 단계의 실제 폭이 1 LSB에서 벗어난 오차'],
  ['SFDR', 'Spurious-Free Dynamic Range', '기본 신호와 가장 큰 불요 성분 사이의 크기 차이'],
  ['THD', 'Total Harmonic Distortion', '출력에 포함된 전체 고조파 왜곡'],
] as const

function AdcDiagram() {
  return <svg viewBox="0 0 820 370" role="img" aria-label="SAR ADC 블록 회로도">
    <defs><marker id="adcArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>
    <rect className="converter-frame" x="15" y="20" width="790" height="325" rx="16"/>
    <g className="converter-block analog"><rect x="55" y="125" width="120" height="75" rx="10"/><text x="115" y="155">S/H</text><text x="115" y="180">Sample/Hold</text></g>
    <g className="converter-block analog"><rect x="245" y="125" width="135" height="75" rx="10"/><text x="312" y="155">CMP</text><text x="312" y="180">Comparator</text></g>
    <g className="converter-block mixed"><rect x="445" y="65" width="145" height="85" rx="10"/><text x="517" y="98">SAR Logic</text><text x="517" y="123">N-bit search</text></g>
    <g className="converter-block analog"><rect x="445" y="220" width="145" height="85" rx="10"/><text x="517" y="253">CDAC</text><text x="517" y="278">trial voltage</text></g>
    <g className="converter-block digital"><rect x="650" y="65" width="120" height="85" rx="10"/><text x="710" y="98">Output REG</text><text x="710" y="123">N-bit code</text></g>
    <g className="converter-lines"><path d="M25 162H55"/><path d="M175 162H245"/><path d="M380 162H420V108H445"/><path d="M590 108H650"/><path d="M517 150V220"/><path d="M445 263H410V185H380"/><path d="M690 305H590"/></g>
    <g className="converter-labels"><text x="27" y="148">VIN</text><text x="665" y="52">DOUT[N-1:0]</text><text x="625" y="298">VREFH/L</text><text x="395" y="100">1-bit</text></g>
  </svg>
}

function DacDiagram() {
  return <svg viewBox="0 0 820 370" role="img" aria-label="Capacitive DAC 블록 회로도">
    <defs><marker id="dacArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>
    <rect className="converter-frame" x="15" y="20" width="790" height="325" rx="16"/>
    <g className="converter-block digital"><rect x="60" y="125" width="130" height="80" rx="10"/><text x="125" y="158">Input REG</text><text x="125" y="183">N-bit code</text></g>
    <g className="converter-block mixed"><rect x="255" y="125" width="145" height="80" rx="10"/><text x="327" y="158">SW Driver</text><text x="327" y="183">switch control</text></g>
    <g className="converter-block analog"><rect x="465" y="90" width="150" height="150" rx="10"/><text x="540" y="135">CDAC Array</text><path className="capacitors" d="M495 160h20m0-18v36m18-18h20m0-28v56m18-28h20"/><text x="540" y="215">Σ weighted C</text></g>
    <g className="converter-block analog"><rect x="670" y="125" width="105" height="80" rx="10"/><text x="722" y="158">BUF</text><text x="722" y="183">optional</text></g>
    <g className="converter-lines dac"><path d="M25 165H60"/><path d="M190 165H255"/><path d="M400 165H465"/><path d="M615 165H670"/><path d="M775 165H805"/><path d="M540 300V240"/></g>
    <g className="converter-labels"><text x="27" y="150">DIN[N-1:0]</text><text x="735" y="150">VOUT</text><text x="490" y="320">VREFH/L</text></g>
  </svg>
}

export default function AdcDacComparison() {
  return <div className="adc-dac-page">
    <section className="card">
      <div className="card-title"><div><small className="kicker">ADC ↔ DAC</small><h2>같은 경계를 반대 방향으로 변환하는 회로</h2></div><span className="connection">Analog ⇄ Digital</span></div>
      <p>ADC는 현실의 전압을 디지털 시스템이 처리할 코드로 바꾸고, DAC는 디지털 코드로 현실의 전압이나 전류를 만듭니다. 둘 다 해상도와 기준전압을 사용하지만 신호 방향, 필요한 내부 블록과 핵심 성능 지표가 다릅니다.</p>
      <div className="data-table"><table><thead><tr><th>항목</th><th>ADC</th><th>DAC</th></tr></thead><tbody>{comparison.map(([item,adc,dac])=><tr key={item}><td><b>{item}</b></td><td>{adc}</td><td>{dac}</td></tr>)}</tbody></table></div>
    </section>

    <section className="card">
      <div className="card-title"><div><small className="kicker">BLOCK SCHEMATICS</small><h2>SAR ADC와 Capacitive DAC 내부 블록</h2></div></div>
      <div className="converter-diagrams"><figure><AdcDiagram/><figcaption><b>SAR ADC:</b> 입력을 고정한 뒤 SAR가 CDAC 시험 전압을 바꾸고 comparator 결과로 비트를 하나씩 확정합니다.</figcaption></figure><figure><DacDiagram/><figcaption><b>CDAC형 DAC:</b> 입력 코드를 switch driver가 해석하고 커패시터 가중합으로 출력 전압을 만든 뒤 필요하면 buffer가 부하를 구동합니다.</figcaption></figure></div>
      <p className="rtl-guide-note"><b>중요:</b> SAR ADC 안에는 내부 시험전압을 만드는 DAC가 필요합니다. 현재 회로에서는 그 역할을 CDAC가 합니다. 반대로 독립 DAC에는 입력과 비교할 필요가 없으므로 SAR와 comparator가 필요하지 않습니다.</p>
    </section>

    <section className="card">
      <div className="card-title"><div><small className="kicker">BLOCK BY BLOCK</small><h2>각 블록이 어디에 들어가는가</h2></div></div>
      <div className="data-table"><table><thead><tr><th>약어</th><th>전체 이름</th><th>SAR ADC에서</th><th>독립 DAC에서</th></tr></thead><tbody>{blocks.map(([abbr,name,adc,dac])=><tr key={abbr}><td><code>{abbr}</code></td><td><b>{name}</b></td><td>{adc}</td><td>{dac}</td></tr>)}</tbody></table></div>
    </section>

    <section className="card">
      <div className="card-title"><div><small className="kicker">ABBREVIATION GLOSSARY</small><h2>ADC/DAC에서 자주 쓰는 약어</h2></div></div>
      <div className="data-table"><table><thead><tr><th>약어</th><th>영문</th><th>의미</th></tr></thead><tbody>{glossary.map(([abbr,name,meaning])=><tr key={abbr}><td><code>{abbr}</code></td><td><b>{name}</b></td><td>{meaning}</td></tr>)}</tbody></table></div>
    </section>
  </div>
}
