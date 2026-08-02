# Sample Test 2 — Hierarchical FIFO Pipeline

| Stage | Scope |
| --- | --- |
| Design | Top/submodule hierarchy, port contracts, parameter choices |
| RTL analysis | `prim_fifo_sync`, `prim_fifo_sync_cnt`, `prim_util_pkg` parse/elaboration |
| Simulation | reset, two writes, two reads, depth transition, empty/full checks |
| UVM | write/read sequence, reference queue scoreboard, occupancy coverage |
| Formal | no read from empty, no write beyond full, depth bounds |
| Implementation | parameterized synthesis; PDK-backed timing and P&R later |

## Current execution result

- Hierarchical Verilator lint/elaboration: **PASS** with explicit compile order
  (`prim_count_pkg`, `prim_util_pkg`, `prim_fifo_sync_cnt`, `prim_fifo_sync`).
- Two `PINCONNECTEMPTY` warnings are present for intentionally unused hardened
  counter outputs; they are non-fatal and not a FIFO functional failure.
- Verilator simulation binary build: C++ compiler and MinGW make are now
  available. RTL-to-C++ translation and C++ compilation both completed.
- Final executable link is currently **BLOCKED** by a Windows toolchain
  integration issue: this MinGW 16 installation omits the C++ runtime from the
  default `g++` link command expected by the bundled Windows Verilator, and
  the Verilator archive rule uses POSIX shell syntax that Windows `cmd` cannot
  execute. This is an environment integration issue, not an RTL failure.
- The generated FIFO testbench covers reset, two writes, two reads, depth
  transitions and empty-state checks. It is ready to run once the build uses a
  matching MSYS2 MinGW UCRT64 compiler/runtime (or a Linux/WSL Verilator flow).
- MSYS2 UCRT64 GCC, make and Python were installed and a manually linked
  Verilator executable ran the FIFO test. The first run caught a testbench
  sampling error: the fall-through output was checked after the read handshake
  had advanced it. The testbench now checks data before asserting `rready_i`.
- With the OSS CAD Suite `bin` directory restored to `PATH`, a fresh
  Verilator 5.051 regeneration, UCRT64 build and executable simulation
  completed successfully. Result: **`SAMPLE_TEST_1_FIFO_PASS`**, `$finish` at
  110 ps, process exit code 0.
