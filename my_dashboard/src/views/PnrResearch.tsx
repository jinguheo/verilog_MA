// P&R 연구 탭 — "현재(flat) 방식 vs hierarchical(macro) 방식"을 나란히 비교하고,
// 후보군을 최대한 병렬로 많이 돌리면서 가능성 없는 것들을 빠르게 버리는 깔때기
// (funnel) 탐색 구조를 설계한다. 이 탭은 실행 결과가 아니라 설계 문서 — 각 단계가
// "검증됨"인지 "제안됨"인지를 명시한다. 2026-09-18 작성.

const approaches = [
  ['현재 (Flat)', 'daq_subsystem 8채널 전체를 매번 통째로 재합성·재배치·재라우팅', '단순함, 전역 최적화 가능(매크로 경계에 갇히지 않음)', '셀 수 증가에 비선형으로 시간 증가 실측(chan_ctrl→chan_top 약 22배 셀에 22배보다 훨씬 큰 시간) · 4번째 시도까지 한 번도 완주 못 함(세션/호스트 종료로 중단, 실제 flow 에러 아님) · 위반이 있으면 원인 위치를 8채널 전체에서 다시 찾아야 함 · 향후 기능 변경/면적 조정도 매번 전체 재합성(체크포인트 재개 불가)'],
  ['Hierarchical (Macro)', 'chan_top을 1번만 hardening → GDS/LEF/LIB/SPEF 확보 → daq_subsystem에서 OpenLane MACROS로 8번 배치, 나머지 로직(dma_sched 등)만 top에서 새로 P&R', '1회 P&R + 8회 저렴한 매크로 배치로 시간 절감 예상 · 각 채널 타이밍이 독립적으로 확정(전체 재검증 불필요) · chan_top 자체가 이미 검증된 블록이라 위반 원인 추적 범위가 좁아짐 · top 레벨만 바뀌는 향후 기능 변경/ECO 시 8개 매크로는 그대로 재사용(2026-09-23 확인 — flat은 이게 불가능)', '매크로 경계를 넘는 경로는 수동 IO 타이밍 budget 필요(daq_subsystem.sdc에 이미 일부 작성됨) · chan_top이 먼저 worst-corner까지 닫혀야 의미 있음(안 닫힌 블록 8배 복제는 위반만 8배) — 셋업 타이밍은 닫힘, 안테나 1건 재검증 중(2026-09-23) · 매크로 배치(어디에 8개를 놓을지) 자체가 별도 최적화 문제 — ParSAC(SA 기반)로 풀 예정'],
] as const

const funnelStages = [
  ['0. 후보 생성', '설계 공간을 명시적으로 나열', 'Flat: SYNTH_STRATEGY(9) × PL_TARGET_DENSITY_PCT(예: 30/40/50) × clock period 후보 — 최대 수십~백 개 조합.  Hierarchical: 매크로 배치 후보(ParSAC SA restart마다 다른 배치) × 채널당 SYNTH_STRATEGY', '제안됨 — 조합 명시만 하면 나머지 단계는 이미 만든 스크립트 재사용', '해당 없음 (생성 단계, EDA 실행 없음)'],
  ['1. 초저가 필터', '어떤 EDA 툴도 완주 없이, 초~분 단위로 전량 실행', 'Flat: openlane --flow SynthesisExploration (합성+STAPrePNR만, wire delay 없음) — 9개 전략을 병렬 스레드풀로 한 번에.  Hierarchical: ParSAC의 ParallelSearch가 이미 N개 SA worker를 병렬로 돌려 비용(wirelength+whitespace)이 낮은 배치만 남김 — OpenLane/OpenROAD 자체를 아예 안 씀', '검증됨(Flat) — 107_synth_explore.sh로 chan_ctrl/cnt_sat/skid_buffer 9개 전략을 25~30초에 비교 완료.  미착수(Hierarchical) — ParSAC 설치·글루코드 필요', 'pre-placement worst slack이 목표 기준 대비 음수로 크게 벌어짐 + area가 현재 최선 후보보다 나쁨 → 즉시 버림'],
  ['2. 재시간측정 필터', '기존에 이미 라우팅된 참조 넷리스트의 실제 DEF+SPEF를 그대로 읽고, 후보 SDC(주기 등)만 바꿔서 초 단위로 재계산 — 새 P&R 없음', 'chan_top.sdc를 그대로 source하되 src_period/axi_period 두 줄만 sed로 바꿔서 OpenSTA만 재실행 — 이번 세션에 axi 32→48ns/src 10→12ns가 실제로 plateau 없이 선형 개선됨을 이 방법으로 확인함', '검증됨 — 같은 netlist를 다른 목표로 재검사하는 것의 함정(6/10-targeted netlist를 32/10 기준으로 착각)도 이번에 직접 겪고 고침. 반드시 "이 재검사가 어떤 target으로 P&R된 netlist인지" 먼저 확인하고 씀', '같은 계열(같은 구조, 주기/코너만 다름) 후보에서 TNS>0 또는 목표 slack 미달 → 버림. 구조가 다른 새 후보(다른 전략/매크로 배치)는 이 단계를 건너뛰고 3단계에서 최소 1개는 반드시 검증'],
  ['3. 전체 P&R', '진짜 synthesis+floorplan+placement+CTS+routing+DRC/LVS+signoff STA — 살아남은 후보만, 비용이 가장 큼(블록당 25~40분)', '109_run_full_pnr.sh / 111_run_chan_top_safe.sh 같은 race-safe(블록별 독립 shim) 러너로 실행', '검증됨 — chan_ctrl/cnt_sat SYNTH_STRATEGY 재검증에 이미 사용, 결과가 pre-placement 예측과 실제로 다를 수 있음도 확인(면적 방향 반전 등) → 이 단계 없이 "최종"이라고 부르면 안 됨', '해당 없음 (최종 후보만 여기 도달 — 버리는 단계가 아니라 확정하는 단계)'],
  ['4. Flat vs Hierarchical 맞대결', '3단계를 통과한 두 트랙의 최선 후보를 실제 signoff 수치로 직접 비교', '면적/최악 slack/TNS + (아직 실측 없는) power', '미착수 — hierarchical 트랙이 아직 1단계도 안 감', '해당 없음'],
] as const

const concurrency = [
  ['1~2단계 (저가)', '거의 무제한 — 8코어 기준 8~16개 동시 실행 가능', '각 작업이 짧고 단일 스레드(OpenSTA 1회 실행) 또는 순수 CPU SA라서 서로 거의 경합 안 함'],
  ['3단계 (전체 P&R)', '사실상 1개 — 후보 여러 개를 동시에 돌려도 이득이 없을 가능성이 높음', 'SynthesisExploration 3개 동시 실행 실측: 8코어에서 1.43배 속도 향상(3배 아님)에 그쳤는데, 그건 그나마 가벼운 합성 단계였다. 전체 P&R 안에서 KLayout DRC 단계 자체가 실제로 `-threads 8`로 이미 8코어 전부를 씁니다(runtime.txt 실측: 이 한 단계만 6분08초) — 후보 하나의 P&R이 이미 이 순간 머신 전체를 쓰므로, 두 번째 후보를 동시에 돌리면 그 시점엔 8개 스레드를 16개로 나눠 쓰게 되어 오히려 각자 더 느려질 수 있다. 후보를 여러 개 찾아도 "동시에 다 돌리기"가 아니라 "빠른 필터(0~2단계)로 최대한 거른 뒤 3단계는 순차로 하나씩" 쪽이 이 머신 규모에 맞다 — 사용자 지적(2026-09-21)대로, CPU 자원이 병렬화의 실질적 한계다.'],
] as const

const races = [
  ['공유 shim 경로 재사용 금지', '$HOME/.cache/openlane-tools/bin을 여러 후보가 동시에 rm -rf + 재생성하면 서로의 심볼릭 링크를 지움 — 이미 2번 실제로 겪은 버그', '후보(블록)별 독립 경로($HOME/.cache/openlane-tools-<후보명>/bin) + 이미 있으면 재생성 안 함(idempotent) — 107/109/111번 스크립트에 이미 적용된 패턴, 새 후보 러너도 그대로 재사용'],
  ['run 디렉터리 충돌 없음', 'OpenLane이 자체적으로 asic/<design>/runs/RUN_<timestamp>/를 만들어서 후보끼리 겹칠 일 없음', '이미 확인됨 — 별도 조치 불필요'],
  ['peer 세션과의 리소스 경합', '이 프로젝트는 다른 세션(daq_subsystem 등)과 같은 8코어/WSL을 공유', '큰 배치 실행 전 ListAgents로 활성 세션 확인 + SendMessage로 셰어드 리소스(공유 shim, CPU 부하) 조율 — 이번 세션에서 실제로 이렇게 조율해서 충돌 회피함'],
] as const

const status = [
  ['Flat 트랙 1~3단계', '검증됨', 'chan_ctrl/cnt_sat/skid_buffer로 1~3단계 전부 실행·검증 완료. chan_top은 RTL 파이프라이닝(ch_cause_o 레지스터화) + src_period 14ns로 전 코너 셋업 타이밍 완전 클로징, 안테나 위반 1건 strategy 6으로 재검증 중(라이브)'],
  ['daq_subsystem — flat, worst-corner 부분 검증', '진행 중 (참고용)', '12/48ns 목표로 라이브 실행 중(`--to STAMidPNR-3`) — hierarchical을 기본 방향으로 정한 뒤에도 완주까지 지켜보고 4단계 맞대결의 flat측 데이터로 사용. 능동적으로 더 투자하진 않음'],
  ['Hierarchical 트랙', '결정됨 — 기본 방향, chan_top 최종 확인 대기 중', '2026-09-23: daq_subsystem의 기본 구현 방향을 hierarchical로 확정(사용자 결정). ParSAC(IntelLabs, Apache 2.0) 설치 완료 — 매크로 floorplanning 전용 SA 도구, OpenLane MACROS와 연결하는 글루코드가 다음 실제 작업. 게이트: chan_top의 안테나 위반 1건이 strategy 6으로 닫히는지 확인 후 매크로로 굳힘'],
  ['4단계 맞대결', '미착수', 'Hierarchical 1단계부터 선행 필요 — daq_subsystem flat 결과가 나오면 비교 기준으로 사용'],
] as const

// RePlAce 대안(GPU 가속 DREAMPlace) 조사 — 실제 설치·빌드·실행까지 해봤으나
// 이 프로젝트 규모엔 안 맞는다는 결론 (2026-09-21).
const dreamplaceEval = [
  ['설치·빌드', '완료', 'WSL에 소스 빌드 — 과정에서 CUDA 12.4 환경의 실제 버그 4개를 찾아 수정함: (1) 동봉된 구버전 CUB이 새 CUDA의 CCCL 기반 CUB과 네임스페이스 충돌 (2) 그 구버전 CUB이 CUDA 12에서 제거된 legacy texture reference API 사용 (3) DreamPlace가 하드코딩한 구버전 C++ ABI가 실제 torch 휠의 신버전 ABI와 불일치 (4) NumPy 2.0에서 제거된 np.string_ 사용. 전부 패치 완료, place_io/global_swap 등 컴파일된 CUDA 확장 모듈 전부 정상 로드 확인'],
  ['실제 배치 테스트', '완료 — 결론은 부정적', 'chan_ctrl(116셀) 실제 sky130 LEF/DEF로 end-to-end 테스트: 1차 시도는 IO 핀 배치 전 단계(step 13) DEF를 잘못 써서 가비지 좌표로 실패, 원인 찾아 올바른 단계(step 24, ioplacement 이후)로 수정 후 재시도 — 파이프라인 자체는 정상 작동(LEF/DEF 파싱·GPU 연산 전부 성공)하지만 1000 iteration 안에 수렴 못 함(overflow 0.51, 목표 0.07). RePlAce는 같은 설계를 5.7초에 끝냄'],
  ['최종 판단', '이 프로젝트엔 부적합', 'DreamPlace는 수만~수백만 셀 규모에서 GPU 병렬성으로 이득을 보는 도구. 이 프로젝트 최대 설계(daq_subsystem)도 ~10만 셀로 경계선이고, 실제 소블록들(chan_ctrl 등)은 수백 셀 — RePlAce가 이미 몇 초 안에 안정적으로 끝내는 규모라 GPU 가속의 이득보다 빌드 취약성(CUDA/ABI/NumPy 버전 의존)과 설계별 hyperparameter 재조정 비용이 더 큼. 이 세션에서 실제로 확인한 진짜 병목(daq_subsystem이 flat 방식으론 완주 자체를 못 함)도 placement 알고리즘 속도가 아니라 구조적 문제라 hierarchical 접근(ParSAC)이 더 맞는 방향'],
] as const

// ParSAC(매크로 floorplanner) — 설치는 완료했지만, 현재(flat) 구조에서는
// "매크로"라는 개념 자체가 없어서 투입할 대상이 없다는 판단 (2026-09-21).
const parsacEval = [
  ['설치', '완료', 'WSL에 uv 기반 Python 3.9 venv, torch 2.7.1+cu126, RTX 3090 인식 확인 — 가볍게 끝남(C++ SA 코어는 첫 실행 시 자동 컴파일, DreamPlace 같은 CMake 풀빌드 불필요)'],
  ['현재 구조에서의 용도', '없음 — 투입 대상 자체가 없음', 'ParSAC은 "이미 굳힌 매크로 N개를 어디에 배치할지" 푸는 도구. 지금 daq_subsystem은 8채널을 flat하게 통째로 재합성하는 방식이라 "매크로"라는 대상 자체가 존재하지 않음 — 도구 성능과 무관하게 풀 문제가 없는 상태'],
  ['전제조건', 'chan_top worst-corner 완전히 닫혀야 함', '안 닫힌 블록을 매크로로 굳혀서 8번 복제하면 위반만 8배가 됨(RESULTS.md에 이미 기록된 교훈) — hierarchical 전환 자체가 이 전제조건에 걸려있어서, ParSAC 투입 여부도 자동으로 같이 대기 상태'],
] as const

// "언제 어떤 도구를 쓰나" — 지금까지 조사·실측한 것 종합한 선택 가이드.
const toolGuide = [
  ['표준셀(cell) 배치 — 지금 모든 블록', 'RePlAce (OpenROAD 기본)', '이미 검증됨. 이 프로젝트 규모(수백~10만 셀)에서 몇 초~수십 분 안에 안정적으로 끝남. 재고려할 이유 없음'],
  ['GPU 가속 셀 배치가 필요한가?', '불필요 — DreamPlace 쓰지 않음', '실측 완료(위 표): 소블록에서 RePlAce보다 느리고 수렴도 안 됨. 재검토 시점: 단일 블록이 향후 50만 셀 이상으로 커지는 경우뿐 — 이 프로젝트 로드맵엔 없음'],
  ['매크로(hardened block) 배치 위치 결정', 'ParSAC — 단, hierarchical 전환 후에만', '지금은 투입 대상(매크로) 자체가 없음. chan_top이 worst-corner까지 닫히고 hierarchical로 실제 전환할 때 재검토'],
  ['daq_subsystem 8채널을 어떻게 P&R할까', '지금은 RePlAce 기반 flat 그대로 (배치 알고리즘 문제 아님)', '진짜 병목은 "flat 방식이 완주 자체가 안 됨"이라는 구조적 문제 — 어떤 placement 알고리즘을 쓰든 안 풀림. chan_top이 닫히면 그때 hierarchical+ParSAC로 재검토'],
  ['합성 전략(SYNTH_STRATEGY) 탐색', 'OpenLane 내장 SynthesisExploration', '이미 검증·적용 완료(chan_ctrl/cnt_sat). 별도 외부 도구 불필요'],
  ['클럭 주기 확정', 'sed로 주기만 바꿔 재시간측정(2단계 필터)', 'chan_top 12/48→52ns 확정에 실제로 쓴 방법. 새 P&R 없이 초 단위로 후보를 거를 수 있음'],
] as const

// RePlAce(전역 배치) 이후 실제 실행 구조 — chan_top 완주 런
// (RUN_2026-09-20_21-14-08, 71분20초) 자체 runtime.txt에서 그대로 뽑은
// 실측치. 추정이 아니라 실제 로그값. 2026-09-21 작성.
const postReplaceSteps = [
  ['0', 'RePlAce (Global Placement)', '2분06초', 125, '#7F77DD', '셀들을 칩 영역에 실제로 퍼뜨리는 전역 배치 — 이전 섹션에서 설명한 정전기 밀도 모델 + Nesterov 경사하강'],
  ['1', '배치 마무리', '1분25초', 85, '#7F77DD', 'STA 체크포인트 → 배치 직후 타이밍 위반 1차 수리(RepairDesignPostGPL) → 합법화(DetailedPlacement, 표준 셀을 정확한 행/그리드에 정렬)'],
  ['2', 'CTS (클록 트리 합성)', '53초', 53, '#7F77DD', '클록을 모든 플립플롭까지 균일한 지연으로 퍼뜨리는 버퍼 트리 생성'],
  ['3', '포스트-CTS 타이밍 리페어', '23분10초', 1390, '#E24B4A', '실제 배선 지연이 반영된 뒤 남은 setup/hold 위반을 버퍼 삽입·셀 교체·핀 스왑으로 반복 수리 — 위반이 많을수록 반복 횟수가 늘어 시간이 비선형으로 증가. 이번 런 전체 시간의 약 1/3'],
  ['4', '라우팅', '11분26초', 686, '#378ADD', 'Global Routing(대략 경로) → antenna 위반 체크 + 다이오드 삽입 → Detailed Routing(실제 금속 배선 확정)'],
  ['5', '후처리 정리', '2분31초', 151, '#378ADD', '미사용 라우팅 영역에 필러 셀 삽입, 배선 길이·연결성 리포트'],
  ['6', '기생성분 추출 + 최종 STA', '3분53초', 233, '#1D9E75', '실제 배선 형상에서 R/C 기생성분 추출(RCX) → 그 값으로 최종 signoff 타이밍 검증(STAPostPNR), IR drop 리포트'],
  ['7', 'GDS 생성 + 물리 검증', '22분38초', 1358, '#E24B4A', 'Magic/KLayout으로 GDS 생성·XOR 비교 → Magic DRC(8분39초) + KLayout DRC(6분08초) 이중 검증 → SPICE 추출 → Netgen LVS. 이번 런 전체 시간의 또 다른 1/3'],
  ['8', '최종 체크 리포트', '<1초', 1, '#888780', 'setup/hold/slew/cap 위반 집계, 제조 가능성 리포트'],
] as const

const parallelizationNotes = [
  ['이 8단계 자체는 순차적으로만 가능', '각 단계가 이전 단계의 물리적 데이터베이스(배치 결과, 배선 결과)를 입력으로 받는다 — CTS를 라우팅보다 먼저 할 수 없는 것과 같은 이유. 병렬화 대상이 아니다.'],
  ['이미 내부적으로 병렬화되어 있는 부분', 'STA 체크포인트(STAMidPNR 등)는 9개 PVT 코너를 이미 동시에 계산한다 — 별도 조치 불필요, 이미 최적.'],
  ['이론적으로는 가능하지만 OpenLane 기본 flow가 안 하는 것', 'Magic DRC · KLayout DRC · Magic SPICE 추출은 GDS만 있으면 되는 서로 독립적인 작업이다 — 커스텀 flow로 동시 실행하면 8분39초+6분08초+2분58초(순차, 17분44초)를 최대값인 8분39초로 줄일 수 있다. OpenLane Classic flow는 이걸 순차 실행하도록 짜여 있어 직접 flow를 커스터마이징하지 않는 한 자동으로 얻어지지 않는다.'],
  ['진짜 실현 가능한 병렬화는 설계 내부가 아니라 설계/후보 사이', '이미 이 프로젝트가 쓰고 있는 방식 — chan_top과 daq_subsystem을 동시에 돌리거나, SynthesisExploration의 9개 전략을 동시에 돌리는 것. "탐색 구조" 섹션의 0~1단계가 정확히 이 원리다.'],
  ['23분(리페어) + 22분(물리검증), 두 병목을 줄이는 진짜 방법', '병렬화가 아니라 애초에 "고칠 위반 개수"를 줄이는 것 — RTL이 타이밍을 더 여유 있게 만족하면(이번에 chan_top에서 실제로 함: ch_cause_o 레지스터화) 리사이저가 반복할 위반 자체가 줄어 이 단계가 짧아진다. DRC 쪽은 antenna 위반을 미리 줄이면(DIODE_INSERTION_STRATEGY 등) 재작업 루프가 줄어든다 — 둘 다 이번 세션에 실제로 확인된 효과.'],
] as const

// 체크포인트 재개 — OpenLane 2 소스(openlane/flows/flow.py Flow.start(),
// openlane/flows/cli.py)에서 직접 확인함. --run-tag/--last-run으로 기존 run을
// 지정하면(--overwrite 안 주면) 이미 끝난 단계는 재실행하지 않고 최신
// state_out.json을 초기 상태로 불러온다 — 합성/배치/CTS처럼 안 바뀐 앞단을
// 건너뛰고 바뀐 파라미터가 영향을 주는 단계부터만 다시 돈다. 2026-09-23 발견.
const resumeMechanism = [
  ['--run-tag <이름>', '특정 run 디렉터리를 재사용', '이미 끝난 단계는 그대로 두고 최신 state_out.json을 초기 상태로 로드 (Flow.start, overwrite=False일 때)'],
  ['--last-run', '가장 최근 run을 자동으로 재사용', '--run-tag와 동일한 메커니즘, 이름을 수동 지정 안 해도 됨'],
  ['-F / --from <step-id>', '그 run 안에서 지정한 단계부터 다시 실행', '이전 단계 산출물은 그대로, 여기부터만 새로 계산'],
  ['-T / --to <step-id>', '지정한 단계까지만 실행하고 멈춤', '뒷단(특히 GDS/DRC/LVS)이 필요 없는 질문에 답할 때'],
  ['--overwrite', '기존 run을 지우고 완전히 처음부터', '재개가 아니라 진짜 재시작이 필요할 때만'],
] as const

// chan_top RUN_2026-09-20_21-14-08 실측 71분20초를 74개 세부 step에 매핑해서
// 시나리오별로 재개 시 절감량을 계산 (근거는 위 postReplaceSteps + flow.log의
// step 번호). 2026-09-23.
const resumeTiming = [
  ['안테나 전략만 재검증 (예: strategy 4→6)', '71분 20초 (전 구간)', '--run-tag <이전> --from 38(GlobalRouting) → 40분 28초', '약 31분 (43%↓)'],
  ['위 + "안테나 결과만" 빨리 확인', '71분 20초', '--from 38 --to 45(CheckAntennas-1) → 11분 26초', '약 60분 (84%↓)'],
  ['배치 밀도(PL_TARGET_DENSITY_PCT) 변경', '71분 20초', '--from 27(GlobalPlacement) → 68분대', '약 3분 (미미)'],
  ['클럭 주기(CLOCK_PERIOD) 변경', '71분 20초', '재개 불가 — 사실상 전체 재실행', '없음'],
  ['RTL 변경 (예: ch_cause_o 레지스터화)', '71분 20초', '재개 불가 — 6번(합성)부터 전체', '없음'],
] as const

const resumeDecisionTable = [
  ['DIODE_INSERTION_STRATEGY, 라우팅 옵션(GRT_*/DRT_*)', '38 (글로벌 라우팅)', '큼 (~43%)'],
  ['PL_TARGET_DENSITY_PCT 등 GPL(배치) 관련', '27 (글로벌 배치)', '작음 (~3분)'],
  ['DIE_AREA, FP_SIZING', '13 (floorplan)', '매우 작음'],
  ['CLOCK_PERIOD / SDC 주기', '사실상 전체 (6번, 타이밍 기반 리사이징이 앞단부터 걸림)', '없음'],
  ['RTL 파일 수정', '6 (합성)', '없음'],
] as const

// "많은 후보 + 보상학습"을 이 프로젝트에 쓸 수 있는지 검토 (RL vs Bayesian
// Optimization). DreamPlace 때와 같은 방식으로 근거를 남김 — 규모 대비
// 과한 기법은 채택하지 않는다. 2026-09-23.
const learningSearchEval = [
  ['딥 RL (Google Circuit Training류)', '이 프로젝트엔 부적합', '수백만 인스턴스 칩을 대상으로, 다른 칩 세대들로 이미 사전학습한 정책을 재사용하는 구조 — 여기서 새로 학습하는 게 아니다. 이 프로젝트는 완주한 실행이 10개 미만이라 사전학습할 데이터가 없고, RL은 보통 수백~수천 에피소드가 필요한데 시도 1회 11~71분으로는 예산이 절대적으로 부족. DreamPlace를 부적합 판정한 것과 같은 이유(규모 불일치)'],
  ['Bayesian Optimization', '개념은 맞지만 지금은 이름', '20~30번의 실제 평가만으로 수렴하도록 설계된 기법이라 체크포인트 재개(시도당 11~40분) 예산과 맞음 — OpenROAD 프로젝트 자체도 ORFS AutoTuner라는 유사 도구가 있음. 다만 (a) 지금 튜닝할 파라미터가 몇 개 안 됨(다이오드 전략·밀도·주기), (b) 대리 모델을 검증할 과거 데이터가 부족 — 글로벌 배치 HPWL과 최종 signoff의 상관관계를 실측 3개로 확인했더니 무상관(아래 표 참고) — 지금 투입할 근거가 없음'],
] as const

const gplCorrelationCheck = [
  ['RUN_2026-09-20_19-36-35', 'HPWL 249,621,517 · overflow 0.0989', 'WNS −3.38ns · 안테나 17건'],
  ['RUN_2026-09-20_21-14-08', 'HPWL 249,650,949 · overflow 0.0990', 'WNS −0.50ns · 안테나 0건'],
  ['RUN_2026-09-21_21-20-41', 'HPWL 249,827,006 · overflow 0.0987', 'WNS +0.97ns(완전 클로징) · 안테나 1건'],
] as const

// 위 세 발견(재개 메커니즘, 재개 판단표, RL/BO 검토)을 하나의 실행 순서로
// 합친 것 — "속도를 어떻게 올리나"에 대한 종합 답. 2026-09-23.
const speedupMethodology = [
  ['1. 뭐가 바뀌었는지 분류', '재개 판단표(위)로 가장 이른 영향 단계 확인', 'RTL/주기 변경 → 전체 재실행 필요. 다이오드 전략·라우팅 옵션만 → 재개 가능'],
  ['2. 재개 가능하면 체크포인트에서 시작', '--run-tag <가장 가까운 완주 run> --from <영향 단계>', '업스트림(합성~포스트CTS리페어, 최대 27분)을 통째로 건너뜀'],
  ['3. 필요한 답이 전체 signoff가 아니면 --to로 조기 종료', '예: 안테나만 궁금하면 --to OpenROAD.CheckAntennas-1', 'GDS/DRC/LVS(22분38초) 등 불필요한 뒷단 생략'],
  ['4. 후보가 1~2개 수준이면 여기서 끝 — 학습법 불필요', '위 1~3만으로 충분, 수동 판단', '지금 chan_top/daq_subsystem 규모에 해당'],
  ['5. 탐색할 조합이 많아지면(채널별 파라미터 조합 등) 그때 Bayesian Optimization 재검토', '체크포인트 재개로 시도당 비용을 낮춘 뒤 BO로 20~30회', '지금은 이르다 — daq_subsystem이 채널마다 다른 조합을 반복 튜닝해야 하는 상황이 되면 재검토'],
] as const

// PPA(Power/Performance/Area) 민감도 분석 — "파레토냐?"는 질문에 답하며 정리한
// 구분: 지금 하는 건 축 하나만 바꾸고 나머지 고정하는 민감도 분석이지, area×
// period×전략을 조합으로 도는 진짜 파레토 프런티어가 아니다. chan_top이 거의
// 닫힌 지금 단계엔 후자가 과함(18개 조합 × ~71분 ≈ 21시간) — 전자로 충분.
// 2026-09-23 작성.
const ppaAxes = [
  ['Area (DIE_AREA)', '입력 — 직접 조절', '기준 800×800(utilization ~52%) → 700×700 / 950×950 후보', '아직 실측 없음 — 호스트가 라이브 실행 두 개로 바빠서 대기 중'],
  ['Performance (CLOCK_PERIOD)', '입력 — 직접 조절', 'src/axi 주기, 면적·RTL은 고정', '실측 2점 이미 있음 (아래 표) — 새 실행 불필요'],
  ['Power', '출력 — 위 두 축을 바꿀 때마다 관찰', 'OpenROAD 리포트(power__total 등)', 'OpenLane엔 "파워를 이 값으로 맞춰라" 같은 직접 조절 knob이 없음 — 독립 축이 아니라 종속 지표'],
] as const

// 면적·RTL 동일, 주기만 다른 두 완주 실행의 실측 비교 — 새로 돌릴 필요 없이
// 이미 있는 metrics.json에서 뽑음.
const performanceAxisData = [
  ['src=12/axi=52ns (RUN_2026-09-20_21-14-08)', '7.161', '−0.50ns', '안테나 0건'],
  ['src=14/axi=52ns (RUN_2026-09-21_21-20-41)', '6.149 (약 14%↓)', '+0.97ns (완전 클로징)', '안테나 1건'],
] as const

const areaAxisPlan = [
  ['700×700 (더 빡빡하게)', '대기 — 호스트 사용 중', 'utilization 상승, 라우팅 자체가 안 될 가능성도 있음 — 그것도 결과'],
  ['800×800 (기준)', '완료', 'RUN_2026-09-21_21-20-41 — utilization ~52%, 이미 위 표에 반영됨'],
  ['950×950 (더 여유있게)', '대기 — 호스트 사용 중', 'utilization 하락, 배선 길어질 것으로 예상 — 실측 전까지는 추정일 뿐'],
] as const

// "가장 오래 걸리는 게 STA 아니냐"는 질문에 실제 runtime.txt로 답한 것 —
// 단독 STA 체크포인트는 전부 30초~2분대로 빠르다. 느린 건 STA를 반복
// 호출하는 "리페어 루프"(ResizerTimingPostCTS)이고, 그 반복 시간조차
// "결과가 좋을수록 빠르다"는 단순 관계가 아니다. 2026-09-23 실측.
const staStandaloneTiming = [
  ['STAPrePNR (합성 직후)', '29.8초'],
  ['STAMidPNR (배치 직후)', '36.6초'],
  ['STAMidPNR-1 (CTS 직후)', '34.7초'],
  ['STAMidPNR-2 (포스트CTS리페어 후)', '28.3초'],
  ['STAMidPNR-3 (다이오드 삽입 후)', '30.9초'],
  ['RCX (기생성분 추출)', '1분11.5초'],
  ['STAPostPNR (최종 signoff STA, RCX 반영)', '2분07.7초'],
] as const

const repairTimeAcrossRuns = [
  ['12/52ns, ch_cause_o 레지스터 전 (RUN_2026-09-20_19-36-35)', '36분54초', 'WNS −3.38ns (나쁨)'],
  ['12/52ns, 레지스터 후 (RUN_2026-09-20_21-14-08)', '22분07초 (가장 빠름)', 'WNS −0.50ns'],
  ['14/52ns, 레지스터 후 (RUN_2026-09-21_21-20-41)', '46분02초 (가장 느림)', 'WNS +0.97ns (가장 좋음, 완전 클로징)'],
] as const

// Hierarchical 트랙 실행 계획 — OpenLane 소스(openlane/config/variable.py의
// Macro/Instance 클래스, openlane/steps/odb.py의 ManualMacroPlacement)를 직접
// 읽어서 확인한 실제 메커니즘. "글루코드가 필요하다"고 여러 번 적었던 게
// 과장이었음 — 실제로는 설정 객체 하나 채우는 정도. 2026-09-23.
const macroMechanism = [
  ['매크로 정의', '`MACROS` config 객체 — 이름별로 gds/lef(필수), nl/spef/lib(계층적 STA용, 있으면 좋음) 목록', 'chan_top의 완주 run이 `final/`에 이미 전부 생성해 둠 — 별도 하드닝 작업 불필요, 경로만 연결하면 됨'],
  ['매크로 배치', '`MACROS.instances`에 인스턴스별 {location: (x,y), orientation} — 또는 더 간단히 `MACRO_PLACEMENT_CFG`(줄바꿈 구분 텍스트, `인스턴스명 X Y 방향`)', 'ParSAC의 SA 탐색 결과(8개 좌표+방향)를 그대로 이 형식으로 출력하면 끝 — "글루코드"가 아니라 좌표 변환 스크립트 수준'],
  ['배치 고정', 'Odb.ManualMacroPlacement 스텝이 `--fixed`로 배치 — 이후 표준셀 배치·CTS·라우팅이 매크로를 건드리지 않음', '이미 검증된 chan_top 내부가 top 레벨 재실행 중에 다시 바뀔 걱정이 없다는 뜻'],
] as const

// ParSAC의 실제 제약 종류 — 소스/README(paper: PARSAC, arXiv 2405.05495) 직접
// 확인. "grouping·인접·크기 변경도 되냐"는 질문에 답하며 정리. 2026-09-23.
const parsacConstraintTypes = [
  ['Grouping (묶음)', '지원됨', '`block_specs[:,3]`에 Group ID — 같은 ID인 블록들이 서로 가까워지도록 비용(`beta_cluster`)으로 유도. 채널을 2~4개씩 묶어 배치할 때 바로 사용 가능'],
  ['경계 인접 (boundary)', '지원됨', '`block_specs[:,2]`, 블록별 boundary constraint — "이 블록은 이 변에 붙어라"를 직접 강제. IO 인접 채널에 정확히 맞음'],
  ['블록 대 블록 인접 (touching)', '직접 지원 안 됨 — grouping으로 근사', '"A와 B가 반드시 맞닿아야 한다"는 별도 제약 타입이 없음 — grouping은 "가까워지도록" 유도할 뿐 "붙어라"를 강제하지 않음'],
  ['가로세로 비율(aspect ratio) 변경', '지원되지만 하드닝 전에만 의미 있음', '`block_specs[:,5]`(고정 0/1) + `ar_search`로 SA가 탐색 가능 — 단 이미 GDS/LEF로 하드닝된 chan_top은 물리적으로 모양이 고정이라 "fixed"로 표시해야 함. 비율을 정말 바꾸려면 chan_top을 다른 DIE_AREA로 재하드닝해야 함(새 P&R 필요)'],
  ['사전 고정 배치 (pre-placed)', '지원됨', '`hard_preplace_constraints` — 특정 매크로를 특정 좌표에 고정. 필요하면 일부 채널을 미리 정한 위치에 못박아둘 때 사용'],
] as const

const hierarchicalTodo = [
  ['1', 'chan_top 최종 확인', '안테나 strategy 6이 0건으로 닫히는지 — 진행 중(라이브)', '진행 중'],
  ['2', 'daq_subsystem 플로어플랜 크기 결정', '8개 chan_top 매크로(각 800×800µm) + top 로직(dma_sched 등)이 들어갈 DIE_AREA 산정', '대기'],
  ['3', 'ParSAC로 8개 매크로 배치 탐색', '경계 제약(IO 인접) + 그룹 제약(대칭) 조건으로 SA 실행 — 이미 설치 완료, 조사 시점 결론(2026-09-21)대로 실행만 하면 됨', '대기'],
  ['4', 'ParSAC 출력 → MACRO_PLACEMENT_CFG 변환', '좌표 변환 스크립트 (수 줄 수준)', '대기'],
  ['5', 'daq_subsystem config.json에 MACROS 연결', 'chan_top final/의 gds·lef·nl·spef·lib 경로 + 위 배치 파일', '대기'],
  ['6', 'top 레벨만 P&R', '8개 매크로는 고정, dma_sched/axi_rd_master/axi_wr_master/desc_fetch/wr_track/irq_ctrl/perf_cnt/daq_csr/axil_slave만 합성·배치·배선', '대기'],
  ['7', '매크로 경계 IO 타이밍 budget 확정', 'daq_subsystem.sdc에 일부 이미 작성됨 — top-매크로 간 신호 경로 재검토', '대기'],
  ['8', '전체 칩 레벨 DRC/LVS/안테나 재검증', '매크로 자체는 이미 검증됐어도, 매크로 경계 라우팅·전체 조립은 별도로 확인 필요', '대기'],
  ['9', 'Flat(daq_subsystem worst-corner 부분 검증) 결과와 4단계 맞대결', 'PPA 직접 비교', '대기'],
] as const

const hierarchicalSpeedup = [
  ['체크포인트 재개(`--run-tag`/`--from`/`--to`)', '적용 가능 — 그대로', 'top 레벨 P&R도 결국 같은 OpenLane 플로우라 동일한 메커니즘이 적용됨. 다이오드 전략 등 재검증 시 똑같이 씀'],
  ['조기 종료(`--to`)로 빠른 스크리닝', '적용 가능 — 그대로', 'top 레벨 배치·안테나만 궁금하면 CheckAntennas-1까지만 돌리는 것도 동일하게 가능'],
  ['hierarchical 고유의 시간 절감 (체크포인트와 별개)', '이게 진짜 핵심', 'top 레벨 넷리스트는 daq_subsystem 전체(~107k셀)가 아니라 glue 로직만 — 셀 수가 훨씬 적어지므로, 가장 비쌌던 "포스트-CTS 타이밍 리페어"(23분, 위반 개수에 비선형 비례) 자체가 근본적으로 작아질 것으로 예상. 다만 실측 전까지는 추정 — 8번째 실행 예정'],
] as const

function PostReplaceTimeline() {
  const totalSec = postReplaceSteps.reduce((sum, s) => sum + Number(s[3]), 0)
  const pxPerSec = 900 / totalSec
  let x = 20
  return <svg viewBox="0 0 940 140" role="img" aria-label="RePlAce 이후 chan_top P&R 단계별 실제 소요시간">
    <text x="20" y="20" style={{font: '600 13px sans-serif', fill: 'var(--text-primary)'}}>RePlAce 이후 실행 구조 — 실제 소요시간 비례 (전체 {Math.round(totalSec/60)}분, chan_top 완주 런 실측)</text>
    {postReplaceSteps.map(([num, name, timeLabel, secStr, color]) => {
      const w = Math.max(Number(secStr) * pxPerSec, 3)
      const rect = <rect key={'r'+num} x={x} y={40} width={w} height={40} fill={color} stroke="var(--surface-2)" strokeWidth={1}/>
      const showLabel = w > 26
      const label = showLabel ? <text key={'t'+num} x={x + w/2} y={64} textAnchor="middle" dominantBaseline="central" style={{font: '600 12px sans-serif', fill: '#fff'}}>{num}</text> : null
      x += w
      return <g key={num}>{rect}{label}</g>
    })}
    <text x="20" y="105" style={{font: '400 11px sans-serif', fill: 'var(--text-secondary)'}}>■ 배치/CTS 계열 (보라)　■ 리페어·DRC 병목 (빨강, 두 구간이 전체의 약 64%)　■ 라우팅/추출 (파랑·초록)</text>
    <text x="20" y="122" style={{font: '400 11px sans-serif', fill: 'var(--text-secondary)'}}>숫자 0-8은 아래 표의 단계 번호와 일치</text>
  </svg>
}

export default function PnrResearch() {
  return <>
    <section className="card"><div className="card-title"><div><small className="kicker">P&R 연구 · 2026-09-18</small><h2>Flat vs Hierarchical — 두 접근을 나란히</h2></div></div>
      <div className="data-table"><table><thead><tr><th>방식</th><th>정의</th><th>장점</th><th>단점 / 전제조건</th></tr></thead><tbody>{approaches.map(([name, def_, pro, con]) => <tr key={name}><td><b>{name}</b></td><td>{def_}</td><td>{pro}</td><td>{con}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note">2026-09-23: daq_subsystem의 기본 구현 방향을 hierarchical로 확정(사용자 결정) — 반복 구조(8채널 동일)가 강한 설계라는 점, 그리고 작은 기능 변경/면적 조정 시에도 이미 굳힌 매크로를 재사용할 수 있다는 점을 근거로 삼음. 다만 4단계(flat vs hierarchical 맞대결) 실측은 아직 안 끝났으므로, 이 결정이 최종 PPA 수치로 증명된 것은 아니다 — flat 트랙(daq_subsystem worst-corner 부분 검증)도 완주까지 지켜보고 비교 기준으로 남겨둔다.</p>
    </section>

    <section className="card"><div className="card-title"><div><small className="kicker">Hierarchical 실행 계획 · 2026-09-23</small><h2>매크로 메커니즘 확인 — "글루코드"는 과장이었다</h2></div></div>
      <p>OpenLane 소스(<code>config/variable.py</code>의 <code>Macro</code>/<code>Instance</code> 클래스, <code>steps/odb.py</code>의 <code>ManualMacroPlacement</code>)를 직접 읽어서 실제 메커니즘을 확인함:</p>
      <div className="data-table"><table><thead><tr><th>단계</th><th>메커니즘</th><th>이 프로젝트에 의미</th></tr></thead><tbody>{macroMechanism.map(([step, mech, note]) => <tr key={step}><td><b>{step}</b></td><td>{mech}</td><td>{note}</td></tr>)}</tbody></table></div>
      <p><b>ParSAC 제약 종류 — grouping·인접·크기 변경 지원 여부 (소스/README 확인):</b></p>
      <div className="data-table"><table><thead><tr><th>제약 종류</th><th>지원 여부</th><th>근거 / 주의점</th></tr></thead><tbody>{parsacConstraintTypes.map(([kind, support, note]) => <tr key={kind}><td><b>{kind}</b></td><td>{support === '지원됨' ? <span className="ok-badge">{support}</span> : <span className="warning-badge">{support}</span>}</td><td>{note}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note">가장 중요한 구분: aspect ratio 탐색은 <b>아직 하드닝 안 된 "말랑한" 블록에만 의미가 있다.</b> chan_top이 오늘 800×800으로 하드닝을 마치면, 8개 배치 탐색 단계에선 이걸 "fixed aspect ratio"로 표시해야 한다 — SA가 실제로 존재하지 않는 모양으로 바꾸려 들면 안 되기 때문. 정말 다른 비율(예: 640×1000, 같은 면적)을 원하면 chan_top을 그 DIE_AREA로 다시 하드닝해야 하고, 이는 area 축 실험(700×700/950×950)을 정사각형이 아닌 비율로 확장하는 것과 같은 작업이다.</p>
      <p><b>실행 계획 (순서대로):</b></p>
      <div className="data-table"><table><thead><tr><th>#</th><th>할 일</th><th>내용</th><th>상태</th></tr></thead><tbody>{hierarchicalTodo.map(([num, task, detail, stat]) => <tr key={num}><td><b>{num}</b></td><td>{task}</td><td>{detail}</td><td>{stat === '진행 중' ? <span className="warning-badge">{stat}</span> : stat}</td></tr>)}</tbody></table></div>
      <p><b>시간 단축 기법 적용 가능 여부:</b></p>
      <div className="data-table"><table><thead><tr><th>기법</th><th>적용 가능?</th><th>근거</th></tr></thead><tbody>{hierarchicalSpeedup.map(([tech, applicable, note]) => <tr key={tech}><td>{tech}</td><td>{applicable.includes('가능') ? <span className="ok-badge">{applicable}</span> : applicable}</td><td>{note}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note">체크포인트 재개·조기 종료는 top 레벨 P&R에도 그대로 쓸 수 있다 — 별도 구현이 필요 없다. 진짜 시간 절감은 hierarchical 구조 자체(top 레벨 넷리스트가 작아짐)에서 오고, 이 둘은 배타적이지 않고 누적된다: top 레벨 P&R 자체가 이미 더 짧고, 그 위에 체크포인트 재개까지 쓰면 다이오드 전략 재검증 같은 반복 작업은 더 빨라진다.</p>
    </section>

    <section className="card"><div className="card-title"><div><small className="kicker">탐색 구조</small><h2>깔때기(funnel) — 비쌀수록 후보 수를 줄인다</h2></div></div>
      <div className="data-table"><table><thead><tr><th>단계</th><th>방법</th><th>구체적 실행</th><th>상태</th><th>버리는 기준</th></tr></thead><tbody>{funnelStages.map(([stage, method, exec_, stat, drop]) => <tr key={stage}><td><b>{stage}</b><br/><small>{method}</small></td><td>{exec_}</td><td>{stat.includes('검증됨') ? <span className="ok-badge">{stat}</span> : <span className="warning-badge">{stat}</span>}</td><td>{drop}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note">핵심 원칙: <b>비용이 100~1000배 뛰는 단계(2→3단계, 재시간측정 초 단위 → 전체 P&R 25~40분)로 넘어가기 전에, 훨씬 싼 단계에서 최대한 많이 걸러낸다.</b> 이번 세션에서 SYNTH_STRATEGY 재검증 때 이미 증명됨 — pre-placement 예측이 방향까지 틀린 적 있지만(chan_ctrl 면적 반전), 그래도 "이 전략을 시도할 가치가 있는가"라는 1차 판단 자체는 맞았다. 즉 싼 필터는 "무엇을 3단계에 보낼지" 정도는 신뢰할 수 있어도, 최종 PPA 숫자로는 못 쓴다.</p>
    </section>

    <section className="card"><div className="card-title"><div><small className="kicker">동시성 설계</small><h2>단계마다 다른 병렬도</h2></div></div>
      <div className="data-table"><table><thead><tr><th>단계</th><th>권장 동시 실행 수</th><th>근거</th></tr></thead><tbody>{concurrency.map(([stage, n, why]) => <tr key={stage}><td>{stage}</td><td><b>{n}</b></td><td>{why}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note">"최대한 병렬로"가 곧 "후보 수만큼 동시에"는 아니다 — 이 호스트가 8코어이고 OpenLane 자체가 내부적으로 이미 병렬화돼 있어서, 외부 동시 실행 수를 늘려도 어느 지점부터는 서로의 코어를 뺏을 뿐 순수 이득이 없다(실측: SynthesisExploration 3개 동시 = 1.43배, 3배 아님). 1~2단계는 가볍고 짧아서 거의 무제한으로 병렬화하고, <b>3단계(전체 P&R)는 사실상 병렬화 여지가 없다</b> — 아래 "실행 구조" 섹션에서 확인했듯 KLayout DRC 한 단계만으로도 8코어를 전부 쓰기 때문에, 후보를 여러 개 찾아내는 것과 그걸 동시에 다 돌리는 것은 별개 문제다. 여러 후보를 "찾는" 건 0~2단계(저렴)에서 병렬로 하고, 3단계는 순차로 하나씩 돌리는 구조가 이 머신 규모에 맞는 현실적인 답이다.</p>
    </section>

    <section className="card"><div className="card-title"><div><small className="kicker">병렬 실행 시 충돌 방지</small><h2>여러 후보/세션이 같은 리소스를 쓸 때</h2></div></div>
      <div className="check-list">{races.map(([title, risk, fix]) => <p key={title}><b>{title}</b><span><i>위험:</i> {risk}<br/><i>대응:</i> {fix}</span></p>)}</div>
    </section>

    <section className="card"><div className="card-title"><div><small className="kicker">현재 진행 상태</small><h2>뭐가 검증됐고 뭐가 아직 설계만 됐는가</h2></div></div>
      <div className="data-table"><table><thead><tr><th>항목</th><th>상태</th><th>비고</th></tr></thead><tbody>{status.map(([item, stat, note]) => <tr key={item}><td><b>{item}</b></td><td>{stat === '검증됨' ? <span className="ok-badge">{stat}</span> : <span className="warning-badge">{stat}</span>}</td><td>{note}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note">다음 구체적 실행 단계 — 이 순서로: (1) chan_top 12/48 from-scratch 확인 + daq_subsystem을 같은 48/12로 재타겟해서 2단계 필터(mid-flow 추정)부터 먼저 확인, 둘 다 지금 백그라운드 진행 중 → (2) daq_subsystem 2단계 추정이 나쁘지 않으면 그때 전체 완주(3단계) 커밋, 나쁘면 완주 전에 재튜닝 → (3) chan_top이 worst-corner까지 닫히면 hardening해서 macro LEF/GDS 확보 → (4) ParSAC venv 설치 + chan_top macro를 8개 배치하는 글루코드 작성(1단계 실행) → (5) 살아남은 배치 후보로 daq_subsystem hierarchical 3단계(전체 P&R) 실행 → (6) 같은 시점의 flat 3단계 결과와 4단계 맞대결.</p>
    </section>

    <section className="card"><div className="card-title"><div><small className="kicker">RePlAce 대안 조사 · DREAMPlace · 2026-09-21</small><h2>실제로 설치·실행까지 해봤지만 이 프로젝트엔 부적합</h2></div></div>
      <div className="data-table"><table><thead><tr><th>단계</th><th>결과</th><th>근거</th></tr></thead><tbody>{dreamplaceEval.map(([step, result, note]) => <tr key={step}><td><b>{step}</b></td><td>{result.includes('완료') && !result.includes('부정') ? <span className="ok-badge">{result}</span> : <span className="warning-badge">{result}</span>}</td><td>{note}</td></tr>)}</tbody></table></div>
    </section>

    <section className="card"><div className="card-title"><div><small className="kicker">ParSAC 조사 · 2026-09-21</small><h2>설치는 완료, 현재 구조엔 투입 대상이 없음</h2></div></div>
      <div className="data-table"><table><thead><tr><th>항목</th><th>상태</th><th>근거</th></tr></thead><tbody>{parsacEval.map(([item, stat, note]) => <tr key={item}><td><b>{item}</b></td><td>{stat === '완료' ? <span className="ok-badge">{stat}</span> : <span className="warning-badge">{stat}</span>}</td><td>{note}</td></tr>)}</tbody></table></div>
    </section>

    <section className="card"><div className="card-title"><div><small className="kicker">실행 구조 · RePlAce 이후 · 2026-09-21</small><h2>RePlAce부터 signoff까지, 각 단계 실제 소요시간</h2></div></div>
      <p>chan_top 완주 런(<code>RUN_2026-09-20_21-14-08</code>, 71분20초)의 실제 <code>runtime.txt</code> 값을 그대로 합산한 것 — 추정이 아니다.</p>
      <div className="analog-schematic-wrap"><PostReplaceTimeline/></div>
      <div className="data-table"><table><thead><tr><th>#</th><th>단계</th><th>실제 소요</th><th>무엇을 하나</th></tr></thead><tbody>
        {postReplaceSteps.map(([num, name, time, , , desc]) => <tr key={num}><td><b>{num}</b></td><td><b>{name}</b></td><td>{time}</td><td>{desc}</td></tr>)}
      </tbody></table></div>
      <p className="rtl-guide-note"><b>단 두 단계(3번 포스트-CTS 리페어 23분10초 + 7번 GDS/물리검증 22분38초)가 전체의 약 64%.</b> 나머지 6단계를 다 합쳐도 이 둘 중 하나에 못 미친다.</p>
    </section>

    <section className="card"><div className="card-title"><div><small className="kicker">"제일 오래 걸리는 게 STA 아니냐" · 2026-09-23</small><h2>아니다 — STA는 빠르다, 느린 건 STA를 반복 호출하는 리페어 루프</h2></div></div>
      <p>단독 STA 체크포인트들의 실제 <code>runtime.txt</code>:</p>
      <div className="data-table"><table><thead><tr><th>단계</th><th>실제 시간</th></tr></thead><tbody>{staStandaloneTiming.map(([step, time]) => <tr key={step}><td>{step}</td><td>{time}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note">단독 STA는 어디서도 30초~2분을 넘지 않는다. 반면 "포스트-CTS 타이밍 리페어"(ResizerTimingPostCTS) 하나가 22분07초 — STA보다 10~40배 걸린다. 이 단계는 STA를 한 번 도는 게 아니라 <b>"STA로 위반 확인 → 버퍼 삽입/셀 교체/핀 스왑으로 고침 → 다시 STA로 확인"을 반복</b>(실측 7회)하는 루프다 — 시간을 먹는 건 STA 계산 자체가 아니라 그 사이 "고치는" 작업(배치 재조정, 셀 교체, 재합법화).</p>
      <p><b>이 리페어 시간을 3개 실행에서 비교:</b></p>
      <div className="data-table"><table><thead><tr><th>실행</th><th>리페어 시간</th><th>최종 결과</th></tr></thead><tbody>{repairTimeAcrossRuns.map(([run, time, result]) => <tr key={run}><td>{run}</td><td>{time}</td><td>{result}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note">"결과가 좋을수록 리페어가 빠르다"는 단순 관계가 아니다 — 가장 좋은 최종 결과(14/52ns, 완전 클로징)가 오히려 가장 오래 걸렸다(46분). 주기를 늦추면 리사이저가 여유를 활용해 더 많은 탐색/최적화를 시도하는 것으로 보이나, 정확한 원인은 이 로그만으로 단정하지 않는다. 실용적 결론: STA 자체를 더 빠르게 할 여지는 거의 없고(이미 30초~2분), 이 단계를 줄이는 진짜 방법은 애초에 고칠 위반 수를 줄이는 것(RTL 파이프라이닝) — 다만 위 표처럼 항상 예측대로 가지는 않는다.</p>
    </section>

    <section className="card"><div className="card-title"><div><small className="kicker">병렬화 가능성 분석</small><h2>어디를 병렬로 돌릴 수 있고, 어디는 안 되나</h2></div></div>
      <div className="check-list">{parallelizationNotes.map(([title, note]) => <p key={title}><b>{title}</b><span>{note}</span></p>)}</div>
    </section>

    <section className="card"><div className="card-title"><div><small className="kicker">도구 선택 가이드</small><h2>언제 어떤 도구를 쓰나</h2></div></div>
      <div className="data-table"><table><thead><tr><th>상황 / 목적</th><th>추천</th><th>이유 / 재검토 시점</th></tr></thead><tbody>{toolGuide.map(([situation, tool, why]) => <tr key={situation}><td>{situation}</td><td><b>{tool}</b></td><td>{why}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note"><b>"많이 돌려서 더 나은 걸 고른다"는 SA스러운 발상 자체는 여전히 유효하다</b> — 다만 ParSAC/DreamPlace 같은 SA/GPU 전용 도구가 아니라, <b>RePlAce를 여러 후보 설정으로 병렬 반복 실행</b>하는 방식으로 이미 하고 있다: SYNTH_STRATEGY 9개 × PL_TARGET_DENSITY_PCT 여러 값 × clock period 후보를 위 "탐색 구조" 섹션의 0~1단계에서 병렬로 돌려서 싸게 거르고, 살아남은 것만 3단계(전체 P&R, 곧 RePlAce 실행)로 확정하는 구조 자체가 "여러 후보를 굴려서 고른다"는 목적을 이미 만족한다 — 알고리즘을 SA로 바꾸는 게 아니라 <b>RePlAce 호출 횟수와 입력 조합을 늘리는 것</b>이 이 프로젝트 규모에 맞는 실현 방법.</p>
    </section>

    <section className="card"><div className="card-title"><div><small className="kicker">체크포인트 재개 · 2026-09-23</small><h2>OpenLane 소스에서 확인 — 안 바뀐 앞단은 다시 안 돈다</h2></div></div>
      <p>OpenLane 2 소스(<code>openlane/flows/flow.py</code>의 <code>Flow.start()</code>, <code>openlane/flows/cli.py</code>)를 직접 읽어서 확인함 — 추정이 아니다. 기존 run 디렉터리를 <code>--overwrite</code> 없이 다시 지정하면, 이미 끝난 step은 그대로 두고 최신 <code>state_out.json</code>을 초기 상태로 불러온다.</p>
      <div className="data-table"><table><thead><tr><th>플래그</th><th>동작</th><th>근거</th></tr></thead><tbody>{resumeMechanism.map(([flag, what, why]) => <tr key={flag}><td><code>{flag}</code></td><td>{what}</td><td>{why}</td></tr>)}</tbody></table></div>
      <p><b>실제 시간 비교</b> — chan_top 완주 런(71분20초)을 74개 세부 step으로 나눠 시나리오별 절감량을 계산:</p>
      <div className="data-table"><table><thead><tr><th>시나리오</th><th>기존(매번 처음부터)</th><th>재개 시</th><th>절감</th></tr></thead><tbody>{resumeTiming.map(([scenario, before, after, saved]) => <tr key={scenario}><td>{scenario}</td><td>{before}</td><td>{after}</td><td><b>{saved}</b></td></tr>)}</tbody></table></div>
      <p><b>재개 가능 여부 판단표</b> — 바꾸는 파라미터에 따라 재개로 얻는 이득이 크게 다르다:</p>
      <div className="data-table"><table><thead><tr><th>바꾸는 것</th><th>영향 시작 단계</th><th>재개 시 절감</th></tr></thead><tbody>{resumeDecisionTable.map(([what, step, saved]) => <tr key={what}><td>{what}</td><td>{step}</td><td>{saved}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note">핵심 제약: 재개 지점 <i>이전</i> 단계에 영향을 주는 파라미터(주기, RTL, 배치 밀도)는 그 지점부터 다시 돌아야 해서 이득이 작거나 없다 — 재개가 크게 이득인 건 라우팅 이후 단계에만 영향을 주는 파라미터(다이오드 전략 등)뿐이다.</p>
    </section>

    <section className="card"><div className="card-title"><div><small className="kicker">위반 하나만 고쳐서 이어가기(ECO) · 2026-09-23</small><h2>조사 중 — 전체 재실행 없이 특정 넷/셀만 패치 가능한가</h2></div></div>
      <p className="rtl-guide-note">조사 중입니다 — OpenLane 2의 Step 기반 flow(<code>OpenROAD.RepairAntennas</code>, <code>OpenROAD.ResizerTimingPostCTS</code> 등)는 기본적으로 설계 전체를 대상으로 위반을 고치도록 짜여 있고, 특정 넷 하나만 골라 고치는 first-class 옵션이 있는지는 아직 OpenLane 쪽 소스에서 확인 전입니다. 다만 이 프로젝트가 실제로 써 온 가장 효과적인 "그 부분만 고치기"는 도구 레벨 ECO가 아니라 <b>RTL 소스 자체를 타겟팅해서 고치는 것</b>이었습니다 — <code>ch_cause_o</code>를 레지스터화해서 그 신호로 끝나는 경로 하나만 고친 것이 실제로 WNS를 −3.38→−0.50ns로 개선한 사례입니다. OpenROAD Tcl 레벨에서 특정 넷에만 다이오드를 삽입하거나 특정 경로에만 버퍼를 넣는 수동 스크립트가 가능한지는 다음 조사에서 확인해서 이 섹션을 갱신하겠습니다.</p>
    </section>

    <section className="card"><div className="card-title"><div><small className="kicker">학습 기반 탐색(RL/BO) 검토 · 2026-09-23</small><h2>강화학습은 과함 — Bayesian Optimization이 규모에 맞지만 지금은 이름</h2></div></div>
      <div className="data-table"><table><thead><tr><th>기법</th><th>판단</th><th>근거</th></tr></thead><tbody>{learningSearchEval.map(([method, verdict, note]) => <tr key={method}><td><b>{method}</b></td><td>{verdict.includes('부적합') ? <span className="warning-badge">{verdict}</span> : verdict}</td><td>{note}</td></tr>)}</tbody></table></div>
      <p><b>대리 모델(surrogate) 신뢰성 실측</b> — "글로벌 배치 단계 지표로 최종 결과를 예측할 수 있는가"를 완주된 chan_top 3개 실행으로 직접 확인:</p>
      <div className="data-table"><table><thead><tr><th>실행</th><th>글로벌 배치 단계 지표</th><th>최종 signoff 결과</th></tr></thead><tbody>{gplCorrelationCheck.map(([run, gpl, final]) => <tr key={run}><td><code>{run}</code></td><td>{gpl}</td><td>{final}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note">HPWL/overflow는 세 실행 모두 0.5% 이내로 거의 동일한데, 최종 WNS는 −3.38ns~+0.97ns(4.35ns 차이), 안테나 위반은 0~17건까지 벌어짐 — <b>배치 단계 지표는 이 설계(utilization ~27%)의 최종 결과와 무상관.</b> 실제 차이는 RTL 구조(레지스터 추가)와 다이오드 전략처럼 배치 단계에는 안 보이는 요인에서 옴. DreamPlace 때와 같은 패턴 — 그럴듯한 대리 지표였지만 실측하니 이 프로젝트엔 안 맞아서 여기서 접는다.</p>
    </section>

    <section className="card"><div className="card-title"><div><small className="kicker">속도 개선 방법론 · 종합 · 2026-09-23</small><h2>지금까지 발견한 것을 하나의 실행 순서로</h2></div></div>
      <div className="data-table"><table><thead><tr><th>단계</th><th>방법</th><th>비고</th></tr></thead><tbody>{speedupMethodology.map(([step, method, note]) => <tr key={step}><td><b>{step}</b></td><td>{method}</td><td>{note}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note">이 방법론의 전제는 "탐색 구조"(퍼널) 섹션과 같다 — 비쌀수록 후보 수를 줄인다. 다른 점은 이번에 찾은 체크포인트 재개가 <b>퍼널의 3단계(전체 P&R) 자체의 비용을 낮춘다</b>는 것 — 후보 하나당 71분이 아니라, 바뀐 파라미터에 따라 11~68분으로 줄어들 수 있다. RL/BO 같은 학습 기법은 탐색할 조합이 지금보다 훨씬 많아지기 전까지는 투입 근거가 없다.</p>
    </section>

    <section className="card"><div className="card-title"><div><small className="kicker">PPA 민감도 분석 · 2026-09-23</small><h2>Area·Performance 축을 하나씩 — 파레토 스윕은 아직 아님</h2></div></div>
      <p>"이게 파레토 측정인가?"라는 질문에 답하며 정리한 구분 — 지금 하는 건 축 하나만 바꾸고 나머지를 고정하는 <b>민감도 분석</b>이다. area×period×전략을 조합으로 도는 진짜 <b>파레토 프런티어</b>는 18개 조합 × 후보당 ~71분 ≈ 21시간이 필요해서, chan_top이 거의 닫힌 지금 단계엔 과하다 — 민감도 분석으로 충분하고, 파레토는 설계가 안정화된 뒤(예: daq_subsystem 최종 설정 확정 시점)로 미룬다.</p>
      <div className="data-table"><table><thead><tr><th>축</th><th>종류</th><th>범위</th><th>상태</th></tr></thead><tbody>{ppaAxes.map(([axis, kind, range, stat]) => <tr key={axis}><td><b>{axis}</b></td><td>{kind}</td><td>{range}</td><td>{stat}</td></tr>)}</tbody></table></div>
      <p><b>Performance 축 — 실측 2점 (면적·RTL 고정, 새 실행 불필요):</b></p>
      <div className="data-table"><table><thead><tr><th>조건</th><th>power_total</th><th>성능(WNS)</th><th>위반</th></tr></thead><tbody>{performanceAxisData.map(([cond, power, perf, viol]) => <tr key={cond}><td>{cond}</td><td>{power}</td><td>{perf}</td><td>{viol}</td></tr>)}</tbody></table></div>
      <p><b>Area 축 — 실행 계획 (호스트 여유 생기면 시작):</b></p>
      <div className="data-table"><table><thead><tr><th>후보</th><th>상태</th><th>비고</th></tr></thead><tbody>{areaAxisPlan.map(([cand, stat, note]) => <tr key={cand}><td>{cand}</td><td>{stat === '완료' ? <span className="ok-badge">{stat}</span> : <span className="warning-badge">{stat}</span>}</td><td>{note}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note">Performance 축에서 이미 드러난 패턴: 주기를 늦추면(12→14ns) power는 내려가고 타이밍은 좋아졌지만, 안테나 위반은 0→1건으로 늘었다 — <b>세 지표가 한 방향으로만 움직이지 않는다</b>는 걸 실측으로 확인함(안테나 증가는 주기 자체가 아니라 그로 인한 다른 라우팅 솔루션의 부작용). Area 축도 실측 전까지는 같은 가정을 하면 안 된다 — 지난번 "배치 단계 지표 무상관" 교훈과 같은 이유로, 실제로 돌려보기 전엔 방향조차 단정하지 않는다.</p>
    </section>
  </>
}
