R=$(ls -d $HOME/.volare/volare/sky130/versions/*/sky130A)
D=$R/libs.tech/klayout/drc/sky130A_mr.drc
wc -l $D
grep -n "\$[a-zA-Z_]*" $D | head -40
sed -n 1,60p $D | cut -c1-140
