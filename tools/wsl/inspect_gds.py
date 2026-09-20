# KLayout batch script. The input path is injected with:
#   klayout -b -rd gds=/path/to/layout.gds -r inspect_gds.py
import json
import pya


layout = pya.Layout()
layout.read(gds)  # noqa: F821 - injected by KLayout's -rd option
top_cells = layout.top_cells()
if len(top_cells) != 1:
    raise RuntimeError("expected one top cell, found %d" % len(top_cells))

top = top_cells[0]
bbox = top.bbox()
dbu = layout.dbu
report = {
    "top_cell": top.name,
    "dbu_um": dbu,
    "width_um": bbox.width() * dbu,
    "height_um": bbox.height() * dbu,
    "cell_count": layout.cells(),
    "layers_with_geometry": sum(
        1 for index in layout.layer_indices()
        if not top.bbox_per_layer(index).empty()
    ),
}
print(json.dumps(report, indent=2, sort_keys=True))
