#!/usr/bin/env bash
R=$(ls -d "$HOME"/.volare/volare/sky130/versions/*/sky130A | head -1)
L="$R/libs.tech/klayout/tech/sky130A.lyp"
python3 - "$L" <<'PY'
import re, sys
txt = open(sys.argv[1], encoding="utf-8").read()
pairs = re.findall(r"<name>([^<]*)</name>.*?<source>([^<]*)</source>", txt, re.S)
want = {"nwell","pwell","dnwell","diff","tap","poly","licon1","li1","mcon","met1","via","met2","via2","met3","via3","met4","via4","met5","pad","npc","nsdm","psdm","areaid","hvtp","lvtn","hvi","text","boundary","prBoundary"}
seen = set()
for name, src in pairs:
    base = name.split(" ")[0]
    root = base.split(".")[0]
    if root in want and (name, src) not in seen:
        seen.add((name, src))
        print(f"{name:28s} {src}")
PY
