"""Evidence record for one OpenLane run folder (used by collect_ppa3_results.py).

What is observed: values in the last finished step's state_out.json (and final/metrics.json when the run finished), the
run's resolved.json settings, the exit code in tools/wsl/logs/<run>.summary.
What is derived: simple rules over those values (e.g. setup met = setup_ws >= 0).
What is inferred: the run state (finished/running/stopped), because a process list is a point-in-time reading.
What is unknown: every metric the run folder does not hold, with the reason (step not run / not finished / not reported).
Nothing is filled with a default.
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any

from evidence import Evidence

# short name -> (OpenLane metric key, unit, step-name fragments that produce it when the run covers them)
METRICS: dict[str, tuple[str, str, list[str]]] = {
    "setup_ws": ("timing__setup__ws", "ns", ["stapostpnr", "stapostpnr", "sta"]),
    "hold_ws": ("timing__hold__ws", "ns", ["stapostpnr", "sta"]),
    "setup_vio": ("timing__setup_vio__count", "count", ["checker-setupviolations", "stapostpnr"]),
    "hold_vio": ("timing__hold_vio__count", "count", ["checker-holdviolations", "stapostpnr"]),
    "antenna_nets": ("antenna__violating__nets", "count", ["checker-antenna", "repairantennas", "globalrouting"]),
    "route_drc": ("route__drc_errors", "count", ["detailedrouting", "checker-trdrc"]),
    "magic_drc": ("magic__drc_error__count", "count", ["magic-drc", "checker-magicdrc"]),
    "klayout_drc": ("klayout__drc_error__count", "count", ["klayout-drc", "checker-klayoutdrc"]),
    "lvs": ("design__lvs_error__count", "count", ["netgen-lvs", "checker-lvs"]),
    "xor": ("design__xor_difference__count", "count", ["klayout-xor", "checker-xor"]),
    "max_slew_vio": ("design__max_slew_violation__count", "count", ["checker-maxslewviolations", "stapostpnr"]),
    "max_cap_vio": ("design__max_cap_violation__count", "count", ["checker-maxcapviolations", "stapostpnr"]),
    "power_grid_vio": ("design__power_grid_violation__count", "count", ["checker-powergridviolations", "pdn"]),
    "utilization": ("design__instance__utilization", "ratio", ["floorplan", "globalplacement"]),
    "area": ("design__instance__area", "um2", ["floorplan", "globalplacement"]),
    "power": ("power__total", "W", ["stapostpnr", "sta"]),
    "wirelength": ("route__wirelength", "um", ["globalrouting", "detailedrouting"]),
}
SIGNOFF = ["route_drc", "magic_drc", "klayout_drc", "lvs", "xor"]
# settings that change what a result means; recorded so two runs can be compared like-for-like
CONTEXT_KEYS = ["CLOCK_PERIOD", "FP_CORE_UTIL", "PL_TARGET_DENSITY_PCT", "DIE_AREA", "MAGIC_DRC_USE_GDS", "GRT_ANTENNA_ITERS",
                "GRT_ANTENNA_MARGIN", "GRT_DESIGN_REPAIR_MAX_WIRE_LENGTH", "DESIGN_REPAIR_MAX_SLEW_PCT", "DESIGN_REPAIR_MAX_CAP_PCT",
                "CTS_MAX_SLEW", "RUN_HEURISTIC_DIODE_INSERTION", "FP_PDN_VOFFSET", "PDN_MACRO_CONNECTIONS", "ERROR_ON_MAGIC_DRC",
                "ERROR_ON_LVS_ERROR", "ERROR_ON_KLAYOUT_DRC", "ERROR_ON_XOR_ERROR"]
# settings a metric's meaning depends on: two runs that differ in them must not be read as a plain improvement/regression
DEPENDS_ON = {"magic_drc": ["MAGIC_DRC_USE_GDS"], "setup_ws": ["CLOCK_PERIOD"], "hold_ws": ["CLOCK_PERIOD"], "setup_vio": ["CLOCK_PERIOD"],
              "hold_vio": ["CLOCK_PERIOD"], "max_slew_vio": ["DESIGN_REPAIR_MAX_SLEW_PCT", "CTS_MAX_SLEW"]}
FLOW_FIRST_STEP = "verilator-lint"  # a run whose first step is something else was resumed from an earlier run's state


def _git_head(root: Path) -> str:
    try:
        return subprocess.run(["git", "-C", str(root), "rev-parse", "--short", "HEAD"], capture_output=True, text=True, timeout=10).stdout.strip() or "unknown"
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def _step_name(step: str) -> str:
    return re.sub(r"^\d+-", "", step)


def _history(run: Path, done: list[str]) -> dict[str, dict[str, Any]]:
    """step -> {metric key: value} for the keys we report (read once per step)."""
    wanted = {v[0] for v in METRICS.values()}
    out: dict[str, dict[str, Any]] = {}
    for s in done:
        try:
            m = json.loads((run / s / "state_out.json").read_text(encoding="utf8")).get("metrics", {})
        except (OSError, json.JSONDecodeError):
            continue
        out[s] = {k: m.get(k) for k in wanted}
    return out


def _first_seen(history: dict[str, dict[str, Any]], steps: list[str], key: str) -> str | None:
    """Earliest step from which the metric has its final value through to the last finished step."""
    final = history[steps[-1]].get(key) if steps else None
    first = None
    for s in reversed(steps):
        if history.get(s, {}).get(key) == final:
            first = s
        else:
            break
    return first


def _unknown_reason(short: str, steps: list[str], done: list[str], resumed: bool) -> str:
    frags = METRICS[short][2]
    names = [_step_name(s) for s in steps]
    hit = [s for s in steps if any(f in _step_name(s) for f in frags)]
    last = done[-1] if done else None
    span = f"this run folder holds steps {steps[0]}..{steps[-1]}" if steps else "this run folder has no steps"
    if not hit:
        why = f"no step producing it ({' / '.join(frags[:2])}) exists in the run; {span}"
    else:
        unfinished = [s for s in hit if s not in done]
        why = (f"{unfinished[0]} started but has no state_out.json (did not finish)" if unfinished
               else f"{hit[-1]} finished but did not report it")
    tail = f"; last finished step: {last}" if last else ""
    return why + tail + ("; run was resumed, so only inherited values exist here" if resumed else "")


def build(run: Path, repo: Path, row: dict[str, Any], alive: set[str] | None, summary: Path | None) -> dict[str, Any]:
    steps = sorted(d.name for d in run.iterdir() if d.is_dir() and re.match(r"\d+-", d.name))
    done = [s for s in steps if (run / s / "state_out.json").exists()]
    resumed = bool(steps) and _step_name(steps[0]) != FLOW_FIRST_STEP
    rel = run.resolve().relative_to(repo.resolve()).as_posix()
    ev = Evidence({"kind": "openlane-run", "id": run.name, "path": rel, "label": row.get("label")}, repo,
                  f"tools/ppa3_evidence.py @ {_git_head(repo)}")

    cfg_id = ev.add_input(run / "resolved.json", "settings the run was started with")
    last_id = ev.add_input(run / done[-1] / "state_out.json", f"state after the last finished step ({done[-1]})") if done else None
    fin_id = ev.add_input(run / "final" / "metrics.json", "final metrics (written only when the flow finishes)")
    sum_id = ev.add_input(summary, "launcher summary (exit code)") if summary else None

    cfg: dict[str, Any] = {}
    if cfg_id:
        try:
            cfg = json.loads((run / "resolved.json").read_text(encoding="utf8"))
        except (OSError, json.JSONDecodeError):
            ev.limit("resolved.json could not be parsed; settings are unknown")
    ev.context = {k: cfg[k] for k in CONTEXT_KEYS if k in cfg}
    ev.context["resumed_from_earlier_state"] = resumed
    m = re.search(r"versions/([0-9a-f]{40})", str(cfg.get("PDK_ROOT", "")))
    ev.environment = {"pdk": cfg.get("PDK"), "pdk_version": m.group(1) if m else None, "std_cell_library": cfg.get("STD_CELL_LIBRARY"),
                      "design": cfg.get("DESIGN_NAME")}

    # ---- metrics: observed or unknown, never defaulted
    hist = _history(run, done)
    for short, (key, unit, _frags) in METRICS.items():
        val = hist[done[-1]].get(key) if done else None
        if val is None:
            ev.unknown(f"m.{short}", short, _unknown_reason(short, steps, done, resumed))
            continue
        first = _first_seen(hist, done, key)
        note = None
        if resumed and first == steps[0]:
            note = "first seen at this folder's first step: the value was inherited from the earlier run's state, not measured here"
        ev.observed(f"m.{short}", short, val, last_id, f"metrics.{key}", unit=unit, step=done[-1], first_seen_step=first, note=note, depends_on_context=DEPENDS_ON.get(short))

    # ---- settings that matter when reading a number
    if "MAGIC_DRC_USE_GDS" in cfg and cfg_id:
        use_gds = bool(cfg["MAGIC_DRC_USE_GDS"])
        ev.observed("c.magic_drc_mode", "magic_drc_mode", "GDS (macro interiors included)" if use_gds else "DEF (macro interiors NOT examined)",
                    cfg_id, "MAGIC_DRC_USE_GDS")
        if not use_gds:
            ev.limit("Magic DRC ran on DEF: it does not look inside macros, so a zero there is not a pass")
    for k in ("CLOCK_PERIOD", "ERROR_ON_MAGIC_DRC", "ERROR_ON_LVS_ERROR", "ERROR_ON_KLAYOUT_DRC"):
        if k in cfg and cfg_id:
            ev.observed(f"c.{k.lower()}", k, cfg[k], cfg_id, k)
    if cfg.get("ERROR_ON_MAGIC_DRC") is False or cfg.get("ERROR_ON_LVS_ERROR") is False or cfg.get("ERROR_ON_KLAYOUT_DRC") is False:
        ev.limit("some checkers were set non-fatal (ERROR_ON_*=false): the flow continues past violations, so completion does not mean a pass")

    # ---- run facts
    ev.observed("r.steps_done", "steps_done", len(done), None, "step folders that contain state_out.json", tool="directory listing")
    if fin_id:
        ev.observed("r.final_metrics_present", "final_metrics_present", True, fin_id, "(file exists)")
    if alive is not None:
        ev.observed("r.process_alive", "process_alive_at_collection", run.name in alive, None, "openlane --run-tag", tool="ps (WSL)",
                    note="point-in-time reading taken when this record was produced")
    if summary and sum_id:
        ex = re.findall(r"exit code: (\d+)", summary.read_text(encoding="utf8", errors="ignore"))
        if ex:
            ev.observed("r.exit_code", "exit_code", int(ex[-1]), sum_id, "last 'exit code:' line")
        else:
            ev.unknown("r.exit_code", "exit_code", f"{summary.name} has no 'exit code:' line")
    else:
        ev.unknown("r.exit_code", "exit_code", "no launcher summary file for this run")

    # ---- derived (rules over observed claims only)
    byname = {c["name"]: c for c in ev.claims}
    if "setup_ws" in byname and byname["setup_ws"]["kind"] == "observed":
        ev.derived("d.setup_met", "setup_met", byname["setup_ws"]["value"] >= 0, ["m.setup_ws"], "setup_ws >= 0")
    if "hold_ws" in byname and byname["hold_ws"]["kind"] == "observed":
        ev.derived("d.hold_met", "hold_met", byname["hold_ws"]["value"] >= 0, ["m.hold_ws"], "hold_ws >= 0")
    present = [s for s in SIGNOFF if byname[s]["kind"] == "observed"]
    if present:
        ev.derived("d.signoff_counts_present", "signoff_counts_present", len(present), [f"m.{s}" for s in present],
                   f"number of the {len(SIGNOFF)} signoff counts {SIGNOFF} that have a value")
    else:
        ev.unknown("d.signoff_counts_present", "signoff_counts_present", "none of the signoff counts has a value in this run")

    # ---- inferred: run state
    if fin_id:
        state, basis, conf = "finished", "final/metrics.json exists", "high"
    elif alive is None:
        state, basis, conf = "unknown", "final/metrics.json absent and the process list could not be read", "low"
    elif run.name in alive:
        state, basis, conf = "running", "no final/metrics.json and an openlane process with this run tag is alive", "medium"
    else:
        state, basis, conf = "stopped", "no final/metrics.json and no live openlane process with this run tag", "medium"
    ev.inferred("i.state", "state", state, basis, conf,
                ["a process list is a point-in-time reading", "a stopped run may have been cut by a WSL restart rather than failing"])
    ev.limit("metrics are the values in the last finished step's state; a metric produced by an earlier step may not reflect later changes")
    ev.limit("collected from run folders only; nothing was re-measured")
    return ev.to_dict()
