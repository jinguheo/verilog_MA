# proxy 대 실제 격차 (자동 생성: tools/proxy_vs_real_gap.py)

싼 지표(proxy)가 나중의 실제 결과와 얼마나 맞는지 본다. A는 우리 데이터, B는 EXPlace 논문 표 값으로 계산한 외부 근거다. OpenLane을 새로 돌리지 않았다.

## A. 우리 데이터 — daq_subsystem 실제 OpenLane 결과 대 배치 지표

| 실행 | 상태 | 마지막 단계 | 오류 | row channel(µm) | 배치 | 평균 쌍거리(µm) | 라벨로 사용 |
|---|---|---|---|---|---|---|---|
| daq-grid-baseline-20260924 | completed_flow | 77-misc-reportmanufacturability | - | 300.0 | grid | 1914.3 | 예 |
| daq-grid-baseline-20260925-interrupted | incomplete_no_error | 36-openroad-resizertimingpostcts | - | 300.0 | grid | 1914.3 | 아니오(중단) |
| daq-macrotetris-v1-20260925 | failed | 38-openroad-resizertimingpostcts | DPL-0036 | 100.0 | grid | 1800.0 | 예 |
| daq-macrotetris-v1-20260926-interrupted | incomplete_no_error | 12-openroad-staprepnr | - | 100.0 | grid | 1800.0 | 아니오(중단) |
| daq-macrotetris-v2-20260926 | failed | 38-openroad-globalrouting | GRT-0118 | None | scattered | 1878.6 | 예 |

상태가 `incomplete_no_error`인 2건은 오류 없이 중간에 멈춘 재실행이다(원인은 로그에 없다. 같은 흐름이 호스트 절전으로 중단된 사례가 기록돼 있다). 설계의 좋고 나쁨을 보여 주지 않으므로 **라벨에서 제외**했다.

### 이 라벨들로 말할 수 있는 것

| 실패 유형 | 라벨 | 개수 | 결론 |
|---|---|---|---|
| hold repair 합법화(ResizerTimingPostCTS) | pass:daq-grid-baseline-20260924, fail:daq-macrotetris-v1-20260925, pass:daq-macrotetris-v2-20260926 | 3 | row channel이 300 → 통과, 100 → 실패, (v2는 채널 없음) → 통과. 지표가 라벨과 일치하지만 **2개 값(100, 300)뿐**이라 경계는 모른다 |
| 전역 배선 혼잡(GlobalRouting) | pass:daq-grid-baseline-20260924, fail:daq-macrotetris-v2-20260926 | 2 | **n=2: 어떤 지표든 둘을 가르는 것은 당연하다. 결론을 낼 수 없다.** 모델의 혼잡 휴리스틱은 둘 다 HIGH였다(노트 기준) |

모델이 낮은 가중 배선 길이를 보고한 v2(55,752 대 59,600)가 실제로는 전역 배선에서 실패했다. 낮은 배선 길이 예측이 실제 통과를 보장하지 않은 사례다(노트 기준, 로그 재확인 불가).

### 후보 이력(ppa3_adc_capture_top)

- 기록된 후보 25건, 서로 다른 정확한 배치 25건, 서로 다른 상대 배치 3건(1 µm 단위), 추정 배선 길이 값 3종.
- **실제로 검증된 후보: 0건.** 따라서 이 proxy의 격차는 아직 측정할 수 없다. 후보를 더 만들어도 라벨은 늘지 않는다.
- 중복 제거 후 이력에는 2건이 남았다(나머지는 optimization_history_duplicates.json에 사유와 함께 보관).

## B. 외부 근거 — EXPlace 논문 표(5~6개 방법 × 6~8개 설계)에서 계산

같은 설계 안에서 방법들의 순위가 두 지표 사이에서 얼마나 일치하는지(스피어만, 설계별 평균). 방법과 설계 수가 작아 설명용이다.

| 평가 | proxy | 실제 | 평균 상관 | 설계별 | 1위 방법 일치 |
|---|---|---|---|---|---|
| ICCAD (EarlyGlobalRoute 추정) | rWL | TNS | +0.81 | [0.9, 1.0, 0.9, 0.9, 0.5, 0.7, 0.8, 0.8] | 6/8 |
| ICCAD (EarlyGlobalRoute 추정) | rWL | WNS | +0.60 | [0.9, 0.7, 0.9, 0.3, 0.3, 0.0, 1.0, 0.7] | 4/8 |
| ICCAD (EarlyGlobalRoute 추정) | WNS | TNS | +0.69 | [0.7, 0.7, 1.0, 0.4, 0.9, 0.3, 0.8, 0.7] | 5/8 |
| OpenROAD (전체 흐름) | rWL | WNS | -0.08 | [-0.94, -0.43, 0.29, 0.6, -0.26, 0.26] | 1/6 |
| OpenROAD (전체 흐름) | rWL | TNS | +0.21 | [-0.71, -0.43, 0.49, 0.6, 0.71, 0.6] | 3/6 |
| OpenROAD (전체 흐름) | rWL | DRC | +0.48 | [-0.03, -0.03, 0.83, 0.89, 0.77, 0.43] | 3/6 |
| OpenROAD (전체 흐름) | WNS | TNS | +0.55 | [0.77, 1.0, -0.17, 0.89, 0.0, 0.83] | 3/6 |
| OpenROAD (전체 흐름) | TNS | DRC | +0.47 | [0.2, 0.66, 0.77, 0.66, 0.6, -0.09] | 3/6 |

## 읽는 법과 우리에게 주는 결론

1. 같은 추정 파이프라인 안(ICCAD)에서는 지표가 같이 움직이고, 전체 흐름(OpenROAD)으로 가면 배선 길이는 WNS와 거의 무관하다. **싼 지표는 나쁜 것을 걸러내는 데는 쓸 만하고, 좋은 것들 중에서 고르는 데는 못 쓴다.**
2. 우리 쪽에서 proxy가 가려낸 것은 하나뿐이다: 채널 폭(clean pair 2점). 혼잡은 아직 가릴 지표가 없다.
3. 후보를 많이 만드는 것은 라벨을 늘리지 않는다. 라벨은 실제 흐름(또는 그 일부 단계)을 돌려야만 생기므로, **어떤 후보를 돌릴지**가 핵심이다(docs/macro-placement-improvement-plan.md).
