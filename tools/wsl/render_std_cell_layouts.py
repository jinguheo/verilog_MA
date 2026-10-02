# KLayout batch script: render EVERY cell of a standard-cell GDS as its own PNG.
#   klayout -z -rd gds=<gds> -rd lyp=<lyp> -rd out=<dir> -rd prefix=<cell prefix> -r this.py
# Output: <out>/<cell name without prefix>.png. Cells that are not std cells of this
# library (names without the prefix) are skipped. Same hidden-window technique as
# render_gds.py; the view is zoomed per cell (zoom_fit) with a small margin.
import pya
import os

gds_path = gds        # noqa: F821 - injected by -rd
lyp_path = lyp        # noqa: F821
out_dir = out         # noqa: F821
prefix = prefix       # noqa: F821

os.makedirs(out_dir, exist_ok=True)
ly = pya.Layout()
ly.read(gds_path)
dbu = ly.dbu
cells = sorted((c for c in ly.each_cell() if c.name.startswith(prefix)), key=lambda c: c.name)
print("cells with prefix %s: %d" % (prefix, len(cells)))

app = pya.Application.instance()
mw = app.main_window()
mw.load_layout(gds_path, 0)
view = mw.current_view()
if lyp_path and os.path.exists(lyp_path):
    view.load_layer_props(lyp_path)
view.max_hier()
view.set_config("grid-visible", "false")

H = 260
done = 0
for c in cells:
    bb = c.bbox()
    if bb.empty():
        continue
    w_um, h_um = bb.width() * dbu, bb.height() * dbu
    W = int(max(220, min(1600, round(H * w_um / h_um))))
    view.select_cell(c.cell_index(), 0)
    view.zoom_fit()
    short = c.name[len(prefix):]
    view.save_image(os.path.join(out_dir, short + ".png"), W, H)
    done += 1
print("rendered: %d -> %s" % (done, out_dir))
