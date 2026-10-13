#!/usr/bin/env bash
R=$(ls -d "$HOME"/.volare/volare/sky130/versions/*/sky130A | head -1)
M="$R/libs.tech/klayout/tech/sky130A.map"
wc -l "$M"
grep -v '^#' "$M" | grep -E '^(nwell|pwell|dnwell|diff|tap|poly|licon1|li1|mcon|met1|via|met2|via2|met3|via3|met4|via4|met5|pad|npc|nsdm|psdm|areaid|text|boundary|prBoundary|hvtp|lvtn|hvi|rpm|urpm)[. ]' | awk '{print $1, $2, $3, $4}' | head -90
