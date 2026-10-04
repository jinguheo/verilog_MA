"""OpenLane screening and signoff for Macro Area Tetris daq_subsystem candidates."""
from __future__ import annotations

import copy
import json
import math
import subprocess
import threading
import uuid
from pathlib import Path

from layout_candidate_runner import _screen_metrics

ROOT = Path(__file__).resolve().parent
DESIGN_DIR = ROOT / "samples" / "sample_test_4" / "asic" / "daq_subsystem"
SOURCE_CONFIG = DESIGN_DIR / "config_hierarchical.json"
RUNNER = ROOT / "tools" / "wsl" / "104_run_layout_candidate.sh"
JOBS_ROOT = ROOT / "physical_design" / "macro_area_verification"
MACRO_SIZE = 800
_lock = threading.Lock()
_batches: dict[str, dict] = {}


def _save(batch: dict) -> None:
    path = JOBS_ROOT / batch["id"] / "batch.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(batch, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def get_batch(batch_id: str) -> dict | None:
    with _lock:
        batch = _batches.get(batch_id)
        if batch is None and len(batch_id) == 12 and all(ch in "0123456789abcdef" for ch in batch_id):
            path = JOBS_ROOT / batch_id / "batch.json"
            if path.is_file():
                batch = json.loads(path.read_text(encoding="utf-8"))
        return copy.deepcopy(batch) if batch else None


def _update(batch_id: str, **values) -> None:
    with _lock:
        batch = _batches[batch_id]
        batch.update(values)
        _save(batch)


def _check_candidate(item: dict) -> dict:
    candidate_id = str(item.get("id", ""))
    if not candidate_id or len(candidate_id) > 40 or not all(c.isalnum() or c in "-_" for c in candidate_id):
        raise ValueError("Invalid candidate ID.")
    die = item.get("die") or {}
    width, height = die.get("w"), die.get("h")
    if not all(isinstance(v, int) and not isinstance(v, bool) and 1800 <= v <= 10000 for v in (width, height)):
        raise ValueError(f"{candidate_id}: invalid die size.")
    macros = item.get("macros")
    if not isinstance(macros, list) or len(macros) != 8:
        raise ValueError(f"{candidate_id}: exactly eight chan_top macros are required.")
    coords = []
    for macro in macros:
        if not isinstance(macro, dict):
            raise ValueError(f"{candidate_id}: invalid macro coordinate.")
        x, y = macro.get("x"), macro.get("y")
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (x, y)):
            raise ValueError(f"{candidate_id}: invalid macro coordinate.")
        if x < 0 or y < 0 or x + MACRO_SIZE > width or y + MACRO_SIZE > height:
            raise ValueError(f"{candidate_id}: macro outside die.")
        coords.append((round(x), round(y)))
    for i, (x, y) in enumerate(coords):
        for xx, yy in coords[:i]:
            if x < xx + MACRO_SIZE and xx < x + MACRO_SIZE and y < yy + MACRO_SIZE and yy < y + MACRO_SIZE:
                raise ValueError(f"{candidate_id}: overlapping macros.")
    return {"id": candidate_id, "die": {"w": width, "h": height}, "coords": coords}


def _config_for(batch_id: str, index: int, candidate: dict, density: float) -> Path:
    config = json.loads(SOURCE_CONFIG.read_text(encoding="utf-8"))
    config["DIE_AREA"] = [0, 0, candidate["die"]["w"], candidate["die"]["h"]]
    config["PL_TARGET_DENSITY_PCT"] = round(density * 100)
    config["MACROS"]["chan_top"]["instances"] = {
        f"gen_chan[{i}].u_chan_top": {"location": [x, y], "orientation": "N"}
        for i, (x, y) in enumerate(candidate["coords"])
    }
    config["MACRO_AREA_CANDIDATE"] = {"batch": batch_id, "id": candidate["id"], "model_status": "legal", "physical_status": "pending"}
    path = DESIGN_DIR / f"macro_area_candidate_{batch_id}_{index}.json"
    path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def _run(config: Path, tag: str, mode: str, log: Path) -> tuple[int, str]:
    command = ["wsl.exe", "-d", "Ubuntu", "--", "bash", f"/mnt/d/MyWork/Veriolg_MA/tools/wsl/{RUNNER.name}",
               f"/mnt/d/MyWork/Veriolg_MA/samples/sample_test_4/asic/daq_subsystem/{config.name}", tag,
               f"/mnt/d/MyWork/Veriolg_MA/physical_design/macro_area_verification/{log.parent.name}", mode]
    try:
        result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, errors="replace", timeout=14400,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        output = (result.stdout or "") + "\n" + (result.stderr or "")
        log.write_text(output, encoding="utf-8")
        return result.returncode, output[-2000:]
    except (OSError, subprocess.TimeoutExpired) as error:
        log.write_text(str(error), encoding="utf-8")
        return 1, str(error)


def _checks(run_dir: Path) -> dict[str, str]:
    names = [p.name.lower() for p in run_dir.iterdir() if p.is_dir()] if run_dir.is_dir() else []
    return {key: "pass" if any(marker in name for name in names) else "not-run"
            for key, marker in {"tritonroute_drc": "checker-trdrc", "magic_drc": "checker-magicdrc",
                                "klayout_drc": "checker-klayoutdrc", "lvs": "checker-lvs",
                                "setup": "checker-setupviolations", "hold": "checker-holdviolations"}.items()}


def _work(batch_id: str, candidates: list[dict], density: float) -> None:
    screened = []
    results = []
    for index, candidate in enumerate(candidates):
        _update(batch_id, status="running", phase="screening", current=index, stage=f"{index + 1}/{len(candidates)} global route·STA")
        config = _config_for(batch_id, index, candidate, density)
        tag = f"macro_area_{batch_id}_{index}"
        run_dir = DESIGN_DIR / "runs" / tag
        log = JOBS_ROOT / batch_id / f"screen_{index}.log"
        code, error = _run(config, tag, "screen", log)
        metrics = _screen_metrics(run_dir) if code == 0 else None
        record = {"id": candidate["id"], "status": "screened" if metrics else "screen-failed",
                  "screening": metrics, "error": None if metrics else error, "config": str(config), "run_dir": str(run_dir), "log": str(log)}
        results.append(record)
        if metrics:
            screened.append(record)
        _update(batch_id, current=index + 1, results=results)
    shortlist = sorted(screened, key=lambda item: item["screening"]["ranking_score"])[:3]
    shortlisted_ids = {item["id"] for item in shortlist}
    for record in screened:
        if record["id"] not in shortlisted_ids:
            record["status"] = "screened-out"
    _update(batch_id, phase="signoff", current=0, shortlisted=len(shortlist), stage=f"Top {len(shortlist)} 상세 배선·DRC/LVS")
    for index, record in enumerate(shortlist):
        code, error = _run(Path(record["config"]), Path(record["run_dir"]).name, "signoff",
                           JOBS_ROOT / batch_id / f"signoff_{index}.log")
        checks = _checks(Path(record["run_dir"]))
        record["checks"] = checks
        record["status"] = "passed" if code == 0 and all(value == "pass" for value in checks.values()) else "failed"
        record["error"] = None if record["status"] == "passed" else error
        _update(batch_id, current=index + 1, results=results)
    _update(batch_id, status="complete", phase="complete", stage="검증 완료", current=len(shortlist), results=results,
            passed=sum(item["status"] == "passed" for item in results),
            failed=sum(item["status"] in {"failed", "screen-failed"} for item in results))


def _worker(batch_id: str, candidates: list[dict], density: float) -> None:
    try:
        _work(batch_id, candidates, density)
    except Exception as error:
        _update(batch_id, status="failed", stage="검증 작업 오류", error=str(error))


def start_batch(body: dict) -> dict:
    if body.get("shape", "800x800") != "800x800":
        raise ValueError("재성형 chan_top의 독립 물리 view가 이 검증 경로에 연결되지 않았습니다. 현재 800×800만 실행할 수 있습니다.")
    if not SOURCE_CONFIG.is_file() or not RUNNER.is_file():
        raise ValueError("Hierarchical OpenLane source config or runner is missing.")
    macro = json.loads(SOURCE_CONFIG.read_text(encoding="utf-8"))["MACROS"]["chan_top"]
    for kind in ("gds", "lef"):
        for value in macro[kind]:
            path = (SOURCE_CONFIG.parent / value.removeprefix("dir::")).resolve()
            if not path.is_file():
                raise ValueError(f"Missing chan_top {kind} view: {path}")
    density = body.get("density", 0.4)
    if not isinstance(density, (int, float)) or not 0.3 <= density <= 0.8:
        raise ValueError("Density must be between 0.3 and 0.8.")
    raw = body.get("candidates")
    if not isinstance(raw, list) or not 1 <= len(raw) <= 10:
        raise ValueError("Select one to ten candidates.")
    candidates = [_check_candidate(item) for item in raw]
    if len({item["id"] for item in candidates}) != len(candidates):
        raise ValueError("Duplicate candidate IDs.")
    with _lock:
        if any(batch["status"] in {"queued", "running"} for batch in _batches.values()):
            raise ValueError("A Macro Area verification batch is already running.")
        batch_id = uuid.uuid4().hex[:12]
        batch = {"id": batch_id, "status": "queued", "phase": "screening", "stage": "대기", "total": len(candidates),
                 "current": 0, "shortlisted": 0, "passed": 0, "failed": 0, "results": []}
        _batches[batch_id] = batch
        _save(batch)
    threading.Thread(target=_worker, args=(batch_id, candidates, float(density)), daemon=True).start()
    return copy.deepcopy(batch)
