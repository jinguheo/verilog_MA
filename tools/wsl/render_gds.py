# KLayout batch script: report what is in a GDS and render it at several zoom
# levels.
#
# Driven by 62_render_layout.sh. Variables arrive via -rd:
#   gds  input GDS path
#   lyp  sky130 layer properties file (colours), may be empty
#   out  output directory
#
# Rendering uses KLayout's hidden-window mode (-z): Qt renders offscreen, no
# window appears. WSLg supplies the display it still needs.
#
# Note on units: view.zoom_box() takes a DBox in micrometres, NOT a Box in
# database units. Passing DBU values here silently zooms out by 1/dbu (1000x
# for sky130) and produces a blank image.
import pya
import os

gds_path = gds          # noqa: F821 - injected by -rd
lyp_path = lyp          # noqa: F821
out_dir = out           # noqa: F821

os.makedirs(out_dir, exist_ok=True)

# ---- contents ------------------------------------------------------------
ly = pya.Layout()
ly.read(gds_path)
top = ly.top_cell()
dbu = ly.dbu
bbox = top.bbox()

w_um = bbox.width() * dbu
h_um = bbox.height() * dbu
print("top cell     : %s" % top.name)
print("database unit: %g um" % dbu)
print("size         : %.2f x %.2f um" % (w_um, h_um))
print("area         : %.1f um^2" % (w_um * h_um))
print("cells        : %d" % ly.cells())

used = [ly.get_info(li).to_s() for li in ly.layer_indices()
        if not top.bbox_per_layer(li).empty()]
print("layers with geometry: %d" % len(used))

# ---- render --------------------------------------------------------------
app = pya.Application.instance()
mw = app.main_window()
mw.load_layout(gds_path, 0)
view = mw.current_view()

if lyp_path and os.path.exists(lyp_path):
    view.load_layer_props(lyp_path)
    print("layer properties: %s" % lyp_path)
else:
    print("layer properties: (none - default colours)")

view.max_hier()

PX = 2000
# Centre of the die, in micrometres.
cx = (bbox.left + bbox.right) * 0.5 * dbu
cy = (bbox.bottom + bbox.top) * 0.5 * dbu


def shot(name, half_um, label):
    """Render a square window of +/- half_um around the die centre."""
    if half_um is None:
        view.zoom_fit()
        span = "full die %.0f x %.0f um" % (w_um, h_um)
    else:
        view.zoom_box(pya.DBox(cx - half_um, cy - half_um,
                               cx + half_um, cy + half_um))
        span = "%.0f x %.0f um window" % (half_um * 2, half_um * 2)
    path = os.path.join(out_dir, name)
    view.save_image(path, PX, PX)
    print("wrote %-28s  %-28s  (%s)" % (os.path.basename(path), span, label))


# Full die, then progressively tighter windows. At ~3% utilisation the die is
# mostly fill cells, so the tight windows are what actually show placement rows
# and routing.
shot("chan_ctrl_full.png",   None, "whole chip")
shot("chan_ctrl_mid.png",    30.0, "placement rows and routing")
shot("chan_ctrl_detail.png", 10.0, "individual cells, vias, metal tracks")

print("done")
