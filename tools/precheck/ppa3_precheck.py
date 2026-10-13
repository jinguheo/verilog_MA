"""PPA3 result pre-check: read an OpenLane run folder and report, check by check, what passes / fails / was not run.

    python tools/precheck/ppa3_precheck.py run <run_dir_name> [--magic-rpt <path>] [--json]
    python tools/precheck/ppa3_precheck.py all            # writes my_dashboard/src/data/precheck.json for the dashboard

It only READS result files (metrics, flow log, reports); it runs no EDA tool. Early (before-the-flow) checks are in
tools/wsl/132_ppa3_precheck_early.sh.

Rules the report follows (same as the dashboard):
  * "not run" is never counted as a pass.
  * Magic DRC findings inside the hard macros (SRAM22 / ADC) are reported separately from findings outside them.
  * A DEF-based Magic DRC (MAGIC_DRC_USE_GDS=false) is labelled as such and is not accepted as a pass.
"""
from __future__ import annotations

import argparse
import collections
import json
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNS = ROOT / "samples/sample_test_4/asic/ppa3_adc_capture/runs"
OUT = ROOT / "my_dashboard/src/data/precheck.json"
DEFAULT_ALL = [
    ("ppa3_antfix4_signoff", None),
    ("ppa3_pdn_a_signoff", None),
    ("ppa3_adcslew2_signoff", "ppa3_adcslew_signoff"),  # Magic DRC report lives in the interrupted run that produced it
]
RPT_ROW = re.compile(r"\s*(-?[\d.]+)um (-?[\d.]+)um (-?[\d.]+)um (-?[\d.]+)um")


def last_metrics(run: Path) -> tuple[dict, str | None]:
    fm = run / "final" / "metrics.json"
    if fm.exists():
        return json.loads(fm.read_text(encoding="utf8")), "final/metrics.json"
    steps = sorted(d for d in run.iterdir() if d.is_dir() and re.match(r"\d+-", d.name))
    done = [d for d in steps if (d / "state_out.json").exists()]
    if not done:
        return {}, None
    st = json.loads((done[-1] / "state_out.json").read_text(encoding="utf8"))
    return st.get("metrics", {}), f"{done[-1].name}/state_out.json"


def macro_boxes(run: Path) -> dict[str, tuple[float, float, float, float]]:
    """name -> (x0, y0, x1, y1) in um, from the resolved config (instance location + LEF SIZE)."""
    boxes: dict[str, tuple[float, float, float, float]] = {}
    try:
        cfg = json.loads((run / "resolved.json").read_text(encoding="utf8"))
    except (OSError, json.JSONDecodeError):
        return boxes
    for mname, m in (cfg.get("MACROS") or {}).items():
        lefs = m.get("lef") or []
        size = None
        for lef in lefs:
            p = Path(str(lef).replace("/mnt/d/", "D:/")) if str(lef).startswith("/mnt/d/") else Path(lef)
            if p.exists():
                mm = re.search(r"SIZE\s+([\d.]+)\s+BY\s+([\d.]+)", p.read_text(encoding="utf8", errors="ignore"))
                if mm:
                    size = (float(mm.group(1)), float(mm.group(2)))
                    break
        for iname, inst in (m.get("instances") or {}).items():
            if size and inst.get("location"):
                x, y = inst["location"]
                boxes[iname] = (x, y, x + size[0], y + size[1])
    return boxes


def find_magic_rpt(run: Path, override: Path | None) -> Path | None:
    if override:
        return override if override.exists() else None
    for d in sorted(run.iterdir()):
        if d.is_dir() and d.name.endswith("magic-drc"):
            r = d / "reports" / "drc_violations.magic.rpt"
            if r.exists():
                return r
    return None


def classify_magic(rpt: Path, boxes: dict) -> dict:
    inside = collections.Counter()
    outside_rules: collections.Counter = collections.Counter()
    total = 0
    cur = None
    complete = False
    with rpt.open(encoding="utf8", errors="ignore") as f:
        for line in f:
            m = RPT_ROW.match(line)
            if m:
                x0, y0, x1, y1 = map(float, m.groups())
                total += 1
                where = None
                for name, b in boxes.items():
                    if x0 >= b[0] - 1 and y0 >= b[1] - 1 and x1 <= b[2] + 1 and y1 <= b[3] + 1:
                        where = name
                        break
                if where:
                    inside[where] += 1
                else:
                    outside_rules[cur or "?"] += 1
            elif line.startswith("[INFO] COUNT:"):
                complete = True
            elif line.strip() and not line.startswith("-") and not line.startswith("[") and line.strip() != "ppa3_adc_capture_top":
                cur = line.strip()[:70]
    return {"total": total, "inside_macros": dict(inside), "outside": sum(outside_rules.values()),
            "outside_rules": dict(outside_rules), "report_complete": complete}


def check_run(name: str, magic_from: str | None = None) -> dict:
    run = RUNS / name
    res = {"run": name, "checks": [], "generated": datetime.now().isoformat(timespec="minutes")}
    if not run.is_dir():
        res["error"] = "run folder not found"
        return res
    metrics, src = last_metrics(run)
    res["metrics_source"] = src

    def add(cid: str, title: str, status: str, value: str, hint: str = "") -> None:
        res["checks"].append({"id": cid, "title": title, "status": status, "value": value, "hint": hint})

    def count(key: str):
        return metrics.get(key)

    # 1 power grid (PSM)
    flow = run / "flow.log"
    psm = None
    if flow.exists():
        t = flow.read_text(encoding="utf8", errors="ignore")
        m = re.search(r"(\d+) power grid violations", t)
        if m:
            psm = int(m.group(1))
        elif "Check for power grid violations" in t and "clear" in t:
            psm = 0
    add("pdn", "전원 grid 연결 (PSM)", "not run" if psm is None else ("pass" if psm == 0 else "fail"),
        "이 run에는 해당 단계 기록 없음(이어받은 run)" if psm is None else f"{psm}건", "PDN 직후 132_ppa3_precheck_early.sh로 먼저 확인")
    # 2 route DRC / antenna / XOR
    for cid, title, key, hint in (("route", "route DRC", "route__drc_errors", ""),
                                  ("antenna", "antenna", "antenna__violating__nets", "GRT_DESIGN_REPAIR_MAX_WIRE_LENGTH 300"),
                                  ("xor", "XOR (Magic vs KLayout GDS)", "design__xor_difference__count", "")):
        v = count(key)
        add(cid, title, "not run" if v is None else ("pass" if v == 0 else "fail"), "-" if v is None else f"{v}건", hint)
    # 3 KLayout DRC
    v = count("klayout__drc_error__count")
    add("klayout", "KLayout DRC", "not run" if v is None else ("pass" if v == 0 else "fail"), "-" if v is None else f"{v}건")
    # 4 Magic DRC outside macros
    rpt = find_magic_rpt(run, (RUNS / magic_from / "01-magic-drc/reports/drc_violations.magic.rpt") if magic_from else None)
    mode = None
    try:
        mode = "GDS" if json.loads((run / "resolved.json").read_text(encoding="utf8")).get("MAGIC_DRC_USE_GDS", True) else "DEF"
    except (OSError, json.JSONDecodeError):
        pass
    if rpt is None:
        add("magic", "Magic DRC (macro 밖)", "not run", "위반 리포트 없음", "")
    else:
        boxes = macro_boxes(run if (run / "resolved.json").exists() else RUNS / (magic_from or name))
        c = classify_magic(rpt, boxes)
        res["magic"] = c
        if not c["report_complete"]:
            add("magic", "Magic DRC (macro 밖)", "not run", "리포트가 완성되지 않음", "")
        elif mode == "DEF":
            add("magic", "Magic DRC (macro 밖, DEF 기준)", "fail" if c["outside"] else "info", f"{c['outside']}건 · DEF 기준이라 macro 내부 미검사, 통과로 세지 않음", "")
        else:
            top = ", ".join(f"{k.split('(')[-1].rstrip(')') or k[:20]} {v}" for k, v in sorted(c["outside_rules"].items(), key=lambda kv: -kv[1])[:3])
            add("magic", "Magic DRC (macro 밖, GDS 기준)", "pass" if c["outside"] == 0 else "fail",
                f"{c['outside']}건" + (f" ({top})" if top else ""), "macro 옆 행 조각의 tap 부족 → tap_coverage.tcl")
        ins = ", ".join(f"{k} {v:,}" for k, v in sorted(c["inside_macros"].items()))
        add("magic_macro", "Magic DRC (macro 내부)", "info", ins or "0건", "공급자 IP 내부 — 제외 범위를 명시해 별도 보고")
    # 5 LVS
    v = count("design__lvs_error__count")
    add("lvs", "LVS", "not run" if v is None else ("pass" if v == 0 else "fail"),
        "-" if v is None else f"{v}건 (device {count('design__lvs_unmatched_device__count')}, net {count('design__lvs_unmatched_net__count')}, pin {count('design__lvs_unmatched_pin__count')})", "")
    # 6 timing / slew / cap
    sw, hw = count("timing__setup__ws"), count("timing__hold__ws")
    if sw is None:
        add("timing", "타이밍 (setup / hold)", "not run", "-")
    else:
        bad = (sw < 0) or (hw is not None and hw < 0)
        add("timing", "타이밍 (setup / hold)", "fail" if bad else "pass", f"{sw:+.2f} / {hw:+.2f} ns" if hw is not None else f"{sw:+.2f} ns")
    for cid, title, key in (("slew", "max-slew 위반", "design__max_slew_violation__count"), ("cap", "max-cap 위반", "design__max_cap_violation__count")):
        v = count(key)
        add(cid, title, "not run" if v is None else ("pass" if v == 0 else "fail"), "-" if v is None else f"{v}건")
    st = [c["status"] for c in res["checks"]]
    res["summary"] = {"pass": st.count("pass"), "fail": st.count("fail"), "not_run": st.count("not run")}
    return res


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["run", "all"])
    ap.add_argument("name", nargs="?")
    ap.add_argument("--magic-rpt")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    if a.cmd == "run":
        if not a.name:
            ap.error("run needs a run directory name")
        r = check_run(a.name, None)
        if a.magic_rpt:
            # allow explicit override
            run = RUNS / a.name
            r = check_run(a.name, Path(a.magic_rpt).parent.parent.parent.name)
        results = [r]
    else:
        results = [check_run(n, m) for n, m in DEFAULT_ALL]
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps({"generated": datetime.now().isoformat(timespec="minutes"), "runs": results}, indent=1, ensure_ascii=False), encoding="utf8")
        print("wrote", OUT)
    for r in results:
        print(f"\n== {r['run']}  (pass {r.get('summary', {}).get('pass', 0)} / fail {r.get('summary', {}).get('fail', 0)} / not run {r.get('summary', {}).get('not_run', 0)})")
        for c in r.get("checks", []):
            print(f"  [{c['status']:7}] {c['title']:34} {c['value']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
