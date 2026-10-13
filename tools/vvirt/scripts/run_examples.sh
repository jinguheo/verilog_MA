#!/usr/bin/env bash
# Run the shipped layout examples 01..14 against vvirt using patched COPIES (originals untouched).
ROOT=/mnt/d/MyWork/Veriolg_MA/tools
SRC=$ROOT/virtuoso-bridge-lite/examples
DST=$ROOT/vvirt/workspace/_ex
rm -rf "$DST"; mkdir -p "$DST/01_virtuoso"
cp "$SRC"/_pdk.py "$SRC"/_timing.py "$SRC"/_target.py "$DST"/
cp -r "$SRC"/01_virtuoso/layout "$DST"/01_virtuoso/
cd "$DST/01_virtuoso/layout" || exit 1
rm -rf __pycache__
# PDK adaptation (tsmc-style names -> sky130A)
sed -i -E 's/"M([1-7])"/"met\1"/g; s/edgeLayer/met3/g; s/"M2_M1"/"M1M2_PR"/g; s/tsmcN28/sky130_fd_sc_hd/g; s/nch_ulvt_mac/sky130_fd_sc_hd__inv_1/g; s/pch_ulvt_mac/sky130_fd_sc_hd__nand2_1/g; s/cfmom_2t/sky130_fd_sc_hd__buf_1/g' *.py
sed -i -E 's/LAYERS = \["met2", "met3", "met4", "met5", "met6", "met7"\]/LAYERS = ["met2", "met3", "met4", "met5"]/' 04_multilayer_routing.py
export PYTHONPATH="$ROOT/vvirt/vendor:$ROOT/virtuoso-bridge-lite/src"
LIB=testlib
CELL=ex_target
run() { n="$1"; shift; echo; echo "################ $n"; timeout 120 python3 "$@" 2>&1 | cut -c1-220 | tail -${TAILN:-12}; echo "[exit ${PIPESTATUS[0]}] $n"; }
run 01 01_create_layout.py $LIB --pdk-lib sky130_fd_sc_hd --pdk-cells sky130_fd_sc_hd__inv_1,sky130_fd_sc_hd__nand2_1,sky130_fd_sc_hd__buf_1
CELL=$(python3 01_create_layout.py $LIB --pdk-lib sky130_fd_sc_hd --pdk-cells sky130_fd_sc_hd__inv_1,sky130_fd_sc_hd__nand2_1,sky130_fd_sc_hd__buf_1 2>&1 | awk '/Target Cell/{print $NF}')
echo "target cell: $CELL"
run 02 02_add_polygon.py
run 03 03_add_via.py
run 04 04_multilayer_routing.py
run 05 05_bus_routing.py
run 06 06_read_layout.py
run 11 11_read_summary.py $LIB $CELL
run 12 12_layer_visibility.py
run 14 14_mosaic_and_nets.py --pdk-lib sky130_fd_sc_hd --pdk-cell sky130_fd_sc_hd__inv_1
TAILN=6 run 07-dry 07_delete_shapes_on_layer.py $LIB $CELL
TAILN=6 run 07-yes 07_delete_shapes_on_layer.py $LIB $CELL --yes
TAILN=8 run 13-dry 13_select_and_delete.py $LIB $CELL
TAILN=8 run 13-yes 13_select_and_delete.py $LIB $CELL --yes
TAILN=6 run 08-dry 08_clear_routing.py $LIB $CELL
TAILN=6 run 08-yes 08_clear_routing.py $LIB $CELL --yes
TAILN=6 run 09-dry 09_clear_current_layout.py $LIB $CELL
TAILN=6 run 09-yes 09_clear_current_layout.py $LIB $CELL --yes
TAILN=6 run 10-dry 10_delete_cell.py $LIB $CELL
TAILN=6 run 10-yes 10_delete_cell.py $LIB $CELL --yes
OUT=$ROOT/vvirt/workspace/_out
TAILN=8 run flower flower.py $LIB
TAILN=12 run 15-xstream 15_export_gds.py --library $LIB --cell flower --stream-map $ROOT/vvirt/profiles/sky130.streammap --output $OUT/flower_xstream.gds --log $OUT/flower_xstream.log --timeout 60
