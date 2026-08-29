# KLayout batch script: render one GDS at three zoom levels.
#
# Variables via -rd: gds, lyp, out, name
#
# Hidden-window mode (-z) renders offscreen; WSLg supplies the display Qt still
# needs. view.zoom_box() takes micrometres, NOT database units - passing DBU
# silently zooms out by 1/dbu and yields a blank image.
import pya
import os

gds_path = gds          # noqa: F821
lyp_path = lyp          # noqa: F821
out_dir = out           # noqa: F821
design = name           # noqa: F821

os.makedirs(out_dir, exist_ok=True)

ly = pya.Layout()
ly.read(gds_path)
top = ly.top_cell()
dbu = ly.dbu
bbox = top.bbox()
w_um = bbox.width() * dbu
h_um = bbox.height() * dbu

print("%s: %.1f x %.1f um, %d cells" % (design, w_um, h_um, ly.cells()))

app = pya.Application.instance()
mw = app.main_window()
mw.load_layout(gds_path, 0)
view = mw.current_view()
if lyp_path and os.path.exists(lyp_path):
    view.load_layer_props(lyp_path)
view.max_hier()

PX = 1600
cx = (bbox.left + bbox.right) * 0.5 * dbu
cy = (bbox.bottom + bbox.top) * 0.5 * dbu


def shot(suffix, half_um):
    if half_um is None:
        view.zoom_fit()
    else:
        view.zoom_box(pya.DBox(cx - half_um, cy - half_um,
                               cx + half_um, cy + half_um))
    p = os.path.join(out_dir, "%s_%s.png" % (design, suffix))
    view.save_image(p, PX, PX)
    print("  wrote %s" % os.path.basename(p))


shot("full", None)     # whole die
shot("mid", 30.0)      # 60 um window - placement rows and routing
shot("detail", 10.0)   # 20 um window - individual cells, vias, metal tracks
