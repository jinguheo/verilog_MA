"""Actual-layout candidate preparation and OpenLane signoff job runner."""
from __future__ import annotations

import json
import math
import random
import re
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DESIGN_DIR = ROOT / "samples" / "sample_test_4" / "asic" / "ppa3_adc_capture"
SOURCE_CONFIG = DESIGN_DIR / "config.json"
BASELINE_IMAGES = DESIGN_DIR / "layout_images"
JOBS_ROOT = ROOT / "physical_design" / "layout_candidates" / "jobs"
OPTIMIZATION_HISTORY = JOBS_ROOT.parent / "optimization_history.json"
WSL_RUNNER = ROOT / "tools" / "wsl" / "104_run_layout_candidate.sh"
_threads: dict[str, threading.Thread] = {}
_verification_batches: dict[str, dict] = {}
_optimization_tasks: dict[str, dict] = {}
_lock = threading.Lock()

SCREEN_STEP = "OpenROAD.STAMidPNR-3"
SIGNOFF_FROM_STEP = "OpenROAD.DetailedRouting"
SIGNOFF_SHORTLIST = 3

def _now():
    return datetime.now(timezone.utc).isoformat()

def _optimization_update(task_id, **values):
    if not task_id:
        return
    with _lock:
        task = _optimization_tasks.setdefault(task_id, {
            "id": task_id, "status": "running", "stage": "준비", "progress": 0,
            "current": 0, "total": 1, "seed": 0, "iteration": 0,
            "created_at": _now(), "cancel_requested": False,
            "_started_at_epoch": time.time(),
        })
        task.update(values)
        now_epoch = time.time()
        elapsed = max(0.0, now_epoch - task["_started_at_epoch"])
        task["elapsed_seconds"] = round(elapsed, 1)
        progress = max(0.0, min(100.0, float(task.get("progress", 0))))
        completed_iterations = int(task.get("completed_iterations", 0) or 0)
        total_iterations = int(task.get("total_iterations", 0) or 0)
        if total_iterations and "_sa_started_at_epoch" not in task and task.get("stage") == "SA 기반 후보 생성":
            task["_sa_started_at_epoch"] = now_epoch
        if completed_iterations > 0 and total_iterations >= completed_iterations:
            sa_elapsed = max(0.0, now_epoch - task.get("_sa_started_at_epoch", now_epoch))
            remaining = sa_elapsed / completed_iterations * (total_iterations - completed_iterations)
            task["estimated_remaining_seconds"] = round(remaining, 1)
            task["estimated_total_seconds"] = round(elapsed + remaining, 1)
        elif progress > 1 and task.get("status") in {"queued", "running"}:
            estimated_total = elapsed / (progress / 100.0)
            task["estimated_total_seconds"] = round(estimated_total, 1)
            task["estimated_remaining_seconds"] = round(max(0.0, estimated_total - elapsed), 1)
        if task.get("status") == "complete":
            task["estimated_total_seconds"] = round(elapsed, 1)
            task["estimated_remaining_seconds"] = 0.0
        task["updated_at"] = _now()

def optimization_status(task_id):
    with _lock:
        task = _optimization_tasks.get(str(task_id))
        return {key: value for key, value in task.items() if not key.startswith("_")} if task else None

def cancel_optimization(task_id):
    task_id = str(task_id)
    with _lock:
        task = _optimization_tasks.get(task_id)
        if not task:
            return None
        task["cancel_requested"] = True
        task["stage"] = "중지 요청 처리 중"
        task["updated_at"] = _now()
        return dict(task)

def _optimization_checkpoint(task_id):
    if not task_id:
        return
    with _lock:
        cancelled = bool(_optimization_tasks.get(task_id, {}).get("cancel_requested"))
    if cancelled:
        _optimization_update(task_id, status="cancelled", stage="사용자가 중지함")
        raise ValueError("SA candidate generation cancelled.")

def _read(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default

def _write(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)

def _job_path(candidate_id):
    return JOBS_ROOT / candidate_id / "job.json"

def _valid_id(value):
    return bool(re.fullmatch(r"[0-9]{8}-[0-9]{6}-[0-9a-f]{6}", str(value)))

def _resolve(config_path: Path, value):
    text = str(value)
    if text.startswith("dir::"):
        text = text[5:]
    path = Path(text)
    return path if path.is_absolute() else (config_path.parent / path).resolve()

def _lef_size(path: Path):
    match = re.search(r"\bSIZE\s+([0-9.]+)\s+BY\s+([0-9.]+)\s*;", path.read_text(encoding="utf-8", errors="replace"), re.I)
    if not match:
        raise ValueError(f"LEF SIZE not found: {path}")
    return float(match.group(1)), float(match.group(2))

def _baseline():
    config = _read(SOURCE_CONFIG)
    if not config:
        raise ValueError(f"Missing or invalid config: {SOURCE_CONFIG}")
    macros = []
    for module, definition in config.get("MACROS", {}).items():
        lef_values = definition.get("lef", [])
        if not lef_values:
            continue
        lef = _resolve(SOURCE_CONFIG, lef_values[0])
        width, height = _lef_size(lef)
        for instance, placement in definition.get("instances", {}).items():
            macros.append({
                "module": module, "instance": instance,
                "x": float(placement["location"][0]), "y": float(placement["location"][1]),
                "width": width, "height": height,
                "orientation": placement.get("orientation", "N"),
                "lef": str(lef), "gds": str(_resolve(SOURCE_CONFIG, definition["gds"][0])),
                "kind": "analog" if "adc" in module.lower() else "memory" if "sram" in module.lower() else "digital",
            })
    image_paths = sorted(
        BASELINE_IMAGES.glob("*.png"),
        key=lambda item: (0 if "placement" in item.stem.lower() else 1 if "routing" in item.stem.lower() else 2, item.name),
    )
    images = []
    for item in image_paths:
        kind = "detailed routing" if "routing" in item.stem.lower() else "placement" if "placement" in item.stem.lower() else item.stem
        images.append({
            "name": item.name,
            "label": f"PPA3 {kind}",
            "url": f"/api/layout-candidates/baseline-assets/{item.name}",
        })
    return {
        "design": config["DESIGN_NAME"], "source": str(SOURCE_CONFIG),
        "die": {"x0": config["DIE_AREA"][0], "y0": config["DIE_AREA"][1], "width": config["DIE_AREA"][2] - config["DIE_AREA"][0], "height": config["DIE_AREA"][3] - config["DIE_AREA"][1]},
        "core": {"x0": config["CORE_AREA"][0], "y0": config["CORE_AREA"][1], "x1": config["CORE_AREA"][2], "y1": config["CORE_AREA"][3]},
        "macros": macros, "images": images,
        "flow": ["OpenLane/OpenROAD PnR", "TritonRoute DRC", "Magic DRC", "KLayout DRC/XOR", "Netgen LVS", "STA/IR drop", "GDS render"],
    }

def _validate(placements, baseline):
    expected = {item["instance"]: item for item in baseline["macros"]}
    if {str(item.get("instance")) for item in placements} != set(expected) or len(placements) != len(expected):
        raise ValueError("Candidate must contain each baseline macro instance exactly once.")
    normalized = []
    for value in placements:
        source = expected[str(value["instance"])]
        item = {**source, "x": float(value["x"]), "y": float(value["y"]), "orientation": str(value.get("orientation", "N")).upper()}
        if item["orientation"] not in {"N", "S", "FN", "FS"}:
            raise ValueError(f"Unsupported orientation for {item['instance']}.")
        if item["x"] < 0 or item["y"] < 0 or item["x"] + item["width"] > baseline["die"]["width"] or item["y"] + item["height"] > baseline["die"]["height"]:
            raise ValueError(f"{item['instance']} exceeds DIE_AREA.")
        normalized.append(item)
    for index, first in enumerate(normalized):
        for second in normalized[index + 1:]:
            overlap = not (first["x"] + first["width"] <= second["x"] or second["x"] + second["width"] <= first["x"] or first["y"] + first["height"] <= second["y"] or second["y"] + second["height"] <= first["y"])
            if overlap:
                raise ValueError(f"{first['instance']} overlaps {second['instance']}.")
    return normalized

def _comparison_metrics(placements, baseline):
    core = baseline["core"]
    core_area = (core["x1"] - core["x0"]) * (core["y1"] - core["y0"])
    macro_area = sum(item["width"] * item["height"] for item in placements)
    adc = next((item for item in placements if item["kind"] == "analog"), None)
    sram = next((item for item in placements if item["kind"] == "memory"), None)
    routing_length = None
    if adc and sram:
        adc_center = (adc["x"] + adc["width"] / 2, adc["y"] + adc["height"] / 2)
        sram_center = (sram["x"] + sram["width"] / 2, sram["y"] + sram["height"] / 2)
        routing_length = abs(adc_center[0] - sram_center[0]) + abs(adc_center[1] - sram_center[1])
    return {
        "hard_macro_utilization_pct": round(macro_area / core_area * 100, 3),
        "estimated_routing_length_um": round(routing_length, 3) if routing_length is not None else None,
    }

def optimization_history(limit=100):
    values = _read(OPTIMIZATION_HISTORY, [])
    return values[-limit:][::-1] if isinstance(values, list) else []

def _placement_signature(placements):
    return "|".join(f'{item["instance"]}:{item["x"]:.3f}:{item["y"]:.3f}:{item["orientation"]}' for item in sorted(placements, key=lambda value: value["instance"]))

def verified_candidates(limit=100):
    return [item for item in optimization_history(limit) if item.get("verification", {}).get("status") == "passed"]

def _shared_synthesis_state():
    """Newest reusable netlist state before candidate-specific floorplanning."""
    states = list((DESIGN_DIR / "runs").glob("RUN_*/10-openroad-checksdcfiles/state_out.json"))
    return max(states, key=lambda path: path.stat().st_mtime) if states else None

def _record_optimization_improvement(placements, baseline, search=None):
    baseline_metrics = _comparison_metrics(baseline["macros"], baseline)
    candidate_metrics = _comparison_metrics(placements, baseline)
    baseline_wire = baseline_metrics["estimated_routing_length_um"]
    candidate_wire = candidate_metrics["estimated_routing_length_um"]
    improved = (
        baseline_wire is not None
        and candidate_wire is not None
        and candidate_wire < baseline_wire
        and candidate_metrics["hard_macro_utilization_pct"] <= baseline_metrics["hard_macro_utilization_pct"]
    )
    comparison = {
        "baseline": baseline_metrics,
        "candidate": candidate_metrics,
        "routing_reduction_um": round(baseline_wire - candidate_wire, 3) if baseline_wire is not None and candidate_wire is not None else None,
        "routing_reduction_pct": round((baseline_wire - candidate_wire) / baseline_wire * 100, 3) if baseline_wire and candidate_wire is not None else None,
        "improved": improved,
    }
    if not improved:
        return None, comparison
    signature = _placement_signature(placements)
    with _lock:
        history = _read(OPTIMIZATION_HISTORY, [])
        if not isinstance(history, list):
            history = []
        existing = next((item for item in history if item.get("signature") == signature), None)
        if existing:
            if search and not existing.get("search"):
                existing["search"] = search
                _write(OPTIMIZATION_HISTORY, history)
            return existing, comparison
        entry = {
            "id": _new_id(),
            "created_at": _now(),
            "baseline_label": "PPA3 current routed best (PPA2-derived placement)",
            "design": baseline["design"],
            "signature": signature,
            "metrics": comparison,
            "placements": [{"instance": item["instance"], "x": item["x"], "y": item["y"], "orientation": item["orientation"]} for item in placements],
            "search": search or {"method": "constrained-grid"},
        }
        history.append(entry)
        _write(OPTIMIZATION_HISTORY, history[-100:])
    return entry, comparison

def _new_id():
    return datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]

def prepare_candidate(body):
    baseline = _baseline()
    placements = body.get("placements") or baseline["macros"]
    if not isinstance(placements, list):
        raise ValueError("placements must be a list.")
    placements = _validate(placements, baseline)
    candidate_id = _new_id()
    job_dir = JOBS_ROOT / candidate_id
    job_dir.mkdir(parents=True, exist_ok=True)
    placement_path = DESIGN_DIR / f"candidate_{candidate_id}.cfg"
    config_path = DESIGN_DIR / f"candidate_{candidate_id}.json"
    placement_path.write_text("\n".join(f"{item['instance']} {item['x']:.3f} {item['y']:.3f} {item['orientation']}" for item in placements) + "\n", encoding="utf-8")
    config = _read(SOURCE_CONFIG)
    config["MACRO_PLACEMENT_CFG"] = f"dir::{placement_path.name}"
    by_instance = {item["instance"]: item for item in placements}
    for definition in config["MACROS"].values():
        for instance, value in definition.get("instances", {}).items():
            selected = by_instance[instance]
            value["location"] = [round(selected["x"], 3), round(selected["y"], 3)]
            value["orientation"] = selected["orientation"]
    config["AI_LAYOUT_CANDIDATE"] = {"id": candidate_id, "source": SOURCE_CONFIG.name, "created_at": _now(), "validation": "exact instance set; boundary and overlap checks passed"}
    _write(config_path, config)
    job = {
        "id": candidate_id, "design": baseline["design"], "status": "prepared", "progress": 0,
        "stage": "실제 후보 준비 완료", "created_at": _now(), "updated_at": _now(),
        "placements": placements, "die": baseline["die"],
        "artifacts": {"config": str(config_path), "macro_placement": str(placement_path)},
        "checks": {}, "images": [],
    }
    _write(_job_path(candidate_id), job)
    return job

def optimize_candidate(body):
    """Create a diverse legal macro pool with constrained grid + Re-place + SA."""
    mode = str(body.get("mode", "hybrid")).lower()
    if mode not in {"constrained", "sa", "hybrid"}:
        raise ValueError("mode must be constrained, sa, or hybrid.")
    task_id = str(body.get("_optimization_id", "")).strip()
    _optimization_update(task_id, status="running", mode=mode, stage="입력 및 기준 배치 확인", progress=1, current=0, total=32, seed=0, iteration=0)
    _optimization_checkpoint(task_id)
    baseline = _baseline()
    source = body.get("placements") or baseline["macros"]
    current = _validate(source, baseline)
    adc = next((item for item in current if item["kind"] == "analog"), None)
    sram = next((item for item in current if item["kind"] == "memory"), None)
    if not adc or not sram:
        raise ValueError("Actual optimizer requires one analog ADC and one SRAM macro.")
    core = baseline["core"]
    halo = 40.0
    step = 10
    # Named once so the grid enumeration below and evaluate()'s on-the-fly
    # bounds later (used by SA's sub-grid refinement) can never desync -
    # range().stop is off by up to `step` from the true inclusive bound and
    # is not a safe way to recover it.
    adc_x_min, adc_x_max = int(core["x0"]), min(321, int(core["x1"] - adc["width"]))
    adc_y_min, adc_y_max = int(core["y0"]), int(core["y1"] - adc["height"])
    sram_x_min, sram_x_max = max(350, int(core["x0"])), int(core["x1"] - sram["width"])
    sram_y_min, sram_y_max = int(core["y0"]), int(core["y1"] - sram["height"])
    adc_xs = range(adc_x_min, adc_x_max + 1, step)
    adc_ys = range(adc_y_min, adc_y_max + 1, step)
    sram_xs = range(sram_x_min, sram_x_max + 1, step)
    sram_ys = range(sram_y_min, sram_y_max + 1, step)
    evaluated = 0
    legal = []
    adc_x_values = list(adc_xs)
    for ax_index, ax in enumerate(adc_x_values):
        _optimization_checkpoint(task_id)
        _optimization_update(task_id, stage="Legal 격자 후보 탐색", progress=5 + round((ax_index + 1) / max(1, len(adc_x_values)) * 40), current=ax_index + 1, total=len(adc_x_values), evaluated=evaluated)
        for ay in adc_ys:
            acx, acy = ax + adc["width"] / 2, ay + adc["height"] / 2
            for sx in sram_xs:
                if ax + adc["width"] + halo > sx:
                    continue
                for sy in sram_ys:
                    evaluated += 1
                    if evaluated % 2048 == 0:
                        _optimization_checkpoint(task_id)
                    scx, scy = sx + sram["width"] / 2, sy + sram["height"] / 2
                    wire = abs(acx - scx) + abs(acy - scy)
                    vertical_misalignment = abs(acy - scy)
                    # Preserve access channels near the core boundary while
                    # favoring a short, horizontally aligned ADC->SRAM path.
                    edge = max(0, 30 - (ax - core["x0"])) + max(0, 30 - (ay - core["y0"]))
                    cost = wire + vertical_misalignment * 2.5 + edge * 4 + abs(ax - 40) * 0.15 + abs(sx - 430) * 0.1
                    legal.append((cost, ax, ay, sx, sy, wire, vertical_misalignment))
    if not legal:
        raise ValueError("AI found no legal actual-layout placement.")
    legal.sort(key=lambda item: item[0])
    _optimization_update(task_id, stage="Re-place 기준 후보 정리", progress=48, current=0, total=32, evaluated=evaluated)
    _optimization_checkpoint(task_id)

    def evaluate(ax, ay, sx, sy):
        """On-the-fly legality + cost for an arbitrary (ax, ay, sx, sy), not
        just points already enumerated by the grid pass. Unlike a lookup into
        a pre-built legal-position table, this lets SA refine BETWEEN grid
        points (sub-10um) instead of only re-sampling the same 40,500 points
        the grid pass already covers exhaustively - the grid alone can't be
        beaten on its own resolution, so any real gain has to come from here."""
        if ax < adc_x_min or ax > adc_x_max or ay < adc_y_min or ay > adc_y_max:
            return None
        if sx < sram_x_min or sx > sram_x_max or sy < sram_y_min or sy > sram_y_max:
            return None
        if ax + adc["width"] + halo > sx:
            return None
        acx, acy = ax + adc["width"] / 2, ay + adc["height"] / 2
        scx, scy = sx + sram["width"] / 2, sy + sram["height"] / 2
        wire = abs(acx - scx) + abs(acy - scy)
        vertical_misalignment = abs(acy - scy)
        edge = max(0, 30 - (ax - core["x0"])) + max(0, 30 - (ay - core["y0"]))
        cost = wire + vertical_misalignment * 2.5 + edge * 4 + abs(ax - 40) * 0.15 + abs(sx - 430) * 0.1
        return (cost, ax, ay, sx, sy, wire, vertical_misalignment)

    def re_place(state):
        """Coordinate-descent rip-up/re-place of one hard macro at a time."""
        selected = state
        for _ in range(2):
            same_sram = (item for item in legal if item[3] == selected[3] and item[4] == selected[4])
            selected = min(same_sram, key=lambda item: item[0], default=selected)
            same_adc = (item for item in legal if item[1] == selected[1] and item[2] == selected[2])
            selected = min(same_adc, key=lambda item: item[0], default=selected)
        return selected

    def anneal(seed, start, iterations=240, seed_index=0):
        rng = random.Random(seed)
        state = re_place(start)
        best = state
        for iteration in range(iterations):
            if iteration % 12 == 0:
                _optimization_checkpoint(task_id)
                _optimization_update(
                    task_id,
                    stage="SA 기반 후보 생성",
                    progress=50 + round((seed_index + iteration / max(1, iterations)) / 32 * 45),
                    current=seed_index + 1,
                    total=32,
                    seed=seed_index + 1,
                    iteration=iteration,
                    iterations_per_seed=iterations,
                    completed_iterations=seed_index * iterations + iteration,
                    total_iterations=32 * iterations,
                    evaluated=evaluated,
                )
            progress = iteration / max(1, iterations - 1)
            # Coarse-to-fine: start at the grid's own 10um step (matching its
            # original behavior) and shrink to 1um by the end of the run, so
            # late iterations refine BETWEEN grid points instead of only
            # jumping among the same 40,500 already-enumerated positions.
            move_step = max(1, round(step * (1 - progress) + 1 * progress))
            position = [state[1], state[2], state[3], state[4]]
            dimension = rng.randrange(4)
            position[dimension] += move_step if rng.random() < 0.5 else -move_step
            candidate = evaluate(*position)
            if candidate is None:
                continue
            temperature = 70.0 * math.pow(0.5 / 70.0, progress)
            delta = candidate[0] - state[0]
            if delta <= 0 or rng.random() < math.exp(-delta / temperature):
                state = candidate
                if state[0] < best[0]:
                    best = state
        return best, state

    grid_candidates = legal[:10]
    sa_candidates = []
    for seed in range(32):
        _optimization_checkpoint(task_id)
        rng = random.Random(0x5A17 + seed)
        start = legal[rng.randrange(len(legal))]
        best_sa, final_sa = anneal(seed + 1, start, seed_index=seed)
        sa_candidates.extend((best_sa, final_sa))
    reserved_grid = grid_candidates[:5] if mode == "hybrid" else []
    unique_grid = {(item[1], item[2], item[3], item[4]) for item in reserved_grid}
    unique_sa = []
    seen_sa = set()
    for item in sorted(sa_candidates, key=lambda value: value[0]):
        position = (item[1], item[2], item[3], item[4])
        if position in unique_grid or position in seen_sa:
            continue
        seen_sa.add(position)
        unique_sa.append(item)
        if len(unique_sa) == 10:
            break
    if mode == "constrained":
        selected = [(item, "constrained-grid") for item in grid_candidates]
    elif mode == "sa":
        selected = [(item, "macro-replace+sa") for item in unique_sa]
    else:
        selected = [(item, "constrained-grid") for item in grid_candidates[:5]] + [(item, "macro-replace+sa") for item in unique_sa[:5]]
    selected_positions = {(item[1], item[2], item[3], item[4]) for item, _ in selected}
    for item in legal:
        position = (item[1], item[2], item[3], item[4])
        if len(selected) >= 10:
            break
        if position not in selected_positions:
            selected.append((item, "constrained-grid"))
            selected_positions.add(position)
    selected.sort(key=lambda value: value[0][0])

    def placements_for(candidate):
        _, ax, ay, sx, sy, _, _ = candidate
        return [
            {**item, "x": float(ax), "y": float(ay)} if item["instance"] == adc["instance"]
            else {**item, "x": float(sx), "y": float(sy)} if item["instance"] == sram["instance"]
            else item for item in current
        ]

    candidate_pool = []
    for rank, (candidate, method) in enumerate(selected, start=1):
        cost, _, _, _, _, wire, alignment = candidate
        candidate_pool.append({
            "rank": rank,
            "method": method,
            "cost": round(cost, 3),
            "estimated_manhattan_um": round(wire, 3),
            "centerline_misalignment_um": round(alignment, 3),
            "placements": placements_for(candidate),
        })
    winner = candidate_pool[0]
    optimized = winner["placements"]
    result = {
        "status": "optimized",
        "placements": optimized,
        "candidate_pool": candidate_pool,
        "metrics": {
            "candidates_evaluated": evaluated,
            "generation_mode": mode,
            "candidate_pool_size": len(candidate_pool),
            "grid_candidates": sum(item["method"] == "constrained-grid" for item in candidate_pool),
            "replace_sa_candidates": sum(item["method"] == "macro-replace+sa" for item in candidate_pool),
            "sa_seeds": 32,
            "sa_iterations_per_seed": 240,
            "estimated_manhattan_um": winner["estimated_manhattan_um"],
            "centerline_misalignment_um": winner["centerline_misalignment_um"],
            "halo_um": halo,
            "cost": winner["cost"],
            "hard_constraints": ["DIE/CORE boundary", "pairwise overlap", "40um ADC-SRAM keep-out"],
        },
    }
    history_entry = None
    history_entries = []
    comparison = {
        "baseline": _comparison_metrics(baseline["macros"], baseline),
        "candidate": _comparison_metrics(optimized, baseline),
    }
    if body.get("_record_history"):
        for candidate in candidate_pool:
            entry, candidate_comparison = _record_optimization_improvement(candidate["placements"], baseline, {"method": candidate["method"], "rank": candidate["rank"], "cost": candidate["cost"], "sa_seeds": 32, "sa_iterations_per_seed": 240})
            if entry and all(item["id"] != entry["id"] for item in history_entries):
                history_entries.append(entry)
            if candidate["rank"] == 1:
                history_entry, comparison = entry, candidate_comparison
    result["comparison"] = comparison
    result["saved_to_history"] = bool(history_entries)
    result["history_entry"] = history_entry
    result["history_entries"] = history_entries
    # Not marked status="complete" here on purpose: the caller (see
    # _optimize_worker below) attaches `result` in the SAME update that flips
    # status to "complete", so a poller can never observe complete-without-result.
    _optimization_update(task_id, stage="결과 정리 중", progress=99, current=32, total=32, seed=32, iteration=240, iterations_per_seed=240, completed_iterations=32 * 240, total_iterations=32 * 240, evaluated=evaluated)
    return result

def _optimize_worker(task_id, body):
    try:
        result = optimize_candidate({**body, "_optimization_id": task_id})
        # Attach the payload the poller needs to finish the UI flow (placements,
        # candidate pool, metrics, history entries) atomically with the status
        # flip, so a client can never poll "complete" with result still None.
        _optimization_update(task_id, status="complete", stage="SA 후보 생성 완료", progress=100, result=result)
    except ValueError as error:
        with _lock:
            already_cancelled = _optimization_tasks.get(task_id, {}).get("status") == "cancelled"
        # _optimization_checkpoint() already set status="cancelled" before raising
        # on a user-requested stop; only a genuine failure should overwrite that.
        if not already_cancelled:
            _optimization_update(task_id, status="failed", stage="실패", error=str(error))
    except Exception as error:  # pragma: no cover - defensive: never leave a task hanging as "running"
        _optimization_update(task_id, status="failed", stage="실패", error=str(error))

def start_optimization(body):
    """Run optimize_candidate (32 seeds x 240 SA iterations, or the grid-only
    mode) on a background thread instead of the request-handling thread, so a
    client Stop click can actually halt the CPU work via cancel_optimization()
    instead of merely dropping an HTTP connection whose server-side computation
    keeps running to completion regardless."""
    mode = str(body.get("mode", "hybrid")).lower()
    if mode not in {"constrained", "sa", "hybrid"}:
        raise ValueError("mode must be constrained, sa, or hybrid.")
    task_id = _new_id()
    _optimization_update(task_id, status="queued", mode=mode, stage="대기 중", progress=0, current=0, total=32, seed=0, iteration=0, completed_iterations=0, total_iterations=32 * 240)
    thread = threading.Thread(target=_optimize_worker, args=(task_id, body), daemon=True, name=f"layout-optimize-{task_id}")
    with _lock:
        _threads[task_id] = thread
    thread.start()
    return optimization_status(task_id)

def get_job(candidate_id):
    return _read(_job_path(candidate_id)) if _valid_id(candidate_id) else None

def jobs(limit=20):
    if not JOBS_ROOT.exists():
        return []
    return [item for item in (_read(path) for path in sorted(JOBS_ROOT.glob("*/job.json"), reverse=True)[:limit]) if item]

def status():
    batches = sorted(_verification_batches.values(), key=lambda item: item["created_at"], reverse=True)
    return {"baseline": _baseline(), "jobs": jobs(), "optimization_history": optimization_history(), "verified_candidates": verified_candidates(), "verification_batch": batches[0] if batches else None, "runner": str(WSL_RUNNER), "runner_ready": WSL_RUNNER.is_file()}

def _wsl(path: Path):
    drive = path.drive.rstrip(":").lower()
    return f"/mnt/{drive}/" + path.as_posix().split(":/", 1)[-1]

def _update(job, **values):
    job.update(values)
    job["updated_at"] = _now()
    _write(_job_path(job["id"]), job)

def _screen_metrics(run_dir: Path):
    states = sorted(run_dir.glob("*-openroad-stamidpnr-3/state_out.json"))
    state = _read(states[-1], {}) if states else {}
    metrics = state.get("metrics", {}) if isinstance(state, dict) else {}
    wire = metrics.get("route__wirelength__estimated")
    wns = metrics.get("timing__setup__wns")
    tns = metrics.get("timing__setup__tns")
    utilization = metrics.get("design__instance__utilization")
    if wire is None:
        return None
    score = float(wire) + max(0.0, -float(wns or 0)) * 1_000_000 + max(0.0, -float(tns or 0)) * 10_000
    return {
        "estimated_wirelength_um": round(float(wire), 3),
        "setup_wns_ns": round(float(wns or 0), 4),
        "setup_tns_ns": round(float(tns or 0), 4),
        "instance_utilization": round(float(utilization or 0), 4),
        "ranking_score": round(score, 3),
        "checkpoint": SCREEN_STEP,
    }

def _collect(job, run_dir: Path, image_dir: Path):
    stage_names = [item.name for item in run_dir.iterdir() if item.is_dir()] if run_dir.exists() else []
    def seen(*needles):
        return any(any(needle in name.lower() for needle in needles) for name in stage_names)
    job["checks"] = {
        "openroad_pnr": "pass" if seen("detailedrouting") else "not-run",
        "tritonroute_drc": "pass" if seen("checker-trdrc") else "not-run",
        "magic_drc": "pass" if seen("checker-magicdrc") else "executed" if seen("magic-drc") else "not-run",
        "klayout_drc": "pass" if seen("checker-klayoutdrc") else "executed" if seen("klayout-drc") else "not-run",
        "lvs": "pass" if seen("checker-lvs") else "executed" if seen("netgen-lvs") else "not-run",
        "sta": "pass" if seen("checker-setupviolations") and seen("checker-holdviolations") else "executed" if seen("stapostpnr") else "not-run",
    }
    job["artifacts"]["run_dir"] = str(run_dir)
    screen = _screen_metrics(run_dir)
    if screen:
        job["screening"] = screen
    final = run_dir / "final"
    for kind, pattern in (("def", "def/*.def"), ("gds", "gds/*.gds"), ("metrics", "metrics.json")):
        matches = list(final.glob(pattern)) if final.exists() else []
        if matches:
            job["artifacts"][kind] = str(matches[0])
    job["images"] = [{"name": path.name, "url": f"/api/layout-candidates/assets/{job['id']}/{path.name}"} for path in sorted(image_dir.glob("*.png"))]

def _sync_history_verification(job):
    if job.get("status") not in {"complete", "failed"}:
        return
    required = ("tritonroute_drc", "magic_drc", "klayout_drc", "lvs")
    checks = job.get("checks", {})
    passed = all(checks.get(name) == "pass" for name in required)
    signature = _placement_signature(job.get("placements", []))
    with _lock:
        history = _read(OPTIMIZATION_HISTORY, [])
        changed = False
        for item in history if isinstance(history, list) else []:
            if item.get("signature") != signature:
                continue
            item["verification"] = {
                "status": "passed" if passed else "failed",
                "job_id": job["id"],
                "verified_at": _now(),
                "checks": {name: checks.get(name, "not-run") for name in required},
                "error": job.get("error"),
            }
            changed = True
        if changed:
            _write(OPTIMIZATION_HISTORY, history)

def _worker(candidate_id, mode="full"):
    job = get_job(candidate_id)
    if not job:
        return
    job_dir = _job_path(candidate_id).parent
    image_dir = job_dir / "layout"
    log_path = job_dir / "openlane.log"
    run_tag = job.get("run_tag") or f"ai_candidate_{candidate_id}"
    run_dir = DESIGN_DIR / "runs" / run_tag
    try:
        if mode == "screen":
            stage = "공통 합성 재사용 · global routing/STA 빠른 선별"
        elif mode == "signoff":
            stage = "선별 checkpoint 재사용 · detailed routing/DRC/LVS"
        else:
            stage = "OpenLane PnR · DRC · LVS · STA 실행"
        _update(job, status="running", progress=10, stage=stage, run_tag=run_tag, run_mode=mode)
        shared = _shared_synthesis_state() if mode == "screen" else None
        command = ["wsl.exe", "-d", "Ubuntu", "--", "bash", _wsl(WSL_RUNNER), _wsl(Path(job["artifacts"]["config"])), run_tag, _wsl(image_dir), mode]
        if shared:
            command.append(_wsl(shared))
        completed = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, errors="replace", timeout=14400, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        log_path.write_text((completed.stdout or "") + (("\n" + completed.stderr) if completed.stderr else ""), encoding="utf-8")
        job = get_job(candidate_id) or job
        _collect(job, run_dir, image_dir)
        job["artifacts"]["log"] = str(log_path)
        if completed.returncode:
            raise RuntimeError((completed.stderr or completed.stdout or "OpenLane failed")[-4000:])
        job["finished_at"] = _now()
        completed_stage = "빠른 global-route/STA 선별 완료" if mode == "screen" else "Signoff flow 완료"
        _update(job, status="complete", progress=100, stage=completed_stage, synthesis_reused=bool(shared) or mode == "signoff")
    except subprocess.TimeoutExpired as error:
        job = get_job(candidate_id) or job
        _collect(job, run_dir, image_dir)
        job["error"] = f"OpenLane timed out after {error.timeout} seconds."
        job["finished_at"] = _now()
        _update(job, status="failed", progress=job.get("progress", 10), stage="시간 초과")
    except Exception as error:
        job = get_job(candidate_id) or job
        _collect(job, run_dir, image_dir)
        job["error"] = str(error)
        job["finished_at"] = _now()
        _update(job, status="failed", progress=job.get("progress", 10), stage="실행 실패")
    finally:
        final_job = get_job(candidate_id)
        if final_job and mode != "screen":
            _sync_history_verification(final_job)
        with _lock:
            _threads.pop(candidate_id, None)

def get_verification_batch(batch_id):
    with _lock:
        batch = _verification_batches.get(str(batch_id))
        return json.loads(json.dumps(batch)) if batch else None

def _sync_history_screening(entry, job, status, rank=None):
    with _lock:
        history = _read(OPTIMIZATION_HISTORY, [])
        for item in history if isinstance(history, list) else []:
            if item.get("id") == entry.get("id"):
                item["screening"] = {
                    "status": status,
                    "job_id": job.get("id"),
                    "screened_at": _now(),
                    "rank": rank,
                    "metrics": job.get("screening", {}),
                    "synthesis_reused": bool(job.get("synthesis_reused")),
                }
        _write(OPTIMIZATION_HISTORY, history)

def _verification_batch_worker(batch_id, entries, completed_count=0):
    total = get_verification_batch(batch_id)["total"]
    screened = []
    for index, entry in enumerate(entries, start=completed_count + 1):
        with _lock:
            _verification_batches[batch_id].update(
                status="running", phase="screening", current=index - 1,
                stage=f"후보 {index}/{total} global-route/STA 선별",
            )
        try:
            reuse_job_id = entry.get("_screen_job_id")
            if reuse_job_id:
                finished = get_job(reuse_job_id)
                if not finished or not finished.get("screening"):
                    raise RuntimeError("Cached screening checkpoint is unavailable.")
                job = finished
            else:
                job = prepare_candidate({"placements": entry["placements"]})
                _update(job, status="queued", progress=2, stage="빠른 선별 대기")
                _worker(job["id"], "screen")
                finished = get_job(job["id"]) or job
            if finished.get("status") != "complete" or not finished.get("screening"):
                raise RuntimeError(finished.get("error") or "Fast screening metrics were not produced.")
            screened.append((entry, finished))
            result = {
                "history_id": entry["id"], "job_id": job["id"], "status": "screened",
                "screening": finished["screening"],
                "synthesis_reused": finished.get("synthesis_reused", False), "cached_screen": bool(reuse_job_id),
            }
            _sync_history_screening(entry, finished, "screened")
        except Exception as error:
            result = {"history_id": entry["id"], "status": "screen-failed", "checks": {}, "error": str(error)}
        with _lock:
            _verification_batches[batch_id]["results"].append(result)
            _verification_batches[batch_id]["current"] = index

    ranked = sorted(screened, key=lambda pair: pair[1]["screening"]["ranking_score"])
    shortlist = ranked[:SIGNOFF_SHORTLIST]
    shortlist_ids = {entry["id"] for entry, _ in shortlist}
    for rank, (entry, screened_job) in enumerate(ranked, start=1):
        status = "shortlisted" if entry["id"] in shortlist_ids else "screened-out"
        _sync_history_screening(entry, screened_job, status, rank)
    with _lock:
        _verification_batches[batch_id].update(
            phase="signoff", shortlisted=len(shortlist), signoff_total=len(shortlist), current=0,
            stage=f"Top {len(shortlist)} detailed routing · DRC/LVS",
        )

    for index, (entry, screened_job) in enumerate(shortlist, start=1):
        try:
            _update(screened_job, status="queued", progress=55, stage="Top 후보 signoff 대기")
            _worker(screened_job["id"], "signoff")
            finished = get_job(screened_job["id"]) or screened_job
            passed = all(finished.get("checks", {}).get(name) == "pass" for name in ("tritonroute_drc", "magic_drc", "klayout_drc", "lvs"))
            result = {
                "history_id": entry["id"], "job_id": screened_job["id"],
                "status": "passed" if passed else "failed", "checks": finished.get("checks", {}),
                "error": finished.get("error"), "continued_from_screen": True,
            }
        except Exception as error:
            result = {"history_id": entry["id"], "job_id": screened_job.get("id"), "status": "failed", "checks": {}, "error": str(error), "continued_from_screen": True}
        with _lock:
            results = _verification_batches[batch_id]["results"]
            results[:] = [item for item in results if item.get("history_id") != entry["id"]]
            results.append(result)
            _verification_batches[batch_id]["current"] = index
    with _lock:
        batch = _verification_batches[batch_id]
        batch.update(status="complete", phase="complete", stage="빠른 선별 + Top 후보 signoff 완료", finished_at=_now())
        batch["passed"] = sum(item["status"] == "passed" for item in batch["results"])
        batch["failed"] = sum(item["status"] in {"failed", "screen-failed"} for item in batch["results"])
        batch["screened_out"] = sum(item["status"] == "screened" for item in batch["results"])

def start_verification_batch(body):
    limit = max(1, min(10, int(body.get("limit", 10))))
    entries = [item for item in reversed(optimization_history(100)) if item.get("placements")][:limit]
    if not entries:
        raise ValueError("No improvement candidates are available for verification.")
    if not WSL_RUNNER.is_file():
        raise ValueError(f"Missing WSL runner: {WSL_RUNNER}")
    force = bool(body.get("force", False))
    cached = []
    pending = []
    for entry in entries:
        verification = entry.get("verification", {})
        if not force and verification.get("status") in {"passed", "failed"}:
            cached.append({"history_id": entry["id"], "job_id": verification.get("job_id"), "status": verification["status"], "checks": verification.get("checks", {}), "error": verification.get("error"), "cached": True})
        else:
            screening = entry.get("screening", {})
            screen_job = get_job(screening.get("job_id", "")) if not force else None
            if screen_job and screen_job.get("screening"):
                pending.append({**entry, "_screen_job_id": screen_job["id"]})
            else:
                pending.append(entry)
    with _lock:
        active = next((item for item in _verification_batches.values() if item["status"] in {"queued", "running"}), None)
        if active:
            return active
        batch_id = _new_id()
        batch = {
            "id": batch_id, "status": "queued" if pending else "complete",
            "phase": "screening" if pending else "complete",
            "stage": "10개 빠른 선별 대기" if pending else "캐시 결과 재사용 완료",
            "created_at": _now(), "total": len(entries), "current": len(cached),
            "passed": sum(item["status"] == "passed" for item in cached),
            "failed": sum(item["status"] == "failed" for item in cached),
            "cached": len(cached), "shortlisted": 0, "signoff_total": 0, "screened_out": 0,
            "results": cached,
            "policy": {"screen_limit": 10, "signoff_limit": SIGNOFF_SHORTLIST, "screen_stop": SCREEN_STEP, "signoff_resume": SIGNOFF_FROM_STEP, "reuse": "shared synthesis + per-candidate global-route checkpoint"},
        }
        if not pending:
            batch["finished_at"] = _now()
        _verification_batches[batch_id] = batch
    if pending:
        threading.Thread(target=_verification_batch_worker, args=(batch_id, pending, len(cached)), daemon=True, name=f"layout-verification-{batch_id}").start()
    return get_verification_batch(batch_id)

def start_job(body):
    candidate_id = str(body.get("candidate_id", ""))
    job = get_job(candidate_id) if candidate_id else None
    if not job:
        job = prepare_candidate(body)
        candidate_id = job["id"]
    if job["status"] in {"queued", "running"}:
        return job
    if job["status"] == "complete":
        raise ValueError("Candidate has already completed.")
    if not WSL_RUNNER.is_file():
        raise ValueError(f"Missing WSL runner: {WSL_RUNNER}")
    _update(job, status="queued", progress=2, stage="실행 대기")
    thread = threading.Thread(target=_worker, args=(candidate_id,), daemon=True, name=f"layout-candidate-{candidate_id}")
    with _lock:
        _threads[candidate_id] = thread
    thread.start()
    return get_job(candidate_id)

def asset_path(candidate_id, name):
    if not _valid_id(candidate_id) or not re.fullmatch(r"[A-Za-z0-9_.-]+\.png", name):
        return None
    path = JOBS_ROOT / candidate_id / "layout" / name
    return path if path.is_file() else None

def baseline_asset(name):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+\.png", name):
        return None
    path = BASELINE_IMAGES / name
    return path if path.is_file() else None
