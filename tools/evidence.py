"""Evidence records: every reported number says how we know it.

A record separates four kinds of statement (idea borrowed from REA's Evidence model):

  observed  a value read directly from a named file/key (path, sha256 of that file, step it first appeared in)
  derived   computed from other claims by a stated rule (lists the claims it came from)
  inferred  an interpretation that is NOT read from a file (basis, confidence, limitations)
  unknown   not measured, with the reason. Unknown is not zero and not "pass".

Standard library only (the project's phase-1 policy).  CLI:

    python tools/evidence.py show     bundle.json [--kind unknown]
    python tools/evidence.py validate bundle.json [--root REPO]   # --root also re-hashes the input files (freshness)
    python tools/evidence.py compare  left.json right.json
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

SCHEMA = "veriolg.evidence/1"
KINDS = ("observed", "derived", "inferred", "unknown")
CONFIDENCE = ("high", "medium", "low")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class Evidence:
    """Builder for one record. Claim ids must be unique; inputs are registered once and referenced by id."""

    def __init__(self, subject: dict[str, Any], root: Path, produced_by: str) -> None:
        self.root = Path(root)
        self.subject = subject
        self.produced = {"by": produced_by, "at": datetime.now().isoformat(timespec="seconds")}
        self.inputs: dict[str, dict[str, Any]] = {}
        self.claims: list[dict[str, Any]] = []
        self.context: dict[str, Any] = {}
        self.limitations: list[str] = []
        self.environment: dict[str, Any] = {}

    # --- inputs
    def add_input(self, path: Path, role: str) -> str | None:
        """Register a file the claims were read from. Returns its id, or None if the file does not exist."""
        path = Path(path)
        if not path.is_file():
            return None
        rel = path.resolve().relative_to(self.root.resolve()).as_posix() if self._inside(path) else path.as_posix()
        for iid, rec in self.inputs.items():
            if rec["path"] == rel:
                return iid
        iid = f"f{len(self.inputs) + 1}"
        st = path.stat()
        self.inputs[iid] = {"path": rel, "role": role, "sha256": sha256_file(path), "bytes": st.st_size,
                            "mtime": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds")}
        return iid

    def _inside(self, path: Path) -> bool:
        try:
            path.resolve().relative_to(self.root.resolve())
            return True
        except ValueError:
            return False

    # --- claims
    def _add(self, claim: dict[str, Any]) -> str:
        if any(c["id"] == claim["id"] for c in self.claims):
            raise ValueError(f"duplicate claim id {claim['id']}")
        self.claims.append(claim)
        return claim["id"]

    def observed(self, cid: str, name: str, value: Any, source_input: str | None, key: str, *, unit: str | None = None,
                 step: str | None = None, first_seen_step: str | None = None, note: str | None = None, tool: str | None = None,
                 depends_on_context: list[str] | None = None) -> str:
        """Observed from a registered input file (source_input), or from a live reading by a named tool (tool=, no file)."""
        if source_input is None and not tool:
            raise ValueError(f"observed claim {cid} needs a source file or a tool")
        if source_input is not None and source_input not in self.inputs:
            raise ValueError(f"observed claim {cid} cites unknown input {source_input}")
        src: dict[str, Any] = {"input": source_input, "key": key} if source_input is not None else {"tool": tool, "key": key}
        if step:
            src["step"] = step
        if first_seen_step:
            src["first_seen_step"] = first_seen_step
        c: dict[str, Any] = {"id": cid, "kind": "observed", "name": name, "value": value, "source": src}
        if unit:
            c["unit"] = unit
        if note:
            c["note"] = note
        if depends_on_context:
            c["depends_on_context"] = depends_on_context  # settings that change what this value means
        return self._add(c)

    def derived(self, cid: str, name: str, value: Any, from_ids: list[str], rule: str, *, note: str | None = None) -> str:
        known = {c["id"] for c in self.claims}
        missing = [i for i in from_ids if i not in known]
        if missing:
            raise ValueError(f"derived claim {cid} cites unknown claims {missing}")
        c: dict[str, Any] = {"id": cid, "kind": "derived", "name": name, "value": value, "from": from_ids, "rule": rule}
        if note:
            c["note"] = note
        return self._add(c)

    def inferred(self, cid: str, name: str, value: Any, basis: str, confidence: str, limitations: list[str]) -> str:
        if confidence not in CONFIDENCE:
            raise ValueError(f"confidence must be one of {CONFIDENCE}")
        return self._add({"id": cid, "kind": "inferred", "name": name, "value": value, "basis": basis,
                          "confidence": confidence, "limitations": limitations})

    def unknown(self, cid: str, name: str, reason: str) -> str:
        return self._add({"id": cid, "kind": "unknown", "name": name, "value": None, "reason": reason})

    def limit(self, text: str) -> None:
        if text not in self.limitations:
            self.limitations.append(text)

    # --- output
    def to_dict(self) -> dict[str, Any]:
        counts = {k: sum(1 for c in self.claims if c["kind"] == k) for k in KINDS}
        return {"schema": SCHEMA, "subject": self.subject, "produced": self.produced, "environment": self.environment,
                "inputs": self.inputs, "context": self.context, "claims": self.claims, "limitations": self.limitations,
                "coverage": counts}


# ----------------------------------------------------------------------------------------------------- validation
def validate(bundle: dict[str, Any], root: Path | None = None) -> list[str]:
    """Problems found in a record (empty = valid). With root, also re-hash the input files: a changed file means the
    claims read from it are stale, which is reported as a problem rather than silently trusted."""
    errs: list[str] = []
    if bundle.get("schema") != SCHEMA:
        errs.append(f"schema is {bundle.get('schema')!r}, expected {SCHEMA}")
    inputs = bundle.get("inputs", {})
    seen: dict[str, str] = {}
    for c in bundle.get("claims", []):
        cid, kind = c.get("id"), c.get("kind")
        if cid in seen:
            errs.append(f"duplicate claim id {cid}")
        seen[cid] = kind
        if kind not in KINDS:
            errs.append(f"{cid}: bad kind {kind!r}")
            continue
        if kind == "observed":
            src = c.get("source", {})
            if src.get("input") is not None:
                if src["input"] not in inputs:
                    errs.append(f"{cid}: observed claim cites input {src['input']} which is not registered")
            elif not src.get("tool"):
                errs.append(f"{cid}: observed claim has neither a registered input file nor a tool")
            if "key" not in src:
                errs.append(f"{cid}: observed claim without a source key")
        elif kind == "derived":
            for f in c.get("from", []):
                if f not in seen:
                    errs.append(f"{cid}: derived from {f}, which is not an earlier claim")
                elif seen[f] == "unknown":
                    errs.append(f"{cid}: derived from unknown claim {f} (a derivation cannot rest on an unknown)")
            if not c.get("rule"):
                errs.append(f"{cid}: derived claim without a rule")
        elif kind == "inferred":
            if c.get("confidence") not in CONFIDENCE:
                errs.append(f"{cid}: inferred claim needs confidence {CONFIDENCE}")
            if not c.get("basis"):
                errs.append(f"{cid}: inferred claim needs a basis")
        elif kind == "unknown":
            if c.get("value") is not None:
                errs.append(f"{cid}: unknown claim must have value null")
            if not c.get("reason"):
                errs.append(f"{cid}: unknown claim needs a reason")
    cov = bundle.get("coverage", {})
    for k in KINDS:
        n = sum(1 for c in bundle.get("claims", []) if c.get("kind") == k)
        if cov.get(k) != n:
            errs.append(f"coverage.{k} is {cov.get(k)} but there are {n} {k} claims")
    if root is not None:
        for iid, rec in inputs.items():
            p = Path(root) / rec["path"]
            if not p.is_file():
                errs.append(f"input {iid} ({rec['path']}) no longer exists")
            elif sha256_file(p) != rec["sha256"]:
                errs.append(f"input {iid} ({rec['path']}) changed since collection: claims read from it are stale")
    return errs


# ------------------------------------------------------------------------------------------------------- comparison
def compare(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    """Compare two records claim by claim.

    equal / changed          both observed (or derived) and the settings the value depends on are the same
    not_like_for_like        both have a value, but a setting the value depends on differs: shown, never read as better/worse
    incomparable             unknown or absent on at least one side (never equal, never a delta)
    """
    lc = {c["name"]: c for c in left["claims"] if c["kind"] in ("observed", "derived", "unknown")}
    rc = {c["name"]: c for c in right["claims"] if c["kind"] in ("observed", "derived", "unknown")}
    lctx, rctx = left.get("context", {}), right.get("context", {})
    ctx_diff = [{"key": k, "left": lctx.get(k), "right": rctx.get(k)} for k in sorted(set(lctx) | set(rctx)) if lctx.get(k) != rctx.get(k)]
    differing = {d["key"] for d in ctx_diff}
    rows = []
    for name in sorted(set(lc) | set(rc)):
        a, b = lc.get(name), rc.get(name)
        row: dict[str, Any] = {"name": name, "left": a["value"] if a else None, "right": b["value"] if b else None,
                               "left_kind": a["kind"] if a else "absent", "right_kind": b["kind"] if b else "absent"}
        if a and b and a["kind"] != "unknown" and b["kind"] != "unknown":
            va, vb = a["value"], b["value"]
            row["status"] = "equal" if va == vb else "changed"
            if isinstance(va, (int, float)) and isinstance(vb, (int, float)) and not isinstance(va, bool) and not isinstance(vb, bool):
                row["delta"] = vb - va
            dep = sorted(set(a.get("depends_on_context", [])) | set(b.get("depends_on_context", [])))
            hit = [k for k in dep if k in differing]
            if hit:
                row["status"] = "not_like_for_like"
                row["why"] = "depends on setting(s) that differ: " + ", ".join(hit)
        else:
            side = [s for s, c in (("left", a), ("right", b)) if c is None or c["kind"] == "unknown"]
            row["status"] = "incomparable"
            row["why"] = "unknown or absent on " + " and ".join(side)
        rows.append(row)
    return {"left": left["subject"].get("id"), "right": right["subject"].get("id"), "rows": rows, "context_differs": ctx_diff,
            "like_for_like": not ctx_diff,
            "summary": {s: sum(1 for r in rows if r["status"] == s) for s in ("equal", "changed", "not_like_for_like", "incomparable")}}


# ------------------------------------------------------------------------------------------------------------- CLI
def _load(p: str) -> dict[str, Any]:
    return json.loads(Path(p).read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):  # Windows consoles default to a legacy code page
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("show")
    s.add_argument("bundle")
    s.add_argument("--kind", choices=KINDS)
    v = sub.add_parser("validate")
    v.add_argument("bundle")
    v.add_argument("--root", help="repository root: also re-hash the input files to detect stale evidence")
    c = sub.add_parser("compare")
    c.add_argument("left")
    c.add_argument("right")
    a = ap.parse_args(argv)
    if a.cmd == "show":
        b = _load(a.bundle)
        print(f"{b['subject'].get('id')}  coverage {b['coverage']}")
        for cl in b["claims"]:
            if a.kind and cl["kind"] != a.kind:
                continue
            extra = cl.get("reason") or cl.get("rule") or cl.get("basis") or cl.get("source", {}).get("key", "")
            print(f"  [{cl['kind']:8}] {cl['name']} = {cl['value']!r}  — {extra}")
        return 0
    if a.cmd == "validate":
        errs = validate(_load(a.bundle), Path(a.root) if a.root else None)
        print("valid" if not errs else "\n".join(errs))
        return 1 if errs else 0
    r = compare(_load(a.left), _load(a.right))
    print(json.dumps(r, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
