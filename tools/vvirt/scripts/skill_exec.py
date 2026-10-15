"""Run SKILL from a file through the real virtuoso-bridge client and print one JSON line {ok, output, errors}.

    bash tools/vvirt/scripts/pyrun.sh tools/vvirt/scripts/skill_exec.py code.il
Used by the evaluation harness for setup and oracle queries; reads the file as UTF-8.
"""
import json
import sys

from virtuoso_bridge import VirtuosoClient

code = open(sys.argv[1], encoding="utf-8").read()
r = VirtuosoClient.from_env().execute_skill(code, timeout=60)
print(json.dumps({"ok": r.status.value == "success", "output": r.output or "", "errors": list(r.errors or [])}, ensure_ascii=False))
