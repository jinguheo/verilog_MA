# macro 배치 개선 계획: 할 일 목록과 꼭 쓸 방향

작성 2026-10-17. 근거: 우리 실행 기록(NEXT_SESSION.md, daq_subsystem runs, optimization_history.json), 연구 동향 탭의 논문 분석(EXPlace, PlaceReasoner-Beta 등).
기존 [ppa3-evolution-learning.md](ppa3-evolution-learning.md)의 "증거 → 가설 → 소수 실험 → 검증 → 지식 갱신" 루프를 이어서, 무작정 많이 돌리는 대신 **정보가 큰 소수 실행**으로 가기 위한 정리다.

## 지금까지 확인한 사실

| 사실 | 근거 |
|---|---|
| 후보 이력 25건이 사실상 3종(상대 배치)이고 물리 검증은 0건이었다 | `tools/proxy_vs_real_gap.py` 출력 |
| 실제 OpenLane 라벨은 daq_subsystem에서 통과 1, 실패 2(원인이 서로 다름)뿐이다 | `failure_knowledge.json` |
| 같은 배치를 다시 돌린 2건은 오류 없이 중간에 멈췄다(배치의 증거가 아님) | `failure_knowledge.json` 상태 `incomplete_no_error` |
| 모델 proxy는 채널 폭만 실제와 맞았고, 혼잡은 가리지 못했다 | `docs/proxy-vs-real-gap.md` |
| 논문 표에서도 전체 흐름으로 가면 배선 길이는 WNS를 거의 예측하지 못한다(상관 −0.08) | 같은 문서 B절 |
| SA 모드의 후보 10개가 실제로는 1개 상대 배치로 수렴한다 | `optimize_candidate(mode="sa")` 측정 |

## 꼭 쓸 방향 (이것만은 유지)

1. **한 번에 한 요소만 바꾼 통과/실패 쌍을 만든다.** 채널 폭 300(통과) 대 100(실패)의 깨끗한 대조가 있었기에 하드 게이트를 만들 수 있었다. 혼잡은 이런 쌍이 없어서 게이트를 못 만들었다.
2. **경계는 이분 탐색으로 찾는다.** 무작위 25회 대신 300 → 200 → 150/250 식으로 3~4회.
3. **실패는 대조쌍이 있을 때만 `reject`로 올린다.** 단독 실패는 `record_only`(경고만)이다. 후보를 제거하는 규칙은 근거가 있어야 한다.
4. **중단된 실행은 라벨이 아니다.** 오류 없이 멈춘 실행(절전 등)은 배치의 좋고 나쁨을 보여 주지 않는다.
5. **후보는 상대 배치로 중복을 없앤다.** 평행이동과 수 µm 흔들림은 같은 정보다. 비싼 단계에는 서로 다른 정보를 주는 후보 최대 3개만 올린다.
6. **단계별 깔때기**: 싼 검사는 많이, 비싼 실행은 선택적으로. 승격은 "기존 최선안 보존 + WNS 우선"(통과하지 못하면 기존 것을 유지).
7. **proxy는 걸러내는 용도이지 고르는 용도가 아니다.** 좋은 후보들 중 순위는 실제 단계 실행으로만 정한다.
8. **결과는 설계별로 보고한다.** 합계 감소율만 내세우지 않는다(EXPlace 분석에서 확인한 함정).
9. **새 실패는 반드시 실패 DB에 기록하고 규칙을 재검토한다.** `tools/build_failure_knowledge.py`의 `RUNS`에 추가.

## 이번에 끝낸 것 (1~3번)

| # | 내용 | 파일 |
|---|---|---|
| 1 | 후보 중복 제거: 상대 배치 지문, 근접·평행이동 판별, 이력 정리(25 → 2, 23건은 사유와 함께 보관), 생성기와 이력 저장에 연결(풀이 서로 다른 배치 10개로 구성) | `candidate_dedup.py`, `tools/dedup_candidate_history.py`, `layout_candidate_runner.py`, `optimization_history_duplicates.json` |
| 2 | 실패 DB: 실제 실행 5건(라벨 3, 중단 2)을 로그에서 읽어 구조화, 규칙 2개(채널 300 reject, 산개 배치 경고), ppa3 DRC 회피 패턴을 후보 생성에 적용(ADC x=40 제외), 점검 CLI | `failure_knowledge.py`, `tools/build_failure_knowledge.py`, `failure_knowledge.json`, `tools/check_candidate_against_failures.py` |
| 3 | proxy 대 실제 격차 표(우리 데이터 + 논문 표 계산) | `tools/proxy_vs_real_gap.py`, `docs/proxy-vs-real-gap.md`, `proxy_gap.json` |

테스트: `python -m pytest tests/test_candidate_dedup.py tests/test_failure_knowledge.py tests/test_layout_candidate_runner.py -q`

## 할 일 (우선순위 순)

- [x] **1. 후보 중복 제거**
- [x] **2. 실패 DB 정리와 후보 생성 활용**
- [x] **3. proxy 대 실제 격차 표**
- [ ] **4. 채널 폭 경계 이분 탐색** — 200 µm 실행(ResizerTimingPostCTS까지) 후 150/250. 실제 OpenLane 실행 필요. `failure_knowledge.json`의 `next_experiments` 참고
- [ ] **5. 혼잡 실패의 대조쌍 만들기** — 통과한 grid에서 v2 방향으로 25/50/75% 이동한 후보를 GlobalRouting까지 실행
- [ ] **6. 저비용 라벨러 확인** — OpenLane 2.3.10이 특정 단계까지만 실행하는 방식을 지원하는지 확인(미확인). 되면 후보당 비용이 크게 준다
- [ ] **7. 승격 규칙 도입** — 기존 최선안 보존 + WNS 우선(PlaceReasoner-Beta 방식). 실패하면 기존 것 유지
- [ ] **8. TypeScript Macro Tetris와 규칙 동기화** — 지금 `CHANNEL_SAFE_MARGIN=300`은 TS에 손으로 적혀 있고 Python 쪽 `failure_knowledge.json`과 값을 맞춰야 한다. JSON을 TS가 읽도록 하거나 동기화 검사를 추가
- [ ] **9. EXPlace 비용 항을 탐색 목적 함수에 추가** — 주기(Σ(dx+dy)), grouping(그룹 bbox 면적), dataflow 가중 거리, I/O keepout 겹침. 기준 grid 대비 A/B (연구 동향 탭 참고)
- [ ] **10. Hier-RTLMP(`rtl_macro_placer`)를 외부 baseline으로** — 설치된 OpenROAD 버전에 포함되는지 먼저 확인(미확인)
- [ ] **11. ppa3 후보의 물리 검증** — 이력에 남은 2개 중 최대 2~3개를 L0 → L3 승격(기존 문서 순서). 아직 0건
- [ ] **12. SA 다양성** — SA 모드가 1개 배치로 수렴한다. 목적 함수나 재시작을 바꾸거나 격자 후보와 섞어 다양성을 확보
- [ ] **13. 라벨 15~20개 확보 후 proxy 보정** — 단순 분류 모델. 3개일 때는 이르다
- [ ] **14. 새 실행마다 실패 DB 갱신** — `RUNS`에 추가 후 `python tools/build_failure_knowledge.py`, 이어서 `proxy_vs_real_gap.py`

## 사용법 요약

```bash
python tools/check_candidate_against_failures.py <config.json>   # 후보가 기록된 실패를 반복하는지 (reject면 종료 코드 1)
python tools/dedup_candidate_history.py [--apply]                # 이력 중복 정리 (기본은 미리보기)
python tools/build_failure_knowledge.py [--check]                # 실제 실행 폴더에서 실패 DB 재생성
python tools/proxy_vs_real_gap.py                                # 격차 표 재생성
```
