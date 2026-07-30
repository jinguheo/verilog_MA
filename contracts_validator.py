"""Lightweight JSON Schema subset validator (standard library only).

This project keeps a "phase 1 uses only the standard library" policy, so this
module does not depend on the `jsonschema` package. It supports only the
subset of JSON Schema actually used under `contracts/`: object `type` and
`required`, `properties`, `enum`, string `minLength`/`pattern`, and array
`items`. It is not a general-purpose JSON Schema implementation.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List

CONTRACTS_DIR = Path(__file__).parent / "contracts"

_TYPE_MAP = {
    "string": str,
    "array": list,
    "object": dict,
    "number": (int, float),
    "integer": int,
    "boolean": bool,
}


def load_schema(name: str) -> Dict[str, Any]:
    return json.loads((CONTRACTS_DIR / name).read_text(encoding="utf-8"))


def validate(schema: Dict[str, Any], instance: Any, path: str = "$") -> List[str]:
    """Return human-readable violations; an empty list means the instance is valid."""
    errors: List[str] = []
    expected_type = schema.get("type")
    if expected_type and expected_type in _TYPE_MAP:
        if not isinstance(instance, _TYPE_MAP[expected_type]):
            errors.append(f"{path}: expected type '{expected_type}', got '{type(instance).__name__}'")
            return errors

    if "enum" in schema and instance not in schema["enum"]:
        errors.append(f"{path}: value '{instance}' not in enum {schema['enum']}")

    if expected_type == "string":
        if "minLength" in schema and len(instance) < schema["minLength"]:
            errors.append(f"{path}: length {len(instance)} is below minLength {schema['minLength']}")
        if "pattern" in schema and not re.match(schema["pattern"], instance):
            errors.append(f"{path}: '{instance}' does not match pattern '{schema['pattern']}'")

    if expected_type == "object":
        for field in schema.get("required", []):
            if field not in instance:
                errors.append(f"{path}: missing required field '{field}'")
        for field, sub_schema in schema.get("properties", {}).items():
            if field in instance:
                errors.extend(validate(sub_schema, instance[field], f"{path}.{field}"))

    if expected_type == "array" and "items" in schema:
        for i, item in enumerate(instance):
            errors.extend(validate(schema["items"], item, f"{path}[{i}]"))

    return errors


def is_valid(schema: Dict[str, Any], instance: Any) -> bool:
    return not validate(schema, instance)
