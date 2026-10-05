"""Collect real OpenLane results of the chan_top reshape experiments into one JSON file.

The dashboard (Macro Area Tetris -> AREA FINDING) renders this file instead of hand-typed numbers, so a
re-run of this script is all that is needed after a run finishes:

    python tools/collect_reshape_results.py

Reads   samples/sample_test_4/asic/chan_top/runs/reshape_full_*  and  reshape_try_*
        (final/metrics.json when present, else the antenna check of the last finished step)
Writes  my_dashboard/src/data/reshapeRuns.json
"""
import json
import re
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "samples/sample_test_4/asic/chan_top"
RUNS = BASE / "runs"
OUT = ROOT / "my_dashboard/src/data/reshapeRuns.json"
SUMMARY_DIR = ROOT / "tools/wsl/logs"

KEYS = {
    "setup_ws": "timing__setup__ws",
    "hold_ws": "timing__hold__ws",
    "setup_vio": "timing__setup_vio__count",
    "route_drc": "route__drc_errors",
    "magic_drc": "magic__drc_error__count",
    "klayout_drc": "klayout__drc_error__count",
    "lvs": "design__lvs_error__count",
    "antenna_nets": "antenna__violating__nets",
    "wirelength": "route__wirelength",
    "power": "power__total",
}
ANT_ROW = re.compile(r"│\s*([\d.]+)\s*│\s*([\d.]+)\s*│\s*([\d.]+)\s*│\s*(\S+)\s*│\s*(\S+)\s*│\s*(\S+)\s*│")


def numbered_steps(run: Path):
    return sorted(d for d in run.iterdir() if d.is_dir() and re.match(r"\d+-", d.name))


def last_finished_step(run: Path):
    done = [d for d in numbered_steps(run) if (d / "state_out.json").exists()]
    return done[-1].name if done else None


def antenna_from_steps(run: Path):
    """antenna result of the last check-antennas step (works even if the run was cut off later)."""
    checks = [d for d in numbered_steps(run) if "checkantennas" in d.name and (d / "state_out.json").exists()]
    if not checks:
        return None
    step = checks[-1]
    rows = []
    rpt = step / "reports" / "antenna_summary.rpt"
    if rpt.exists():
        for m in ANT_ROW.finditer(rpt.read_text(encoding="utf8", errors="ignore")):
            rows.append({"ratio": float(m.group(1)), "net": m.group(4), "pin": m.group(5), "layer": m.group(6)})
    nets = None
    mf = step / "or_metrics_out.json"
    if mf.exists():
        try:
            nets = json.loads(mf.read_text(encoding="utf8")).get("antenna__violating__nets")
        except json.JSONDecodeError:
            pass
    # the first check (before repair / detailed routing) is only an intermediate number; the one after
    # detailed routing is named "...checkantennas-1" and is the signoff-relevant value
    return {"step": step.name, "nets": nets, "violations": rows, "post_route": step.name.endswith("checkantennas-1")}


def parse_name(name: str):
    m = re.match(r"reshape_(full|try)_(\d+x\d+)(?:_(.+))?$", name)
    if not m:
        return None
    kind, shape, variant = m.groups()
    return kind, shape, variant or "base"


def config_knobs(shape: str, variant: str, kind: str):
    cfg_name = f"config_reshape_{shape}.json" if kind == "full" else f"config_reshape_{shape}_{variant}.json"
    p = BASE / cfg_name
    knobs = {"axi_period": 52, "ant_margin": 10, "ant_iters": 3, "heuristic_um": 90}
    if kind == "try" and "axi54" in variant:
        knobs["axi_period"] = 54
    if p.exists():
        c = json.loads(p.read_text(encoding="utf8"))
        knobs["ant_margin"] = c.get("GRT_ANTENNA_MARGIN", knobs["ant_margin"])
        knobs["ant_iters"] = c.get("GRT_ANTENNA_ITERS", knobs["ant_iters"])
        knobs["heuristic_um"] = c.get("HEURISTIC_ANTENNA_THRESHOLD", knobs["heuristic_um"])
    return knobs


def summary_state(name: str):
    """started/finished info from tools/wsl/logs/<name>.summary (written by the run scripts)."""
    p = SUMMARY_DIR / f"{name}.summary"
    if not p.exists():
        return None, False
    text = p.read_text(encoding="utf8", errors="ignore")
    starts = re.findall(r"===.*?(\d{4}-\d{2}-\d{2}T[\d:]+)", text)
    exits = re.findall(r"exit code: (\d+)", text)
    # a run counts as finished only if an exit line comes after the last start/resume line
    last_start = max((m.start() for m in re.finditer(r"===", text)), default=-1)
    last_exit = max((m.start() for m in re.finditer(r"exit code:", text)), default=-1)
    return (starts[-1] if starts else None), (last_exit > last_start >= 0), (int(exits[-1]) if exits else None)


def collect():
    rows = []
    for run in sorted(RUNS.glob("reshape_*")):
        parsed = parse_name(run.name)
        if not parsed or not run.is_dir():
            continue
        kind, shape, variant = parsed
        row = {
            "run": run.name,
            "shape": shape,
            "variant": variant,
            "scope": "full" if (run / "final" / "metrics.json").exists() and any("klayout" in d.name for d in numbered_steps(run)) else "partial",
            "knobs": config_knobs(shape, variant, kind),
            "last_step": last_finished_step(run),
        }
        info = summary_state(run.name)
        if info and info[0]:
            row["started"] = info[0]
            row["finished_ok"] = bool(info[1]) and info[2] == 0
        elif kind == "full":
            row["started"] = None
            row["finished_ok"] = (run / "final" / "metrics.json").exists()
        else:
            row["started"] = None
            row["finished_ok"] = False

        mjson = run / "final" / "metrics.json"
        metrics = {}
        if mjson.exists():
            d = json.loads(mjson.read_text(encoding="utf8"))
            metrics = {k: d.get(v) for k, v in KEYS.items()}
            row["metrics_source"] = "final/metrics.json"
            row["updated"] = datetime.fromtimestamp(mjson.stat().st_mtime).isoformat(timespec="minutes")
        else:
            row["metrics_source"] = "antenna check only"
            steps = numbered_steps(run)
            row["updated"] = datetime.fromtimestamp(max(s.stat().st_mtime for s in steps)).isoformat(timespec="minutes") if steps else None
        row["metrics"] = metrics

        ant = antenna_from_steps(run)
        if ant:
            row["antenna"] = ant
            if metrics.get("antenna_nets") is None and ant["post_route"]:
                metrics["antenna_nets"] = ant["nets"]
        # 'running' = unfinished and written to within the last 15 minutes
        if not row["finished_ok"] and row["updated"]:
            age_min = (time.time() - datetime.fromisoformat(row["updated"]).timestamp()) / 60
            row["state"] = "running" if age_min < 15 else "interrupted"
        else:
            row["state"] = "finished" if row["finished_ok"] else "unknown"
        rows.append(row)
    rows.sort(key=lambda r: (int(r["shape"].split("x")[0]), r["knobs"]["axi_period"], r["variant"]))
    return rows


if __name__ == "__main__":
    rows = collect()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"generated": datetime.now().isoformat(timespec="minutes"), "runs": rows}, indent=1, ensure_ascii=False), encoding="utf8")
    for r in rows:
        m = r["metrics"]
        print(f'{r["run"]:42} {r["state"]:11} axi={r["knobs"]["axi_period"]} setup={m.get("setup_ws")} antenna={m.get("antenna_nets")} step={r["last_step"]}')
    print("wrote", OUT)
