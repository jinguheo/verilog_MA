import pya
import os

gds_path = gds          # noqa: F821
lyp_path = lyp          # noqa: F821
out_dir = out           # noqa: F821
os.makedirs(out_dir, exist_ok=True)

app = pya.Application.instance()
mw = app.main_window()
mw.load_layout(gds_path, 0)
view = mw.current_view()
if lyp_path and os.path.exists(lyp_path):
    view.load_layer_props(lyp_path)
view.max_hier()

# Comparator block sits on the right-hand side of the die (roughly x=170-224,
# y=75-160 based on the full-die render) - transistor-level view, not the
# capacitor array that dominates the die centre.
view.zoom_box(pya.DBox(160, 70, 224, 165))
view.save_image(os.path.join(out_dir, "adc_comparator_zoom.png"), 2000, 2000)
print("wrote adc_comparator_zoom.png")
