from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from capabilities import CAPABILITIES
from toolchain import detect_toolchain
from adapters.verilog_kb import VerilogKnowledgeBase
from design_flow import readiness
from analog_optimizer import create_study, installation_status as analog_installation_status, studies
from analog_runner import get_job as get_analog_job, jobs as analog_jobs, start_job as start_analog_job
from parsac_runner import get_job as get_parsac_job, jobs as parsac_jobs, start_job as start_parsac_job


MAX_SCAN_FILES = 5_000
PROJECT_ROOT = Path(__file__).resolve().parent
OPENLANE_IMAGE = 'ghcr.io/efabless/openlane2:2.3.10'
PARSAC_ROOT = PROJECT_ROOT / '.local-cache' / 'tools' / 'parsac'
PARSAC_PYTHON = PROJECT_ROOT / '.local-cache' / 'tools' / 'parsac-env' / 'python.exe'
PARSAC_RESULT = PROJECT_ROOT / 'physical_design' / 'parsac' / 'sample_test_2' / 'result.json'
PARSAC_RUNNER = PROJECT_ROOT / 'tools' / 'parsac' / 'run_sample_test_2.ps1'


def _command(args, timeout=8):
    try:
        completed = subprocess.run(
            args, capture_output=True, text=True, timeout=timeout,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
        )
        return completed.returncode == 0, (completed.stdout or completed.stderr).strip()
    except (OSError, subprocess.SubprocessError):
        return False, ''


def _docker_path():
    candidate = Path(os.environ.get('LOCALAPPDATA', '')) / 'Programs' / 'DockerDesktop' / 'resources' / 'bin' / 'docker.exe'
    return str(candidate) if candidate.exists() else shutil.which('docker')


def _resolve_design_path(config_path: Path, value):
    if not value:
        return None
    raw = str(value)
    if raw.startswith('dir::'):
        raw = raw[5:]
    path = Path(raw)
    return path.resolve() if path.is_absolute() else (config_path.parent / path).resolve()


def _design_configs():
    candidates = list(PROJECT_ROOT.glob('samples/*/asic/*/config.json'))
    candidates += list((PROJECT_ROOT / 'physical_design' / 'designs').glob('*/config.json'))
    designs = []
    for config_path in sorted(set(candidates)):
        try:
            config = json.loads(config_path.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError):
            continue
        rtl = [_resolve_design_path(config_path, item) for item in config.get('VERILOG_FILES', [])]
        rtl = [item for item in rtl if item]
        sdc = _resolve_design_path(config_path, config.get('PNR_SDC_FILE') or config.get('SIGNOFF_SDC_FILE'))
        missing = [str(item) for item in rtl if not item.exists()]
        if sdc and not sdc.exists():
            missing.append(str(sdc))
        designs.append({
            'name': config.get('DESIGN_NAME', config_path.parent.name),
            'config': str(config_path),
            'top_module': config.get('DESIGN_NAME', ''),
            'rtl_count': len(rtl),
            'rtl_found': sum(item.exists() for item in rtl),
            'sdc': str(sdc) if sdc else '',
            'sdc_found': bool(sdc and sdc.exists()),
            'clock_port': config.get('CLOCK_PORT', ''),
            'clock_period': config.get('CLOCK_PERIOD'),
            'connected': bool(rtl and not missing and sdc),
            'missing': missing[:8],
        })
    return designs


def _parsac_status():
    try:
        result = json.loads(PARSAC_RESULT.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        result = None
    return {
        'installed': PARSAC_ROOT.is_dir() and PARSAC_PYTHON.is_file(),
        'host': 'Windows native',
        'python': str(PARSAC_PYTHON),
        'source': str(PARSAC_ROOT),
        'runner': str(PARSAC_RUNNER),
        'result_path': str(PARSAC_RESULT),
        'result': result,
        'jobs': parsac_jobs(),
        'models': [
            {'id': 'sample_test_2', 'label': 'Sample Test 2 · 교육용 추정 모델'},
            {'id': 'sample_test_4', 'label': 'Sample Test 4 · OpenLane 실측 블록'},
        ],
    }


def run_parsac(body):
    steps = int(body.get('steps', 2000))
    runs = int(body.get('runs', 8))
    workers = int(body.get('workers', 2))
    if not 10 <= steps <= 1_000_000:
        raise ValueError('steps must be between 10 and 1000000.')
    if not 1 <= runs <= 64:
        raise ValueError('runs must be between 1 and 64.')
    if not 1 <= workers <= 8:
        raise ValueError('workers must be between 1 and 8.')
    if not PARSAC_RUNNER.is_file():
        raise ValueError('PARSAC runner is not installed.')
    command = [
        'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', str(PARSAC_RUNNER), '-Steps', str(steps),
        '-Runs', str(runs), '-Workers', str(workers),
    ]
    try:
        completed = subprocess.run(
            command, cwd=PROJECT_ROOT, capture_output=True, text=True,
            timeout=600, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise ValueError(f'PARSAC execution failed: {error}') from error
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip()[-2000:]
        raise ValueError('PARSAC execution failed: ' + detail)
    try:
        result = json.loads(PARSAC_RESULT.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError('PARSAC result was not generated.') from error
    return {'status': 'completed', 'result': result}


def physical_design_status():
    install_file = PROJECT_ROOT / 'physical_design' / 'install_status.json'
    try:
        recorded = json.loads(install_file.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        recorded = {}
    docker = _docker_path()
    docker_ready, docker_version = _command([docker, 'version', '--format', '{{.Server.Version}}']) if docker else (False, '')
    image_ready, _ = _command([docker, 'image', 'inspect', OPENLANE_IMAGE]) if docker_ready else (False, '')
    wsl_ready, wsl_arch = _command(['wsl.exe', '-d', 'Ubuntu', '--', '/bin/sh', '-lc', 'uname -m'])
    versions_root = PROJECT_ROOT / 'pdk' / 'volare' / 'sky130' / 'versions'
    revisions = sorted(item.name for item in versions_root.iterdir() if item.is_dir()) if versions_root.exists() else []
    pdk_revision = recorded.get('pdk_revision') or (revisions[-1] if revisions else '')
    pdk_config = versions_root / pdk_revision / 'sky130A' / 'libs.tech' / 'openlane' / 'config.tcl' if pdk_revision else Path()
    designs = _design_configs()
    return {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'installation': {
            'wsl': {'installed': wsl_ready, 'version': f'Ubuntu WSL2 · {wsl_arch}' if wsl_ready else 'not available'},
            'docker': {'installed': docker_ready, 'version': docker_version or 'not available', 'path': docker or ''},
            'openlane': {'installed': image_ready, 'version': recorded.get('openlane_version', '2.3.10'), 'image': OPENLANE_IMAGE},
            'pdk': {'installed': pdk_config.is_file(), 'name': 'sky130A', 'revision': pdk_revision, 'path': str(pdk_config.parent.parent.parent) if pdk_revision else ''},
            'tools': recorded.get('tools', []),
            'smoke_test': recorded.get('smoke_test', {'status': 'unknown'}),
        },
        'designs': designs,
        'parsac': _parsac_status(),
        'summary': {'connected': sum(item['connected'] for item in designs), 'total': len(designs)},
    }


def create_physical_design_config(body):
    design_name = str(body.get('design_name', '')).strip()
    top_module = str(body.get('top_module', design_name)).strip()
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', design_name):
        raise ValueError('Design name must be a Verilog identifier.')
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', top_module):
        raise ValueError('Top module must be a Verilog identifier.')
    rtl_values = body.get('rtl_files', [])
    if isinstance(rtl_values, str):
        rtl_values = [line.strip() for line in rtl_values.splitlines() if line.strip()]
    if not rtl_values:
        raise ValueError('At least one RTL file is required.')
    rtl_paths = [Path(item).resolve() for item in rtl_values]
    sdc_path = Path(str(body.get('sdc_file', ''))).resolve()
    missing = [str(item) for item in [*rtl_paths, sdc_path] if not item.is_file()]
    if missing:
        raise ValueError('Missing file: ' + ', '.join(missing))
    if any(item.suffix.lower() not in {'.v', '.sv', '.vh', '.svh'} for item in rtl_paths):
        raise ValueError('RTL files must use .v/.sv/.vh/.svh extensions.')
    if sdc_path.suffix.lower() != '.sdc':
        raise ValueError('Constraint file must use the .sdc extension.')
    design_dir = PROJECT_ROOT / 'physical_design' / 'designs' / design_name
    design_dir.mkdir(parents=True, exist_ok=True)
    config_path = design_dir / 'config.json'
    relative = lambda item: 'dir::' + os.path.relpath(item, design_dir).replace('\\', '/')
    config = {
        'DESIGN_NAME': top_module,
        'VERILOG_FILES': [relative(item) for item in rtl_paths],
        'CLOCK_PORT': str(body.get('clock_port', 'clk')).strip(),
        'CLOCK_PERIOD': float(body.get('clock_period', 10)),
        'PNR_SDC_FILE': relative(sdc_path),
        'SIGNOFF_SDC_FILE': relative(sdc_path),
        'FP_SIZING': 'relative',
        'FP_CORE_UTIL': int(body.get('core_utilization', 40)),
    }
    config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return {'status': 'created', 'config': str(config_path), 'design': design_name}


def _matching_files(path: Path, suffixes=None, limit=MAX_SCAN_FILES):
    """Yield matching files quickly, avoiding an unbounded walk of vendor trees."""
    if not path.exists():
        return
    suffixes = set(suffixes or [])
    skipped = {'.git', 'node_modules', '.venv', '.venv-graphify', '.venv-openkb', '__pycache__'}
    found = 0
    for current, directories, filenames in os.walk(path):
        directories[:] = [name for name in directories if name not in skipped]
        for filename in filenames:
            item = Path(current) / filename
            if suffixes and item.suffix.lower() not in suffixes:
                continue
            yield item
            found += 1
            if found >= limit:
                return


def count_files(path: Path, suffixes=None):
    if not path.exists():
        return 0
    return sum(1 for _ in _matching_files(path, suffixes))


def samples(path: Path, suffixes=None, limit=8):
    return [{"name": p.name, "detail": str(p)} for p in _matching_files(path, suffixes, limit=limit)]


def source(source_id, name, kind, path, description, icon, color='', suffixes=None, extra=None, connection='artifact'):
    available = path.exists()
    metric = {"files": count_files(path, suffixes)} if available else {"files": 0}
    if extra: metric.update(extra(path) if callable(extra) else extra)
    return {"id": source_id, "name": name, "short_name": name.split(' / ')[0], "kind": kind,
            "path": str(path), "description": description, "icon": icon, "color": color,
            "status": "available" if available else "missing", "connection": connection, "metrics": metric,
            "samples": samples(path, suffixes)}


def overview(root: Path):
    out = root / 'out'; graph = root / 'graphify-out'; dbs = root / 'dbs'; platform = root / 'platform'
    sources = [
        source('graphify', 'Graphify', 'architecture graph', graph / 'graph.json', 'cross-file community와 architecture snapshot', 'G', 'purple', {'.json'}, connection='snapshot'),
        source('embedding', 'Vector / Embedding', 'semantic index', out / 'embedding_rows.json', 'semantic retrieval용 embedding records', 'V', 'blue', {'.json'}, connection='artifact'),
        source('code-kg', 'Code KG / Postgres', 'relational facts', platform / 'schema' / 'postgres_schema.sql', 'module·port·instance·version 정형 구조', 'PG', 'green', {'.sql'}, {'tables': 'schema available'}, connection='schema-only'),
        source('neo4j', 'Neo4j Graph', 'graph database', platform / 'schema' / 'postgres_ontology_extension.sql', 'hierarchy·connectivity·ontology graph 적재 설정', 'N', 'purple', {'.sql'}, {'adapter': 'configured'}, connection='schema-only'),
        source('openkb', 'OpenKB / Spec', 'document knowledge', root / 'docs', 'spec 문서와 late-binding 설계 문서', 'S', 'orange', {'.md', '.pdf'}, connection='documents'),
        source('rtl-sources', 'RTL Source DB', 'source snapshots', dbs, 'OpenTitan·Ibex 등 RTL 원천 저장소', 'RTL', 'blue', {'.v', '.sv', '.vh', '.svh'}, connection='filesystem'),
    ]
    available = sum(x['status'] == 'available' for x in sources)
    ready = sum(x['status'] == 'implemented' for x in CAPABILITIES.values())
    return {'generated_at': datetime.now(timezone.utc).isoformat(), 'workspace': {'path': str(root), 'exists': root.exists()},
            'summary': {'sources': len(sources), 'available': available, 'files': sum(x['metrics'].get('files', 0) for x in sources),
                        'agents_ready': ready, 'agents_total': len(CAPABILITIES)}, 'sources': sources,
            'agents': [{'name': k, 'label': v['label'], 'status': v['status']} for k, v in CAPABILITIES.items()],
            'toolchain': detect_toolchain(),
            'design_flow': readiness([{'agent': k} for k in CAPABILITIES], detect_toolchain())}


class Handler(BaseHTTPRequestHandler):
    def __init__(self, *args, knowledge_root: Path, **kwargs):
        self.knowledge_root = knowledge_root
        super().__init__(*args, **kwargs)

    def do_GET(self):
        route = urlparse(self.path).path
        if route == '/api/overview':
            payload = json.dumps(overview(self.knowledge_root), ensure_ascii=False).encode('utf-8')
            self.send_response(200); self.send_header('Content-Type', 'application/json; charset=utf-8'); self.send_header('Content-Length', str(len(payload))); self.end_headers(); self.wfile.write(payload); return
        if route == '/api/health':
            payload = json.dumps({'status': 'ok', 'knowledge_root': str(self.knowledge_root), 'toolchain': detect_toolchain()}, ensure_ascii=False).encode('utf-8')
            self.send_response(200); self.send_header('Content-Type', 'application/json; charset=utf-8'); self.send_header('Content-Length', str(len(payload))); self.end_headers(); self.wfile.write(payload); return
        if route == '/api/search':
            from urllib.parse import parse_qs
            query = parse_qs(urlparse(self.path).query).get('q', [''])[0]
            payload = json.dumps({'query': query, 'results': VerilogKnowledgeBase(str(self.knowledge_root)).search(query)}, ensure_ascii=False).encode('utf-8')
            self.send_response(200); self.send_header('Content-Type', 'application/json; charset=utf-8'); self.send_header('Content-Length', str(len(payload))); self.end_headers(); self.wfile.write(payload); return
        if route == '/api/physical-design':
            payload = json.dumps(physical_design_status(), ensure_ascii=False).encode('utf-8')
            self.send_response(200); self.send_header('Content-Type', 'application/json; charset=utf-8'); self.send_header('Content-Length', str(len(payload))); self.end_headers(); self.wfile.write(payload); return
        if route.startswith('/api/physical-design/parsac/jobs/'):
            job = get_parsac_job(route.rsplit('/', 1)[-1])
            if not job:
                self.send_error(404, 'Unknown PARSAC job'); return
            payload = json.dumps(job, ensure_ascii=False).encode('utf-8')
            self.send_response(200); self.send_header('Content-Type', 'application/json; charset=utf-8'); self.send_header('Content-Length', str(len(payload))); self.end_headers(); self.wfile.write(payload); return
        if route == '/api/analog':
            payload = json.dumps({
                'generated_at': datetime.now(timezone.utc).isoformat(),
                'installation': analog_installation_status(),
                'studies': studies(),
                'jobs': analog_jobs(),
            }, ensure_ascii=False).encode('utf-8')
            self.send_response(200); self.send_header('Content-Type', 'application/json; charset=utf-8'); self.send_header('Content-Length', str(len(payload))); self.end_headers(); self.wfile.write(payload); return
        if route.startswith('/api/analog/jobs/'):
            job = get_analog_job(route.rsplit('/', 1)[-1])
            if not job:
                self.send_error(404, 'Unknown analog job'); return
            payload = json.dumps(job, ensure_ascii=False).encode('utf-8')
            self.send_response(200); self.send_header('Content-Type', 'application/json; charset=utf-8'); self.send_header('Content-Length', str(len(payload))); self.end_headers(); self.wfile.write(payload); return
        self.send_error(404, 'Not Found')

    def do_POST(self):
        route = urlparse(self.path).path
        if route not in {'/api/physical-design/configure', '/api/physical-design/parsac/run', '/api/analog/select', '/api/analog/run'}:
            self.send_error(404, 'Not Found'); return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length <= 0 or length > 1_000_000:
                raise ValueError('Invalid request size.')
            body = json.loads(self.rfile.read(length).decode('utf-8'))
            if route == '/api/physical-design/configure':
                result = create_physical_design_config(body)
            elif route == '/api/physical-design/parsac/run':
                result = start_parsac_job(body)
            elif route == '/api/analog/select':
                result = create_study(body)
            else:
                result = start_analog_job(body)
            payload = json.dumps(result, ensure_ascii=False).encode('utf-8')
            self.send_response(201)
        except (ValueError, json.JSONDecodeError) as error:
            payload = json.dumps({'status': 'error', 'message': str(error)}, ensure_ascii=False).encode('utf-8')
            self.send_response(400)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', 'http://127.0.0.1:5173')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description='Veriolg_MA knowledge DB dashboard')
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--knowledge-root', default=r'D:\MyWork\verilog')
    args = parser.parse_args()
    root = Path(args.knowledge_root)
    factory = lambda *a, **kw: Handler(*a, knowledge_root=root, **kw)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), factory)
    print(f'Veriolg_MA dashboard: http://127.0.0.1:{args.port}/')
    print(f'Knowledge root: {root}')
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()


if __name__ == '__main__': main()
