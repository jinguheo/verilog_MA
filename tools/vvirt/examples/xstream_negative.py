"""Negative paths of the XStream emulation through the real client.export_gds(): partial stream map, missing cell, empty map."""
import json, os, sys
from pathlib import Path
from virtuoso_bridge import VirtuosoClient
c = VirtuosoClient.from_env()
out = Path("/mnt/d/MyWork/Veriolg_MA/tools/vvirt/workspace/_out/xs_neg"); out.mkdir(parents=True, exist_ok=True)
full = Path("/mnt/d/MyWork/Veriolg_MA/tools/vvirt/profiles/sky130.streammap")
partial = out / "partial.map"
partial.write_text("".join(l for l in full.read_text().splitlines(True) if not l.startswith(("met3 ", "met4 "))))
empty = out / "empty.map"; empty.write_text("# nothing\n")
def run(name, cell, smap):
    r = c.layout.export_gds("testlib", cell, out / f"{name}.gds", stream_map=smap, log_path=out / f"{name}.log", timeout=60)
    print(name, "->", r.status.value, r.reason.value, "warnings:", len(r.warnings), "errors:", r.errors[:1])
    return r
r1 = run("partial_map", "flower", partial)
r2 = run("missing_cell", "no_such_cell", full)
r3 = run("empty_map", "flower", empty)
ok = r1.warnings and r2.errors and r3.errors and not r2.ok and not r3.ok
print("NEGATIVE PATHS OK" if ok else "NEGATIVE PATHS UNEXPECTED")
sys.exit(0 if ok else 1)
