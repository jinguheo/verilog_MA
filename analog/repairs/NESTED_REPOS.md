# Nested repositories embedded in analog/repairs

Six directories below were `git clone`s of upstream IP repositories with local repair edits.
They are committed here as plain files (their own `.git` folders are not part of this repository),
so the exact upstream commit and the number of locally modified files at the time of the snapshot are recorded here.
Recorded 2026-10-09.

| Directory | Upstream | Upstream commit | Branch | Locally modified/untracked files |
|---|---|---|---|---|
| `adc_repaired/base/ip/sky130_ef_ip__ccomp3v` | https://github.com/RTimothyEdwards/sky130_ef_ip__ccomp3v | `a15d230f090e62483553d4fe3fef11f24eab6f0f` | main | 1 |
| `adc_repaired/base/ip/sky130_ef_ip__cdac3v_12bit` | https://github.com/RTimothyEdwards/sky130_ef_ip__cdac3v_12bit | `d0b15efd2be69e34a4d7c33696c109f30140bc2c` | main | 7 |
| `adc_repaired/ip/sky130_ef_ip__ccomp3v` | https://github.com/RTimothyEdwards/sky130_ef_ip__ccomp3v | `a15d230f090e62483553d4fe3fef11f24eab6f0f` | main | 1 |
| `adc_repaired/ip/sky130_ef_ip__cdac3v_12bit` | https://github.com/RTimothyEdwards/sky130_ef_ip__cdac3v_12bit | `d0b15efd2be69e34a4d7c33696c109f30140bc2c` | main | 8 |
| `cdac_tap_baseline/project` | https://github.com/RTimothyEdwards/sky130_ef_ip__cdac3v_12bit | `d0b15efd2be69e34a4d7c33696c109f30140bc2c` | main | 7 |
| `cdac_tap_fix/project` | https://github.com/RTimothyEdwards/sky130_ef_ip__cdac3v_12bit | `d0b15efd2be69e34a4d7c33696c109f30140bc2c` | main | 8 |

To see the local repair edits, check out the upstream commit above in a scratch directory and diff it against the matching directory here.
The same large file (`pmos_waffle_48x48.mag`, 10.6 MB) appears in several copies because each clone carries its own dependencies.
