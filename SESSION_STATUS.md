# Veriolg_MA 작업 상태

작성일: 2026-07-29

## 오늘 완료한 내용

- Windows-first 멀티에이전트 구조 구현
  - Requirements Agent
  - Architecture Agent
  - RTL Agent
  - Verification Agent
  - Formal Agent
  - Manufacturing Agent
  - Review Agent
  - Triage Agent
- 고객 요구사항 분석 기능 추가
  - 기능/비기능/인터페이스 분류
  - 요구사항 ID 생성
  - acceptance criteria 생성
  - 모호한 표현 및 수치 없는 성능 요구사항 탐지
- 기존 `D:\MyWork\verilog` 지식 DB 연결
  - Graphify snapshot
  - Embedding artifact
  - Code KG/Postgres schema
  - Neo4j schema
  - OpenKB/Spec 문서
  - RTL source DB
- React/Vite 기반 지식 DB 대시보드 구현
- DB 탭별 상태, 경로, 파일 수, 운영 형태 표시
- simulator/EDA toolchain 탐지 기능 구현
- 설계 readiness gate 구현
- Windows native 환경 점검 스크립트 추가
- OSS CAD Suite를 다음 경로에 배치

```text
D:\MyWork\Veriolg_MA\oss-cad-suite
```

- 감지된 도구
  - Verilator
  - Icarus Verilog
  - Yosys
  - SymbiYosys
  - cocotb
  - pyslang
  - tree-sitter-verilog
- Docker Desktop 사용자 모드 설치 완료
- WSL2 Ubuntu 설치 및 기본 배포판 설정 완료
- React production build 성공
- Python tests 3개 통과

## 현재 실행 명령

EDA 환경 활성화:

```powershell
cd D:\MyWork\Veriolg_MA
powershell.exe -ExecutionPolicy Bypass -NoExit -File .\start_windows_eda.ps1
```

대시보드 API:

```powershell
python .\dashboard_server.py
```

React 대시보드:

```powershell
cd D:\MyWork\Veriolg_MA\my_dashboard
npm.cmd run dev
```

WSL Ubuntu 접속:

```powershell
wsl -d Ubuntu
```

## 아직 남은 작업

1. Windows에서 실제 RTL sample simulation 실행
2. cocotb testbench 생성/실행 runner 연결
3. Verilator lint 결과 parser 연결
4. Yosys synthesis 결과 parser 연결
5. SymbiYosys 실행 wrapper 안정화
6. Postgres/Neo4j 실제 서비스 연결
7. Ubuntu에서 OpenLane/OpenROAD 설치
8. PDK 설치 및 RTL-to-GDSII smoke test
9. DRC/LVS 결과를 dashboard에 표시
10. Windows agent가 Ubuntu worker에 job manifest를 보내는 구조 구현

## 내일 시작할 지점

Windows 작업은 현재 상태를 유지하고, Ubuntu에서 다음 명령으로 환경을 확인한다.

```bash
wsl -d Ubuntu
cd /mnt/d/MyWork/Veriolg_MA
docker version
```

그 다음 OpenLane/OpenROAD 설치와 PDK smoke test를 진행한다.
