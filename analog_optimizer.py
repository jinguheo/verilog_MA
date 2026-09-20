from __future__ import annotations

import json
import math
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent
ANALOG_ROOT = ROOT / "analog"
CATALOG_PATH = ANALOG_ROOT / "catalog.json"
RUNS_ROOT = ANALOG_ROOT / "runs"

STAGES = [
    ("requirements", "요구사항 정규화", "기능·전압·속도·정확도·면적·전력·PDK를 검증 가능한 목표로 변환"),
    ("candidate_selection", "회로/IP 후보 선정", "기능과 PDK가 맞지 않는 후보를 제거하고 공개 검증 증거로 순위화"),
    ("schematic_characterization", "회로도 특성평가", "CACE/ngspice로 PVT corner, Monte Carlo, 정확도·속도·전력을 측정"),
    ("sizing", "소자 크기 최적화", "트랜지스터 W/L, 바이어스, 수동소자 값을 요구사항에 맞게 탐색"),
    ("placement", "아날로그 Placement", "대칭·common-centroid·interdigitation·dummy·guard-ring 제약을 적용"),
    ("routing", "아날로그 Routing", "차동 대칭, 차폐, 전원 폭, 기생성분과 민감 신호 간격을 탐색"),
    ("physical_verification", "DRC/LVS 하드 게이트", "DRC=0 및 LVS match가 아니면 후보를 PPA 비교에서 제외"),
    ("pex_ppa", "PEX 및 Post-layout PPA", "추출 RC로 성능·전력·면적을 다시 측정하고 Pareto front를 계산"),
    ("macro_export", "Hard Macro 통합", "GDS·LEF·SPICE/CDL·Liberty/behavioral model을 디지털 top에 제공"),
]


def _read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def catalog():
    items = _read_json(CATALOG_PATH, [])
    for item in items:
        repo = ROOT / item["repo"]
        item["installed"] = repo.exists()
        item["path"] = str(repo)
        if repo.exists():
            counts = {suffix: 0 for suffix in (".gds", ".lef", ".mag", ".sch", ".spice", ".lib", ".v", ".sv", ".yaml")}
            for current, directories, filenames in os.walk(repo):
                directories[:] = [name for name in directories if name not in {".git", "node_modules", "__pycache__", ".venv"}]
                for filename in filenames:
                    suffix = Path(filename).suffix.lower()
                    if suffix in counts:
                        counts[suffix] += 1
            item["artifacts"] = {key[1:]: value for key, value in counts.items() if value}
        else:
            item["artifacts"] = {}
    return items


def installation_status():
    recorded = _read_json(ANALOG_ROOT / "install_status.json", {})
    items = catalog()
    return {
        **recorded,
        "catalog_total": len(items),
        "catalog_installed": sum(item["installed"] for item in items),
        "catalog": items,
    }


def _number(value, name, minimum=0.0):
    if value in (None, ""):
        return None
    parsed = float(value)
    if not math.isfinite(parsed) or parsed < minimum:
        raise ValueError(f"{name} must be a finite number >= {minimum}.")
    return parsed


def normalize_requirements(body):
    function = str(body.get("function", "")).strip().lower()
    supported = {"adc", "dac", "comparator", "ldo", "temperature_sensor", "custom_analog", "sram", "memory_controller"}
    if function not in supported:
        raise ValueError("Unsupported analog function.")
    pdk = str(body.get("pdk", "sky130A")).strip()
    weights = {
        "performance": _number(body.get("performance_weight", 1), "performance_weight") or 0,
        "power": _number(body.get("power_weight", 1), "power_weight") or 0,
        "area": _number(body.get("area_weight", 1), "area_weight") or 0,
    }
    total = sum(weights.values())
    if total <= 0:
        raise ValueError("At least one PPA weight must be positive.")
    weights = {key: value / total for key, value in weights.items()}
    return {
        "function": function,
        "pdk": pdk,
        "supply_v": _number(body.get("supply_v"), "supply_v"),
        "resolution_bits": int(_number(body.get("resolution_bits"), "resolution_bits", 1) or 0) or None,
        "sample_rate_hz": _number(body.get("sample_rate_hz"), "sample_rate_hz"),
        "capacity_kb": _number(body.get("capacity_kb"), "capacity_kb"),
        "word_width": int(_number(body.get("word_width"), "word_width", 1) or 0) or None,
        "ports": int(_number(body.get("ports"), "ports", 1) or 0) or None,
        "max_power_mw": _number(body.get("max_power_mw"), "max_power_mw"),
        "max_area_um2": _number(body.get("max_area_um2"), "max_area_um2"),
        "weights": weights,
    }


def rank_candidates(requirements, items=None):
    ranked = []
    functions = {requirements["function"]}
    if requirements["function"] == "sram":
        functions.add("memory_controller")
    for item in items or catalog():
        reasons = []
        blockers = []
        score = 0
        if item["function"] in functions:
            score += 45
            reasons.append("기능 일치")
        else:
            blockers.append("기능 불일치")
        if requirements["pdk"] in item.get("pdk", []) or "portable" in item.get("pdk", []):
            score += 30
            reasons.append("PDK 호환")
        else:
            blockers.append("PDK 불일치")
        if item.get("installed"):
            score += 10
            reasons.append("로컬 설치")
        evidence = item.get("evidence", [])
        score += min(10, len(evidence))
        if "measured_silicon" in evidence:
            score += 8
            reasons.append("실리콘 측정 이력")
        elif "tapeout" in evidence:
            score += 4
            reasons.append("테이프아웃 이력")
        if requirements.get("resolution_bits") and item.get("resolution_bits"):
            delta = abs(requirements["resolution_bits"] - item["resolution_bits"])
            score += max(0, 5 - delta)
            reasons.append(f"해상도 {item['resolution_bits']}bit")
        if requirements.get("supply_v") and item.get("supply_v"):
            if abs(requirements["supply_v"] - item["supply_v"]) <= 0.2:
                score += 5
                reasons.append("전압 근접")
            else:
                reasons.append("전압 재검증 필요")
        if requirements.get("capacity_kb") and item.get("capacity_kb"):
            if requirements["capacity_kb"] in item["capacity_kb"]:
                score += 5
                reasons.append("요청 용량 제공")
        ranked.append({
            "id": item["id"], "name": item["name"], "score": score,
            "eligible": not blockers, "blockers": blockers, "reasons": reasons,
            "kind": item["kind"], "maturity": item["maturity"],
            "installed": item["installed"], "path": item["path"],
            "evidence": evidence, "ppa": {"status": "not_measured"},
        })
    return sorted(ranked, key=lambda item: (item["eligible"], item["score"]), reverse=True)


def create_study(body):
    requirements = normalize_requirements(body)
    ranked = rank_candidates(requirements)
    eligible = [item for item in ranked if item["eligible"]]
    run_id = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    stages = []
    for stage_id, label, description in STAGES:
        status = "complete" if stage_id in {"requirements", "candidate_selection"} else "not_run"
        stages.append({"id": stage_id, "label": label, "description": description, "status": status})
    result = {
        "id": run_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "requirements": requirements,
        "selection": {
            "status": "selected" if eligible else "no_compatible_candidate",
            "recommended": eligible[0]["id"] if eligible else None,
            "candidates": ranked,
        },
        "optimization_policy": {
            "hard_gates": ["DRC violations == 0", "LVS == match"],
            "objective": "weighted Pareto optimization after post-layout extraction",
            "weights": requirements["weights"],
            "unmeasured_policy": "Never invent PPA values; keep candidate as not_measured.",
        },
        "stages": stages,
    }
    run_dir = RUNS_ROOT / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    (run_dir / "study.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def studies(limit=20):
    if not RUNS_ROOT.exists():
        return []
    results = []
    for path in sorted(RUNS_ROOT.glob("*/study.json"), reverse=True)[:limit]:
        data = _read_json(path, None)
        if data:
            results.append(data)
    return results
