"""Repeat-trial statistics for the agent eval: pass@k and pass^k per task, and one grid cell per (harness, model).

pass@k  = chance that at least one of k trials passes   = 1 - C(n-c, k) / C(n, k)   (unbiased, Chen et al. 2021)
pass^k  = chance that all k trials pass                 =     C(c, k)   / C(n, k)   (unbiased, tau-bench)
n = trials run for the task, c = trials that passed. Both need k <= n; values are averaged over tasks.
"""
from __future__ import annotations

from math import comb


def pass_at_k(n: int, c: int, k: int) -> float:
    if not 1 <= k <= n:
        raise ValueError(f"k={k} needs 1 <= k <= n={n}")
    return 1.0 - comb(n - c, k) / comb(n, k)


def pass_hat_k(n: int, c: int, k: int) -> float:
    if not 1 <= k <= n:
        raise ValueError(f"k={k} needs 1 <= k <= n={n}")
    return comb(c, k) / comb(n, k)


def per_task(rows: list[dict]) -> dict[str, dict[str, int]]:
    """rows (one per trial) -> {task: {"n": trials, "c": passed}}"""
    out: dict[str, dict[str, int]] = {}
    for r in rows:
        t = out.setdefault(r["task"], {"n": 0, "c": 0})
        t["n"] += 1
        t["c"] += 1 if r["passed"] else 0
    return out


def _num(rows: list[dict], key: str) -> float | None:
    vals = [r.get("meta", {}).get(key) for r in rows]
    vals = [v for v in vals if isinstance(v, (int, float))]
    return round(sum(vals), 4) if vals else None


def cell(rows: list[dict], harness: str, model: str, generated: str) -> dict:
    """Summarise every trial of one (harness, model) pair. k runs to the smallest n over tasks, so every task counts for every k."""
    pt = per_task(rows)
    kmax = min(t["n"] for t in pt.values()) if pt else 0
    avg = lambda f, k: round(sum(f(t["n"], t["c"], k) for t in pt.values()) / len(pt), 4)  # noqa: E731
    return {
        "harness": harness, "model": model, "generated": generated,
        "tasks": len(pt), "trials": len(rows), "repeat_min": kmax,
        "per_task": pt,
        "passed_tasks_all_trials": sum(1 for t in pt.values() if t["c"] == t["n"]),
        "pass_at_k": {str(k): avg(pass_at_k, k) for k in range(1, kmax + 1)},
        "pass_hat_k": {str(k): avg(pass_hat_k, k) for k in range(1, kmax + 1)},
        "tool_calls": sum(r.get("metrics", {}).get("tool_calls", 0) for r in rows),
        "errors": sum(r.get("metrics", {}).get("errors", 0) for r in rows),
        "cost_usd": _num(rows, "cost_usd"),
        "duration_s": (lambda ms: None if ms is None else round(ms / 1000, 1))(_num(rows, "duration_ms")),
        "api_errors": sum(1 for r in rows if r.get("meta", {}).get("api_error")),
    }


def upsert(grid: list[dict], new: dict) -> list[dict]:
    """Replace the cell with the same (harness, model), keep the others."""
    return [g for g in grid if (g["harness"], g["model"]) != (new["harness"], new["model"])] + [new]
