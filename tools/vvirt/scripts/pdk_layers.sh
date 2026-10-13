#!/usr/bin/env bash
R=$(ls -d "$HOME"/.volare/volare/sky130/versions/*/sky130A | head -1)
echo "PDK: $R"
ls -la "$R/libs.ref/sky130_fd_sc_hd/gds" "$R/libs.ref/sky130_fd_sc_hd/lef" "$R/libs.ref/sky130_fd_sc_hd/spice" | head -20
echo "--- klayout tech"
ls "$R/libs.tech/klayout" "$R/libs.tech/klayout/tech" 2>/dev/null | head -20
echo "--- layer map files"
find "$R/libs.tech" -maxdepth 3 \( -name '*.lyp' -o -name '*.map' -o -name 'layers*' -o -name '*.lyt' -o -name '*gds*map*' \) 2>/dev/null | head -20
echo "--- LEF header"
head -c 700 "$R/libs.ref/sky130_fd_sc_hd/lef/sky130_fd_sc_hd.lef"
echo
echo "--- LEF sample macro (inv_1)"
awk '/MACRO sky130_fd_sc_hd__inv_1$/,/END sky130_fd_sc_hd__inv_1$/' "$R/libs.ref/sky130_fd_sc_hd/lef/sky130_fd_sc_hd.lef" | head -60
echo "--- macro count"
grep -c '^MACRO ' "$R/libs.ref/sky130_fd_sc_hd/lef/sky130_fd_sc_hd.lef"
