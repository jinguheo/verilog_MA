# Next session note (2026-08-02)

- The legacy `dashboard/` static UI was removed; `my_dashboard/` is the sole UI.
- React dashboard: `http://127.0.0.1:5173/`
- Knowledge API: `http://127.0.0.1:8788/api/overview`
- Port 8787 had unrelated/conflicting listeners, so the project API intentionally uses port 8788.
- The API sends a CORS header for the Vite dashboard origin.
- User preference: always end server/dashboard-related responses with the web address.

## Dashboard state

- The left navigation has one `General RTL Pipeline` entry. Its internal pages are `Overview` and `단계별 Task`; the latter contains Requirements through Review as internal tabs.
- Sample Test 1, Sample Test 2, Knowledge DB, and Tool Comparison remain separate left-navigation entries.
- The overview hides the duplicate Knowledge DB summary and Verification Environment. The Task page also hides Verification Environment because each Task now has its own software-detail and tool-comparison guide.
- RTL Design includes plain-language explanations for CDC, lint, syntax/compile, elaboration, and synthesis, plus Verilator/Verible/Slang/Yosys comparisons.
- Each Task page has a tool guide that explains the listed software's purpose, strength, and difference from similar tools.

## UVM Test 2 status

- **Resolved (2026-08-02): full native build + regression now passes.** `samples/sample_test_2/uvm/run_verilator_uvm.ps1` builds `Vprim_fifo_sync_uvm_tb.exe` into `samples/sample_test_2/obj_uvm` and runs it; result is `UVM_ERROR: 0`, `UVM_FATAL: 0`, `[FIFO_SB] UVM FIFO PASS: 7 checked reads`, exit code 0.
- Three distinct Windows toolchain bugs had to be fixed in the script, all still relevant if this environment changes:
  1. `oss-cad-suite` bundles no GNU Make, so PATH resolved `make` to an unrelated legacy `C:\Windows\System32\make.exe` ("0 was unexpected at this time."). Fixed by shimming `mingw32-make.exe` as `make.exe` in `%TEMP%\veriolg-make-shim` and putting it first on PATH.
  2. This machine's installed MinGW-w64 g++ 16.1.0 mis-links `std::string`'s move constructor specifically under `-Os` (undefined reference at link time). Verilator's generated Makefile compiles the runtime + generated classes with `-Os` via `OPT_GLOBAL`/`OPT_FAST`/`OPT_SLOW`; the script now forces `-O2` for all three via `$env:MAKEFLAGS`.
  3. `oss-cad-suite\lib` ships its own older `libstdc++-6.dll`/`libgcc_s_seh-1.dll`/`libwinpthread-1.dll`. If those shadow the mingw64 runtime that actually built the exe, it fails at load with `STATUS_ENTRYPOINT_NOT_FOUND` (0xC0000139). Fixed by resolving `g++.exe`'s own bin dir and putting it first on PATH for both build and run.
- Re-run anytime with: `powershell -File samples\sample_test_2\uvm\run_verilator_uvm.ps1`. `-OutDirName <name>` is available if `obj_uvm` is ever locked by a stale process.

## Git state

- Pushed to `https://github.com/jinguheo/verilog_MA.git`, branch `master`.
- Latest pushed commit: `fafcc59` (`Refine pipeline navigation and tool guidance`).
- `docs/session_notes/` and `third_party/uvm-core/` are intentionally untracked local directories; generated UVM output/logs are ignored.
