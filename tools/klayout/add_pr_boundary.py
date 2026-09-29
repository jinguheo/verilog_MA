"""Add a SKY130 prBoundary rectangle to an existing hard-macro GDS.

Run with KLayout batch mode and pass INPUT_GDS, OUTPUT_GDS, WIDTH_UM and
HEIGHT_UM using -rd. The source GDS is left untouched.
"""

import pya


def required(name):
    value = globals().get(name)
    if value is None or str(value) == "":
        raise RuntimeError(f"missing -rd {name}=...")
    return str(value)


input_gds = required("INPUT_GDS")
output_gds = required("OUTPUT_GDS")
width_um = float(required("WIDTH_UM"))
height_um = float(required("HEIGHT_UM"))

layout = pya.Layout()
layout.read(input_gds)
top_cells = layout.top_cells()
if len(top_cells) != 1:
    raise RuntimeError(f"expected one top cell, found {len(top_cells)}")

top = top_cells[0]
layer_index = layout.layer(pya.LayerInfo(235, 4))
scale = 1.0 / layout.dbu
boundary = pya.Box(0, 0, round(width_um * scale), round(height_um * scale))
top.shapes(layer_index).insert(boundary)
layout.write(output_gds)

print(
    f"added prBoundary 235/4 to {top.name}: "
    f"0,0..{width_um:.3f},{height_um:.3f} um -> {output_gds}"
)
