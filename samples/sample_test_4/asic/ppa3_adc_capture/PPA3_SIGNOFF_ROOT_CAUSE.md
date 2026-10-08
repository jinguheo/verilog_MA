# PPA3 signoff 위반 원인 분석 (2026-10-05)

대상: `runs/ppa3_antfix4_signoff` (GDS 기준 Magic DRC), `runs/ppa3_antfix5_signoff` (LVS, DEF 기준 Magic DRC).
실행 폴더의 보고서·DEF·추출 SPICE를 읽기만 해서 분석했고, 설계·설정은 바꾸지 않았다.

## 결론 한 줄
**ADC macro 왼쪽에 남은 9.7 µm 폭의 행 조각에 tap 셀이 하나도 없다.** 이것 하나가
LVS 불일치 대부분과 top-level Magic DRC 1,853건을 함께 만든다. SRAM 내부를 뺀 DRC 1,861건 중 1,853건이 여기다.

## 근거
- ADC `u_adc` 위치: config `MACROS.instances.u_adc.location = [40, 150]`.
  - LEF 크기는 223.71 × 293.365 µm이므로 ADC는 x 40–263.7, y 150–443.4 µm에 놓인다.
- halo는 설정하지 않아 기본값(10 µm)이 쓰였다. 행은 x≈29.9에서 잘리고, 코어 왼쪽 끝(x≈20.2)과의 사이에 9.7 µm 조각이 남는다(y 138.7–451.5).
- tap 셀(`tapvpwrvgnd_1`)은 25.76 µm 간격 격자에 놓인다. 이 조각 116개 행에는 tap이 0개이고, 그 행들의 첫 tap은 ADC 오른쪽 x=299.92에 있다.
- 인접 행이 N-well을 공유하므로, 116개 조각은 **떠 있는 N-well 섬 57개**가 된다.

### LVS (`07-netgen-lvs/reports/lvs.netgen.rpt`)
- 추출 SPICE에 `FILLER_<행>_3/VPB` 이름의 net이 **57개** 있다. 모두 x=21.62의 decap_12이고, 행은 45–157 홀수 행이다.
- schematic과 비교한 차이는 셀 3종뿐이다(나머지 110종은 개수 일치).
  - `decap_12` +57
  - `decap_3` +57
  - `fill_1` +2
  - 합계 +116이고, 이는 device 차이 1553−1437=116과 정확히 같다.
- 원리: schematic에서는 전원만 연결된 decap이 모두 같은 VPWR/VGND에 병렬로 붙어 하나로 합쳐진다. 레이아웃에서는 VPB가 57개 섬으로 갈라져 따로 남는다. 그래서 net 차이가 1391−1332=59가 되고, net 매칭이 무너지며 핀 표 전체가 "no matching pin"으로 나온다(증상).
- ADC·SRAM은 양쪽 모두 placeholder(device 0)로 비교된다(`MACROS.*.spice = []`). macro 내부는 이 LVS에서 비교하지 않는다.
- 비교한 schematic은 `ppa3_antfix2/16-openroad-fillinsertion/ppa3_adc_capture_top.pnl.v`다(resume 체인).

### Magic DRC, GDS 기준 (antfix4, 15,861,362건)
| 영역 | 건수 |
|---|---|
| SRAM macro 내부 (x 430–1194.2, y 65–525.3) | 15,859,501 |
| **ADC 왼쪽 9.7 µm 조각** | **1,853** (LU.3 908 · LU.2 888 · nwell.4 57) |
| ADC macro 내부 | 0 (이 OpenLane 실행 기준) |
| top 기타 | 8 (LU.2) |

- `nwell.4` 57건은 LVS의 VPB 섬 57개와 같은 수다.
- LU.2/LU.3(래치업: diff–tap 거리 15 µm 초과)는 tap이 없어서 생긴다.
- 참고: 대시보드의 "ADC 전체 19건"은 CACE/Magic으로 따로 검사한 결과다. 이 OpenLane 실행의 DRC와는 아직 맞춰 보지 않았다.

### KLayout DRC 1건 (npc.2, antfix4)
- 위치: x≈977.25–977.5, y≈49.6–49.9 µm (SRAM 아래 표준셀 행).
- 맞닿은 두 셀:
  - `u_capture_path.u_capture.u_capture_sram.u_sram22_63` (`conb_1`, FN, x 976.12–977.50)
  - `_0988_` (`and3_1`, N, x 977.50–979.80)
- 두 셀의 npc 간격이 0.255 µm로, 규칙 0.27 µm보다 좁다. 셀 한 칸 띄우기 또는 방향 변경 ECO로 고칠 수 있다.

### 같은 유형이지만 위반이 없는 곳
SRAM 오른쪽에도 25.3 µm 폭 조각 88개(x 1204.3–1229.6, y 57–530)가 tap 없이 남아 있다.
이번 GDS DRC와 LVS에서는 이 영역에 위반이나 섬이 나오지 않았다. halo를 바꾸면 다시 확인해야 한다.

## 수정안 (아직 실행하지 않음)
1. **ADC를 왼쪽으로 옮겨 조각을 없앤다(권장).** `location`을 `[40,150]` → 약 `[30.24,150]`로 바꾼다.
   - 코어 왼쪽 끝 + halo 10이 되므로 남는 행 폭이 0이 된다.
   - DEF `ROW` 시작 좌표가 x=20.240 µm(`ROW ROW_0 unithd 20240 …`)임을 확인했다. 30.24 = 20.24 + halo 10이다.
   - ADC 왼쪽 핀까지의 배선 여유(die 끝에서 약 30 µm)도 확인해야 한다.
2. 또는 ADC 왼쪽 행 조각에 tap을 넣거나 행을 제거한다(placement blockage / row cut).
3. npc.2는 해당 두 셀 사이를 1 site 띄운다.
4. 위 수정 후 floorplan부터 다시 실행해 GDS 기준 Magic DRC·LVS를 재확인한다. SRAM 내부 1,585만 건은 macro 자체 문제라 별도로 판정한다(top-level signoff에서 waiver 또는 macro 교체).

### max slew 42 · max cap 1 (ss 코너, antfix2 `19-openroad-stapostpnr/max_ss_100C_1v60/checks.rpt`)
- **sram22 입력 핀 21개(din·addr·we·clk)**
  - lib의 `max_transition`은 0.351 ns인데, 실제 slew는 최대 0.849 ns(`din[26]`)다.
  - clk 핀은 0.708 ns다. clk는 클록 net이라 repair_design이 아니라 CTS가 담당한다.
- **net 하나, `_1375_/Y`**
  - 셀 10개를 구동하고 싱크마다 antenna 다이오드가 붙어 slew가 1.826 ns(한계 1.5)다.
  - max cap 1건(0.084 pF, 한계 0.065)도 이 net이다.
- **원인:** classic flow 순서가 `RepairDesignPostGRT` → `HeuristicDiodeInsertion` → `DetailedRouting`이다.
  - 수리 뒤에 붙는 다이오드 부하와 배선 후 RC 증가가 기본 여유(배치 후 20%, GRT 후 10%)를 넘는다.
  - `RSZ_CORNERS`는 기본값으로 전체 STA 코너를 쓰므로, 코너 누락 문제는 아니다.

## 실행 (2026-10-05 20:32~)
| run | 설정 | 바꾼 것 |
|---|---|---|
| `runs/ppa3_adcshift` | `config_adcshift.json` + `macro_placement_adcshift.cfg` | ADC x 40 → 30.24만 (나머지는 config_antfix4와 동일) |
| `runs/ppa3_adcslew` | `config_adcslew.json` | 위 + `DESIGN_REPAIR_MAX_SLEW/CAP_PCT` 50, `GRT_DESIGN_REPAIR_MAX_SLEW/CAP_PCT` 50, `CTS_MAX_SLEW` 0.2 ns |

- 둘 다 처음부터 전체를 실행한다(`tools/wsl/126_run_ppa3_full.sh`, `121_launch_ppa3_detached.sh`로 detached 실행).
- 결과 요약은 `tools/wsl/logs/ppa3_<variant>.summary`에 남는다.
- 중간 확인(adcshift, 18-openroad-tapendcapinsertion DEF):
  - ADC는 30.24에 놓였다.
  - ADC 왼쪽의 tap 없는 행 조각은 **0개**다(이전 116개).
  - SRAM 오른쪽 25.3 µm 조각 88개는 그대로 있다.

ADC 크기를 줄이는 것은 해결책이 아니다. 원인은 macro 크기가 아니라, 코어 가장자리와 macro halo 사이에 tap 격자보다 좁은 행 조각이 남는 배치다.
