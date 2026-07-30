# Veriolg_MA

기존 `D:\MyWork\verilog` 지식 플랫폼을 읽기 전용으로 활용하는 RTL 멀티에이전트 실행 계층입니다.

## 현재 agent

- Requirements Agent
- Architecture / Spec Agent
- RTL Agent
- Verification Agent
- Formal Agent
- Manufacturing Agent
- Independent Review Agent
- Issue/Triage Agent

기존 `rtl-orchestrator`, `rtl-knowledge-indexer`, `rtl-module-qa`, `rtl-design-generator`의 계약을 유지하면서, 우선 표준 라이브러리만으로 결정적 실행 경로를 제공합니다.

## 실행

```powershell
python .\cli.py --module fifo --requirements "- valid input is accepted\n- output preserves ordering"
```

기본 지식 DB 위치는 `D:\MyWork\verilog`입니다. `--knowledge-root`로 변경할 수 있습니다.

현재 adapter는 Graphify snapshot과 embedding artifact를 읽습니다. Postgres/Neo4j/vector API 연결은 동일한 `VerilogKnowledgeBase` 인터페이스 뒤에 추가합니다.

## 웹 대시보드

```powershell
python .\dashboard_server.py
```

브라우저에서 `http://127.0.0.1:8787/`을 열면 Graphify, Vector/Embedding,
Code KG/Postgres, Neo4j, OpenKB/Spec, RTL Source DB를 탭으로 확인할 수 있습니다.
대시보드는 파일 기반 artifact와 schema의 현재 상태를 읽기 전용으로 표시합니다.

React/Vite 기반 `my_dashboard` 형태의 화면은 [my_dashboard](my_dashboard) 아래에 있습니다.
기존 `D:\MyWork\my-dashboard`의 `src/components`, `src/views`, `src/services` 패턴에 맞춰
`Sidebar`, `KnowledgeDB`, `knowledgeDb` service로 분리했습니다.

현재 기본 운영 프로필은 [Windows-first 정책](docs/WINDOWS_FIRST.md)입니다. Windows에서 가능한
agent/지식 DB/AST/대시보드/검증 계획을 먼저 실행하고, OpenLane·PDK·DRC/LVS/GDSII만 향후
Ubuntu worker로 연결합니다.

## 구현 상태

각 agent 결과와 함께 `capabilities` 및 `gaps`가 출력됩니다. `implemented`는 현재 동작,
`partial`은 계획/분석 일부만 동작, `external-required`는 외부 EDA/DB 환경이 필요한
영역입니다. 구현되지 않은 기능을 완료된 것으로 보고하지 않습니다.

상세 상태는 [capabilities.py](capabilities.py)에 있습니다.
