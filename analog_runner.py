from __future__ import annotations

import gzip
import json
import re
import shutil
import subprocess
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from analog_optimizer import ROOT, RUNS_ROOT, catalog


JOBS_ROOT = ROOT / "analog" / "jobs"
CACE_PYTHON = "/mnt/d/MyWork/Veriolg_MA/analog/.venv-cace/bin/python"
PDK_ROOT = "/home/oem/eda/pdk"
MAGIC_BIN = "/nix/store/kh8imbr9x09a76n3bww3s674l5jxvvxp-magic-vlsi/bin"
NETGEN_BIN = "/nix/store/d55q9bly3qrnbkif0sc6nmmvba3law57-netgen/bin"
KLAYOUT_BIN = "/nix/store/kd8jmsgmli7f4wx53gvsmjwpb42igdqc-klayout/bin"
CACE_TOOL_PATH = ":".join([MAGIC_BIN, NETGEN_BIN, KLAYOUT_BIN])
OPENFASOC_PYTHON = "/mnt/d/MyWork/Veriolg_MA/analog/.venv-openfasoc/bin/python"
OPENFASOC_GENERATORS = "/mnt/d/MyWork/Veriolg_MA/analog/third_party/OpenFASOC/openfasoc/generators"
OPENFASOC_TOOL_PATH = ":".join([
    "/nix/store/zzypcxbrgw1qink1l7fwgwpbk7fvdwpg-openroad/bin",
    "/nix/store/y4lsl792fjahppq4xk68s5ckh7mwks70-yosys-with-plugins/bin",
    MAGIC_BIN,
    "/nix/store/d55q9bly3qrnbkif0sc6nmmvba3law57-netgen/bin",
    "/nix/store/kd8jmsgmli7f4wx53gvsmjwpb42igdqc-klayout/bin",
])

CACE_PROJECTS = {
    "sky130_ef_adc3v_12bit": (
        "analog/third_party/sky130_ef_ip__adc3v_12bit",
        "cace/sky130_ef_ip__adc3v_12bit.yaml",
    ),
    "sky130_ef_cdac3v_12bit": (
        "analog/third_party/sky130_ef_ip__adc3v_12bit/ip/sky130_ef_ip__cdac3v_12bit",
        "cace/sky130_ef_ip__cdac3v_12bit.yaml",
    ),
    "sky130_ef_ccomp3v": (
        "analog/third_party/sky130_ef_ip__adc3v_12bit/ip/sky130_ef_ip__ccomp3v",
        "cace/sky130_ef_ip__ccomp3v.yaml",
    ),
}

CACE_PARAMETERS = {
    "area": ["magic_area"],
    "drc": ["magic_drc"],
    "lvs": ["netgen_lvs"],
    "klayout_drc": ["klayout_drc_full"],
    "physical_signoff": ["magic_area", "magic_drc", "netgen_lvs", "klayout_drc_full"],
}

OPENFASOC_PROJECTS = {
    "openfasoc_temp": {
        "project": "temp-sense-gen",
        "script": "tools/temp-sense-gen.py",
        "spec": "test.json",
        "platform": "sky130hd",
        "rtl_dir": "flow/design/src/tempsense",
    },
    "openfasoc_ldo": {
        "project": "ldo-gen",
        "script": "tools/ldo-gen.py",
        "spec": "spec.json",
        "platform": "sky130hvl",
        "rtl_dir": "flow/design/src/ldo",
    },
}

GENERATOR_ACTIONS = {"generate_verilog", "generate_macro"}
MEMORY_ACTIONS = {"select_memory_macro"}
ALLOWED_ACTIONS = {"artifact_audit", *CACE_PARAMETERS, *GENERATOR_ACTIONS, *MEMORY_ACTIONS}
_threads: dict[str, threading.Thread] = {}
_lock = threading.Lock()
_generator_lock = threading.Lock()


def _now():
    return datetime.now(timezone.utc).isoformat()


def _read(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def _write(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _job_path(job_id):
    return JOBS_ROOT / job_id / "job.json"


def jobs(limit=30):
    if not JOBS_ROOT.exists():
        return []
    output = []
    for path in sorted(JOBS_ROOT.glob("*/job.json"), reverse=True)[:limit]:
        item = _read(path)
        if item:
            output.append(item)
    return output


def get_job(job_id):
    if not re.fullmatch(r"[0-9]{8}-[0-9]{6}-[0-9a-f]{6}", str(job_id)):
        return None
    return _read(_job_path(job_id))


def _candidate(candidate_id):
    return next((item for item in catalog() if item["id"] == candidate_id), None)


def _study(study_id):
    if not re.fullmatch(r"[0-9]{8}-[0-9]{6}-[0-9a-f]{6}", str(study_id)):
        return None
    return _read(RUNS_ROOT / study_id / "study.json")


def _lef_dimensions(candidate):
    root = Path(candidate["path"])
    dimensions = []
    pattern = re.compile(r"\bSIZE\s+([0-9.]+)\s+BY\s+([0-9.]+)\s*;", re.I)
    for path in root.rglob("*.lef"):
        try:
            match = pattern.search(path.read_text(encoding="utf-8", errors="ignore"))
        except OSError:
            continue
        if match:
            width, height = map(float, match.groups())
            dimensions.append({
                "macro": path.stem, "width_um": width, "height_um": height,
                "area_um2": round(width * height, 3), "lef": str(path),
            })
    return dimensions


def _artifact_audit(candidate):
    root = Path(candidate["path"])
    suffixes = {".gds": 0, ".lef": 0, ".lib": 0, ".spice": 0, ".sp": 0, ".v": 0}
    compressed_gds = 0
    for path in root.rglob("*"):
        if not path.is_file() or ".git" in path.parts:
            continue
        if path.name.lower().endswith(".gds.gz"):
            compressed_gds += 1
        elif path.suffix.lower() in suffixes:
            suffixes[path.suffix.lower()] += 1
    views = {key[1:]: value for key, value in suffixes.items() if value}
    if compressed_gds:
        views["gds.gz"] = compressed_gds
    dimensions = _lef_dimensions(candidate)
    required = {
        "layout": bool(views.get("gds") or views.get("gds.gz")),
        "abstract": bool(views.get("lef")),
        "timing": bool(views.get("lib")),
        "circuit": bool(views.get("spice") or views.get("sp")),
        "behavioral": bool(views.get("v")),
    }
    return {
        "views": views,
        "required_views": required,
        "complete": all(required.values()),
        "dimensions": dimensions[:100],
        "area_um2": min((item["area_um2"] for item in dimensions), default=None),
        "area_source": "LEF SIZE statement" if dimensions else None,
    }


def _memory_macro_shape(name):
    patterns = (
        re.compile(r"sram22_(?P<depth>\d+)x(?P<width>\d+)m\d+w\d+$", re.I),
        re.compile(r"sky130_sram_[^_]+_[^_]+_(?P<width>\d+)x(?P<depth>\d+)_\d+$", re.I),
        re.compile(r"sram_[^_]+_(?P<width>\d+)_(?P<depth>\d+)_\d+_sky130$", re.I),
    )
    for pattern in patterns:
        match = pattern.fullmatch(name)
        if match:
            width = int(match.group("width"))
            depth = int(match.group("depth"))
            return width, depth
    return None


def _memory_ports(name):
    lowered = name.lower()
    if "1rw1r" in lowered or "1r1w" in lowered:
        return 2
    return 1


def _memory_views(directory):
    extensions = {
        "lef": (".lef",), "gds": (".gds", ".gds.gz"),
        "liberty": (".lib",), "spice": (".spice", ".sp"),
        "verilog": (".v",),
    }
    views = {}
    for kind, suffixes in extensions.items():
        matches = sorted(
            path for path in directory.iterdir()
            if path.is_file() and any(path.name.lower().endswith(suffix) for suffix in suffixes)
        )
        if matches:
            views[kind] = [str(path) for path in matches]
    return views


def _select_memory_macro(job, candidate, study):
    requirements = study["requirements"]
    requested_capacity = requirements.get("capacity_kb")
    requested_width = requirements.get("word_width")
    requested_ports = requirements.get("ports")
    choices = []
    root = Path(candidate["path"])
    for directory in root.iterdir():
        if not directory.is_dir():
            continue
        shape = _memory_macro_shape(directory.name)
        if not shape:
            continue
        width, depth = shape
        capacity_kb = width * depth / 8192
        ports = _memory_ports(directory.name)
        views = _memory_views(directory)
        dimensions = _lef_dimensions({"path": str(directory)}) if views.get("lef") else []
        area_um2 = min((item["area_um2"] for item in dimensions), default=None)
        complete = all(views.get(kind) for kind in ("lef", "gds", "liberty", "spice", "verilog"))
        capacity_error = abs(capacity_kb - requested_capacity) / requested_capacity if requested_capacity else 0
        width_error = abs(width - requested_width) / requested_width if requested_width else 0
        port_error = abs(ports - requested_ports) if requested_ports else 0
        score = capacity_error * 60 + width_error * 30 + port_error * 20 + (0 if complete else 1000)
        choices.append({
            "macro": directory.name, "width_bits": width, "depth_words": depth,
            "capacity_kb": capacity_kb, "ports": ports, "area_um2": area_um2,
            "complete": complete, "views": views, "score": round(score, 6),
        })
    choices.sort(key=lambda item: (item["score"], item["area_um2"] or float("inf"), item["macro"]))
    if not choices:
        return {"passed": False, "reason": "No parseable SRAM macro directories were found."}
    selected = choices[0]
    output = JOBS_ROOT / job["id"] / "memory_macro.json"
    result = {
        "passed": selected["complete"], "selected": selected,
        "alternatives": choices[1:11],
        "requirements": {
            "capacity_kb": requested_capacity, "word_width": requested_width, "ports": requested_ports,
        },
        "selection_policy": "Closest capacity, word width and port count; incomplete physical views are rejected.",
        "output_path": str(output), "file_count": sum(len(paths) for paths in selected["views"].values()),
    }
    _write(output, result)
    return result


def _parse_cace_summary(path: Path):
    if not path.exists():
        return {"summary": "", "metrics": {}, "statuses": {}}
    text = path.read_text(encoding="utf-8", errors="replace")
    metrics, statuses = {}, {}
    for line in text.splitlines():
        if not line.startswith("|") or "Parameter" in line or ":---" in line:
            continue
        cells = [cell.strip().replace("\u200b", "") for cell in line.strip("|").split("|")]
        if len(cells) < 10:
            continue
        name, result_name, value, status = cells[0], cells[2], cells[8], cells[9]
        statuses[name] = re.sub(r"[^A-Za-z]", "", status).lower() or "unknown"
        number = re.search(r"[-+]?[0-9]*\.?[0-9]+", value)
        if number:
            metrics[result_name] = float(number.group())
    return {"summary": text[-12000:], "metrics": metrics, "statuses": statuses}


def _openlane_running():
    completed = subprocess.run(
        ["wsl.exe", "-d", "Ubuntu", "--", "/bin/ps", "-eo", "args="],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    return any(
        "openlane" in line and "Veriolg_MA" in line
        for line in completed.stdout.splitlines()
    )


def _run_openfasoc(job, candidate):
    config = OPENFASOC_PROJECTS[candidate["id"]]
    if job["action"] == "generate_macro" and _openlane_running():
        return {
            "passed": False,
            "blocked_reason": "Digital OpenLane runs are active; macro generation is resource-gated.",
            "resource_gate": "openlane_busy",
        }
    project_rel = f"analog/third_party/OpenFASOC/openfasoc/generators/{config['project']}"
    project = ROOT / project_rel
    job_root = JOBS_ROOT / job["id"]
    generated = job_root / "generated"
    generated.mkdir(parents=True, exist_ok=True)
    (ROOT / "analog/third_party/OpenFASOC/openfasoc/common/drc-lvs-check").mkdir(parents=True, exist_ok=True)
    mode = "verilog" if job["action"] == "generate_verilog" else "macro"
    wsl_project = "/mnt/d/MyWork/Veriolg_MA/" + project_rel
    command = (
        f"cd {wsl_project} && export PDK_ROOT={PDK_ROOT} && export PDK=sky130A && "
        f"export PYTHONPATH={OPENFASOC_GENERATORS} && "
        f"export PATH={OPENFASOC_TOOL_PATH}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin && "
        f"{OPENFASOC_PYTHON} {config['script']} --specfile {config['spec']} "
        f"--outputDir ./work --platform {config['platform']} --mode {mode}"
    )
    completed = subprocess.run(
        ["wsl.exe", "-d", "Ubuntu", "--", "/bin/bash", "-lc", command],
        cwd=project, capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=7200, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    log = (completed.stdout or "") + ("\n" + completed.stderr if completed.stderr else "")
    (job_root / "console.log").write_text(log[-400000:], encoding="utf-8")
    source_rtl = project / config["rtl_dir"]
    copied = []
    if source_rtl.exists():
        for source in source_rtl.glob("*.v"):
            target = generated / source.name
            shutil.copy2(source, target)
            copied.append(str(target))
    if mode == "macro":
        work = project / "work"
        if work.exists():
            for source in work.rglob("*"):
                if source.is_file() and source.suffix.lower() in {".gds", ".lef", ".def", ".v", ".spice", ".sdc", ".rpt"}:
                    target = generated / source.name
                    shutil.copy2(source, target)
                    if str(target) not in copied:
                        copied.append(str(target))
    metrics = {}
    array_size = re.search(r"Power Transistor array Size =\s*([0-9]+)", log)
    estimated_area = re.search(r"Design Area =\s*([0-9.]+)\s*um", log)
    inverter_count = re.search(r"Inv\s*:\s*([0-9]+)", log)
    header_count = re.search(r"Header\s*:\s*([0-9]+)", log)
    if array_size:
        metrics["power_transistor_array_size"] = int(array_size.group(1))
    if estimated_area:
        metrics["estimated_area_um2"] = float(estimated_area.group(1))
    if inverter_count:
        metrics["inverters"] = int(inverter_count.group(1))
    if header_count:
        metrics["headers"] = int(header_count.group(1))
    required_suffixes = {".gds", ".lef", ".spice"} if mode == "macro" else {".v"}
    present_suffixes = {Path(path).suffix.lower() for path in copied}
    return {
        "passed": completed.returncode == 0 and required_suffixes.issubset(present_suffixes),
        "return_code": completed.returncode,
        "mode": mode,
        "files": copied,
        "file_count": len(copied),
        "metrics": metrics,
        "output_path": str(generated),
        "log_tail": log[-8000:],
        "missing_views": sorted(required_suffixes - present_suffixes),
    }


def _update_study(job):
    study_path = RUNS_ROOT / job["study_id"] / "study.json"
    study = _read(study_path)
    if not study:
        return
    study.setdefault("executions", []).append({
        "job_id": job["id"], "action": job["action"], "candidate_id": job["candidate_id"],
        "status": job["status"], "finished_at": job.get("finished_at"), "result": job.get("result", {}),
    })
    result = job.get("result", {})
    if job["action"] == "artifact_audit":
        stage = next(item for item in study["stages"] if item["id"] == "macro_export")
        stage["status"] = "evidence_ready" if result.get("complete") else "blocked"
    if job["action"] == "area" and result.get("metrics", {}).get("area") is not None:
        study.setdefault("measured", {})["area_um2"] = result["metrics"]["area"]
        study["measured"]["source"] = "CACE Magic layout measurement"
    if job["action"] == "physical_signoff":
        statuses = result.get("statuses", {})
        drc_pass = statuses.get("Magic DRC") == "pass" and statuses.get("KLayout DRC full") == "pass"
        lvs_pass = statuses.get("Netgen LVS") == "pass"
        stage = next(item for item in study["stages"] if item["id"] == "physical_verification")
        stage["status"] = "complete" if drc_pass and lvs_pass else "blocked"
    if job["action"] == "generate_verilog":
        study.setdefault("generated", {})["rtl"] = result.get("files", [])
    if job["action"] == "generate_macro":
        for stage_id in ("placement", "routing", "physical_verification", "macro_export"):
            stage = next(item for item in study["stages"] if item["id"] == stage_id)
            stage["status"] = "complete" if result.get("passed") else "blocked"
    if job["action"] == "select_memory_macro":
        selected = result.get("selected")
        stage = next(item for item in study["stages"] if item["id"] == "macro_export")
        stage["status"] = "evidence_ready" if result.get("passed") else "blocked"
        if selected:
            study.setdefault("generated", {})["memory_macro"] = selected
            if selected.get("area_um2") is not None:
                study.setdefault("measured", {})["area_um2"] = selected["area_um2"]
                study["measured"]["source"] = "Selected SRAM LEF SIZE statement"
    _write(study_path, study)


def _run_cace(job, candidate):
    relative_project, datasheet = CACE_PROJECTS[candidate["id"]]
    project = ROOT / relative_project
    run_path = JOBS_ROOT / job["id"] / "cace_runs"
    wsl_project = "/mnt/d/MyWork/Veriolg_MA/" + relative_project.replace("\\", "/")
    wsl_runs = "/mnt/d/MyWork/Veriolg_MA/analog/jobs/" + job["id"] + "/cace_runs"
    source_datasheet = project / datasheet
    runtime_datasheet = JOBS_ROOT / job["id"] / "datasheet.yaml"
    runtime_text = source_datasheet.read_text(encoding="utf-8")
    runtime_text = re.sub(
        r"(?m)^(\s+)script:\s*run_lvs\.tcl\s*$", r"\1args: []", runtime_text
    )
    runtime_text = re.sub(r"(?m)^(\s*root:)\s*\.\.\s*$", rf"\1 {wsl_project}", runtime_text, count=1)
    runtime_datasheet.write_text(runtime_text, encoding="utf-8")
    wsl_datasheet = "/mnt/d/MyWork/Veriolg_MA/analog/jobs/" + job["id"] + "/datasheet.yaml"
    parameters = " ".join(CACE_PARAMETERS[job["action"]])
    prepared_gds = []
    for compressed in (project / "gds").glob("*.gds.gz"):
        target = compressed.with_suffix("")
        if not target.exists() or target.stat().st_size < 1024:
            with gzip.open(compressed, "rb") as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)
        if target.stat().st_size < 1024:
            exported = ROOT / "analog" / "build" / project.name / f"{project.name}.gds"
            if exported.is_file() and exported.stat().st_size >= 1024:
                shutil.copy2(exported, target)
        prepared_gds.append(str(target))
    command = (
        f"cd {wsl_project} && export PDK_ROOT={PDK_ROOT} && "
        f"export PATH={CACE_TOOL_PATH}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin && "
        f"{CACE_PYTHON} -m cace {wsl_datasheet} --source layout --parameter {parameters} "
        f"--run-path {wsl_runs} --no-plot --no-progress-bar --max-runs 3 --log-level INFO"
    )
    completed = subprocess.run(
        ["wsl.exe", "-d", "Ubuntu", "--", "/bin/bash", "-lc", command],
        cwd=project, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=3600,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    log = (completed.stdout or "") + ("\n" + completed.stderr if completed.stderr else "")
    (JOBS_ROOT / job["id"] / "console.log").write_text(log[-200000:], encoding="utf-8")
    summaries = sorted(run_path.glob("RUN_*/summary.md"), reverse=True)
    parsed = _parse_cace_summary(summaries[0]) if summaries else {"summary": "", "metrics": {}, "statuses": {}}
    parsed.update({
        "return_code": completed.returncode,
        "run_path": str(summaries[0].parent) if summaries else str(run_path),
        "log_tail": log[-5000:],
        "prepared_gds": prepared_gds,
    })
    statuses = parsed.get("statuses", {})
    requested_names = {
        "magic_area": ["Area", "Width", "Height"],
        "magic_drc": ["Magic DRC"],
        "netgen_lvs": ["Netgen LVS"],
        "klayout_drc_full": ["KLayout DRC full"],
    }
    expected = [name for parameter in CACE_PARAMETERS[job["action"]] for name in requested_names[parameter]]
    parsed["passed"] = bool(expected) and all(statuses.get(name) == "pass" for name in expected)
    return parsed


def _adc_lvs_schematic(job_id: str, project: Path) -> Path:
    """Create an LVS-only schematic netlist without changing vendor IP files.

    The upstream Xschem export comments out the ADC's top-level .subckt and
    .ends lines, while retaining all dependent blocks.  Netgen therefore
    cannot select the comparison cell.  Reconstruct only that wrapper in the
    per-job directory; all implementation content remains upstream-owned.
    """
    source = (project / "netlist/schematic/sky130_ef_ip__adc3v_12bit.spice").read_text(encoding="utf-8")
    target = JOBS_ROOT / job_id / "lvs" / "sky130_ef_ip__adc3v_12bit.spice"
    target.parent.mkdir(parents=True, exist_ok=True)
    if ".subckt sky130_ef_ip__adc3v_12bit " in source:
        target.write_text(source, encoding="utf-8")
        return target
    body_start = source.index("x1 adc_dac_val[0]")
    top_end = source.index("**.ends", body_start)
    dependencies_start = source.index("\n", top_end) + 1
    pins = (
        "adc_dac_val[11] adc_dac_val[10] adc_dac_val[9] adc_dac_val[8] "
        "adc_dac_val[7] adc_dac_val[6] adc_dac_val[5] adc_dac_val[4] "
        "adc_dac_val[3] adc_dac_val[2] adc_dac_val[1] adc_dac_val[0] "
        "adc_ena adc_reset adc_comp_out adc_hold adc_vrefL vssd adc_vrefH "
        "adc_trim adc_vCM adc_in vccd vdda vssa"
    )
    top = ".subckt sky130_ef_ip__adc3v_12bit " + pins + "\n" + source[body_start:top_end].rstrip() + "\n.ends\n\n"
    target.write_text(top + source[dependencies_start:], encoding="utf-8")
    return target


def _run_adc_lvs(job, candidate):
    """Run Netgen directly with the per-job reconstructed ADC top level."""
    relative_project, _ = CACE_PROJECTS[candidate["id"]]
    project = ROOT / relative_project
    schematic = _adc_lvs_schematic(job["id"], project)
    output_dir = JOBS_ROOT / job["id"] / "lvs"
    report = output_dir / "sky130_ef_ip__adc3v_12bit_comp.out"
    script = output_dir / "run_lvs.tcl"
    wsl = lambda path: "/mnt/d/MyWork/Veriolg_MA/" + str(path.relative_to(ROOT)).replace("\\", "/")
    setup = f"{PDK_ROOT}/sky130A/libs.tech/netgen/sky130A_setup.tcl"
    hv = f"{PDK_ROOT}/sky130A/libs.ref/sky130_fd_sc_hvl/spice/sky130_fd_sc_hvl.spice"
    hd = f"{PDK_ROOT}/sky130A/libs.ref/sky130_fd_sc_hd/spice/sky130_fd_sc_hd.spice"
    layout = project / "netlist/layout/sky130_ef_ip__adc3v_12bit.spice"
    script.write_text(
        "set circuit1 [readnet spice {%s}]\n" % wsl(layout)
        + "set circuit2 [readnet spice {%s}]\n" % hv
        + "readnet spice {%s} $circuit2\n" % hd
        + "readnet spice {%s} $circuit2\n" % wsl(schematic)
        + "lvs \"$circuit1 sky130_ef_ip__adc3v_12bit\" \"$circuit2 sky130_ef_ip__adc3v_12bit\" {%s} {%s} -json\n" % (setup, wsl(report)),
        encoding="utf-8",
    )
    command = (
        f"export PDK_ROOT={PDK_ROOT}; "
        f"export PATH={CACE_TOOL_PATH}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; "
        f"{NETGEN_BIN}/netgen -batch source {wsl(script)}"
    )
    completed = subprocess.run(
        ["wsl.exe", "-d", "Ubuntu", "--", "/bin/bash", "-lc", command],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=3600,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    log = (completed.stdout or "") + ("\n" + completed.stderr if completed.stderr else "")
    (JOBS_ROOT / job["id"] / "console.log").write_text(log[-200000:], encoding="utf-8")
    json_report = report.with_suffix(".json")
    has_report = json_report.is_file() or report.is_file()
    passed = completed.returncode == 0 and has_report and "Circuits match uniquely" in log
    status = "pass" if passed else ("fail" if has_report else "error")
    return {
        "passed": passed,
        "return_code": completed.returncode,
        "statuses": {"Netgen LVS": status},
        "schematic": str(schematic),
        "report": str(json_report if json_report.is_file() else report),
        "log_tail": log[-5000:],
    }


def _worker(job_id):
    path = _job_path(job_id)
    job = _read(path)
    candidate = _candidate(job["candidate_id"])
    try:
        job["status"] = "running"
        job["started_at"] = _now()
        _write(path, job)
        if job["action"] == "artifact_audit":
            result = _artifact_audit(candidate)
            success = result["complete"]
        elif job["action"] in MEMORY_ACTIONS:
            result = _select_memory_macro(job, candidate, _study(job["study_id"]))
            success = result["passed"]
        elif job["action"] in GENERATOR_ACTIONS:
            with _generator_lock:
                result = _run_openfasoc(job, candidate)
            success = result["passed"]
        elif job["action"] == "lvs" and candidate["id"] == "sky130_ef_adc3v_12bit":
            result = _run_adc_lvs(job, candidate)
            success = result["passed"]
        else:
            result = _run_cace(job, candidate)
            success = result["passed"]
        job["result"] = result
        job["status"] = "complete" if success else "blocked"
    except subprocess.TimeoutExpired as error:
        job["status"] = "failed"
        job["error"] = f"Timed out after {error.timeout} seconds."
    except Exception as error:
        job["status"] = "failed"
        job["error"] = str(error)
    job["finished_at"] = _now()
    _write(path, job)
    _update_study(job)
    with _lock:
        _threads.pop(job_id, None)


def start_job(body):
    study_id = str(body.get("study_id", ""))
    candidate_id = str(body.get("candidate_id", ""))
    action = str(body.get("action", ""))
    study = _study(study_id)
    candidate = _candidate(candidate_id)
    if not study:
        raise ValueError("Unknown study.")
    if not candidate:
        raise ValueError("Unknown candidate.")
    if candidate_id not in {item["id"] for item in study["selection"]["candidates"] if item["eligible"]}:
        raise ValueError("Candidate is not eligible for this study.")
    if action not in ALLOWED_ACTIONS:
        raise ValueError("Unsupported analog execution action.")
    if action in CACE_PARAMETERS and candidate_id not in CACE_PROJECTS:
        raise ValueError("This candidate has no CACE physical-check adapter.")
    if action in GENERATOR_ACTIONS and candidate_id not in OPENFASOC_PROJECTS:
        raise ValueError("This candidate has no OpenFASoC generator adapter.")
    if action in MEMORY_ACTIONS and candidate_id not in {"sky130_sram_macros", "sram22_sky130_macros"}:
        raise ValueError("This candidate has no prebuilt SRAM macro selector.")
    job_id = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    job = {
        "id": job_id, "study_id": study_id, "candidate_id": candidate_id,
        "candidate_name": candidate["name"], "action": action, "status": "queued",
        "created_at": _now(), "result": {},
    }
    _write(_job_path(job_id), job)
    thread = threading.Thread(target=_worker, args=(job_id,), daemon=True, name=f"analog-{job_id}")
    with _lock:
        _threads[job_id] = thread
    thread.start()
    return job
