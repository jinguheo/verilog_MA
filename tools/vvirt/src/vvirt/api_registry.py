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
    "vvGdsSummary": dict(group="export", summary="Size summary of a GDS file: structures, tops, per-structure shapes, bbox, per-layer shape count and area.",
                         args=["path: string - .gds under the workspace, /tmp or the PDK", "?top: string - one structure"],
                         returns="record: file dbuUm structures tops cells scope; each cell: name shapes texts references bboxUm layers",
                         example='vvGdsSummary("/tmp/top.gds")',
                         notes="Layer area sums shapes, so overlaps are counted twice: a size indicator, not a merged-mask area. Read scope in the result."),
    "vvGdsCompare": dict(group="export", summary="Compare two GDS files structure by structure: what was added, removed or moved. Use it to check an edit stayed small.",
                         args=["pathA: string", "pathB: string", "?top: string - compare one structure", "?limit: integer - example shapes per structure, default 20"],
                         returns="record: identical changedStructures unchangedStructures elementsAdded elementsRemoved structuresOnlyInA structuresOnlyInB changes scope",
                         example='vvGet(vvGdsCompare("/tmp/a.gds" "/tmp/b.gds") "identical")',
                         notes="Not flattened; polygons compared by canonical vertex loop, so identical means the same shapes in the same structures, not electrically equivalent."),
    "vvExportGds": dict(group="export", summary="Write the cellview and its hierarchy to a GDS file.", args=["lib: string", "cell: string", "path: string - under the workspace or /tmp", "?view: string"],
                        returns="the path", example='vvExportGds("mylib" "top" "/tmp/top.gds")'),
    "vvExportSvg": dict(group="export", summary="Render the cellview to an annotated SVG (legend, instance names, pins).", args=["lib: string", "cell: string", "?path: string", "?view: string"],
                        returns="the path", example='vvExportSvg("mylib" "top")'),
    # ---- schematic (design source for Maestro tests)
    "vvSchCreate": dict(group="schematic", summary="Create an empty netlist-level schematic (the design a Maestro test simulates).", args=["lib: string", "cell: string"], returns="\"lib/cell\"", example='vvSchCreate("mylib" "rc")'),
    "vvSchAddInst": dict(group="schematic", summary="Add an instance of a device master (analogLib res/cap/vdc..., sky130 transistors) or of another schematic, with explicit pin-to-net connections.",
                         args=["lib: string", "cell: string", "name: string - instance name", "masterLib: string", "masterCell: string", "?conn: list - ((\"PLUS\" \"in\") (\"MINUS\" \"gnd!\"))", "?params: list - ((\"r\" \"1k\"))"],
                         returns="the instance name", example='vvSchAddInst("mylib" "rc" "R0" "analogLib" "res" ?conn \'(("PLUS" "in") ("MINUS" "out")) ?params \'(("r" "1k")))',
                         notes="Parameter values are numbers (SI suffixes ok) or expressions over design variables, e.g. \"2*c_val\". Nets named 0 or gnd! are ground. Pins and parameters are checked against the master."),
    "vvSchConnect": dict(group="schematic", summary="Connect one pin of an instance to a net.", args=["lib: string", "cell: string", "inst: string", "pin: string", "net: string"], returns="t", example='vvSchConnect("mylib" "rc" "R0" "MINUS" "out")'),
    "vvSchSetParam": dict(group="schematic", summary="Set one parameter of an instance (a number or an expression over design variables).", args=["lib: string", "cell: string", "inst: string", "name: string", "value"], returns="t", example='vvSchSetParam("mylib" "rc" "C0" "c" "c_val")'),
    "vvSchAddPin": dict(group="schematic", summary="Expose a net as a port of the schematic (needed when it is instantiated in another schematic).", args=["lib: string", "cell: string", "name: string", "?direction: input|output|inout"], returns="the pin name", example='vvSchAddPin("mylib" "rc" "OUT" ?direction "output")'),
    "vvSchCheck": dict(group="schematic", summary="Problems that would break simulation: unconnected pins, single-connection nets, no ground.", args=["lib: string", "cell: string"], returns="list of strings, nil when none", example='vvSchCheck("mylib" "rc")'),
    "vvSchList": dict(group="schematic", summary="Schematics that exist, as \"lib/cell\" strings.", args=["?lib: string"], returns="list of strings", example='vvSchList("mylib")'),
    "vvSchDelete": dict(group="schematic", summary="Delete a schematic.", args=["lib: string", "cell: string"], returns="t, or nil if it did not exist", example='vvSchDelete("mylib" "rc")'),
    "vvSchMasters": dict(group="schematic", summary="Device masters that can be instantiated: pins, parameters with defaults, SPICE prefix.", args=["?lib: string - analogLib or sky130_fd_pr"], returns="list of records: library cell pins parameters spice doc", example='vvSchMasters("analogLib")'),
    "vvSchInfo": dict(group="schematic", summary="Instances, nets, ports and check problems of a schematic.", args=["lib: string", "cell: string"], returns="record: library cell kind pins nets instances problems", example='vvSchInfo("mylib" "rc")'),
    "vvSchNetlist": dict(group="schematic", summary="The SPICE netlist (with an .op card) that the schematic produces.", args=["lib: string", "cell: string", "?variables: list - ((\"c_val\" \"1p\"))"], returns="string", example='vvSchNetlist("mylib" "rc")'),
    "vvSchFromSpice": dict(group="schematic", summary="Use a SPICE netlist or subcircuit as a design (text or a file under the workspace, /tmp or the PDK).", args=["lib: string", "cell: string", "text: string - SPICE text or a path", "?top: string - subcircuit to use"],
                           returns="record: library cell subckt pins", example='vvSchFromSpice("mylib" "amp" ".subckt amp in out\\nE1 out 0 in 0 2\\n.ends amp\\n")'),
    "vvSchFromXschem": dict(group="schematic", summary="Import an xschem schematic: it is netlisted with xschem and used as a SPICE design.", args=["lib: string", "cell: string", "path: string - .sch file", "?top: string"],
                            returns="record: library cell subckt pins source", example='vvSchFromXschem("mylib" "amp" "/tmp/amp.sch")', notes="Needs xschem; sky130 symbols' .include/.lib lines come from the xschem netlist."),
    # ---- maestro (ngspice-backed)
    "vvMaeDoctor": dict(group="maestro", summary="Is the Maestro backend usable: ngspice version, sky130 models, xschem, supported analyses and run modes.", args=[], returns="record: ngspice ngspicePath sky130Models xschem workspace supportedAnalyses supportedRunModes", example='vvMaeDoctor()'),
    "vvMaeResults": dict(group="maestro", summary="Structured results of a run: overall status and yield, every point with variables, corner, outputs, spec status and errors.", args=["?history: string - default latest", "?session: string"],
                         returns="record: history status simulator seconds overall points", example='vvMaeResults(?history "Interactive.1")', notes="Waveform outputs are not inlined (kind \"wave\"); read them with vvMaeWaveCsv or vvMaeEval."),
    "vvMaeHistories": dict(group="maestro", summary="Runs of this maestro view with status, point count, overall result and lock.", args=["?session: string"], returns="list of records: history status points created locked overall", example='vvMaeHistories()'),
    "vvMaeStatus": dict(group="maestro", summary="Progress of runs started in this server (done/total, failure text).", args=[], returns="list of records: history status done total error", example='vvMaeStatus()'),
    "vvMaeDeleteHistory": dict(group="maestro", summary="Delete a run and its stored waveforms (refused when locked).", args=["history: string", "?session: string"], returns="t", example='vvMaeDeleteHistory("Interactive.1")'),
    "vvMaeEval": dict(group="maestro", summary="Evaluate any calculator expression on the saved waveforms of one point, without re-simulating.", args=["expr: string", "?history: string", "?test: string", "?cornerName: string", "?pointIndex: integer", "?analysis: string"],
                      returns="record: kind value (scalar) or kind points xname xmin xmax (wave)", example='vvMaeEval("dcGain(VF(\\"/OUT\\"))" ?pointIndex 1)',
                      notes="Functions: v/VT/VF/VDC/i, mag phase db20 real imag, value cross delay riseTime fallTime overshoot settlingTime slewRate, ymax ymin average rms integ deriv clip, bandwidth unityGainFreq gainBwProd phaseMargin gainMargin, dft thd, onoise inoise. See SKILL.md."),
    "vvMaeWaveCsv": dict(group="maestro", summary="Write a waveform (an output name or an expression) of one point as CSV (x,y or x,re,im).", args=["expr: string - output name or expression", "?path: string", "?history: string", "?test: string", "?pointIndex: integer"],
                         returns="the path, or the CSV text when no path is given", example='vvMaeWaveCsv("Vout" "/tmp/vout.csv" ?pointIndex 1)'),
    "vvMaeStats": dict(group="maestro", summary="Mean, standard deviation, min, max, median of a numeric output over all points of a test (use after Monte Carlo or a sweep).", args=["output: string", "test: string", "?history: string"],
                       returns="record: n mean std min max median", example='vvMaeStats("BW" "AC")'),
    "vvMaeDeck": dict(group="maestro", summary="The ngspice deck for one point of a test, before running it.", args=["test: string", "?corner: string", "?point: integer - 1 based within the test/corner"], returns="string", example='vvMaeDeck("AC")'),
    "vvMaeReevaluate": dict(group="maestro", summary="Re-evaluate the current outputs and specs on a finished run's saved waveforms (new outputs, changed specs) without simulating.", args=["?history: string", "?session: string"],
                            returns="record: history overall yield", example='vvMaeReevaluate(?history "Interactive.1")'),
    "vvMaeSetModel": dict(group="maestro", summary="Give a corner a model file and section (.lib file section) for all tests or one test.", args=["corner: string", "path: string - under the workspace, /tmp or the PDK", "?section: string", "?test: string"], returns="t", example='vvMaeSetModel("ss" "/tmp/m.lib" "ss")'),
    "vvMaeSky130Corner": dict(group="maestro", summary="Create or update a corner that uses the PDK's sky130 ngspice models at a process section and temperature.", args=["name: string", "?section: tt|ss|ff|sf|fs", "?temperature: number"], returns="the corner name", example='vvMaeSky130Corner("ss_125" "ss" 125)'),
    "vvMaeMonteCarlo": dict(group="maestro", summary="Configure Monte Carlo sampling: number of points, seed, and per-variable distributions (set the run mode with maeSetCurrentRunMode).", args=["?points: integer", "?seed: integer", "?dists: list - ((\"r_val\" ((\"dist\" \"gaussian\") (\"sigma\" \"5%\"))))", "?clear: t"],
                           returns="record: points seed variables", example='vvMaeMonteCarlo(?points 50 ?seed 3)', notes="Distributions: gaussian (sigma absolute or %, optional mean) and uniform (tol, or lo/hi). Variables are sampled; device mismatch models are not."),
    "vvMaeReport": dict(group="maestro", summary="Self-contained HTML report of a run: setup, results table with spec colours, waveform plots, Monte Carlo histograms.", args=["?path: string - under the workspace or /tmp", "?history: string"], returns="the path, or the HTML text", example='vvMaeReport("/tmp/report.html")'),
}


def names() -> list[str]:
    return sorted(API)


def summary_rows() -> list[list[str]]:
    order = ["discover", "libraries", "technology", "placement", "routing", "rules", "check", "export", "schematic", "maestro"]
    return [[v["group"], k, v["summary"]] for g in order for k, v in sorted(API.items()) if v["group"] == g]


def help_record(name: str) -> list | None:
    e = API.get(name)
    if e is None:
        return None
    from .records import rec

    return rec(("name", name), ("group", e["group"]), ("summary", e["summary"]), ("args", e["args"] or None), ("returns", e["returns"]),
               ("example", e["example"]), ("notes", e.get("notes")))
