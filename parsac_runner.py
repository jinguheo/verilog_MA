from __future__ import annotations

import json
import re
import subprocess
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent
JOBS_ROOT = ROOT / "physical_design" / "parsac" / "jobs"
RUNNER = ROOT / "tools" / "parsac" / "run_sample_test_2.ps1"
PYTHON = ROOT / ".local-cache" / "tools" / "parsac-env" / "python.exe"
EXTRACTOR = ROOT / "tools" / "parsac" / "extract_openlane_blocks.py"
EXPORTER = ROOT / "tools" / "parsac" / "export_openlane_macros.py"
MODELS = {
    "sample_test_2": ROOT / "physical_design" / "parsac" / "sample_test_2" / "input.json",
    "sample_test_4": ROOT / "physical_design" / "parsac" / "sample_test_4" / "manifest.json",
}
_threads: dict[str, threading.Thread] = {}
_lock = threading.Lock()


def _now():
    return datetime.now(timezone.utc).isoformat()


def _path(job_id):
    return JOBS_ROOT / job_id / "job.json"


def _read(path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def _write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def jobs(limit=20):
    if not JOBS_ROOT.exists():
        return []
    return [item for item in (_read(path) for path in sorted(JOBS_ROOT.glob("*/job.json"), reverse=True)[:limit]) if item]


def get_job(job_id):
    if not re.fullmatch(r"[0-9]{8}-[0-9]{6}-[0-9a-f]{6}", str(job_id)):
        return None
    return _read(_path(job_id))


def _run(command, log_path, timeout=1800):
    completed = subprocess.run(
        command, cwd=ROOT, capture_output=True, text=True, errors="replace", timeout=timeout,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    log = (completed.stdout or "") + (("\n" + completed.stderr) if completed.stderr else "")
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(log)
    if completed.returncode:
        raise RuntimeError(log[-4000:] or f"Command failed with code {completed.returncode}")


def _update(job, status, progress, stage):
    job.update({"status": status, "progress": progress, "stage": stage, "updated_at": _now()})
    _write(_path(job["id"]), job)


def _worker(job_id):
    job = get_job(job_id)
    job_dir = _path(job_id).parent
    log_path = job_dir / "console.log"
    try:
        _update(job, "running", 5, "입력 준비")
        if job["model"] == "sample_test_4":
            input_path = job_dir / "input.json"
            _run([str(PYTHON), str(EXTRACTOR), "--manifest", str(MODELS[job["model"]]), "--output", str(input_path)], log_path)
        else:
            input_path = MODELS[job["model"]]
        result_path = job_dir / "result.json"
        _update(job, "running", 20, "PARSAC 병렬 탐색")
        _run([
            "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(RUNNER),
            "-InputFile", str(input_path), "-OutputFile", str(result_path),
            "-Steps", str(job["steps"]), "-Runs", str(job["runs"]), "-Workers", str(job["workers"]),
        ], log_path)
        _update(job, "running", 90, "결과 검증·변환")
        result = _read(result_path)
        if not result:
            raise RuntimeError("PARSAC result was not generated.")
        if job["model"] == "sample_test_4":
            _run([str(PYTHON), str(EXPORTER), "--result", str(result_path), "--output-dir", str(job_dir)], log_path)
        job["result"] = result
        job["artifacts"] = {
            "result": str(result_path), "log": str(log_path),
            "macro_placement": str(job_dir / "macro_placement.cfg") if job["model"] == "sample_test_4" else None,
            "openlane_macros": str(job_dir / "openlane_macros.json") if job["model"] == "sample_test_4" else None,
        }
        job["finished_at"] = _now()
        _update(job, "complete", 100, "완료")
    except subprocess.TimeoutExpired as error:
        job["error"] = f"Timed out after {error.timeout} seconds."
        job["finished_at"] = _now()
        _update(job, "failed", job.get("progress", 0), "시간 초과")
    except Exception as error:
        job["error"] = str(error)
        job["finished_at"] = _now()
        _update(job, "failed", job.get("progress", 0), "실패")
    with _lock:
        _threads.pop(job_id, None)


def start_job(body):
    model = str(body.get("model", "sample_test_2"))
    steps, runs, workers = int(body.get("steps", 2000)), int(body.get("runs", 8)), int(body.get("workers", 2))
    if model not in MODELS:
        raise ValueError("Unsupported PARSAC model.")
    if not 10 <= steps <= 1_000_000 or not 1 <= runs <= 64 or not 1 <= workers <= 8:
        raise ValueError("Invalid PARSAC steps/runs/workers.")
    for required in (RUNNER, PYTHON, MODELS[model]):
        if not required.exists():
            raise ValueError(f"Missing PARSAC dependency: {required}")
    job_id = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    job = {"id": job_id, "model": model, "steps": steps, "runs": runs, "workers": workers,
           "status": "queued", "progress": 0, "stage": "대기", "created_at": _now(), "result": {}}
    _write(_path(job_id), job)
    thread = threading.Thread(target=_worker, args=(job_id,), daemon=True, name=f"parsac-{job_id}")
    with _lock:
        _threads[job_id] = thread
    thread.start()
    return job
