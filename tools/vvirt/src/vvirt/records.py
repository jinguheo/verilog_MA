"""Named-field results for vv* SKILL functions.

SKILL has no maps, so a record is an association list: (("name" "inv_1") ("width" 1.38) ...). It reads the same in the
reply an agent sees and in code: vvGet(rec "width"), or assoc("width" rec). Positional lists such as (name w h pins) force a
reader to remember the order; they remain available per call with ?positional t for older scripts.
"""
from __future__ import annotations

from typing import Any


def rec(*pairs: tuple[str, Any]) -> list:
    """Ordered record: [[key, value], ...]; None values are kept so absence is visible, not silently dropped."""
    return [[k, v] for k, v in pairs]


def get(record: Any, *path: Any) -> Any:
    """Value at a key path in a record (or list index for integers). nil when a key is missing."""
    cur = record
    for key in path:
        if cur is None:
            return None
        if isinstance(key, int) and not isinstance(key, bool):
            cur = cur[key] if isinstance(cur, list) and 0 <= key < len(cur) else None
            continue
        found = None
        if isinstance(cur, list):
            for item in cur:
                if isinstance(item, list) and len(item) == 2 and item[0] == key:
                    found = item[1]
                    break
        cur = found
    return cur


def keys(record: Any) -> list | None:
    return [item[0] for item in record if isinstance(item, list) and len(item) == 2 and isinstance(item[0], str)] or None if isinstance(record, list) else None
