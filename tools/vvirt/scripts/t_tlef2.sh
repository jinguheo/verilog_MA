R=$(ls -d $HOME/.volare/volare/sky130/versions/*/sky130A)
T=$R/libs.ref/sky130_fd_sc_hd/techlef/sky130_fd_sc_hd__nom.tlef
sed -n 301,320p $T
grep -n "^LAYER\|DIRECTION\|PITCH" $T | grep -v "^.*CAPAC" | head -60
awk '/^LAYER (met3|met4|via3|via4)$/,/^END (met3|met4|via3|via4)$/' $T | grep -E "LAYER|WIDTH|SPACING|ENCLOSURE|AREA|DIRECTION|PITCH" 
