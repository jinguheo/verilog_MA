# Evolution SA 구현 계획

## 목표

AI Chip Tetris에 이미 저장된 legal 배치 후보를 초기 population으로 사용하고, 알고리즘이 후보 선택·변이·Simulated Annealing(SA)·평가를 반복해 현재 cost 기준의 더 나은 배치를 자동으로 찾는다. 이 단계는 계획 수립이며, 자동 진화 실행 기능 자체는 아직 구현하지 않았다.

## 현재 기반

- 후보는 브라우저 localStorage의 `chip-tetris-legal-candidates-v2`에 저장된다. 항목에는 generation/index, score, congestion, replacements와 전체 GameState가 들어 있다.
- `placementSignature`로 동일 배치를 식별할 수 있고, `createEliteMutation`은 기존 후보에서 블록 하나를 legal하게 재배치한다.
- `runReplaceThenAnnealing`은 Re-place와 SA를 실행한다. Web Worker 인터페이스도 이미 있어 UI 스레드를 막지 않는 계산에 재사용할 수 있다.
- `evaluatePlacement`는 높이, 구멍, 울퉁불퉁함, zone/spacing, power/pin access, integrity, 혼잡, macro clearance, wirelength proxy 등을 가중 합산한다. `measureBoard`는 이 breakdown을 반환한다.

## 무작위 대신 규칙·실패 이력 기반 탐색

후보 수 자체를 늘리기보다, 실제 규칙·설정·실패 기록이 다음 변이 방향을 안내하게 한다.

### 사전 지식 만들기

1. **Magic sky130 DRC 규칙 catalog:** 사용 중인 PDK/Magic rule deck의 버전과 원본 경로를 고정하고 규칙 ID, 관련 layer, 조건/거리, 매크로 경계·tap·well 관련성을 추출한다. `nwell.4`, `LU.2/LU.3`, `diff/tap`은 우선 조사 대상으로 두되, 규칙명만으로 의미를 추정하지 않고 deck 정의와 실제 report를 함께 확인한다.
2. **OpenLane macro 주변 설정:** 실제 run config와 flow script에서 macro halo/keepout, tapcell/endcap 삽입, PDN 연결·strap 정책, macro pin 접근 관련 값을 읽어 설정 provenance와 함께 저장한다. 값이 누락된 경우 안전한 것으로 가정하지 않고 unknown으로 둔다.
3. **실패 이력 기억:** 과거 Magic/KLayout DRC, LVS, OpenROAD/STA 로그와 summary를 수집한다. run/design/PDK/deck/config 버전, rule ID, 좌표·layer·대상 instance, 실패/수정 후 결과를 정규화해 후보에 risk feature로 붙인다. 같은 위반 fingerprint는 변이 비용을 올리고 수정된 사례는 회피 패턴으로 기록한다.
4. **STA 기준 자료:** 실제 SDC에서 clock, uncertainty, input/output delay, false/multicycle path 등의 제약을 가져오고 과거 critical path의 start/end 및 slack을 저장한다. 초기 floorplan 단계는 배선 전 추정치임을 표시하고, placement/global route 이후 parasitic 추정으로 후보 순위를 갱신한다.

### 다음 후보를 고르는 법

- 확정된 hard DRC/placement constraint 위반은 후보를 거부한다. 아직 PDK rule deck으로 확인하지 못한 risk는 낮은 confidence의 soft penalty로만 사용한다.
- 예측 risk가 큰 경계 주변은 무작위 이동을 줄이고 halo/keepout을 키우거나, tap/endcap·PDN·pin access를 개선하는 방향으로 표적 변이를 만든다.
- STA에서 반복되는 critical path가 있으면 그 경로의 driver/sink·연결 macro·혼잡 corridor를 중심으로 wirelength와 congestion을 낮추는 변이를 우선 생성한다. 경로 정보가 없는 매크로 이동만으로 timing이 개선된다고 가정하지 않는다.
- 탐색은 risk-guided mutation을 기본으로 하고 소량의 diversity mutation을 남겨 모델의 blind spot과 조기 수렴을 감시한다. 부모 선택은 score, 예상 DRC/STA risk, 배치 다양성을 함께 본다.
- 각 예측에 rule/config/log 출처와 confidence를 붙인다. 실제 DRC/STA 결과가 들어오면 예측과 비교해 가중치를 갱신하며, clean report가 없는 것은 clean으로 학습하지 않는다.
## 제안하는 세대 실행

1. 저장 후보를 읽고 손상·불법 상태를 걸러낸 다음 signature 중복을 제거한다. 후보가 10개면 우선 이들을 초기 부모 풀로 삼는다.
2. 모든 후보를 현재 엔진으로 다시 평가한다. 총점 순위와 함께 cost 항목별 차이, legal 상태, signature 유사도를 보여준다.
3. 상위 elite는 그대로 보존하고, cost가 좋은 후보와 서로 다른 배치 특성을 가진 후보를 함께 부모로 선택한다. 점수 1위만 반복 선택하지 않아 조기 수렴을 줄인다.
4. 부모 하나에서 매크로/블록 하나를 옮기는 변이를 수행한다. 후보를 조합하는 crossover는 block identity와 hard constraints를 보존하는 방식이 검증된 뒤 후속 단계로 추가한다.
5. legal 검사에 통과한 자식에 Re-place→SA를 실행한다. 자식의 seed와 parent signature를 저장해 재현할 수 있게 한다.
6. 부모와 자식을 합쳐 중복 제거 및 elite 보존을 하고 다음 세대를 구성한다. 개선 정체가 이어지면 mutation 폭을 키우고, diversity 하한을 회복한다.
7. 세대별 best/median/worst score, cost breakdown, diversity, 개선 정체 횟수를 기록한다. Pause/Resume/Stop, 세대 한도, 후보 한도를 제공한다.

## 빠른 검증 funnel

후보를 많이 만들기 위해 모든 후보에 full signoff를 실행하지 않는다. 검증 비용과 실제성에 따라 단계별로 거른다.

1. **배치 전 빠른 검사:** 현재 Tetris 엔진의 hard constraints, overlap, 영역·인접·pin/power access 검사를 모든 자식 후보에 적용한다. 비용이 낮아 대량 탐색에 사용한다.
2. **배치 품질 추정:** wirelength·혼잡·pin access proxy를 계산하고, 필요하면 OpenROAD global placement의 routability/congestion 추정 또는 global-route 지표를 소수 후보에 추가한다. 이 단계는 실제 DRC pass를 의미하지 않는다.
3. **조기 layout DRC:** GDS/DEF 등 실제 레이아웃 형상이 생성된 후보에서만 빠른 DRC runset을 적용한다. 빠른 rule subset은 후보 탈락용이며, 최종 signoff DRC와 동일하다고 표시하지 않는다.
4. **최종 DRC/LVS:** 상위이면서 서로 다른 후보만 full signoff deck으로 DRC하고, 실제 layout에서 netlist를 추출해 기준 netlist와 비교하는 LVS를 수행한다. LVS 결과는 라우팅/추출된 layout이 있을 때 의미가 있으므로 placement proxy만으로 대체하지 않는다.

## 비교 기준
- 우선 hard constraint: 위반 후보는 보관·승격하지 않는다.
- 단일 proxy 점수는 현재 `evaluatePlacement`의 최대화 결과로 비교한다. UI에는 cost 성분을 별도로 표시해 점수 개선의 대가를 숨기지 않는다.
- 목적이 area·혼잡·wirelength 간 trade-off로 넓어지면 NSGA-II 등 다목적 순위화로 확장한다. 그 전에는 Pareto frontier를 기록해 가중치에 따른 후보 손실을 확인한다.
- 점수와 혼잡은 게임 모델의 proxy다. 실제 PPA, DRC/LVS, routability 통과로 표현하지 않는다. 최종 검증은 선정 후보를 실제 P&R flow에 넣어 확인한다.

## 구현 단계와 완료 조건
