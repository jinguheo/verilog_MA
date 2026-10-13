R=$(ls -d $HOME/.volare/volare/sky130/versions/*/sky130A)
ls $R/libs.ref/sky130_fd_sc_hd/techlef/
T=$R/libs.ref/sky130_fd_sc_hd/techlef/sky130_fd_sc_hd__nom.tlef
wc -l $T
awk '/^LAYER (li1|met1|met2|met5|mcon|via|via2|poly|nwell)$/,/^END (li1|met1|met2|met5|mcon|via|via2|poly|nwell)$/' $T | grep -v "^ *$" | head -150
grep -c "^VIA " $T; grep -n "^VIA \|^VIARULE" $T | head -20
