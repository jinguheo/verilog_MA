# Render a placement-only screenshot (no routing needed) from a post-detailed-
# placement ODB. Reads ODB_PATH/OUT_PNG/DIE_W/DIE_H (microns) from the
# environment - see 114_render_chan_top_reshapes.sh.
read_db $::env(ODB_PATH)
gui::save_image $::env(OUT_PNG) 0 0 $::env(DIE_W) $::env(DIE_H)
puts "wrote $::env(OUT_PNG)"
