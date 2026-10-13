R=$(ls -d $HOME/.volare/volare/sky130/versions/*/sky130A)
ls $R/libs.tech/klayout/drc 2>/dev/null | head; ls $R/libs.tech/klayout 2>/dev/null | head -20
find $R/libs.tech -iname "*drc*" 2>/dev/null | head
python3 -c "import klayout.db as d; print('pip klayout', d.__file__)" 2>&1 | tail -1
klayout -v 2>&1 | head -2
