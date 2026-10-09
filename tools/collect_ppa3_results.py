"""Collect the real OpenLane results of the PPA3 (ADC + SRAM) runs into one JSON for the dashboard.

    python tools/collect_ppa3_results.py

Reads   samples/sample_test_4/asic/ppa3_adc_capture/runs/<run>  (state_out.json of the last finished step, final/metrics.json)
Writes  my_dashboard/src/data/ppa3Runs.json
Counts that are not measured yet stay null ("not run"), they are never filled with defaults.
"""
import json
import re
import subprocess
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / "samples/sample_test_4/asic/ppa3_adc_capture/runs"
OUT = ROOT / "my_dashboard/src/data/ppa3Runs.json"
LOGS = ROOT / "tools/wsl/logs"
TOTAL_STEPS = 74  # OpenLane Classic flow for this config

LABELS = {
    "RUN_2026-09-24_14-07-59": "baseline (09-24)",
    "ppa3_antenna_fix": "antenna 반복 10 · margin 20",
    "ppa3_antfix2": "긴 배선 300µm 분할 repair + heuristic diode",
    "ppa3_antfix3_signoff": "antfix2 + Magic 읽기 오류 무시 (signoff부터) · GDS 기준 DRC",
    "ppa3_antfix4_signoff": "antfix3 + 검사 단계 non-fatal · GDS 전체 기준 Magic DRC (재시작 후 다시 실행)",
    "ppa3_pdn2": "사용자 정의 PDN + ADC 전원 rail 연결 조각 (단일 전원 가정, WriteLEF 앞까지)",
    "ppa3_pdn_a_signoff": "ppa3_pdn2를 WriteLEF부터 이어받은 signoff (단일 전원 가정)",
    "ppa3_adcshift_signoff": "ADC를 x 40→30.24로 이동(왼쪽 행 조각 제거), antfix4 설정 · signoff부터 이어받음",
    "ppa3_adcslew_signoff": "ADC 이동 + slew/cap 여유 50% · CTS slew 0.2 ns · signoff부터 이어받음",
    "ppa3_adcslew2_signoff": "ADC 이동 + slew 여유 · KLayout DRC부터 이어받아 완주 (Magic DRC 리포트는 ppa3_adcslew_signoff/01-magic-drc, SRAM 밖 0건)",
    "ppa3_antfix5_signoff": "antfix3 + 검사 단계 non-fatal + Magic DRC를 DEF 기준으로 (macro 내부 미검사)",
}
KEYS = {
    "setup_ws": "timing__setup__ws", "hold_ws": "timing__hold__ws",
    "setup_vio": "timing__setup_vio__count", "hold_vio": "timing__hold__vio_count",
    "antenna_nets": "antenna__violating__nets", "route_drc": "route__drc_errors",
    "magic_drc": "magic__drc_error__count", "klayout_drc": "klayout__drc_error__count",
    "lvs": "design__lvs_error__count", "xor": "design__xor_difference__count",
    "utilization": "design__instance__utilization", "area": "design__instance__area",
    "power": "power__total", "wirelength": "route__wirelength",
}


def live_tags():
    try:
        out = subprocess.run(["wsl.exe", "-e", "bash", "-c", "ps -eo args | grep 'openlane --run-tag'"],
                             capture_output=True, text=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    return set(re.findall(r"--run-tag (\S+)", out))


def collect():
    alive = live_tags()
    rows = []
    names = ["RUN_2026-09-24_14-07-59", "ppa3_antenna_fix", "ppa3_antfix2", "ppa3_antfix3_signoff", "ppa3_antfix4_signoff", "ppa3_antfix5_signoff", "ppa3_pdn2", "ppa3_pdn_a_signoff", "ppa3_adcshift_signoff", "ppa3_adcslew_signoff", "ppa3_adcslew2_signoff"]
    names += sorted(p.name for p in RUNS.glob("ppa3_fin*") if p.is_dir())
    for name in names:
        run = RUNS / name
        if not run.is_dir():
            continue
        steps = sorted(d.name for d in run.iterdir() if d.is_dir() and re.match(r"\d+-", d.name))
        done = [s for s in steps if (run / s / "state_out.json").exists()]
        metrics = {}
        if done:
            st = json.loads((run / done[-1] / "state_out.json").read_text(encoding="utf8"))
            m = st.get("metrics", {})
            metrics = {k: m.get(v) for k, v in KEYS.items()}
        final = (run / "final" / "metrics.json").exists()
        drc_mode = None
        try:
            rc = json.loads((run / "resolved.json").read_text(encoding="utf8"))
            drc_mode = "GDS" if rc.get("MAGIC_DRC_USE_GDS", True) else "DEF"
        except (OSError, json.JSONDecodeError):
            pass
        summary = LOGS / f"{name}.summary"
        exit_code = None
        if summary.exists():
            ex = re.findall(r"exit code: (\d+)", summary.read_text(encoding="utf8", errors="ignore"))
            exit_code = int(ex[-1]) if ex else None
        newest = max((s.stat().st_mtime for s in (run / x for x in steps)), default=run.stat().st_mtime) if steps else run.stat().st_mtime
        if final:
            state = "finished"
        elif alive is not None and name in alive:
            state = "running"
        elif alive is None:
            state = "unknown"
        else:
            state = "stopped"
        # steps counted from the first step id of resumed runs are not comparable, so only report the numbers
        rows.append({
            "run": name, "label": LABELS.get(name, name), "state": state, "exit_code": exit_code,
            "steps_done": len(done), "last_step": done[-1] if done else None,
            "next_step": (steps[-1] if steps and steps[-1] != (done[-1] if done else None) else None),
            "magic_drc_mode": drc_mode,
            "updated": datetime.fromtimestamp(newest).isoformat(timespec="minutes"),
            "metrics": metrics,
        })
    return rows


if __name__ == "__main__":
    rows = collect()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"generated": datetime.now().isoformat(timespec="minutes"), "total_steps": TOTAL_STEPS, "runs": rows}, indent=1, ensure_ascii=False), encoding="utf8")
    for r in rows:
        m = r["metrics"]
        print(f'{r["run"]:26} {r["state"]:9} done={r["steps_done"]:2} last={r["last_step"]} antenna={m.get("antenna_nets")} xor={m.get("xor")} drc={m.get("magic_drc")}')
