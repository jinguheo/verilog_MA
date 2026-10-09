// Stored OpenLane evidence shared by Physical Design and P&R Research.
// Checked on 2026-10-05. These are run results, not a live process monitor.
export const physicalEvidence = [
  ['chan_top', 'signoff clean · 10/5 reshape', 'reshape_try_590x1085_axi54ant2', 'setup WNS +1.267ns · hold WNS +0.144ns · antenna/route DRC/Magic DRC/KLayout DRC/LVS 모두 0. GDS 보존. 9/23 RUN_2026-09-23_12-48-47은 다른 다이·SDC의 기존 clean 기준점'],
  ['daq_subsystem · flat', '부분 검증', 'CTS 이후 STA', '마지막 확인된 flat 실행은 CTS 이후 STA에서 종료. 전체 signoff 비교값 없음'],
  ['daq_subsystem · hierarchical', '완주 · 물리 검증 clean / 타이밍·antenna 미통과 · 10/8', 'hierarchical_auto_20260924_142552', 'Flow complete(final/metrics.json). route DRC/Magic DRC/KLayout DRC/LVS/XOR 모두 0. 남은 위반: setup WNS −6.44ns(max_ss_100C_1v60 코너, tt/ff 코너는 +2.3ns 이상) · hold WNS −0.15ns(max_ff_n40C_1v95) · antenna 121 nets/163 pins. top-level signoff 통과 아님'],
  ['ppa3_adc_capture', 'signoff 미통과 · 10/5', 'ppa3_antfix5_signoff', '실행 exit 0, setup WNS +10.392ns · hold +0.183ns · antenna/route DRC/XOR 0. Magic DRC 559 · KLayout DRC 1 · LVS 363이 남음'],
] as const
