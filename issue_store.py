"""File-based issue persistence and duplicate detection (standard library only)."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Union

DEFAULT_STORE_PATH = Path(".veriolg") / "issues.json"


def fingerprint(issue: Dict[str, Any]) -> str:
    """Stable identity for an issue based on category + finding text, independent of issue_id/run_id."""
    basis = f"{issue.get('category', '')}:{issue.get('finding', '')}".strip().lower()
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()[:16]


class IssueStore:
    """Append-only, fingerprint-deduplicated issue log persisted as JSON."""

    def __init__(self, path: Union[Path, str] = DEFAULT_STORE_PATH):
        self.path = Path(path)

    def _load(self) -> Dict[str, Dict[str, Any]]:
        if not self.path.exists():
            return {}
        try:
            records = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return {r["fingerprint"]: r for r in records}

    def _save(self, records: Dict[str, Dict[str, Any]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps(list(records.values()), ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def record(self, issues: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Persist issues, annotate each with fingerprint/occurrences, and flag repeat findings."""
        records = self._load()
        now = datetime.now(timezone.utc).isoformat()
        annotated: List[Dict[str, Any]] = []
        for issue in issues:
            fp = fingerprint(issue)
            existing = records.get(fp)
            if existing:
                existing["occurrences"] += 1
                existing["last_seen"] = now
                annotated.append({**issue, "fingerprint": fp,
                                   "occurrences": existing["occurrences"],
                                   "duplicate_of": existing["issue_id"]})
            else:
                record = {**issue, "fingerprint": fp, "occurrences": 1,
                          "first_seen": now, "last_seen": now}
                records[fp] = record
                annotated.append(record)
        self._save(records)
        return annotated
