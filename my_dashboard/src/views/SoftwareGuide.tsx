type Guide = { function: string; strength: string; comparison: string }

const guides: Record<string, Guide> = {
  'Verilator': { function: 'RTL lint와 빠른 cycle 기반 시뮬레이션을 수행합니다.', strength: '대형 설계의 빠른 피드백과 regression에 강합니다.', comparison: 'Icarus보다 정적 검사와 실행 속도에 강하고, 상용 UVM simulator보다 고급 기능은 제한될 수 있습니다.' },
  'Verible': { function: 'SystemVerilog 형식, 스타일, 작성 규칙을 자동 점검합니다.', strength: '코드가 팀 규칙에 맞고 읽기 쉽게 유지되도록 돕습니다.', comparison: 'Verilator·Slang이 회로 구조를 더 깊게 해석하는 것과 달리, Verible은 작성 품질에 집중합니다.' },
  'Slang / pyslang': { function: 'SystemVerilog 문법과 모듈 계층을 정확하게 해석합니다.', strength: 'package, parameter, interface 연결 문제를 상세하게 찾습니다.', comparison: 'Verible보다 언어·구조 분석이 깊고, Verilator처럼 주로 시뮬레이션 속도에 초점을 두지는 않습니다.' },
  'Slang': { function: 'SystemVerilog 문법, parameter, package, 계층 구조를 해석합니다.', strength: 'compile/elaboration 오류를 구체적으로 진단합니다.', comparison: 'Verible의 스타일 점검보다 구조 분석이 깊고, Verilator의 빠른 simulation과 역할이 다릅니다.' },
  'Yosys': { function: 'RTL을 논리 게이트 구조로 변환해 합성 가능한지 확인합니다.', strength: '초기 구조, 셀 사용량, 합성 가능성을 오픈소스로 빠르게 확인합니다.', comparison: 'Verilator가 동작 검증에 강하다면, Yosys는 실제 회로 구조로 바꿀 수 있는지에 강합니다.' },
  'cocotb': { function: 'Python으로 RTL testbench와 scoreboard를 작성·실행합니다.', strength: '소프트웨어 개발 방식으로 테스트를 빠르게 작성하고 자동화하기 쉽습니다.', comparison: 'UVM보다 진입 장벽이 낮고 Python 생태계를 쓰기 좋지만, 표준 UVM 구성과 coverage DB는 별도 환경이 필요합니다.' },
  'Icarus Verilog': { function: '기본 Verilog/SystemVerilog 컴파일과 시뮬레이션을 수행합니다.', strength: '가볍고 간단한 directed test를 빠르게 실행할 수 있습니다.', comparison: 'Verilator보다 고급 lint·성능 면에서 단순하지만, 작은 테스트를 시작하기에는 부담이 적습니다.' },
  'UVM simulator': { function: 'SystemVerilog UVM test, sequence, scoreboard, coverage를 실행합니다.', strength: '대규모 검증 환경과 표준화된 재사용 구조에 적합합니다.', comparison: 'cocotb는 Python 중심의 간결한 테스트에, UVM은 복잡한 칩 검증의 조직화와 재사용에 강합니다.' },
  'SymbiYosys': { function: 'RTL property proving, bounded model checking, cover 분석을 실행합니다.', strength: '많은 입력 조합을 수학적으로 탐색해 simulation이 놓칠 수 있는 반례를 찾습니다.', comparison: 'Simulation은 정한 시나리오를 실행하고, formal은 가능한 상태 공간을 증명·반례 탐색합니다.' },
  'OpenKB / Spec DB': { function: '요구사항·사양 문서를 검색하고 근거를 연결합니다.', strength: '문서 기반 결정의 출처를 추적하기 좋습니다.', comparison: 'Graphify가 관계 구조를 보여준다면, Spec DB는 원문 요구사항과 근거 확인에 초점을 둡니다.' },
  'JSON Schema': { function: '요구사항과 issue 데이터의 필수 항목·형식을 검증합니다.', strength: '문서 데이터가 일정한 구조를 유지하도록 막아 줍니다.', comparison: 'Spec DB가 내용을 관리한다면, JSON Schema는 데이터 형식의 오류를 막습니다.' },
  'Graphify': { function: '문서·코드의 연결 관계를 그래프로 탐색합니다.', strength: '변경된 모듈과 관련 요구사항·문서를 함께 추적합니다.', comparison: 'Code KG와 목적은 비슷하지만, Graphify는 문서와 코드의 넓은 관계 탐색에 적합합니다.' },
  'Code KG / Graphify': { function: '기존 RTL 블록과 하위 모듈의 관계를 탐색합니다.', strength: '재사용 가능한 설계 구조를 빠르게 파악합니다.', comparison: 'Slang이 코드 자체를 해석한다면, Code KG는 저장된 구조 관계를 탐색하는 데 강합니다.' },
  'OpenLane / OpenROAD': { function: 'floorplan부터 routing까지 물리 설계를 자동화합니다.', strength: 'PDK가 준비되면 오픈소스 physical implementation 흐름을 제공합니다.', comparison: 'Yosys는 RTL 합성까지만 담당하고, OpenLane/OpenROAD는 배치·배선 같은 물리 구현을 담당합니다.' },
  'Docker / WSL': { function: 'EDA 도구와 PDK 실행 환경을 일관되게 만듭니다.', strength: '팀·PC마다 달라질 수 있는 설치 환경을 재현하기 쉽습니다.', comparison: 'EDA 도구 자체가 아니라 도구를 안정적으로 실행시키는 환경 계층입니다.' },
  'PDK': { function: '특정 반도체 공정의 라이브러리, 배선 규칙, 검증 규칙을 제공합니다.', strength: '실제 제조 가능한 타이밍·면적·DRC/LVS 결과의 기준이 됩니다.', comparison: 'Yosys 같은 도구가 회로를 만들고, PDK는 그 회로를 어느 공정에서 어떻게 만들지 정의합니다.' },
  'Issue store': { function: '발견한 문제를 분류하고 중복을 관리합니다.', strength: '누락 없이 담당자·심각도·해결 상태를 추적합니다.', comparison: 'Git이 코드 변경을 관리한다면, Issue store는 해결해야 할 문제를 관리합니다.' },
  'Git': { function: '코드와 문서의 변경 이력, 검토, branch를 관리합니다.', strength: '누가 언제 무엇을 바꿨는지 재현하고 검토하기 쉽습니다.', comparison: 'Issue store가 할 일을 관리한다면, Git은 실제 변경 내용을 관리합니다.' },
}

export default function SoftwareGuide({ names }: { names: string[] }) {
  const items = names.flatMap(name => guides[name] ? [[name, guides[name]] as const] : [])
  if (!items.length) return null
  return <section className="card software-guide"><div className="card-title"><div><small className="kicker">TOOL GUIDE & COMPARISON</small><h2>이 화면에서 사용하는 도구는 무엇을 하나요?</h2></div></div><div className="software-guide-grid">{items.map(([name, guide]) => <article key={name}><b>{name}</b><p><strong>기능</strong>{guide.function}</p><p><strong>강점</strong>{guide.strength}</p><p><strong>차이</strong>{guide.comparison}</p></article>)}</div></section>
}
