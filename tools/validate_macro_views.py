from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


LEF_PIN_RE = re.compile(r"^\s*PIN\s+(\S+)", re.MULTILINE)
SPICE_SUBCKT_RE = re.compile(
    r"^\.subckt\s+(\S+)\s+(.+?)(?=^\S|\Z)",
    re.MULTILINE | re.DOTALL | re.IGNORECASE,
)
VERILOG_MODULE_RE = re.compile(r"\bmodule\s+(\w+)\s*\((.*?)\)\s*;", re.DOTALL)
VERILOG_DECL_RE = re.compile(
    r"\b(?:input|output|inout)\s+(?:wire\s+)?"
    r"(?:\[(\d+)\s*:\s*(\d+)\]\s*)?([A-Za-z_]\w*)"
)


def lef_pins(path: Path) -> set[str]:
    return set(LEF_PIN_RE.findall(path.read_text(encoding="utf-8")))


def verilog_pins(path: Path, module: str) -> set[str]:
    text = re.sub(
        r"//.*?$|/\*.*?\*/",
        "",
        path.read_text(encoding="utf-8"),
        flags=re.MULTILINE | re.DOTALL,
    )
    match = VERILOG_MODULE_RE.search(text)
    if not match or match.group(1) != module:
        raise ValueError(f"module {module!r} not found in {path}")
    pins: set[str] = set()
    for msb, lsb, name in VERILOG_DECL_RE.findall(match.group(2)):
        if msb:
            lo, hi = sorted((int(msb), int(lsb)))
            pins.update(f"{name}[{index}]" for index in range(lo, hi + 1))
        else:
            pins.add(name)
    return pins


def spice_pins(path: Path, module: str) -> set[str]:
    text = path.read_text(encoding="utf-8", errors="replace")
    logical_lines = re.sub(r"\n\+", " ", text)
    for match in SPICE_SUBCKT_RE.finditer(logical_lines):
        if match.group(1).lower() == module.lower():
            return set(match.group(2).split())
    raise ValueError(f".subckt {module!r} not found in {path}")


def compare_views(name: str, lef: Path, verilog: Path, spice: Path) -> dict:
    views = {
        "lef": lef_pins(lef),
        "verilog": verilog_pins(verilog, name),
        "spice": spice_pins(spice, name),
    }
    expected = views["lef"]
    mismatches = {
        view: {
            "missing": sorted(expected - pins),
            "extra": sorted(pins - expected),
        }
        for view, pins in views.items()
        if pins != expected
    }
    return {
        "macro": name,
        "pin_count": len(expected),
        "pins": sorted(expected),
        "valid": not mismatches,
        "mismatches": mismatches,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate hard-macro pin contracts across P&R views."
    )
    parser.add_argument("--name", required=True)
    parser.add_argument("--lef", type=Path, required=True)
    parser.add_argument("--verilog", type=Path, required=True)
    parser.add_argument("--spice", type=Path, required=True)
    parser.add_argument("--gds", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    report = compare_views(args.name, args.lef, args.verilog, args.spice)
    if args.gds:
        report["gds"] = {
            "path": str(args.gds),
            "bytes": args.gds.stat().st_size if args.gds.exists() else 0,
        }
        if report["gds"]["bytes"] == 0:
            report["valid"] = False
            report["mismatches"]["gds"] = {
                "missing": ["non-empty GDS"],
                "extra": [],
            }
    rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0 if report["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
