"""Explicit implementation boundary for every Veriolg_MA agent."""

CAPABILITIES = {
    "requirements-agent": {
        "label": "요구사항 분석",
        "status": "partial",
        "implemented": ["입력 텍스트를 요구사항 ID로 분리", "기본 검증 방법 연결", "짧은 입력 경고",
                        "정형화된 수용 기준(acceptance criteria) 생성",
                        "contracts/requirement.schema.json 및 contracts/issue.schema.json 대비 자동 검증"],
        "missing": ["문서/Spec DB 질의", "요구사항 충돌 분석", "모호성 정교화"],
        "external_required": ["OpenKB 또는 Spec API 연결"],
    },
    "architecture-agent": {
        "label": "아키텍처/스펙",
        "status": "partial",
        "implemented": ["인터페이스·클럭·리셋·latency 검토 항목 생성"],
        "missing": ["실제 마이크로아키텍처 제안", "레지스터 맵 생성", "대안 비교", "PPA 예측"],
        "external_required": ["기존 RTL KG와 유사 블록 검색"],
    },
    "rtl-agent": {
        "label": "RTL 설계",
        "status": "partial",
        "implemented": ["기존 Graphify/embedding artifact 조회", "RTL 설계 계획 생성",
                        "rtl_file이 주어지면 verilator lint 실행 및 결과 evidence 기록"],
        "missing": ["SystemVerilog 파일 생성", "patch 기반 수정", "lint 오류 자동 수정", "compile context 사용"],
        "external_required": ["rtl-design-generator 실행 계약 연결"],
    },
    "verification-agent": {
        "label": "검증",
        "status": "partial",
        "implemented": ["요구사항별 cocotb/Verilator 테스트 계획 생성",
                        "rtl_file이 주어지면 verilator/iverilog로 실제 시뮬레이터 실행 및 결과 evidence 기록"],
        "missing": ["실제 테스트벤치 파일 생성", "coverage 수집", "waveform 분석"],
        "external_required": ["cocotb와 Verilator 설치"],
    },
    "uvm-scenario-agent": {
        "label": "UVM scenario planning",
        "status": "partial",
        "implemented": ["requirements-based scenario plan", "reset/nominal/negative/stress baseline"],
        "missing": ["SystemVerilog sequence generation", "scenario execution", "result scoring"],
        "external_required": ["UVM-capable SystemVerilog simulator"],
    },
    "uvm-environment-agent": {
        "label": "UVM testbench topology",
        "status": "partial",
        "implemented": ["UVM component manifest", "DUT/interface binding plan"],
        "missing": ["driver/monitor/scoreboard source generation", "simulator compile"],
        "external_required": ["UVM library", "SystemVerilog simulator"],
    },
    "uvm-coverage-agent": {
        "label": "UVM coverage planning",
        "status": "partial",
        "implemented": ["covergroup/coverpoint/cross plan", "coverage closure target"],
        "missing": ["covergroup implementation", "coverage database collection"],
        "external_required": ["coverage-capable SystemVerilog simulator"],
    },
    "uvm-regression-agent": {
        "label": "UVM regression planning",
        "status": "partial",
        "implemented": ["smoke/feature/nightly test matrix", "pass/fail gates"],
        "missing": ["regression runner", "seed execution and aggregation"],
        "external_required": ["UVM simulator runner", "CI or regression host"],
    },
    "formal-agent": {
        "label": "Formal/Security",
        "status": "partial",
        "implemented": ["기본 property 후보 생성"],
        "missing": ["SVA 파일 생성", "SymbiYosys 실행", "counterexample 분석", "보안 property 체계화"],
        "external_required": ["Yosys/SymbiYosys 실행환경"],
    },
    "manufacturing-agent": {
        "label": "제조/물리설계",
        "status": "external-required",
        "implemented": ["RTL-to-GDS 검사 항목과 flow 계획 생성"],
        "missing": ["합성 실행", "area/timing 산출", "OpenLane 실행", "DRC/LVS 파싱"],
        "external_required": ["PDK", "Docker/WSL", "Yosys/OpenLane/OpenROAD"],
    },
    "review-agent": {
        "label": "독립 리뷰",
        "status": "partial",
        "implemented": ["다른 agent의 issue 수집", "reviewer 표시"],
        "missing": ["독립 evidence retrieval", "생성 결과와 실제 파일 비교", "false-positive 판정"],
        "external_required": ["실행 로그와 artifact 저장소"],
    },
    "triage-agent": {
        "label": "Issue/Triage",
        "status": "implemented",
        "implemented": ["issue 병합 수집", "severity 정렬", "재실행/human approval 다음 단계 제시",
                        "파일 기반 영속 issue DB (issue_store.py)", "category+finding 기반 duplicate fingerprint"],
        "missing": ["자동 담당자 라우팅"],
        "external_required": [],
    },
    "knowledge-base-adapter": {
        "label": "기존 Verilog 지식 DB 연결",
        "status": "partial",
        "implemented": ["Graphify snapshot 조회", "embedding artifact 조회", "health check"],
        "missing": ["Postgres adapter", "Neo4j traversal", "Vector API 호출", "OpenKB late-binding query"],
        "external_required": ["기존 runtime/API 기동"],
    },
}


def capability_report():
    counts = {"implemented": 0, "partial": 0, "external-required": 0, "missing": 0}
    for item in CAPABILITIES.values():
        counts[item["status"]] = counts.get(item["status"], 0) + 1
    return {"items": CAPABILITIES, "counts": counts}
