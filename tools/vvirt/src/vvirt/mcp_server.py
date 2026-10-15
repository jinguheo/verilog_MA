"""Minimal MCP (stdio, newline-delimited JSON-RPC 2.0) front end for vvirt.

Two tools, deliberately few:
  vvirt_skill     run SKILL through the real virtuoso-bridge client (same path as any bridge user) and return the reply or the error
  vvirt_describe  the vv* API: list by group, or one function's arguments / result fields / example

Run (inside WSL):  bash tools/vvirt/scripts/mcp.sh      register with a client, e.g. Claude Code:
  claude mcp add vvirt -- wsl.exe -d Ubuntu -e bash /mnt/d/MyWork/Veriolg_MA/tools/vvirt/scripts/mcp.sh
Needs the vvirt server running (scripts/vserver.sh start). Nothing here changes configuration or installs anything.
"""
from __future__ import annotations

import json
import sys
import time
from typing import Any

from . import api_registry

SUPPORTED = ("2025-06-18", "2025-03-26", "2024-11-05")
TOOLS = [
    {"name": "vvirt_skill",
     "description": "Execute Virtuoso SKILL on the vvirt virtual Virtuoso (sky130 layout create/modify) and return the printed result (%L) or the error. "
                    "State persists between calls (variables such as cv stay bound). Call vvirt_describe first if unsure which vv* function to use.",
     "inputSchema": {"type": "object", "properties": {"code": {"type": "string", "description": "SKILL source; several forms allowed"}}, "required": ["code"],
                     "additionalProperties": False}},
    {"name": "vvirt_describe",
     "description": "Describe the vv* SKILL functions. No argument: list grouped by purpose. With name: arguments, result fields and an example.",
     "inputSchema": {"type": "object", "properties": {"name": {"type": "string", "description": "e.g. vvRoute"}}, "additionalProperties": False}},
]


def describe(name: str | None) -> str:
    if not name:
        lines = ["vv* functions (call vvirt_describe with a name for details):"]
        last = None
        for group, fn, summary in api_registry.summary_rows():
            if group != last:
                lines.append(f"\n[{group}]")
                last = group
            lines.append(f"  {fn} - {summary}")
        lines.append("\nResults are named-field records: read with vvGet(rec \"field\"). The standard db*/dd*/ge* Virtuoso functions also work.")
        return "\n".join(lines)
    e = api_registry.API.get(name)
    if e is None:
        near = [n for n in api_registry.names() if name.lower() in n.lower()]
        return f"No vv* function named {name}." + (f" Similar: {', '.join(near)}" if near else " Call vvirt_describe without a name for the list.")
    out = [f"{name}  [{e['group']}]", e["summary"], "args:"] + [f"  - {a}" for a in e["args"]] + [f"returns: {e['returns']}", f"example: {e['example']}"]
    if e.get("notes"):
        out.append("notes: " + e["notes"])
    return "\n".join(out)


class Server:
    def __init__(self) -> None:
        self.client: Any = None

    def _client(self) -> Any:
        if self.client is None:
            from virtuoso_bridge import VirtuosoClient

            self.client = VirtuosoClient.from_env()
        return self.client

    def call(self, name: str, args: dict[str, Any]) -> tuple[str, bool]:
        if name == "vvirt_describe":
            return describe(args.get("name")), False
        if name == "vvirt_skill":
            code = args.get("code")
            if not isinstance(code, str) or not code.strip():
                return "ERROR: argument 'code' must be a non-empty SKILL string", True
            try:
                r = self._client().execute_skill(code, timeout=60)
            except Exception as exc:  # connection problems must be visible to the agent, not crash the server
                return f"ERROR: could not reach vvirt ({type(exc).__name__}: {exc}). Is the server running? (scripts/vserver.sh start; scripts/doctor.sh)", True
            if r.status.value == "success":
                return (r.output or "nil"), False
            return "ERROR: " + ("; ".join(r.errors) if r.errors else "unknown error"), True
        return f"unknown tool {name}", True

    def handle(self, msg: dict[str, Any]) -> dict[str, Any] | None:
        method, mid = msg.get("method"), msg.get("id")
        if mid is None:  # notification (initialized, cancelled, ...): no reply
            return None
        if method == "initialize":
            want = (msg.get("params") or {}).get("protocolVersion")
            return {"jsonrpc": "2.0", "id": mid, "result": {"protocolVersion": want if want in SUPPORTED else SUPPORTED[-1],
                                                           "capabilities": {"tools": {}}, "serverInfo": {"name": "vvirt", "version": "1"}}}
        if method == "tools/list":
            return {"jsonrpc": "2.0", "id": mid, "result": {"tools": TOOLS}}
        if method == "tools/call":
            p = msg.get("params") or {}
            text, is_err = self.call(p.get("name", ""), p.get("arguments") or {})
            return {"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": text}], "isError": is_err}}
        if method == "ping":
            return {"jsonrpc": "2.0", "id": mid, "result": {}}
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"method not found: {method}"}}


def main() -> int:
    srv = Server()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            reply = srv.handle(json.loads(line))
        except json.JSONDecodeError:
            reply = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}}
        if reply is not None:
            sys.stdout.write(json.dumps(reply, ensure_ascii=False) + "\n")
            sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
