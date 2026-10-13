"""Export the newest testlib layout through the bridge (SVG + GDS) and print its summary."""
import sys
from virtuoso_bridge import VirtuosoClient

lib = sys.argv[1] if len(sys.argv) > 1 else "testlib"
cell = sys.argv[2]
out = "/mnt/d/MyWork/Veriolg_MA/tools/vvirt/workspace/_out"
c = VirtuosoClient.from_env()
print(c.execute_skill(f'vvExportSvg("{lib}" "{cell}" "{out}/{cell}.svg")').output)
print(c.execute_skill(f'vvExportGds("{lib}" "{cell}" "{out}/{cell}.gds")').output)
print(c.layout.read_summary(lib, cell) if hasattr(c.layout, "read_summary") else "")
