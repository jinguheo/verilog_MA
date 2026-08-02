const concepts = [
  ['CDC', '서로 다른 속도의 클록 회로 사이로 신호를 안전하게 전달하는 설계입니다.', '신호 누락·데이터 깨짐을 막기 위해 동기화기, handshake, 비동기 FIFO를 사용합니다.'],
  ['Lint', '코드를 실행하기 전에 실수하기 쉬운 패턴과 잠재적인 회로 오류를 찾는 자동 점검입니다.', '사용하지 않는 신호, 폭이 맞지 않는 연결, 의도하지 않은 latch를 초기에 발견합니다.'],
  ['Syntax / Compile', '문법, 파일, 포트 이름이 올바르게 연결됐는지 확인합니다.', '오타, 빠진 package, 잘못된 모듈 연결을 회로 실행 전에 찾습니다.'],
  ['Elaboration', 'parameter를 반영해 실제 생성될 모듈·포트·계층 구조를 펼쳐 보는 단계입니다.', '설정 조합에 따른 연결 오류와 회로 구조 문제를 확인합니다.'],
  ['Synthesis', 'RTL을 FF, MUX, 논리 게이트로 바꾸어 실제 회로로 만들 수 있는지 확인합니다.', '초기 면적·속도·전력에 영향을 주는 구조를 파악합니다.'],
] as const

const tools = [
  ['Verilator', '빠른 lint와 cycle simulation', '대형 RTL을 빠르게 검사하고 C++ 모델로 실행합니다.', '일상적인 빠른 피드백과 regression', '일부 고급 SystemVerilog/UVM 기능은 제약될 수 있습니다.'],
  ['Verible', '코딩 규칙과 스타일 점검', '형식, 파일·모듈 이름, 권장 작성 규칙에 강합니다.', '코드 작성 직후 품질 관리', '복잡한 회로 동작을 깊이 분석하는 도구는 아닙니다.'],
  ['Slang', '정확한 SystemVerilog 해석', 'package, parameter, interface, 계층 구조를 깊게 해석합니다.', 'compile/elaboration과 구조 분석', '시뮬레이션이 주 목적은 아닙니다.'],
  ['Yosys', '합성 가능성 및 논리 구조 확인', 'RTL이 게이트 수준 회로로 바뀔 수 있는지 확인합니다.', '합성 가능성 및 초기 구조 평가', '최종 면적·타이밍 정확도에는 PDK와 라이브러리가 필요합니다.'],
] as const

export default function RtlDesignGuide() {
  return <section className="rtl-guide">
    <div className="card"><div className="card-title"><div><small className="kicker">PLAIN-LANGUAGE GUIDE</small><h2>RTL Design에서 확인하는 기능</h2></div><span className="connection">설계 전 자동 점검</span></div><p className="rtl-guide-intro">RTL은 칩의 동작을 글로 설계하는 단계입니다. 아래 점검은 원하는 동작뿐 아니라 실제 회로로 안전하게 만들 수 있는지도 미리 확인합니다.</p><div className="rtl-concept-grid">{concepts.map(([term, description, result]) => <article key={term}><b>{term}</b><p>{description}</p><small><strong>주로 하는 기능</strong>{result}</small></article>)}</div></div>
    <div className="card"><div className="card-title"><div><small className="kicker">TOOL COMPARISON</small><h2>도구별 역할과 강점</h2></div></div><div className="rtl-tool-grid">{tools.map(([name, role, strength, best, caution]) => <article key={name}><header><b>{name}</b><span>{role}</span></header><p><strong>강점</strong>{strength}</p><p><strong>주로 사용할 때</strong>{best}</p><p><strong>유의점</strong>{caution}</p></article>)}</div><p className="rtl-guide-note">일반적으로 Verible로 작성 규칙을 맞추고, Verilator·Slang으로 오류와 구조를 확인한 뒤, Yosys로 합성 가능성을 점검합니다. 한 도구가 다른 도구를 완전히 대체하지는 않습니다.</p></div>
  </section>
}
