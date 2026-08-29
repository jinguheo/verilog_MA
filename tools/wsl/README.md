# Open-source RTL-to-GDS toolchain (WSL)

Set up 2026-08-25. Everything lives inside the WSL Ubuntu distro, which is on
**D:\WSL\Ubuntu**, so none of this consumes C: space.

## DECISION (2026-08-26): OpenLane 2 is the flow. ORFS is abandoned.

Do not resume the ORFS build. The evidence:

| | OpenLane 2 | ORFS |
| --- | --- | --- |
| State | v2.3.10, working | never produced a binary |
| Output | three finished GDS (`chan_ctrl`, `cnt_sat`, `skid_buffer`), DRC/LVS/antenna all clean | none |
| Disk | shares the PDK | 5.2 GB + 932 MB bazel cache |
| Build attempts | — | five failures |

Four of those five failures trace to one cause: ORFS's top-level `setup.sh`
rejects Ubuntu 26.04 (it supports 20.04/22.04/24.04) and aborts at its KLayout
step, so every later dependency stage silently never runs — which is how
`libabsl-dev`, then `ortools`, then `bazelisk` each turned up missing in turn.
OpenLane 2 bundles its own OpenROAD, so building ORFS was duplicated effort from
the start. `30`–`35_*build*.sh` are kept only as a record of what was tried.

### Two duplications this left behind

- **PDK is installed twice.** The finished runs used
  `~/.volare/volare/sky130/versions/0fe599b2.../sky130A` (per `resolved.json`).
  A second copy at `~/eda/pdk` came from the volare install in this session and
  is unused by the flow. The render scripts now prefer `.volare` so images match
  what actually produced the GDS. Reclaimable: 2.2 GB.
- **Two OpenLane venvs**, both v2.3.10: `~/.venvs/openlane312` (Python 3.12.13)
  and `~/openlane_venv_311` (Python 3.11.16).

Nothing has been deleted — there is 925 GB free, so removal is optional
housekeeping, not a fix. Reclaimable if wanted: `~/eda/OpenROAD-flow-scripts`,
`~/.cache/bazel`, `~/eda/pdk` — about 8.4 GB.

### Docker is not reachable from inside WSL

`docker: installed but daemon unreachable`. The three finished designs were
therefore run natively through the venv, not `--dockerized`, despite what the
dashboard's toolchain notes say.

## Where things are

| Item | Path |
| --- | --- |
| WSL distro | `D:\WSL\Ubuntu` (Ubuntu 26.04, user `oem`) |
| **OpenLane 2** | `~/.venvs/openlane312/bin/openlane` (also `~/openlane_venv_311`) |
| **PDK in use** | `~/.volare/volare/sky130/versions/0fe599b2.../sky130A` |
| ASIC runs | `samples/sample_test_4/asic/<design>/runs/RUN_*/` |
| Layout images | `my_dashboard/public/layout/` (served by Vite at `/layout/...`) |
| EDA root | `~/eda` |
| ~~ORFS~~ | `~/eda/OpenROAD-flow-scripts` — abandoned, see decision above |
| ~~duplicate PDK~~ | `~/eda/pdk` — unused by the flow |
| Build logs | `tools/wsl/logs/` |

## Status

| Stage | Tool | State |
| --- | --- | --- |
| RTL sim | verilator, iverilog 12.0 | installed |
| waveform | gtkwave | installed |
| synthesis | yosys 0.52 | installed (see caveat below) |
| **P&R + STA** | **OpenLane 2 (bundles OpenROAD)** | **working — three designs taken to GDS** |
| ~~P&R~~ | ~~standalone openroad via ORFS~~ | abandoned, see decision above |
| DRC | magic 8.3.105, klayout 0.30.0 | installed |
| LVS | netgen-lvs 1.5.133 (`/usr/bin/netgen-lvs`) | installed |
| schematic | xschem | installed |
| SPICE | ngspice | installed, sky130 models load |
| math | octave, numpy, matplotlib | installed |

Supporting libraries installed to non-default prefixes: or-tools 9.14.6206 and
Abseil in `/opt/or-tools`; Boost 1.89, Eigen 3.4, CUDD, CUSP, Lemon, spdlog,
gtest, SWIG 4.4, PCRE, CMake 4.2.3 in `/usr/local`.

Not installed, and not needed: Xyce (not in the 26.04 archive; ngspice covers
the requirement, Xyce is only a speed upgrade for large circuits) and gaw
(gtkwave plus numpy/matplotlib cover waveform viewing and are scriptable).

## Viewing a finished layout

Two ways, both working:

**Rendered images in the dashboard.** Sample Test 4 → Layout tab. Three designs
at three zoom levels each, rendered by KLayout with the sky130A layer properties
applied so layers carry their real colours — blue horizontals are met1 power
rails, magenta verticals are met2 signal routing, green is N-well. Regenerate
after a new run with:

    wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/63_render_all.sh

**KLayout GUI**, for panning, zooming and toggling layers:

    tools\open_layout.bat chan_ctrl

KLayout runs inside WSL and draws on the Windows desktop through WSLg
(`DISPLAY=:0`), so nothing is installed on the Windows side. A web page cannot
launch a local GUI without a backend to do it, which is why this is a batch file
rather than a dashboard button.

Two rendering traps, both already handled in `render_gds.py` /
`render_all_gds.py`:

- `view.zoom_box()` takes a **DBox in micrometres**, not a `Box` in database
  units. Passing DBU silently zooms out by 1/dbu — 1000× for sky130 — and writes
  a blank image.
- KLayout will not run a script from `/dev/stdin` ("no interpreter"); it needs a
  real `.py` file. And `klayout -z` can exit non-zero after writing every image,
  so under `set -e` its status must not be allowed to abort a render loop.

## Abandoned: the ORFS build

Kept for the record only — see the decision at the top. The build reached
10,335 of 11,882 actions and stopped with no compiler error and no OOM (13 GB of
15 GB free), almost all of it compiling Qt 6.9.1 from source for a GUI this
project never needed. `35_build_nogui.sh` (`-DBUILD_GUI=OFF`) would have skipped
that, but OpenLane 2 already supplies OpenROAD, so there is no reason to finish
it.

## Caveat: the distro yosys cannot read SystemVerilog

`/usr/bin/yosys` has no slang plugin, so it cannot parse the SystemVerilog in
Sample Test 2/3/4 (packages, typedefs, enums). The yosys built by ORFS does
include yosys-slang — the configure log reports `YOSYS_SLANG_REVISION`. **Use
the ORFS yosys for these designs, not the distro one.**

## Ubuntu 26.04 is outside ORFS's supported range

ORFS's top-level `setup.sh` rejects 26.04 (it supports 20.04/22.04/24.04) and
aborts at its KLayout step. Because it aborts early, every later dependency
stage silently never runs — that is the single root cause behind four separate
build failures (missing `libabsl-dev`, then `ortools`, then `bazelisk`).

OpenROAD's *own* `etc/DependencyInstaller.sh` does understand 26.04 — it
normalises the version when selecting a prebuilt or-tools tarball. The working
approach is therefore to bypass the ORFS wrapper and drive OpenROAD's installer
and build script directly, which is what scripts 19 and 34 do.

If more friction appears, the clean fallback is Docker: an OpenLane 2 or ORFS
image is built on a supported distro and sidesteps all of this. Docker 29.6.2
is installed but its daemon was not running.

## Two things fixed along the way

**Host clock was 9 hours behind.** Three independent servers agreed. apt
rejected every archive Release file as "not valid yet". Fixed on the Windows
side; a temporary `/etc/apt/apt.conf.d/99-clock-skew` workaround was used in the
meantime and has been removed. Worth noting that files and git commits created
while the clock was wrong carry timestamps that are off by nine hours.

**Passwordless sudo** was enabled for `oem` via
`/etc/sudoers.d/99-nopasswd` so the installers could run unattended. To undo:

    wsl -d Ubuntu -u root -- rm /etc/sudoers.d/99-nopasswd

## Scripts

Numbered in the order they were run. All are re-runnable.

| Script | Purpose |
| --- | --- |
| `00_survey.sh` | Environment survey before installing anything |
| `enable_nopasswd_sudo.sh` | Passwordless sudo (run by the user, as root) |
| `10_apt_deps.sh` | Base build toolchain and libraries |
| `11_status.sh` | What is installed right now |
| `12_clock_check.sh` | Compare the clock against independent servers |
| `13_apt_date_workaround.sh` | apt date-check bypass (no longer needed) |
| `14_clock_verify.sh` | Confirm the clock is correct |
| `15_cleanup_and_probe_setup.sh` | Remove the workaround, inspect setup state |
| `16_orfs_deps.sh` | Install ORFS apt dependencies |
| `17_inspect_dependency_installer.sh` | Understand the ORFS installer |
| `18_openroad_di_probe.sh` | Understand OpenROAD's own installer |
| `19_openroad_common_deps.sh` | or-tools, Abseil, Boost, Eigen, Lemon, spdlog |
| `20/21_*probe*.sh` | Locate a usable OpenROAD distribution |
| `30–34_*build*.sh` | Build attempts; `34` is the working one |
| `40_sky130_pdk.sh` | sky130 PDK via volare |
| `41_pdk_verify.sh` | Verify PDK contents |
| `50_gap_check.sh` | What is still missing |
| `51_install_gaps.sh` | iverilog, ngspice, verilator, gtkwave |
| `52_analog_tools.sh` | xschem and the analog stack |
| `53_finish_analog.sh` | Final inventory and build progress |

Note on invocation: PowerShell mangles nested quotes when passing a command
through `wsl -- bash -lc "..."`. Every non-trivial step is therefore a script
file invoked as `wsl -d Ubuntu -- bash /mnt/d/.../script.sh`, with no quoting.

## Next

1. Confirm the OpenROAD build finished.
2. Write an SDC for the target block. For these designs the clock definitions
   are the easy part; the real work is the asynchronous exceptions
   (`set_clock_groups -asynchronous`, `set_max_delay -datapath_only` on the
   synchroniser inputs). Without them STA reports thousands of false violations
   on the CDC paths, or worse, the tool tries to "fix" them.
3. Run a first flow on a Sample Test 4 block — `daq_csr` or `axil_slave` — with
   `make DESIGN_CONFIG=./designs/sky130hd/<design>/config.mk`, then read out
   area, timing and power.
4. Manufacturing rules do not get written by hand: the tech LEF, DRC deck,
   antenna and density rules all come from the PDK. Only SDC and the floorplan
   configuration are authored.
