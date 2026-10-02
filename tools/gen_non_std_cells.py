"""Collect everything that is NOT a standard cell, from real files:
  - PDK side: I/O pad cells, SRAM macros (LEF MACRO name + SIZE), devices (sky130_fd_pr)
  - project side: which of our blocks contain non-standard cells in their latest synthesis
    stat.json, where each macro's LEF/GDS comes from (config MACROS), its size, and the
    hierarchical case where a hardened block (chan_top) is placed as a macro.
Writes my_dashboard/src/data/non_std_cells.json. Run inside WSL:

  wsl -d Ubuntu -e bash -lc "python3 /mnt/d/MyWork/Veriolg_MA/tools/gen_non_std_cells.py"
"""
import glob, json, os, re

ROOT = "/mnt/d/MyWork/Veriolg_MA"
ASIC = f"{ROOT}/samples/sample_test_4/asic"
REF = os.path.expanduser("~/eda/pdk/sky130A/libs.ref")
OUT = f"{ROOT}/my_dashboard/src/data/non_std_cells.json"
STD = "sky130_fd_sc_"


def lef_macros(path):
    out, cur = [], None
    for line in open(path, encoding="utf-8", errors="replace"):
        s = line.strip()
        if s.startswith("MACRO "):
            cur = {"name": s.split()[1]}
            out.append(cur)
        elif cur is not None and s.startswith("SIZE "):
            m = re.match(r"SIZE\s+([\d.]+)\s+BY\s+([\d.]+)", s)
            if m:
                cur["w"], cur["h"] = float(m.group(1)), float(m.group(2))
    return out


def resolve(base, p):
    p = p.replace("dir::", "")
    return os.path.normpath(os.path.join(base, p))


# ---- PDK side ----
pdk = []
io = [m for f in glob.glob(f"{REF}/sky130_fd_io/lef/*.lef") for m in lef_macros(f)]
kinds = {"전원 패드(vccd/vdda/vddio/vss…)": 0, "아날로그 패드": 0, "GPIO 패드": 0, "코너/버스 슬라이스/기타": 0}
for m in io:
    n = m["name"]
    if re.search(r"(vcc|vdd|vss).*pad|top_power", n):
        kinds["전원 패드(vccd/vdda/vddio/vss…)"] += 1
    elif "analog" in n or "bare_pad" in n:
        kinds["아날로그 패드"] += 1
    elif "gpio" in n:
        kinds["GPIO 패드"] += 1
    else:
        kinds["코너/버스 슬라이스/기타"] += 1
pdk.append({"lib": "sky130_fd_io", "kind": "I/O 패드", "count": len(io), "breakdown": kinds,
            "why": "칩 외부 핀과 연결, 정전기(ESD) 보호·높은 전압(3.3V/5V) 구동 때문에 표준셀과 전혀 다른 전용 셀",
            "examples": [m["name"] for m in io if "gpiov2_pad" in m["name"] or "corner" in m["name"]][:4]})
sram = [m for f in glob.glob(f"{REF}/sky130_sram_macros/lef/*.lef") for m in lef_macros(f)]
pdk.append({"lib": "sky130_sram_macros", "kind": "SRAM 매크로", "count": len(sram),
            "why": "비트셀 배열이라 표준셀(플립플롭)로 만들면 면적이 수십 배 — 전용 레이아웃으로 만든 별도 매크로",
            "macros": [{"name": m["name"], "w": m.get("w"), "h": m.get("h")} for m in sram]})
n_pr = sum(len(lef_macros(f)) for f in glob.glob(f"{REF}/sky130_fd_pr/lef/*.lef"))
pdk.append({"lib": "sky130_fd_pr", "kind": "개별 소자 PCell", "count": n_pr,
            "why": "트랜지스터·저항·커패시터·다이오드 하나하나의 파라메트릭 셀 — 표준셀 내부와 아날로그 직접 설계의 재료"})

# ---- project side ----
blocks = {}
for f in glob.glob(f"{ASIC}/*/runs/RUN_*/*yosys-synthesis/reports/stat.json"):
    blk = f.split("/runs/")[0]
    blocks.setdefault(blk, []).append(f)
proj = []
for blk, fs in sorted(blocks.items()):
    f = sorted(fs, key=lambda p: p.split("/runs/")[1])[-1]
    d = json.load(open(f))["design"]
    by = d["num_cells_by_type"]
    std = sum(v for k, v in by.items() if STD in k)
    non = {k: v for k, v in by.items() if STD not in k}
    row = {"block": os.path.basename(blk), "run": f.split("/runs/")[1].split("/")[0], "totalCells": d["num_cells"], "stdCells": std, "nonStd": []}
    cfgp = f"{blk}/config.json"
    macros = json.load(open(cfgp)).get("MACROS", {}) if os.path.exists(cfgp) else {}
    for name, cnt in non.items():
        e = {"cell": name, "count": cnt, "w": None, "h": None, "lef": None}
        mc = macros.get(name)
        if mc and mc.get("lef"):
            lp = resolve(blk, mc["lef"][0])
            e["lef"] = os.path.relpath(lp, ROOT).replace("\\", "/")
            if os.path.exists(lp):
                ms = [m for m in lef_macros(lp) if m["name"] == name] or lef_macros(lp)[:1]
                if ms:
                    e["w"], e["h"] = ms[0].get("w"), ms[0].get("h")
        row["nonStd"].append(e)
    proj.append(row)

# hardened sub-block placed as a macro (hierarchical daq_subsystem)
hier = None
hp = f"{ASIC}/daq_subsystem/config_hierarchical.json"
if os.path.exists(hp):
    h = json.load(open(hp))
    for name, mc in h.get("MACROS", {}).items():
        lp = resolve(os.path.dirname(hp), mc["lef"][0])
        ms = [m for m in lef_macros(lp) if m["name"] == name] if os.path.exists(lp) else []
        hier = {"macro": name, "instances": len(mc.get("instances", {})), "w": ms[0].get("w") if ms else None,
                "h": ms[0].get("h") if ms else None, "lef": os.path.relpath(lp, ROOT).replace("\\", "/")}

json.dump({"pdk": pdk, "project": proj, "hierarchical": hier}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(json.dumps({"pdk": [(p["lib"], p["count"]) for p in pdk], "project": [(p["block"], p["nonStd"]) for p in proj if p["nonStd"]], "hier": hier}, ensure_ascii=False, indent=1))
