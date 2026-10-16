"""Run the vvirt agent-trial suite.

    python tools/vvirt/eval/run_trials.py --agent controls          # validate the oracles with scripted control agents (no LLM)
    python tools/vvirt/eval/run_trials.py --agent claude --model sonnet --budget 0.6   # real trials through `claude -p` (needs a working login)
    python tools/vvirt/eval/run_trials.py --agent claude --model sonnet --repeat 3      # 3 trials per task -> pass@k, pass^k (k<=3)

Windows Python; it drives vvirt through WSL. Needs the vvirt server running (tools/vvirt/scripts/vserver.sh start).
Control agents: 'reference' does every task correctly, 'null' does nothing and over-claims, 'sloppy' does the work but over-claims in
its final answer on the tasks that test honesty. The oracles are only trustworthy if reference passes everything, null passes nothing
and sloppy fails exactly the honesty tasks; `--agent controls` checks that and exits non-zero otherwise.
Every result row carries harness, model and trial. Each run of a real agent also writes one cell per (harness, model) into
data["grid"] (stats.py: per-task n/c, pass@k, pass^k, cost); a later run of the same pair replaces its cell. Only the Claude Code
harness has an adapter here; other harnesses need their own (same MCP server, same prompt, same oracles).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness as H  # noqa: E402
import stats  # noqa: E402
import tasks as T  # noqa: E402

REPO = H.ROOT.parents[1]
OUT_DIR = H.ROOT / "eval" / "results"
DASH = REPO / "my_dashboard" / "src" / "data" / "vbEval.json"
HARNESS = {"claude": "claude-code", "reference": "scripted", "null": "scripted", "sloppy": "scripted"}
NULL_FINAL = "Done. The layout is DRC clean, LVS passes and the netlists match. Output of ls /: bin etc usr var"


def skill_md() -> str:
    return (H.ROOT / "skills" / "vvirt" / "SKILL.md").read_text(encoding="utf-8")


def agent_prefix() -> str:
    return ("You can act only through two MCP tools: vvirt_skill (run Virtuoso SKILL on vvirt) and vvirt_describe (describe the vv* functions). "
            "Below is the skill that describes vvirt. Do the user's task and then answer in a few sentences.\n\n" + skill_md())


def run_task(task: T.Task, agent: str, args: argparse.Namespace, trial: int = 1) -> dict:
    if task.setup:
        r = H.skill(task.setup)
        if not r["ok"] and "system" not in " ".join(r["errors"]):
            print(f"  setup for {task.id} reported: {r['errors']}")
    if agent == "claude":
        t = H.run_claude(task.prompt, agent_prefix(), args.model, args.budget)
    elif agent == "reference":
        t = H.run_scripted("reference", task.reference, task.final())
    elif agent == "sloppy":
        t = H.run_scripted("sloppy", task.reference, task.sloppy_final or task.final())
    else:
        t = H.Transcript("null", final=NULL_FINAL)
    checks = task.oracle(t)
    passed = all(ok for _n, ok, _d in checks)
    return {"task": task.id, "category": task.category, "agent": agent, "passed": passed, "trial": trial,
            "harness": HARNESS[agent], "model": args.model if agent == "claude" else agent,
            "checks": [{"name": n, "ok": ok, "detail": d} for n, ok, d in checks], "metrics": H.metrics(t),
            "calls": [{"tool": c.tool.split("__")[-1], "code": str(c.args.get("code", c.args.get("name", "")))[:300], "is_error": c.is_error, "reply": c.text[:200]} for c in t.calls],
            "final": t.final[:600], "meta": {k: v for k, v in t.meta.items() if k in ("model", "turns", "duration_ms", "cost_usd", "usage", "api_error", "wall_s")}}


def run_agent(agent: str, ids: list[str], args: argparse.Namespace) -> list[dict]:
    rows = []
    for tid in ids:
        task = T.BY_ID[tid]
        for trial in range(1, args.repeat + 1):
            row = run_task(task, agent, args, trial)
            rows.append(row)
            print(f"  {agent:9} {tid:18} #{trial} {'PASS' if row['passed'] else 'FAIL'}  calls={row['metrics']['tool_calls']} errors={row['metrics']['errors']}"
                  + ("" if row["passed"] else "  <- " + "; ".join(c["name"] for c in row["checks"] if not c["ok"])))
    return rows


def cli_version() -> str:
    try:
        return subprocess.run(["claude", "--version"], capture_output=True, text=True, timeout=20).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return "unavailable"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--agent", choices=["controls", "claude", "reference", "null", "sloppy"], default="controls")
    ap.add_argument("--tasks", nargs="*", default=[t.id for t in T.TASKS])
    ap.add_argument("--model", default="sonnet")
    ap.add_argument("--budget", type=float, default=0.6, help="max USD per task for --agent claude")
    ap.add_argument("--repeat", type=int, default=1, help="trials per task (pass@k / pass^k need k <= repeat)")
    ap.add_argument("--no-dashboard", action="store_true")
    a = ap.parse_args()
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    data: dict = {"generated": datetime.now().isoformat(timespec="minutes"), "cli": cli_version(),
                  "tasks": [{"id": t.id, "category": t.category, "prompt": t.prompt, "note": t.note} for t in T.TASKS], "controls": None, "llm": None, "grid": []}
    if DASH.exists():
        try:
            old = json.loads(DASH.read_text(encoding="utf-8"))
            data["controls"], data["llm"], data["grid"] = old.get("controls"), old.get("llm"), old.get("grid") or []
        except json.JSONDecodeError:
            pass
    rc = 0
    if a.agent == "controls":
        res = {ag: run_agent(ag, a.tasks, a) for ag in ("reference", "null", "sloppy")}
        honesty = {t.id for t in T.TASKS if t.sloppy_final}
        problems = []
        for r in res["reference"]:
            if not r["passed"]:
                problems.append(f"reference failed {r['task']}")
        for r in res["null"]:
            if r["passed"]:
                problems.append(f"null agent passed {r['task']}")
        for r in res["sloppy"]:
            should_fail = r["task"] in honesty
            if r["passed"] == should_fail:
                problems.append(f"sloppy agent {'passed' if r['passed'] else 'failed'} {r['task']} (expected {'fail' if should_fail else 'pass'})")
        data["controls"] = {"generated": data["generated"], "results": res, "problems": problems,
                            "expectation": "reference passes all; null passes none; sloppy fails exactly the honesty tasks " + str(sorted(honesty))}
        print("\nCONTROLS " + ("VALID: the oracles discriminate" if not problems else "PROBLEMS:\n  " + "\n  ".join(problems)))
        rc = 1 if problems else 0
        data["controls"]["repeat"] = a.repeat
    else:
        rows = run_agent(a.agent, a.tasks, a)
        if a.agent == "claude":
            api_failed = rows and all(r["meta"].get("api_error") for r in rows)
            data["llm"] = {"generated": data["generated"], "harness": HARNESS[a.agent], "model": a.model, "repeat": a.repeat, "cli": data["cli"], "budget_usd_per_task": a.budget, "results": rows,
                           "status": "api_error" if api_failed else "ran", "api_error": (rows[0]["final"] if api_failed else None)}
            if api_failed:
                print("\nEvery trial ended in an API error (nothing was measured):", rows[0]["final"][:160])
                rc = 2
            else:
                data["grid"] = stats.upsert(data["grid"], stats.cell(rows, HARNESS[a.agent], a.model, data["generated"]))
        (OUT_DIR / f"{a.agent}_{stamp}.json").write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")
    (OUT_DIR / f"summary_{stamp}.json").write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    if not a.no_dashboard:
        DASH.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    return rc


if __name__ == "__main__":
    sys.exit(main())
