"""Self-description of the vv* SKILL functions: what an agent needs to pick and call one correctly without guessing.

vvApi() lists them by group; vvHelp("vvRoute") gives signature, argument meaning, the named fields of the result and an
example. A test (tests in tools/vvirt/tests/test_api_registry.py) fails when a registered vv* function has no entry or an
entry names a function that no longer exists, so this cannot drift quietly.
"""
from __future__ import annotations

from typing import Any

# name -> group, summary, args ("name: type - meaning"; "?name" optional), returns, example, notes
API: dict[str, dict[str, Any]] = {
    # ---- discover
    "vvApi": dict(group="discover", summary="List every vv* function with a one-line purpose, grouped.", args=[], returns="list of (group name summary)", example='vvApi()'),
    "vvHelp": dict(group="discover", summary="Signature, arguments, result fields and an example for one vv* function.", args=["name: string - e.g. \"vvRoute\""],
                   returns="record: name group summary args returns example notes", example='vvHelp("vvRoute")'),
    "vvGet": dict(group="discover", summary="Read a field from a named-field result (association list); nested keys and list indexes allowed.",
                  args=["record: result of a vv* function", "key...: string or integer path"], returns="the value, or nil if a key is missing",
                  example='vvGet(vvCellInfo("sky130_fd_sc_hd__inv_1") "width")'),
    # ---- libraries and cells
    "vvLibraries": dict(group="libraries", summary="Names of the libraries currently available (PDK libraries are read-only).", args=[], returns="list of strings", example="vvLibraries()"),
    "vvPdkLibs": dict(group="libraries", summary="PDK cell libraries present on disk that vvAttachPdkLib can load.", args=[], returns="list of strings", example="vvPdkLibs()"),
    "vvAttachPdkLib": dict(group="libraries", summary="Load another PDK cell library (read-only), e.g. sky130_fd_sc_hvl.", args=["name: string"],
                           returns="record: library cells hasGds", example='vvAttachPdkLib("sky130_fd_sc_hvl")'),
    "vvCells": dict(group="libraries", summary="Cell names in a library whose name contains a pattern.", args=["lib: string", "?pattern: string - substring, case-insensitive"],
                    returns="list of strings (nil if none)", example='vvCells("sky130_fd_sc_hd" "nand2")'),
    "vvCellInfo": dict(group="libraries", summary="Size and pins (with real pin geometry) of a PDK cell.", args=["cell: string - full cell name", "?lib: string", "?positional t - old list shape"],
                       returns="record: name library width height pins; each pin is a record: name direction use layer bbox center", example='vvGet(vvCellInfo("sky130_fd_sc_hd__inv_1") "height")',
                       notes="direction INPUT/OUTPUT/INOUT; use SIGNAL/POWER/GROUND; bbox ((x0 y0) (x1 y1)) in um, cell-local coordinates (before orientation)."),
    "vvPin": dict(group="libraries", summary="One pin of a PDK cell: direction, use, layer, bbox and centre (cell-local, before orientation).",
                  args=["cell: string - full cell name", "pin: string", "?lib: string"], returns="record: name direction use layer bbox center",
                  example='vvGet(vvPin("sky130_fd_sc_hd__inv_1" "Y") "center")', notes="For a placed instance use vvPinXY, which applies position and orientation."),
    "vvCopyCell": dict(group="libraries", summary="Copy any cell (including read-only PDK cells) into an editable user library; returns the cellview open for edit.",
                       args=["srcLib: string", "srcCell: string", "dstLib: string - must exist", "?dstCell: string - default same name"], returns="cellview", example='vvCopyCell("sky130_fd_sc_hd" "sky130_fd_sc_hd__inv_1" "mylib" "inv_edit")'),
    "vvImportGds": dict(group="libraries", summary="Load structures of a GDS file as editable cellviews in a user library.", args=["lib: string - existing user library", "path: string - .gds under the workspace, /tmp or the PDK", "?top: string - one structure", "?positional t"],
                        returns="record: cells shapes instances skippedShapes skippedRefs skippedLayers", example='vvImportGds("mylib" "/tmp/x.gds")',
                        notes="Layers not in the sky130 map and array references are skipped and counted, never silently dropped."),
    # ---- geometry helpers
    "vvLayers": dict(group="technology", summary="Valid layer names and their purposes.", args=["?positional t"], returns="list of records: layer purposes", example="vvLayers()"),
    "vvViaDefs": dict(group="technology", summary="Via definitions usable with techFindViaDefByName / dbCreateVia.", args=["?positional t"], returns="list of records: name bottom cut top cutSize", example="vvViaDefs()"),
    "vvBBox": dict(group="technology", summary="Bounding box of a cellview.", args=["cv: cellview"], returns="((x0 y0) (x1 y1)) or nil if empty", example="vvBBox(cv)"),
    "vvPinXY": dict(group="placement", summary="Pin centre of a placed instance, after its orientation and position are applied.", args=["cv: cellview", "inst: string - instance name", "pin: string"],
                    returns="(x y) in um", example='vvPinXY(cv "U1" "Y")'),
    "vvPlaceRow": dict(group="placement", summary="Place PDK cells left to right in a row, applying the active habit profile (cell gap, end taps, row flip).",
                       args=["cv: cellview open for edit", "prefix: string - instance name prefix", "cells: list of strings - short names, e.g. \"inv_1\"", "xy: (x y) - row origin", "?row: integer - 0 based; odd rows flip when the profile says so", "?positional t"],
                       returns="list of records: name cell x orient", example='vvPlaceRow(cv "A" list("inv_1" "nand2_1") list(0.0 0.0) 0)',
                       notes="Read the returned names: end taps are named <prefix>_TAP0 / _TAP1 and shift the numbering."),
    "vvViaStack": dict(group="routing", summary="Vias from a lower to an upper layer at a point, with the profile's number of cuts.",
                       args=["cv: cellview open for edit", "xy: (x y)", "lower: string - li1|met1..met4", "upper: string - met1..met5"], returns="list of via definition names used", example='vvViaStack(cv list(1.0 1.0) "li1" "met2")'),
    "vvRoute": dict(group="routing", summary="Rule-aware Manhattan route on one layer between two points, avoiding shapes already in the cellview.",
                    args=["cv: cellview open for edit", "layer: string", "p0: (x y)", "p1: (x y)", "?positional t"],
                    returns="record: how width space points limitations", example='vvRoute(cv "met2" list(0 0) list(3 0))',
                    notes="Failure is not proof that no route exists. Success is rule-legal, not DRC-clean: run vvCheckReport."),
    # ---- rules
    "vvRuleSource": dict(group="rules", summary="Where the design rules came from.", args=[], returns="string (path of the PDK tech LEF, or a note that defaults are used)", example="vvRuleSource()"),
    "vvRules": dict(group="rules", summary="Rule values in force: (layer kind value) triples; kinds minWidth minSpace minArea.", args=["?layer: string"], returns="list of (layer kind value)", example='vvRules("met2")'),
    "vvSetRule": dict(group="rules", summary="Override one rule value (reported later as a ruleOverride).", args=["layer: string", "kind: minWidth|minSpace|minArea", "value: number - um or um^2"], returns="the new value", example='vvSetRule("met3" "minSpace" 0.6)'),
    "vvPitch": dict(group="rules", summary="Minimum wire pitch (minWidth + minSpace) of a layer.", args=["layer: string"], returns="number, um", example='vvPitch("met2")'),
    "vvDirections": dict(group="rules", summary="Preferred routing direction per layer (H or V).", args=[], returns="list of (layer direction)", example="vvDirections()"),
    "vvLoadProfile": dict(group="rules", summary="Load a designer-habit profile (rule overrides + placement/routing habits); resets earlier overrides.", args=["name: string - profiles/<name>.json"],
                          returns="string describing the profile", example='vvLoadProfile("habit_analog")'),
    "vvProfile": dict(group="rules", summary="The habits in force.", args=[], returns="list of (key value)", example="vvProfile()"),
    "vvCheckRules": dict(group="check", summary="Violations of the drawn geometry. nil means none found in the rules that ran, NOT DRC-clean. Prefer vvCheckReport.",
                         args=["cv: cellview", "?layers: list of strings"], returns="list of (layer rule required bbox), or nil", example="vvCheckRules(cv)"),
    "vvCheckReport": dict(group="check", summary="Rule check with its scope stated: status clean_in_scope | violations | nothing_checked.",
                          args=["cv: cellview", "?layers: list of strings"],
                          returns="record: status checkedLayers enclosureChecks presentWithoutRule notChecked excludedBecauseInPlacedCells ruleSource profile ruleOverrides violations",
                          example='vvCheckReport(cv list("met1" "met2"))', notes="violations are records: layer rule required bbox. Quote the scope when reporting a result."),
    "vvOfficialDrc": dict(group="check", summary="Official sky130A KLayout deck (BEOL by default). nil = none found in the groups that ran. Prefer vvOfficialDrcReport.",
                          args=["cv: cellview", "?\"feol\": also run the FEOL group"], returns="list of (rule count), or nil", example="vvOfficialDrc(cv)"),
    "vvOfficialDrcReport": dict(group="check", summary="Official DRC with the deck release and which groups ran / did not run.", args=["cv: cellview", "?\"feol\""],
                                returns="record: status deck deckRelease groupsRun notRun excludedBecauseInPlacedCells violations", example="vvOfficialDrcReport(cv)"),
    # ---- export
    "vvExportGds": dict(group="export", summary="Write the cellview and its hierarchy to a GDS file.", args=["lib: string", "cell: string", "path: string - under the workspace or /tmp", "?view: string"],
                        returns="the path", example='vvExportGds("mylib" "top" "/tmp/top.gds")'),
    "vvExportSvg": dict(group="export", summary="Render the cellview to an annotated SVG (legend, instance names, pins).", args=["lib: string", "cell: string", "?path: string", "?view: string"],
                        returns="the path", example='vvExportSvg("mylib" "top")'),
}


def names() -> list[str]:
    return sorted(API)


def summary_rows() -> list[list[str]]:
    order = ["discover", "libraries", "technology", "placement", "routing", "rules", "check", "export"]
    return [[v["group"], k, v["summary"]] for g in order for k, v in sorted(API.items()) if v["group"] == g]


def help_record(name: str) -> list | None:
    e = API.get(name)
    if e is None:
        return None
    from .records import rec

    return rec(("name", name), ("group", e["group"]), ("summary", e["summary"]), ("args", e["args"] or None), ("returns", e["returns"]),
               ("example", e["example"]), ("notes", e.get("notes")))
