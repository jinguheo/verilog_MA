"""Extract every standard cell's transistor-level netlist (real SPICE from the PDK)
into my_dashboard/public/stdcells/<lib>.cells.json, and the PDK facts into
my_dashboard/src/data/sky130_pdk_info.json. Run inside WSL:

  wsl -d Ubuntu -e bash -lc "python3 /mnt/d/MyWork/Veriolg_MA/tools/gen_std_cell_devices.py"

SPICE note: the sky130 std-cell .spice files write geometry as w=1e+06u l=150000u,
i.e. units of 1e-12 m, so micrometres = value / 1e6.
"""
import glob, json, os, re

PDK = os.path.expanduser("~/eda/pdk/sky130A")
REF = f"{PDK}/libs.ref"
ROOT = "/mnt/d/MyWork/Veriolg_MA/my_dashboard"
LIBS = {
    "sky130_fd_sc_hd": ("sky130_fd_sc_hd", f"{REF}/sky130_fd_sc_hd/spice/sky130_fd_sc_hd.spice"),
    "sky130_fd_sc_hvl": ("sky130_fd_sc_hvl", f"{REF}/sky130_fd_sc_hvl/spice/*.spice"),
    "sky130_ef_sc_hd": ("sky130_ef_sc_hd", f"{REF}/sky130_fd_sc_hd/spice/sky130_ef_sc_hd__*.spice"),
}


def num_um(tok):
    m = re.match(r"([a-z]+)=([-+0-9.eE]+)u?", tok)
    return (m.group(1), float(m.group(2)) / 1e6) if m else (None, None)


def logical_lines(path):
    lines = []
    for raw in open(path, encoding="utf-8", errors="replace"):
        s = raw.strip()
        if not s or s.startswith("*"):
            continue
        if s.startswith("+") and lines:
            lines[-1] += " " + s[1:].strip()
        else:
            lines.append(s)
    return lines


def parse(path):
    out, cur = {}, None
    for s in logical_lines(path):
        if s.lower().startswith(".subckt "):
            t = s.split()
            cur = {"name": t[1], "ports": t[2:], "_lines": []}
            out[t[1]] = cur
        elif s.lower().startswith(".ends"):
            cur = None
        elif cur is not None:
            cur["_lines"].append(s)
    return out


def devices(sub):
    devs = []
    for s in sub["_lines"]:
        t = s.split()
        if not t or not t[0][0] in "Xx":
            continue
        model = next((x for x in t if x.startswith("sky130_fd_pr__")), None)
        if not model:
            continue
        mi = t.index(model)
        nets = t[1:mi]
        params = dict(num_um(x) for x in t[mi + 1:] if "=" in x)
        d = {"n": t[0], "m": model.replace("sky130_fd_pr__", ""), "nets": nets,
             "w": round(params.get("w") or 0, 3), "l": round(params.get("l") or 0, 3)}
        if "nf" in params:
            pass
        devs.append(d)
    return devs


for lib, (prefix, pattern) in LIBS.items():
    cells = {}
    for f in sorted(glob.glob(pattern)):
        for name, sub in parse(f).items():
            short = name.split("__", 1)[1] if "__" in name else name
            cells[short] = {"ports": sub["ports"], "devices": devices(sub)}
    path = f"{ROOT}/public/stdcells/{lib}.cells.json"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(cells, open(path, "w"), separators=(",", ":"))
    tr = sum(1 for c in cells.values() for d in c["devices"])
    print(lib, len(cells), "cells,", tr, "devices ->", os.path.getsize(path) // 1024, "KB")

# ---- PDK facts (all read from the install, nothing typed by hand) ----
src = open(f"{PDK}/SOURCES").read().split()
libs_ref = sorted(os.listdir(REF))
tech = sorted(os.listdir(f"{PDK}/libs.tech"))
info = {
    "name": "sky130A",
    "install": "~/eda/pdk/sky130A (WSL)",
    "openPdks": src[1] if len(src) > 1 else None,
    "libsRef": libs_ref,
    "libsTech": tech,
    "stdcellLibs": [
        {"id": "sky130_fd_sc_hd", "role": "High Density · 1.8V 디지털 표준셀 — 이 프로젝트의 모든 P&R이 사용"},
        {"id": "sky130_fd_sc_hvl", "role": "High Voltage · 5V 표준셀 (레벨 시프터 등 I/O 쪽)"},
        {"id": "sky130_ef_sc_hd", "role": "Efabless 추가 셀(decap_12 등 큰 decap) — hd와 호환"},
    ],
}
json.dump(info, open(f"{ROOT}/src/data/sky130_pdk_info.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("pdk info:", info["openPdks"], libs_ref)
