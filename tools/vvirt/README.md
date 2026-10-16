# vvirt — virtual Virtuoso for virtuoso-bridge

Lets an LLM create and modify layouts with Virtuoso SKILL **without Cadence**. The real `virtuoso-bridge-lite`
client and daemon (`tools/virtuoso-bridge-lite`) are used unchanged; `vvirt.server` plays the Virtuoso/CIW side.
Cell library: sky130_fd_sc_hd (LEF + GDS from the volare PDK in WSL). Everything lives on D:.

## Setup from a fresh checkout
`tools/virtuoso-bridge-lite` (upstream, MIT) is NOT committed; fetch the version this was built and tested against:
```
git clone https://github.com/Arcadia-1/virtuoso-bridge-lite.git tools/virtuoso-bridge-lite
git -C tools/virtuoso-bridge-lite checkout e227f12b0a4db39844aebf86019b83264792ab9c
```
`vendor/`, `.pipcache/` and `workspace/` are generated (setup_env.sh, vserver.sh, the examples) and git-ignored.

## Run (WSL Ubuntu)
```
bash tools/vvirt/scripts/setup_env.sh            # prints the plan only; add --yes to pip --target into tools/vvirt/vendor (idempotent)
bash tools/vvirt/scripts/doctor.sh               # read-only readiness check: what is wrong, the fix command, which capability it limits
bash tools/vvirt/scripts/vb.sh start             # once: generates ~/.local/state/virtuoso_bridge/local/virtuoso_setup.il
bash tools/vvirt/scripts/vserver.sh start        # fake Virtuoso + real daemon (stop / status / log)
bash tools/vvirt/scripts/vb.sh eval '1+2'
bash tools/vvirt/scripts/pyrun.sh tools/vvirt/examples/accept_layout.py   # 11 checks
bash tools/vvirt/scripts/pyrun.sh tools/vvirt/examples/demo_inv_chain.py
```
From Windows PowerShell call `wsl.exe -d Ubuntu -e bash /mnt/d/MyWork/Veriolg_MA/tools/vvirt/scripts/<script>.sh`
(inline quoting through wsl.exe breaks; always run script files).

## For the LLM
* Use the bridge docs in `tools/virtuoso-bridge-lite/skills/virtuoso/` (client.layout.create()/modify(), layout ops).
* Layers are sky130A names (`met1`, `li1`, `poly`, `via` ...; purposes `drawing/pin/label/...`): `vvLayers()`.
* Cells: `vvCells("sky130_fd_sc_hd" "nand2")`, pins/size: `vvCellInfo("sky130_fd_sc_hd__inv_1")` (name, w, h, pins with li1 rects).
* Vias: `vvViaDefs()` then `techFindViaDefByName`; export: `vvExportGds(lib cell path)`, `vvExportSvg(lib cell path)`.
* Libraries/cells persist as JSON in `tools/vvirt/workspace/libs/<lib>/<cell>/<view>.json` (dbSave).

## Libraries, PDK cells, rules, habits (added 2026-10-13)
* Libraries: `ddGetLibList`, `ddGetObj(lib)~>readPath/~>cells/~>writable`, `ddCreateLib(name "<workspace>/libs/name")`,
  `ddDeleteObj`, `techBindTechFile`, `techGetTechLibName`. Opening a cellview for write in a library that does not exist is an
  error (like Virtuoso); `VVIRT_AUTOLIB=1` restores auto-creation. PDK libraries are read-only: `vvAttachPdkLib("sky130_fd_sc_hvl")`.
* Edit a PDK cell: `vvCopyCell("sky130_fd_sc_hd" "sky130_fd_sc_hd__inv_1" "mylib" "inv_edit")` (also `dbCopyCellView`);
  load any GDS: `vvImportGds("mylib" "/path/file.gds" [top])` (unmapped layers and AREFs are skipped and counted).
* Rules come from the PDK tech LEF (`vvRuleSource()`, `vvRules`, `vvDirections`); override with `vvSetRule("met3" "minSpace" 0.6)`.
  Designer habits: `profiles/*.json` + `vvLoadProfile("habit_analog")`; habit-aware `vvPlaceRow`, `vvViaStack`, `vvRoute`, `vvPinXY`.
  Check: `vvCheckReport(cv)` / `vvOfficialDrcReport(cv)` state their scope (`clean_in_scope`, never plain clean; what was and was not checked). The older
  `vvCheckRules(cv)` / `vvOfficialDrc(cv)` return only the violations: **nil means none found in the rules that ran, not DRC-clean**.
* GDS size and edit check: `vvGdsSummary(path ?top)` (structures, tops, per-layer shapes/area/bbox) and `vvGdsCompare(pathA pathB ?top ?limit)`
  (added/removed shapes, moved references, changed text, structures only in one file). Per structure, not flattened; read `scope` in the result.
  `identical` means the same shapes, not electrical equivalence.
* Agent instructions: `skills/vvirt/SKILL.md` (+ references). Not installed anywhere automatically; copy it to your agent's skills folder if wanted.
  `examples/check_skill_doc.py` verifies its links and that every recipe block runs.
* Scenario traces for the dashboard: `bash scripts/pyrun.sh examples/make_scenarios.py` (31 checks).

## Layout
`src/vvirt/`: `skill_lang` (SKILL interpreter) · `odb` (design DB) · `skill_funcs` (Virtuoso functions) · `export` (GDS/SVG) ·
`stdcell` (LEF/GDS) · `gdsio` · `layers` · `server` · `lib_funcs` · `gdsimport` · `techlef` · `rules` · `rule_funcs`. Tests: `tests/test_skill.py`.

## Limits
Not Cadence: no DRC/LVS/extraction, partial SKILL, no CDF/GUI; xstream GDS flow not emulated (use `vvExportGds`).
Maestro is a working subset (`mae*`/`asi*`/`axl*` plus `vvSch*`/`vvMae*`, package `src/vvirt/maestro/`): it simulates with
ngspice, not Spectre (runs are skipped when ngspice is absent), and schematics are netlist-level (instances and pin->net
connections, or imported SPICE/xschem netlists; no drawn wires or symbols). Results are not evidence of Spectre behaviour. Host-reaching SKILL (`system`, `sh`, env writes) is intentionally absent; `load` only reads /tmp, workspace.
