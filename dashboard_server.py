from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from capabilities import CAPABILITIES
from toolchain import detect_toolchain
from adapters.verilog_kb import VerilogKnowledgeBase
from design_flow import readiness


def count_files(path: Path, suffixes=None):
    if not path.exists():
        return 0
    suffixes = set(suffixes or [])
    return sum(1 for p in path.rglob('*') if p.is_file() and (not suffixes or p.suffix.lower() in suffixes))


def samples(path: Path, suffixes=None, limit=8):
    if not path.exists(): return []
    suffixes = set(suffixes or [])
    return [{"name": p.name, "detail": str(p)} for p in list(p for p in path.rglob('*') if p.is_file() and (not suffixes or p.suffix.lower() in suffixes))[:limit]]


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


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, dashboard_dir: Path, knowledge_root: Path, **kwargs):
        self.dashboard_dir, self.knowledge_root = dashboard_dir, knowledge_root
        super().__init__(*args, directory=str(dashboard_dir), **kwargs)

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
        super().do_GET()

    def log_message(self, fmt, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description='Veriolg_MA knowledge DB dashboard')
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--knowledge-root', default=r'D:\MyWork\verilog')
    args = parser.parse_args()
    dashboard_dir = Path(__file__).parent / 'dashboard'
    root = Path(args.knowledge_root)
    factory = lambda *a, **kw: Handler(*a, dashboard_dir=dashboard_dir, knowledge_root=root, **kw)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), factory)
    print(f'Veriolg_MA dashboard: http://127.0.0.1:{args.port}/')
    print(f'Knowledge root: {root}')
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()


if __name__ == '__main__': main()
