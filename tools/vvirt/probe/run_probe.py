"""Run the read-only Virtuoso probe (vb_probe.il) through the virtuoso-bridge client and check what came back.

    bash tools/vvirt/scripts/pyrun.sh tools/vvirt/probe/run_probe.py --lib sky130_fd_sc_hd --cell sky130_fd_sc_hd__inv_1 \
        [--remote-dir /tmp/vbprobe] [--local-dir tools/vvirt/probe/out]

The same command works against the virtual Virtuoso and a real one (the client picks the daemon from ~/.virtuoso-bridge/.env).
Steps: send vb_probe.il (with the parameters in front) -> call vbpRun() -> download probe_*.json -> parse every file -> write
probe_report.json with, per section: status (ok/error from SKILL), bytes, JSON parses (yes/no), plus which functions exist.
Exit code 0 only if every file arrived and parsed; a SKILL section that failed ("error") is a finding, not a script failure.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SECTIONS = ["functions", "libraries", "cells", "tech", "cell"]


def q(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def fetch(client, remote: str, local: str) -> str:
    """Bring one remote file local. In local mode (same machine) a plain copy is enough; otherwise use the client."""
    if os.path.isfile(remote):
        shutil.copyfile(remote, local)
        return "copy"
    client.download_file(remote, local)
    return "download"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lib", required=True)
    ap.add_argument("--cell", required=True)
    ap.add_argument("--remote-dir", default="/mnt/d/MyWork/Veriolg_MA/tools/vvirt/workspace/_out/probe")
    ap.add_argument("--local-dir", default=os.path.join(HERE, "out"))
    ap.add_argument("--max-cells", type=int, default=500)
    a = ap.parse_args()

    from virtuoso_bridge import VirtuosoClient

    c = VirtuosoClient.from_env()
    os.makedirs(a.local_dir, exist_ok=True)
    code = (f"vbpOut = {q(a.remote_dir)}\nvbpLib = {q(a.lib)}\nvbpCell = {q(a.cell)}\nvbpMax = {a.max_cells}\n"
            + open(os.path.join(HERE, "vb_probe.il"), encoding="utf-8").read())
    r = c.execute_skill(code, timeout=120)
    if r.status.value != "success":
        print("loading vb_probe.il failed:", r.errors or r.output)
        return 2
    r = c.execute_skill("vbpRun()", timeout=300)
    summary = (r.output or "").strip()
    print("probe returned:", summary)

    report: dict = {"lib": a.lib, "cell": a.cell, "skill_summary": summary, "sections": {}}
    bad = 0
    for s in SECTIONS:
        name = f"probe_{s}.json"
        local = os.path.join(a.local_dir, name)
        row = {"file": name, "bytes": 0, "json_ok": False, "skill_status": None, "how": None, "error": None}
        try:
            row["how"] = fetch(c, a.remote_dir.rstrip("/") + "/" + name, local)
            row["bytes"] = os.path.getsize(local)
            doc = json.load(open(local, encoding="utf-8"))
            row["json_ok"] = True
            row["skill_status"] = doc.get("status")
            if s == "functions" and doc.get("status") == "ok":
                report["functions"] = {d["name"]: d["exists"] for d in doc["data"]}
        except Exception as exc:  # noqa: BLE001 - report every kind of failure per file
            row["error"] = f"{type(exc).__name__}: {exc}"
            bad += 1
        report["sections"][s] = row
    json.dump(report, open(os.path.join(a.local_dir, "probe_report.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)

    print(f"{'section':<10} {'skill':<7} {'bytes':>7}  json")
    for s, row in report["sections"].items():
        print(f"{s:<10} {str(row['skill_status']):<7} {row['bytes']:>7}  {'ok' if row['json_ok'] else 'FAIL ' + str(row['error'])}")
    miss = [n for n, ok in report.get("functions", {}).items() if not ok]
    if miss:
        print("functions missing here:", " ".join(miss))
    print("report:", os.path.join(a.local_dir, "probe_report.json"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
