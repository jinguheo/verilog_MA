"""Agent-trial harness for vvirt: run an agent on a task through the MCP tools, record every call, check the result.

An "agent" is anything that produces a Transcript: the real `claude -p` CLI (run_claude), or a scripted control agent
(run_scripted) that talks to the same MCP server. Oracles read the saved layout from disk and the final answer text; they never
look at what the agent intended. Transcripts record tool, SKILL code, error flag, reply, retries and (for claude) tokens/cost.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]            # tools/vvirt
WS = ROOT / "workspace"
SCRIPTS = ROOT / "scripts"
TOOLS = ("mcp__vvirt__vvirt_skill", "mcp__vvirt__vvirt_describe")


def wslp(p: Path) -> str:
    """D:\\a\\b -> /mnt/d/a/b"""
    s = str(p.resolve()).replace("\\", "/")
    return "/mnt/" + s[0].lower() + s[2:] if len(s) > 1 and s[1] == ":" else s


def wsl(args: list[str], timeout: int = 180) -> str:
    r = subprocess.run(["wsl.exe", "-d", "Ubuntu", "-e", "bash", *args], capture_output=True, text=True, encoding="utf-8", timeout=timeout)
    return (r.stdout or "").strip()


def skill(code: str) -> dict[str, Any]:
    """Run SKILL on vvirt directly (setup / oracle queries; not part of any agent's transcript)."""
    d = WS / "_eval"
    d.mkdir(parents=True, exist_ok=True)
    f = d / f"{uuid.uuid4().hex}.il"
    f.write_text(code, encoding="utf-8")
    try:
        out = wsl([wslp(SCRIPTS / "pyrun.sh"), wslp(SCRIPTS / "skill_exec.py"), wslp(f)])
        return json.loads(out.splitlines()[-1])
    except (json.JSONDecodeError, IndexError):
        return {"ok": False, "output": "", "errors": [f"skill_exec gave no JSON: {out[-200:]!r}"]}
    finally:
        f.unlink(missing_ok=True)


def nums(text: str) -> list[float]:
    return [float(x) for x in re.findall(r"-?\d+\.?\d*", text)]


def cell_json(lib: str, cell: str) -> dict[str, Any] | None:
    p = WS / "libs" / lib / cell / "layout.json"
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


@dataclass
class Call:
    tool: str
    args: dict[str, Any]
    text: str = ""
    is_error: bool = False


@dataclass
class Transcript:
    agent: str
    calls: list[Call] = field(default_factory=list)
    final: str = ""
    meta: dict[str, Any] = field(default_factory=dict)

    def code(self) -> str:
        return "\n".join(str(c.args.get("code", c.args.get("name", ""))) for c in self.calls)


FUNC = re.compile(r"\b((?:vv|db|dd|ge|le|tech)[A-Z]\w*)\(")


def metrics(t: Transcript) -> dict[str, Any]:
    funcs = [set(FUNC.findall(str(c.args.get("code", "")))) for c in t.calls]
    retries = sum(1 for i in range(len(t.calls) - 1) if t.calls[i].is_error and funcs[i] and funcs[i] & funcs[i + 1])
    return {"tool_calls": len(t.calls), "errors": sum(c.is_error for c in t.calls), "retries_after_error": retries,
            "used_describe": any(c.tool.endswith("vvirt_describe") for c in t.calls),
            "functions": sorted(set().union(*funcs)) if funcs else []}


# ------------------------------------------------------------------------------------------------ MCP (scripted agents)
class McpSession:
    """Talks to scripts/mcp.sh over stdio exactly as an MCP client would."""

    def __init__(self) -> None:
        self.p = subprocess.Popen(["wsl.exe", "-d", "Ubuntu", "-e", "bash", wslp(SCRIPTS / "mcp.sh")], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL, text=True, encoding="utf-8", bufsize=1)
        self.n = 0
        self._rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "vvirt-eval", "version": "1"}})
        self.p.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
        self.p.stdin.flush()

    def _rpc(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        self.n += 1
        self.p.stdin.write(json.dumps({"jsonrpc": "2.0", "id": self.n, "method": method, "params": params}) + "\n")
        self.p.stdin.flush()
        return json.loads(self.p.stdout.readline())

    def call(self, tool: str, args: dict[str, Any]) -> Call:
        # Claude Code namespaces MCP tools as mcp__<server>__<tool>; the server itself only knows <tool>
        r = self._rpc("tools/call", {"name": tool.split("__")[-1], "arguments": args})["result"]
        return Call(tool, args, r["content"][0]["text"], bool(r.get("isError")))

    def close(self) -> None:
        try:
            self.p.stdin.close()
            self.p.wait(10)
        except Exception:
            self.p.kill()


def run_scripted(name: str, steps: list[tuple[str, dict[str, Any]]], final: str) -> Transcript:
    t = Transcript(name)
    if steps:
        s = McpSession()
        try:
            for tool, args in steps:
                t.calls.append(s.call(tool, args))
        finally:
            s.close()
    t.final = final
    return t


# ------------------------------------------------------------------------------------------------ real agent: claude -p
def run_claude(prompt: str, system_append: str, model: str, budget_usd: float, timeout: int = 600) -> Transcript:
    """Run the Claude Code CLI headless with only the two vvirt MCP tools. Requires a working `claude` login."""
    cfg = ROOT / "eval" / "mcp.json"
    cmd = ["claude", "-p", prompt, "--mcp-config", str(cfg), "--strict-mcp-config", "--allowedTools", *TOOLS, "--tools", "", "--output-format", "stream-json",
           "--verbose", "--max-budget-usd", str(budget_usd), "--model", model, "--no-session-persistence", "--setting-sources", "",
           "--append-system-prompt", system_append]
    t0 = time.time()
    with tempfile.TemporaryDirectory(prefix="vveval_") as cwd:  # empty cwd: no project instructions leak into the trial
        p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=timeout, cwd=cwd, stdin=subprocess.DEVNULL)
    return parse_stream(p.stdout, t0)


def parse_stream(stdout: str, t0: float | None = None) -> Transcript:
    t = Transcript("claude")
    pending: dict[str, Call] = {}
    for line in stdout.splitlines():
        try:
            m = json.loads(line)
        except json.JSONDecodeError:
            continue
        kind = m.get("type")
        if kind == "system" and m.get("subtype") == "init":
            t.meta.update(model=m.get("model"), tools=m.get("tools"), mcp=m.get("mcp_servers"))
        elif kind == "assistant":
            for b in m.get("message", {}).get("content", []):
                if b.get("type") == "tool_use":
                    c = Call(b["name"], b.get("input", {}))
                    pending[b["id"]] = c
                    t.calls.append(c)
                elif b.get("type") == "text":
                    t.final = b["text"]
        elif kind == "user":
            for b in m.get("message", {}).get("content", []):
                if isinstance(b, dict) and b.get("type") == "tool_result" and b.get("tool_use_id") in pending:
                    c = pending[b["tool_use_id"]]
                    body = b.get("content")
                    c.text = body if isinstance(body, str) else " ".join(x.get("text", "") for x in body or [] if isinstance(x, dict))
                    c.is_error = bool(b.get("is_error"))
        elif kind == "result":
            t.meta.update(turns=m.get("num_turns"), duration_ms=m.get("duration_ms"), cost_usd=m.get("total_cost_usd"), usage=m.get("usage"),
                          api_error=bool(m.get("is_error")), result=m.get("result"))
            if m.get("result"):
                t.final = m["result"]
    if t0 is not None:
        t.meta.setdefault("wall_s", round(time.time() - t0, 1))
    return t
