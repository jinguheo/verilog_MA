# Windows-first execution policy

`Veriolg_MA`의 기본 control plane은 Windows입니다. 요구사항, agent, 지식 DB, AST/IR,
대시보드, 검증 계획, SVA 생성, review/triage는 Windows에서 실행합니다.

## Windows에서 우선 지원하는 기능

- customer requirements 분석과 acceptance criteria
- spec/architecture/RTL/verification/formal/review agent
- 기존 `D:\MyWork\verilog` knowledge artifact 조회
- Tree-sitter Verilog와 `pyslang` 기반 구조 분석
- cocotb/Verilator/Icarus 연동(도구가 설치된 경우)
- issue와 요구사항 traceability
- React/Vite dashboard

## Ubuntu로 남겨두는 기능

- OpenLane/OpenROAD
- PDK와 공정별 standard cell
- place & route
- Magic/KLayout DRC
- Netgen LVS
- GDSII/OASIS 제조 signoff

Ubuntu 기능은 Windows 코드와 분리된 job-manifest worker로 나중에 연결합니다. Windows agent는
도구 위치나 OS를 직접 가정하지 않고, `toolchain.py`의 capability 결과와 표준 artifact/log를 사용합니다.

## 점검

```powershell
.\windows_setup.ps1 -CheckOnly
```

## 설치 가능한 Python/Node 의존성

```powershell
.\windows_setup.ps1 -InstallPythonPackages -InstallNodePackages
```

관리자 권한이 필요한 Verilator/Icarus/Yosys/Docker는 시스템 설치 정책에 따라 별도로 설치합니다.
