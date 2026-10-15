---
name: vvirt
description: Create and modify sky130 IC layouts with Virtuoso SKILL through virtuoso-bridge, against vvirt, a virtual Virtuoso (no Cadence). Use to place PDK standard cells, draw shapes/vias/wires, edit a copy of a PDK cell, route and check against PDK design rules, and export GDS/SVG. Skip when a real Virtuoso session is available and its exact behaviour matters, or when the task needs LVS, extraction, schematics, Maestro or signoff DRC.
metadata:
  version: "1"
---

# vvirt — layout work through virtuoso-bridge

`vvirt` plays the Virtuoso side of `virtuoso-bridge`. The real client (`VirtuosoClient`, `client.layout.create()/modify()`)
and daemon are unchanged; SKILL you send is run by a SKILL interpreter subset against an in-memory layout database
with the sky130_fd_sc_hd standard cells. It is a **simulation**: say "vvirt accepted/produced X", never "Virtuoso did X".

## Connect only when needed
If a `VirtuosoClient` call already works, go straight to the task. Do not run diagnostics before every job.
When a call fails to connect, or after a reboot, read [connection and recovery](references/connection-and-recovery.md);
the one command that tells you what is wrong is `bash tools/vvirt/scripts/doctor.sh` (read-only).

## Route by task
| You want to… | Use | Notes |
|---|---|---|
| find a cell, its size and pins | `vvCells(lib "pattern")`, `vvCellInfo(cell)`, `vvPin(cell "Y")` | named-field results: `vvGet(vvCellInfo(c) "width")`, `vvGet(vvPin(c "Y") "center")`; use real pin geometry, do not guess |
| place cells | `dbCreateParamInstByMasterName(cv lib cell "layout" name list(x y) "R0")`, `vvPlaceRow(...)` | orientations `R0 R90 R180 R270 MX MY MXR90 MYR90`; `MX` flips about x, so a cell of height h placed at y+h occupies y..y+h |
| draw | `dbCreateRect / dbCreatePath / dbCreatePolygon / dbCreateLabel / dbCreateVia` | sky130 names only: `vvLayers()` lists layer/purpose pairs; wrong names fail with the valid list |
| change existing geometry | `dbDeleteObject`, `dbMoveFig`, `dbCopyFig`, `geSelectArea`+`leHiDelete`, `foreach`/`setof` over `cv~>shapes` | selection is by **fully enclosed** bounding box |
| edit a PDK cell | `vvCopyCell("sky130_fd_sc_hd" cell "mylib" "newname")` | PDK libraries are read-only; the copy is editable |
| libraries | `ddGetLibList`, `ddCreateLib(name "<workspace>/libs/name")`, `ddDeleteObj` | writing into a library that does not exist is an error |
| design rules, habits | `vvRules`, `vvSetRule`, `vvLoadProfile("habit_analog")` | rules come from the PDK tech LEF; see [rules and habits](references/rules-and-habits.md) |
| route / check | `vvRoute(cv "met2" p0 p1)`, `vvCheckReport(cv)`, `vvOfficialDrcReport(cv)` | read results as below |
| export | `vvExportGds(lib cell path)`, `vvExportSvg(lib cell path)`, or `client.layout.export_gds(...)` with a stream map | SVG has a legend; GDS can be re-read with KLayout |

Recipes with working SKILL: [layout recipes](references/layout-recipes.md).

## Discover before guessing
`vvApi()` lists every vv* function by group; `vvHelp("vvRoute")` gives its arguments, result fields and an example.
Results of vv* functions are **named-field records**, an association list `(("name" "inv_1") ("width" 1.38) ...)`: read a field
with `vvGet(rec "width")` (nested: `vvGet(info "pins" 0 "name")`), never by position. A missing field is `nil`. Old positional
shapes remain available per call with `?positional t`; do not rely on them in new code.

## Working loop
1. **Observe** before acting: list/inspect cells, read pin geometry, read back what exists.
2. **Act** with one small step; read the reply (it is the source of truth, not what you intended).
3. **Verify** by reading back (`cv~>instances`, `cv~>shapes`, `cv~>bBox`) and, for rules, a report.
4. `dbSave(cv)`; `dbOpenCellViewByType(... "w")` creates **and resets**, `"a"` edits what is saved.
5. Errors are information: the message names the valid layers/cells/libraries. Fix the cause, do not retry unchanged.

## Reading results correctly
- **`nil` from `vvCheckRules` / `vvOfficialDrc` means "no violation found in the rules that ran", not "DRC clean".**
  Use `vvCheckReport` / `vvOfficialDrcReport`: `status` is `violations`, `clean_in_scope` or `nothing_checked`, and
  `checkedLayers`, `presentWithoutRule`, `notChecked`, `ruleSource`, `ruleOverrides` say what that means (all named fields). Quote the scope
  when you report a result. `nothing_checked` is not a pass.
- **`vvRoute` failing is not proof that no route exists**: candidates are straight/L/Z/S, obstacles are bounding boxes,
  single layer, no vias. Try another layer, move an endpoint, or draw the wire yourself and check it.
- **A successful `vvRoute` is rule-legal, not DRC-clean**; run `vvCheckReport` on the result.
- Official DRC runs the BEOL group by default (FEOL only with `"feol"`); the report lists `groupsRun` and `notRun`.
- Direct `dbCreate*` calls enforce no design rules. Habit profiles apply only through `vvPlaceRow`, `vvRoute`, `vvViaStack`.
- Do not claim LVS, extraction, timing, antenna or signoff status: none of these exist here.

## Common errors
| Message contains | Cause → fix |
|---|---|
| `layer X is not defined in the technology` | use a name from the printed list (`met1`, `li1`, `poly`, …) |
| `purpose P is not defined for layer L` | pick one of the purposes printed (`drawing`, `pin`, `label`, …) |
| `cannot find master` | cell name wrong → `vvCells(lib "part-of-name")` |
| `library X does not exist` | `ddCreateLib("X" "<workspace>/libs/X")` first |
| `outside the virtual workspace` | library paths must live under the vvirt workspace |
| `not open for edit` | the cellview was opened read-only → open with `"a"` |
| `undefined function - f` | not implemented here; check `tools/vvirt/SUPPORT.md` if present, else do it with the listed functions |
| `no legal … route found` | see "Reading results correctly" |

## Limits
No LVS, extraction, schematics, Maestro, CDF or GUI forms (form/menu calls return nil). Host access is deliberately absent
(`system`, `sh`, env writes); `load` reads only /tmp and the workspace. Libraries and cells persist as JSON under the
workspace. Results from this simulation do not establish how a real Virtuoso session or Cadence PDK behaves.
