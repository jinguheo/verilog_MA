// P&R 연구 탭 — "현재(flat) 방식 vs hierarchical(macro) 방식"을 나란히 비교하고,
// 후보군을 최대한 병렬로 많이 돌리면서 가능성 없는 것들을 빠르게 버리는 깔때기
// (funnel) 탐색 구조를 설계한다. 이 탭은 실행 결과가 아니라 설계 문서 — 각 단계가
// "검증됨"인지 "제안됨"인지를 명시한다. 2026-09-18 작성.

const approaches = [
  ['현재 (Flat)', 'daq_subsystem 8채널 전체를 매번 통째로 재합성·재배치·재라우팅', '단순함, 전역 최적화 가능(매크로 경계에 갇히지 않음)', '셀 수 증가에 비선형으로 시간 증가 실측(chan_ctrl→chan_top 약 22배 셀에 22배보다 훨씬 큰 시간) · 4번째 시도까지 한 번도 완주 못 함(세션/호스트 종료로 중단, 실제 flow 에러 아님) · 위반이 있으면 원인 위치를 8채널 전체에서 다시 찾아야 함'],
  ['Hierarchical (Macro)', 'chan_top을 1번만 hardening → GDS/LEF/LIB/SPEF 확보 → daq_subsystem에서 OpenLane MACROS로 8번 배치, 나머지 로직(dma_sched 등)만 top에서 새로 P&R', '1회 P&R + 8회 저렴한 매크로 배치로 시간 절감 예상 · 각 채널 타이밍이 독립적으로 확정(전체 재검증 불필요) · chan_top 자체가 이미 검증된 블록이라 위반 원인 추적 범위가 좁아짐', '매크로 경계를 넘는 경로는 수동 IO 타이밍 budget 필요(daq_subsystem.sdc에 이미 일부 작성됨) · chan_top이 먼저 worst-corner까지 닫혀야 의미 있음(안 닫힌 블록 8배 복제는 위반만 8배) · 매크로 배치(어디에 8개를 놓을지) 자체가 별도 최적화 문제 — OpenROAD 내장 배치기보다 ParSAC(SA 기반) 같은 전용 floorplanner가 더 잘 풀 가능성'],
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
  ['Flat 트랙 1~3단계', '검증됨', 'chan_ctrl/cnt_sat/skid_buffer로 1~3단계 전부 실행·검증 완료. chan_top은 12ns/52ns 주기 + RTL 파이프라이닝(ch_cause_o 레지스터화)으로 worst-corner 거의 닫힘, src_ready_o 경로 마무리 중'],
  ['daq_subsystem — 2단계 적용', '진행 중', '8채널 전체를 32/10ns로 완주 시도하던 시행착오를 거쳐, chan_top에서 확정된 주기로 SDC/config 갱신 후 재시작 — 이 탭이 말하는 깔때기를 daq_subsystem 자신에게도 적용한 사례'],
  ['Hierarchical 트랙', '설계만 됨, 미착수', 'ParSAC(IntelLabs, Apache 2.0) 조사 완료 — 매크로 floorplanning 전용 SA 도구, OpenLane MACROS와 연결하는 글루코드 필요. chan_top이 worst-corner까지 안 닫힌 상태라 아직 투입 시점 아님'],
  ['4단계 맞대결', '미착수', 'Hierarchical 1단계부터 선행 필요'],
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

// RePlAce 알고리즘 자체 설명 — 지금까지 이 파일 여러 곳에서 "이전 섹션에서
// 설명한 정전기 밀도 모델 + Nesterov 경사하강"이라고 참조만 해뒀지, 그 설명
// 본문이 실제로는 없었다. 그 자리를 채운다. OpenROAD의 gpl 모듈이 곧 RePlAce
// 논문(Cheng et al., ICCAD'18/TCAD'19)의 구현체이고, 이 프로젝트의 모든
// 블록(chan_ctrl~daq_subsystem)이 실제로 이걸 통해 배치됐다 — 교과서 설명이
// 아니라 이 세션에서 실제로 관찰한 로그·수치에 근거를 둔다. 2026-09-24 작성.
const replaceProblem = [
  ['주어지는 것 (고정)', '넷리스트(셀 N개 + 셀 사이 연결=net), 이미 자리 잡은 매크로/IO, 코어 영역 크기', 'chan_top의 경우 45,000~46,000개 표준셀 — RTL 합성 결과 그대로, 이 단계에서 바꾸지 않음'],
  ['최적화 변수', '각 표준셀의 좌표 (x, y) — 아직 정확한 행(row)/그리드에 안 붙어도 됨', '정확히 행에 정렬하는 건 이 다음 단계인 Detailed Placement의 일. RePlAce/gpl은 "대략 어디쯔음"까지만 정한다'],
  ['목표(minimize)', '전체 wirelength(모든 net의 배선 길이 합)', '배선이 길어지면 지연·전력이 늘고, 다음 단계(CTS·라우팅)가 더 힘들어짐 — 이 프로젝트에서 실제로 반복 겪은 "포스트-CTS 리페어가 오래 걸리는" 문제의 씨앗이 여기서 뿌려짐'],
  ['제약(constraint)', '어떤 국소 영역(bin)도 셀 밀도가 목표치를 넘지 않음', '이 프로젝트 config의 `PL_TARGET_DENSITY_PCT`(대부분 40)가 바로 이 목표치 — 넘으면 그 bin 안 셀들이 물리적으로 겹치게 되어 다음 단계에서 풀 수 없음'],
] as const

const replaceCostTerms = [
  ['WL(x, y) — 배선 항', 'HPWL(반주변 길이)은 min/max로 정의돼서 미분이 안 됨 → log-sum-exp로 부드럽게 근사해서 경사(gradient)를 계산 가능하게 만듦', '"셀을 어느 방향으로 옮기면 배선이 짧아지는가"를 매 스텝 수치로 answer할 수 있게 하는 장치'],
  ['D(x, y) — 밀도 항 (RePlAce의 핵심)', '각 셀을 면적에 비례하는 "전하(charge)"로 보고, bin별 밀도를 전하 밀도로 취급 — 정전기학의 Poisson 방정식(∇²φ = −ρ)을 FFT로 풀어서 과밀한 bin에서 셀을 밀어내는 힘(potential의 gradient)을 얻음', 'FFT를 쓰는 이유: 격자(bin) 전체에 대해 이 방정식을 한 번에 빠르게 풀 수 있어서 — 셀이 수만 개여도 이 힘의 계산 자체는 비싸지 않음'],
  ['λ (penalty weight)', 'F(x,y) = WL(x,y) + λ·D(x,y) 하나의 숫자로 합칠 때, 밀도를 얼마나 중요하게 볼지 정하는 가중치 — 고정값이 아니라 반복마다 자동으로 올라감(밀도 위반이 아직 크면 다음 스텝은 밀도를 더 신경쓰게 λ를 키움)', 'ePlace(RePlAce의 전신)는 이 가중치를 수동으로 튜닝해야 했음 — RePlAce가 이걸 자동화한 게 논문의 핵심 기여. 이 프로젝트는 이 내부 튜닝을 건드리지 않고 OpenROAD 기본값을 그대로 씀'],
] as const

// 스케일 검증 — "셀 수가 많아져도 빠른가?"를 실측으로 답한다. 2026-09-24.
// daq_subsystem의 27번(global placement) runtime.txt가 09:24:18(9시간24분)로
// 나와서 처음엔 "RePlAce가 25만 셀에서 느려진다"로 보였으나, 앞뒤 스테이지
// (23~26, 28)의 mtime을 대조해서 확인한 결과 이 스테이지 도중 호스트가 절전
// 상태로 들어갔다가 나중에 깨어난 것 — 진짜 계산 시간이 아니라 벽시계 시간이
// 부풀려진 것으로 판명. 그래서 "빠르다"고 성급히 결론 내리지 않고, 정직하게
// "아직 확인 못 함"으로 기록한다.
const scaleCheck = [
  ['chan_top (~46,000 셀)', '00:01:55 ~ 00:02:06 (두 번의 정상 완주 런에서 일관됨)', '신뢰 가능 — 두 값이 비슷해서 정상 변동 범위로 보임'],
  ['daq_subsystem (~257,000 셀, 5.6배)', '기록값 09:24:18 — 그러나 오염됨', '신뢰 불가 — 아래 "오염 판정 근거" 참고. 진짜 계산 시간 미확인'],
] as const
const scaleCheckEvidence = [
  ['23 (GlobalPlacementSkipIo)', '00:04:23', '정상'],
  ['24 (IOPlacement)', '00:02:21', '정상'],
  ['25 (CustomIOPlacement)', '00:00:00.005', '정상 (거의 즉시)'],
  ['26 (ApplyDefTemplate)', '00:00:00.006', '정상 (거의 즉시)'],
  ['27 (GlobalPlacement) ← 문제', '09:24:18.404', '이상 — 13:16:44 시작, 22:41:03 완료 기록'],
  ['28 (WriteVerilogHeader)', '00:00:31', '정상 (27 종료 직후 다시 정상 속도로 복귀)'],
] as const

const replaceStepLoop = [
  ['0 (준비, 1회만)', 'InitialPlace — 밀도는 무시하고 순수 wirelength만 최소화하는 이차식을 Conjugate Gradient(CG)로 풀어서, 저렴하게 "적당히 괜찮은" 시작점을 확보', '이 프로젝트 chan_top 로그 실측: `[InitialPlace] Iter: 1 CG residual: 0.00013173 HPWL: 358,105,888` → `Iter: 3 ... HPWL: 190,130,627` — CG 3번만으로 HPWL이 거의 반토막. 이 시작점이 나쁘면 이후 Nesterov 단계가 훨씬 더 오래 걸림'],
  ['1', '현재 배치를 bin 격자에 투영해서 bin별 밀도 계산', '이 프로젝트 로그: `[GPL-0016] CoreArea: 613,701 um^2`, `[GPL-0019] Util: 28.771%` 처럼 셀 면적/코어 면적 비율이 여기서 나옴'],
  ['2', 'WL 항의 gradient 계산 — 셀마다 "이 방향으로 옮기면 배선이 짧아진다"는 벡터', '앞서 log-sum-exp로 부드럽게 만든 덕에 이 계산이 해석적(analytic)으로 바로 나옴'],
  ['3', 'density 항의 gradient 계산 — Poisson 방정식을 FFT로 풀어서, 과밀한 bin의 셀들이 빈 이웃 bin 쪽으로 밀리는 힘', '이게 "제약을 만족시키는" 실제 메커니즘 — 규칙을 어기면 안 된다고 막는 게 아니라, 어길수록 더 세게 밀어내는 부드러운 힘으로 표현'],
  ['4', '두 gradient를 F = WL + λ·D 기준으로 합침', '이 시점의 λ 값 — 아직 밀도가 많이 위반 중이면 큰 값'],
  ['5', 'Nesterov 가속 경사하강으로 모든 셀의 좌표를 동시에 갱신', '일반 경사하강("지금 위치에서 gradient만큼 이동")과 다르게, "이전 이동 방향으로 미리 한 걸음 더 나가본 지점"에서 gradient를 재서 그 방향으로 이동 — 매 스텝의 실제 이동량이 더 정확해져서 같은 반복 수로 더 빨리 수렴함'],
  ['6', '이번 스텝 후 밀도 위반이 얼마나 남았는지 측정 ("overflow" = 목표 밀도를 넘는 면적의 비율)', '이 프로젝트 실측(아래 "PPA 민감도" 섹션 표): chan_top 세 실행 모두 overflow 0.0987~0.0990 근방에서 수렴 — DreamPlace 비교 때 언급된 목표치(0.07)보다는 느슨하지만, OpenROAD 기본 설정으로 안정적으로 도달하는 수준'],
  ['7', 'overflow가 아직 크면 λ를 올리고 1번으로 돌아감. overflow가 충분히 작아지고 wirelength도 더 줄지 않으면 종료', '이 반복 전체가 "RePlAce (Global Placement)" 한 단계 — 이 프로젝트 chan_top 완주 런에서 2분06초 걸림(위 "실행 구조" 표의 0번)'],
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
      <p className="rtl-guide-note">둘 중 하나를 "정답"으로 미리 정하지 않는다 — daq_subsystem처럼 반복 구조(8채널 동일)가 강한 설계는 hierarchical이 유리할 가능성이 높지만, 실측(4단계) 없이는 가정일 뿐이다. 이 탭의 목적은 그 실측을 최소 비용으로 빨리 얻는 것.</p>
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

    <section className="card"><div className="card-title"><div><small className="kicker">RePlAce 알고리즘 설명 · 2026-09-24</small><h2>전역 배치가 실제로 무엇을 계산하는가</h2></div></div>
      <p>위 "탐색 구조"·"동시성" 섹션은 <b>RePlAce를 언제·몇 번 부르는지</b>를 다뤘다. 이 섹션은 <b>RePlAce 자체가 매 호출마다 무엇을 계산하는지</b>를 다룬다. OpenROAD의 <code>gpl</code> 모듈이 곧 RePlAce 논문(Cheng et al., ICCAD'18/TCAD'19)의 구현체이고, 이 프로젝트의 모든 블록이 실제로 이걸 통해 배치됐다 — 아래는 chan_top 실행 로그에서 그대로 뽑은 실측치를 근거로 한다.</p>
      <p><b>1. 무엇을 풀고 있는 문제인가:</b></p>
      <div className="data-table"><table><thead><tr><th>구분</th><th>내용</th><th>이 프로젝트에서의 의미</th></tr></thead><tbody>{replaceProblem.map(([kind, content, note]) => <tr key={kind}><td><b>{kind}</b></td><td>{content}</td><td>{note}</td></tr>)}</tbody></table></div>
      <p><b>2. cost function을 어떻게 만드는가 — F(x, y) = WL(x, y) + λ·D(x, y):</b></p>
      <div className="data-table"><table><thead><tr><th>항</th><th>어떻게 계산하나</th><th>왜 이렇게 하나</th></tr></thead><tbody>{replaceCostTerms.map(([term, how, why]) => <tr key={term}><td><b>{term}</b></td><td>{how}</td><td>{why}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note">핵심 아이디어를 한 문장으로: <b>"밀도 위반을 하지 마라"는 딱딱한 규칙을, "위반할수록 더 세게 밀어내는 부드러운 힘"으로 바꿔서 wirelength 항과 똑같이 미분·최적화할 수 있게 만든 것</b>이 RePlAce(의 전신 ePlace)의 트릭이다. 힘이 부드럽기 때문에 "배선을 줄이는 방향"과 "밀도를 지키는 방향"을 매 스텝 하나의 숫자(F)로 저울질할 수 있다.</p>
      <p><b>3. 매 스텝마다 실제로 하는 일 — wirelength를 줄이면서 constraint를 만족시키는 반복 루프:</b></p>
      <div className="data-table"><table><thead><tr><th>스텝</th><th>하는 일</th><th>이 프로젝트 실측/근거</th></tr></thead><tbody>{replaceStepLoop.map(([step, what, evidence]) => <tr key={step}><td><b>{step}</b></td><td>{what}</td><td>{evidence}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note"><b>"현재 구현된 수준"에서 짚어둘 것:</b> 이 프로젝트는 RePlAce/gpl 내부의 λ 스케줄링·bin 크기·수렴 기준 같은 하이퍼파라미터를 하나도 직접 건드리지 않는다 — OpenLane이 노출하는 건 <code>PL_TARGET_DENSITY_PCT</code>(밀도 제약의 목표치, 위 표의 "제약"에 들어가는 입력값) 정도뿐이고, 나머지(λ를 얼마나 빨리 올릴지, Nesterov의 step size를 어떻게 잡을지)는 OpenROAD 기본값 그대로다. 즉 이 섹션은 "이 프로젝트가 커스텀 구현한 것"이 아니라 "이미 잘 만들어진 알고리즘을 그대로 호출해서 쓰고 있다"는 사실 자체를 정확히 설명하는 것이 목적이다.</p>
      <p><b>4. 셀 수가 많아져도 빠른가? — 실측으로 확인, 결과는 "아직 모름":</b></p>
      <p>이론적으로는 그래야 한다 — 밀도 항을 FFT로 풀기 때문에 이 부분은 대략 O(N log N), 배선 항도 net 개수에 선형이라, 옛날식(모든 셀 쌍을 직접 계산하는 O(N²)) 배치 방식보다 훨씬 잘 스케일해야 한다. 이 프로젝트의 실제 완주 데이터로 검증을 시도했다:</p>
      <div className="data-table"><table><thead><tr><th>설계 (셀 수)</th><th>RePlAce 단계 실제 소요</th><th>신뢰도</th></tr></thead><tbody>{scaleCheck.map(([design, time, trust]) => <tr key={design}><td><b>{design}</b></td><td>{time}</td><td>{trust.startsWith('신뢰 가능') ? <span className="ok-badge">{trust}</span> : <span className="warning-badge">{trust}</span>}</td></tr>)}</tbody></table></div>
      <p><b>오염 판정 근거</b> — daq_subsystem의 27번 스테이지 앞뒤를 실제 <code>runtime.txt</code>로 대조:</p>
      <div className="data-table"><table><thead><tr><th>스테이지</th><th>기록된 소요시간</th><th>판정</th></tr></thead><tbody>{scaleCheckEvidence.map(([stage, time, verdict]) => <tr key={stage}><td>{stage}</td><td>{time}</td><td>{verdict === '정상' || verdict.startsWith('정상') ? verdict : <span className="warning-badge">{verdict}</span>}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note"><b>왜 9시간24분을 그대로 못 믿는가:</b> 27번 바로 앞 4개 스테이지(23~26)는 13:14~13:16 사이에 전부 정상 속도(몇 초~4분)로 끝났고, 27번이 끝난 직후 28번도 13:16:44(27번 시작 시각) 기준이 아니라 22:41:34 — 27번이 끝나자마자 곧바로 31초 만에 정상 속도로 복귀했다. 즉 "느려진 건 27번 딱 하나뿐이고, 그 앞뒤는 멀쩡하다"는 패턴 — 이 프로젝트에서 여러 번 겪은 호스트 절전/WSL 재시작 문제와 정확히 같은 모양이다(중간에 절전 → 벽시계 시간만 몇 시간 부풀려짐 → 컴퓨터가 깨어나서 마지막 남은 계산을 마치고 정상적으로 다음 단계로 넘어감). <b>정직한 결론: 이 프로젝트는 아직 "25만 셀 규모에서도 RePlAce가 빠르다"를 실측으로 증명하지 못했다</b> — 증명하려면 daq_subsystem 27번 스테이지가 호스트 절전 없이 끝까지 도는 걸 한 번은 봐야 한다. 지금 확실히 말할 수 있는 건 "4.6만 셀에서는 일관되게 2분 안팎"이라는 것뿐이다.</p>
    </section>

    <section className="card"><div className="card-title"><div><small className="kicker">실행 구조 · RePlAce 이후 · 2026-09-21</small><h2>RePlAce부터 signoff까지, 각 단계 실제 소요시간</h2></div></div>
      <p>chan_top 완주 런(<code>RUN_2026-09-20_21-14-08</code>, 71분20초)의 실제 <code>runtime.txt</code> 값을 그대로 합산한 것 — 추정이 아니다.</p>
      <div className="analog-schematic-wrap"><PostReplaceTimeline/></div>
      <div className="data-table"><table><thead><tr><th>#</th><th>단계</th><th>실제 소요</th><th>무엇을 하나</th></tr></thead><tbody>
        {postReplaceSteps.map(([num, name, time, , , desc]) => <tr key={num}><td><b>{num}</b></td><td><b>{name}</b></td><td>{time}</td><td>{desc}</td></tr>)}
      </tbody></table></div>
      <p className="rtl-guide-note"><b>단 두 단계(3번 포스트-CTS 리페어 23분10초 + 7번 GDS/물리검증 22분38초)가 전체의 약 64%.</b> 나머지 6단계를 다 합쳐도 이 둘 중 하나에 못 미친다.</p>
    </section>

    <section className="card"><div className="card-title"><div><small className="kicker">병렬화 가능성 분석</small><h2>어디를 병렬로 돌릴 수 있고, 어디는 안 되나</h2></div></div>
      <div className="check-list">{parallelizationNotes.map(([title, note]) => <p key={title}><b>{title}</b><span>{note}</span></p>)}</div>
    </section>

    <section className="card"><div className="card-title"><div><small className="kicker">도구 선택 가이드</small><h2>언제 어떤 도구를 쓰나</h2></div></div>
      <div className="data-table"><table><thead><tr><th>상황 / 목적</th><th>추천</th><th>이유 / 재검토 시점</th></tr></thead><tbody>{toolGuide.map(([situation, tool, why]) => <tr key={situation}><td>{situation}</td><td><b>{tool}</b></td><td>{why}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note"><b>"많이 돌려서 더 나은 걸 고른다"는 SA스러운 발상 자체는 여전히 유효하다</b> — 다만 ParSAC/DreamPlace 같은 SA/GPU 전용 도구가 아니라, <b>RePlAce를 여러 후보 설정으로 병렬 반복 실행</b>하는 방식으로 이미 하고 있다: SYNTH_STRATEGY 9개 × PL_TARGET_DENSITY_PCT 여러 값 × clock period 후보를 위 "탐색 구조" 섹션의 0~1단계에서 병렬로 돌려서 싸게 거르고, 살아남은 것만 3단계(전체 P&R, 곧 RePlAce 실행)로 확정하는 구조 자체가 "여러 후보를 굴려서 고른다"는 목적을 이미 만족한다 — 알고리즘을 SA로 바꾸는 게 아니라 <b>RePlAce 호출 횟수와 입력 조합을 늘리는 것</b>이 이 프로젝트 규모에 맞는 실현 방법.</p>
    </section>
  </>
}
