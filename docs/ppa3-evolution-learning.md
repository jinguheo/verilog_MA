# PPA3 면적 후보와 경험 기반 진화 루프

## 목표와 현재 상태

- 목적: DRC/LVS/STA/전원/배선 제약을 만족하는 최소 die 면적을 찾고, 남은 틈에 필요한 filler 및 전원 분석으로 정해진 decap만 배치한다.
- die 폭과 높이는 독립 변수다. 위반이 발생하면 같은 면적의 가로형/세로형 재배치부터 시험하고, 필요한 경우에만 면적을 늘린다.
- 현재 8개 후보는 기하 검증만 완료했다. 물리 실행은 0건이다. 3개만 첫 승격 대상으로 표시했다.
- 기존 PPA3 antfix5는 route DRC 0이지만 Magic DRC 559, LVS 363 및 slew 위반이 남아 완전 통과 기준이 아니다.

## 판단에 쓰는 두 지식 DB

- [제약 DB](../physical_design/layout_candidates/ppa3_constraint_knowledge.json): 실제 설치된 sky130A 기술 LEF, 표준셀 LEF/Liberty, 매크로 LEF, OpenLane 설정, Magic deck의 nwell.4/LU.2/LU.3 출처를 기록한다. PDK deck의 확정 규칙과 DEF에서 추정한 halo를 구별한다. 라이브러리 면적·핀 정보는 빠른 선별용이며 후보의 timing 통과를 대신하지 않는다.
- [DRC 경험 DB](../physical_design/layout_candidates/drc_knowledge.json): 실행별 config/매크로/면적, DRC 검사 범위, 규칙별 위반 수, LVS/STA 지표와 출처를 저장한다. 매크로 추상화와 전체 GDS 검사는 절대 같은 분모로 비교하지 않는다. 위반 감소만으로 해결 원인을 확정하지 않는다.
- DB의 avoid_patterns는 관측된 동일 실패 형상을 재생성하지 않도록 후보 생성기에 적용된다. 현재 ADC 왼쪽 9.76 µm 행 조각은 관측 실패 패턴이며, x=30.24 µm 이동은 미검증 해결 가설이다. 해결 사례는 같은 DRC 범위에서 해당 규칙이 0이 될 때만 resolutions에 기록한다.

## 한 번에 많이 돌리지 않는 순서

1. 후보와 제약 DB를 대조한다. die/core/halo, 사이트 격자, 매크로 겹침, 과거 실패 특징값, 행 용량을 먼저 검사한다.
2. 각 후보에 검증 가능한 가설 하나를 붙인다: 어떤 규칙이나 병목이 개선될지, 반대로 무엇이 악화될지 적는다. 개선 목표·위험·불확실성을 함께 남긴다.
3. 서로 다른 실패 원인을 구분할 수 있는 최대 3개만 첫 검증 대상으로 고른다. 현재는 compact-balanced(기본 축소), wide-low(높이 축소/하단 접근), vertical-relaxed(위아래 매크로 구조)다. 9.2% 기하 경계의 compact-limit는 무조건 먼저 전량 실행하지 않는다.
4. L0 기하 → L1 tap/PDN → L2 배치/배선/STA → L3 DRC/LVS 순으로 승격한다. 앞 단계에서 확정된 실패는 동일 fingerprint로 다시 실행하지 않는다. 최종 소수만 전체 GDS DRC를 수행한다.
5. 실행마다 python tools/ppa3_area_experiments.py collect로 관측을 재수집한다. 같은 규칙·같은 검사 범위의 전후 실행이 있을 때만 resolve --before ... --after ... --rule ... --change ...로 해결 경험을 등록한다.
6. 결과가 예측과 다르면 원인을 분리한다. 면적 부족이면 동일 면적의 종횡비 교환·매크로 이동을 먼저 시험한다. PDN 설정·매크로 내부 DRC 등 면적 무관 원인은 별도 수리로 보낸다. 다음 후보는 이 분석이 바꾼 가설을 시험하도록 선택한다.
7. 물리 통과 후보가 나오면 그 후보를 새 기준으로 면적 경계를 좁힌다. 같은 설정에서 신규 정보나 면적 개선이 없으면 반복을 멈추고 막힌 규칙·구역·필요한 외부 수리를 보고한다.

이는 “많이 실행해서 우연히 좋은 해를 찾기”가 아니라 증거 → 가설 → 소수 실험 → 검증 → 지식 갱신의 루프다. LLM의 판단은 제약·실행 데이터의 출처와 상태를 함께 제시해야 하며, 가설을 PDK hard rule이나 실제 DRC 통과로 승격해서는 안 된다.

## 생성물과 명령

- 후보 목록: [area_candidates_manifest.json](../samples/sample_test_4/asic/ppa3_adc_capture/area_candidates_manifest.json)
- 각 후보의 area_candidate_<id>.json은 빠른 매크로 추상화 screening용이고, area_candidate_<id>_full.json은 전체 GDS DRC용이다. 두 파일 모두 동일한 die/core/매크로 배치를 쓴다.
- python tools/ppa3_area_experiments.py collect: 기존 결과를 중복 없이 DB에 반영.
- python tools/ppa3_area_experiments.py generate: PDK/경험 DB 확인 후 후보 설정 및 목록 생성. 물리 실행 없음.
- wsl.exe python3 /mnt/d/MyWork/Veriolg_MA/tools/build_ppa3_constraint_db.py: 현재 PDK/라이브러리 DB 갱신.
