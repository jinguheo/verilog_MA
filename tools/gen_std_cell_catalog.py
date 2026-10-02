"""Generate my_dashboard/src/data/sky130_std_cells.json from the real sky130A PDK
(LEF = cell list + size, liberty = which cells have timing) plus chan_top's
post-synthesis cell usage. Run inside WSL:

  wsl -d Ubuntu -e bash -lc "python3 /mnt/d/MyWork/Veriolg_MA/tools/gen_std_cell_catalog.py"
"""
import json, os, re, glob

PDK = os.path.expanduser("~/eda/pdk/sky130A/libs.ref")
ROOT = "/mnt/d/MyWork/Veriolg_MA"
OUT = f"{ROOT}/my_dashboard/src/data/sky130_std_cells.json"
STAT = f"{ROOT}/samples/sample_test_4/asic/chan_top/runs/RUN_2026-09-23_12-48-47/06-yosys-synthesis/reports/stat.json"

LIBS = [
    ("sky130_fd_sc_hd", "sky130_fd_sc_hd", "High Density · 1.8V", "lib/sky130_fd_sc_hd__tt_025C_1v80.lib"),
    ("sky130_fd_sc_hvl", "sky130_fd_sc_hvl", "High Voltage · 5V I/O", None),
    ("sky130_ef_sc_hd", "sky130_fd_sc_hd", "Efabless extra (hd 호환)", None),
]


def category(base):
    if base.startswith("lpflow_"):
        return "low-power"
    if re.match(r"(tap|tapvgnd|tapvgnd2|tapvpwrvgnd|fill|decap|diode|conb|probe|probec|macro_sparecell|lsbuf)", base):
        return "physical"
    if re.match(r"(buf|inv|bufbuf|bufinv|clkbuf|clkinv|clkdlybuf|dlygate|dlymetal|einv|ebuf)", base):
        return "buffer"
    if re.match(r"(df|dl|sdf|edf|sedf|sdl)", base):
        return "sequential"
    if re.match(r"(mux|ha|fa|fah|maj)", base):
        return "mux-adder"
    return "logic"


def parse_lef(path, prefix):
    cells, cur = {}, None
    height = None
    for line in open(path, encoding="utf-8", errors="replace"):
        s = line.strip()
        if s.startswith("MACRO "):
            cur = s.split()[1]
        elif cur and s.startswith("SIZE "):
            m = re.match(r"SIZE\s+([\d.]+)\s+BY\s+([\d.]+)", s)
            if m:
                w, h = float(m.group(1)), float(m.group(2))
                cells[cur] = (w, h)
                height = height or h
            cur = None
    return {k[len(prefix) + 2:] if k.startswith(prefix + "__") else k: v for k, v in cells.items()}, height


def liberty_cells(path):
    out = set()
    for line in open(path, encoding="utf-8", errors="replace"):
        m = re.match(r'\s*cell \("?[a-z0-9_]+__([a-z0-9_]+)"?\)', line)
        if m:
            out.add(m.group(1))
    return out


libs = []
for lib_id, prefix, label, lib_rel in LIBS:
    lef = glob.glob(f"{PDK}/{prefix}/lef/{lib_id}.lef")[0]
    cells, height = parse_lef(lef, prefix if lib_id != "sky130_ef_sc_hd" else "sky130_ef_sc_hd")
    # ef cells are named sky130_ef_sc_hd__*, parse again with its own prefix
    if lib_id == "sky130_ef_sc_hd":
        cells, height = parse_lef(lef, "sky130_ef_sc_hd")
    lib_set = None
    if lib_rel:
        lib_set = liberty_cells(f"{PDK}/{prefix}/{lib_rel}")
    groups = {}
    for name, (w, h) in cells.items():
        m = re.match(r"(.+)_(\d+)$", name)
        base, drive = (m.group(1), int(m.group(2))) if m else (name, 0)
        g = groups.setdefault(base, {"base": base, "category": category(base), "variants": []})
        g["variants"].append({"drive": drive, "w": round(w, 2), "area": round(w * h, 2), "timing": (name in lib_set) if lib_set is not None else None})
    fn = sorted(groups.values(), key=lambda g: g["base"])
    for g in fn:
        g["variants"].sort(key=lambda v: v["drive"])
    libs.append({
        "id": lib_id, "label": label, "lefCells": len(cells), "libertyCells": len(lib_set) if lib_set is not None else None,
        "functions": len(fn), "rowHeight": height,
        "noTiming": sorted(n for n in cells if lib_set is not None and n not in lib_set),
        "groups": fn,
    })

usage = None
if os.path.exists(STAT):
    d = json.load(open(STAT))["design"]
    by = d["num_cells_by_type"]
    rows = []
    for k, v in by.items():
        if k.startswith("sky130_fd_sc_hd__"):
            rows.append({"cell": k[len("sky130_fd_sc_hd__"):], "count": v})
    rows.sort(key=lambda r: -r["count"])
    usage = {"design": "chan_top", "source": "RUN_2026-09-23_12-48-47/06-yosys-synthesis/reports/stat.json (합성 직후, P&R 전)",
             "totalCells": d["num_cells"], "area": d["area"], "distinctTypes": len(rows), "rows": rows}

os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump({"generatedFrom": "~/eda/pdk/sky130A/libs.ref (LEF size + tt_025C_1v80 liberty)", "libs": libs, "usage": usage},
          open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
for l in libs:
    print(l["id"], "LEF", l["lefCells"], "liberty", l["libertyCells"], "functions", l["functions"], "rowH", l["rowHeight"])
print("usage", usage and (usage["totalCells"], usage["distinctTypes"]))
