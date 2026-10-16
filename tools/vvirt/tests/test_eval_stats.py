"""pass@k / pass^k estimators and the (harness, model) grid cell used by eval/run_trials.py.

    python tools/vvirt/tests/test_eval_stats.py      (plain Python, no vvirt server needed)
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "eval"))
import stats as S  # noqa: E402

checks = []


def check(name, ok, detail=""):
    checks.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


def close(a, b):
    return abs(a - b) < 1e-9


def main() -> int:
    check("pass@1 = c/n", close(S.pass_at_k(4, 3, 1), 0.75))
    check("pass^1 = c/n", close(S.pass_hat_k(4, 3, 1), 0.75))
    check("pass^k = 1 when every trial passed", close(S.pass_hat_k(5, 5, 5), 1.0))
    check("pass^k = 0 when one of k=n trials failed", close(S.pass_hat_k(3, 2, 3), 0.0))
    check("pass@k = 0 when nothing passed", close(S.pass_at_k(5, 0, 3), 0.0))
    check("pass@k = 1 when failures < k", close(S.pass_at_k(4, 2, 3), 1.0))
    check("pass^2 with n=4 c=3 is C(3,2)/C(4,2)=0.5", close(S.pass_hat_k(4, 3, 2), 0.5))
    check("pass@2 with n=4 c=1 is 1-C(3,2)/C(4,2)=0.5", close(S.pass_at_k(4, 1, 2), 0.5))
    try:
        S.pass_hat_k(2, 1, 3)
        check("k > n rejected", False)
    except ValueError:
        check("k > n rejected", True)

    rows = ([{"task": "a", "passed": True, "metrics": {"tool_calls": 2, "errors": 0}, "meta": {"cost_usd": 0.1, "duration_ms": 1000}}] * 3
            + [{"task": "b", "passed": p, "metrics": {"tool_calls": 1, "errors": 1}, "meta": {}} for p in (True, False, True)])
    c = S.cell(rows, "claude-code", "sonnet", "2026-10-16T23:00")
    check("cell: tasks and trials counted", c["tasks"] == 2 and c["trials"] == 6 and c["repeat_min"] == 3)
    check("cell: per-task n/c", c["per_task"] == {"a": {"n": 3, "c": 3}, "b": {"n": 3, "c": 2}})
    check("cell: pass@1 averaged over tasks", close(c["pass_at_k"]["1"], round((1 + 2 / 3) / 2, 4)), str(c["pass_at_k"]))
    check("cell: pass^3 only counts the always-passing task", close(c["pass_hat_k"]["3"], 0.5), str(c["pass_hat_k"]))
    check("cell: tasks passed in every trial", c["passed_tasks_all_trials"] == 1)
    check("cell: metrics summed, missing cost stays partial", c["tool_calls"] == 9 and c["errors"] == 3 and close(c["cost_usd"], 0.3) and close(c["duration_s"], 3.0))

    g = S.upsert([{"harness": "claude-code", "model": "sonnet", "x": 1}, {"harness": "codex", "model": "sonnet"}], c)
    check("upsert replaces same (harness, model) and keeps others", len(g) == 2 and g[-1] is c and g[0]["harness"] == "codex")
    print(f"{sum(checks)}/{len(checks)} checks passed")
    return 0 if all(checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())
