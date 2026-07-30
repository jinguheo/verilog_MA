from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List
import json


class VerilogKnowledgeBase:
    """Read-only bridge to existing artifacts; live APIs can be added later.

    This deliberately uses persisted artifacts first, preserving the existing
    late-binding policy between Code KG, Graphify and OpenKB.
    """

    def __init__(self, root: str = r"D:\MyWork\verilog"):
        self.root = Path(root)

    def _read_json(self, path: Path) -> Any:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def search(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        candidates = [self.root / "graphify-out" / "graph.json",
                      self.root / "out" / "embedding_rows.json"]
        result: List[Dict[str, Any]] = []
        q = query.lower()
        for path in candidates:
            data = self._read_json(path)
            if isinstance(data, dict):
                items = data.get("nodes", []) + data.get("records", [])
            elif isinstance(data, list):
                items = data
            else:
                items = []
            for item in items:
                text = json.dumps(item, ensure_ascii=False).lower()
                if q in text:
                    result.append({"source": str(path), "record": item})
                    if len(result) >= limit:
                        return result
        return result

    def module_context(self, module_name: str) -> Dict[str, Any]:
        return {"module_name": module_name, "matches": self.search(module_name),
                "knowledge_root": str(self.root), "retrieval_mode": "persisted-artifacts"}

    def health(self) -> Dict[str, Any]:
        return {"root": str(self.root), "exists": self.root.exists(),
                "graphify_snapshot": (self.root / "graphify-out" / "graph.json").exists(),
                "embedding_rows": (self.root / "out" / "embedding_rows.json").exists(),
                "audit": self.audit()}

    def audit(self) -> Dict[str, Any]:
        """Audit read-only artifacts needed by the RTL-to-GDS verification flow."""
        def files(pattern: str) -> List[Path]:
            return list(self.root.rglob(pattern)) if self.root.exists() else []

        checks = {
            "structure_graph": [self.root / "graphify-out" / "graph.json"],
            "embedding_index": [self.root / "out" / "embedding_rows.json"],
            "rtl_ast": [self.root / "out" / "ast"],
            "dv_testbench": files("*.sv") + files("*.v"),
            "uvm_sources": files("*uvm*") + files("*UVM*"),
            "sva_assertions": files("*.sva") + files("*_bind.sv"),
            "timing_constraints": files("*.sdc"),
            "formal_scripts": files("*.sby") + files("verify.tcl"),
            "commercial_simulator_configs": files("*xcelium*") + files("*questa*"),
            "openlane_config": files("config.json") + files("*openlane*"),
            "sky130_pdk_reference": files("*sky130*"),
        }
        present = {}
        for name, candidates in checks.items():
            unique = {str(path) for path in candidates if path.exists()}
            present[name] = {"present": bool(unique), "count": len(unique),
                             "examples": sorted(unique)[:5]}
        missing = [name for name, item in present.items() if not item["present"]]
        return {"present": present, "missing": missing,
                "read_only": True, "source": str(self.root)}
