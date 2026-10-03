"""Add per-cell facts to my_dashboard/public/stdcells/<lib>.cells.json (run AFTER
gen_std_cell_devices.py): liberty -> area / pins / boolean function / pin capacitance,
LEF -> size / site / pin rectangles (position inside the cell), techlef -> site & routing
layer pitches (written to src/data/sky130_pdk_info.json).

  wsl -d Ubuntu -e bash -lc "python3 /mnt/d/MyWork/Veriolg_MA/tools/gen_std_cell_info.py"
"""
import glob, json, os, re

PDK = os.path.expanduser("~/eda/pdk/sky130A")
REF = f"{PDK}/libs.ref"
ROOT = "/mnt/d/MyWork/Veriolg_MA/my_dashboard"
LIBS = {
    "sky130_fd_sc_hd": ("sky130_fd_sc_hd", f"{REF}/sky130_fd_sc_hd/lib/sky130_fd_sc_hd__tt_025C_1v80.lib", f"{REF}/sky130_fd_sc_hd/lef/sky130_fd_sc_hd.lef"),
    "sky130_fd_sc_hvl": ("sky130_fd_sc_hvl", None, f"{REF}/sky130_fd_sc_hvl/lef/sky130_fd_sc_hvl.lef"),
    "sky130_ef_sc_hd": ("sky130_ef_sc_hd", None, f"{REF}/sky130_fd_sc_hd/lef/sky130_ef_sc_hd.lef"),
}
# hvl splits its cells over two liberty files: the 3.3V gate/flop set (57 cells) and the
# level-shifter set that also needs the 1.8V rail (8 cells); the rest are physical-only.
hvl_files = [f"{REF}/sky130_fd_sc_hvl/lib/sky130_fd_sc_hvl__tt_025C_3v30.lib", f"{REF}/sky130_fd_sc_hvl/lib/sky130_fd_sc_hvl__tt_025C_3v30_lv1v80.lib"]
LIBS["sky130_fd_sc_hvl"] = ("sky130_fd_sc_hvl", hvl_files, LIBS["sky130_fd_sc_hvl"][2])


def parse_liberty(path):
    cells, cur, pin = {}, None, None
    depth = 0
    cell_depth = pin_depth = None
    pat_cell = re.compile(r'^\s*cell \("?([^")]+)"?\)\s*\{')
    pat_pin = re.compile(r'^\s*pin \("?([^")]+)"?\)\s*\{')
    pat_pg = re.compile(r'^\s*pg_pin \("?([^")]+)"?\)\s*\{')
    pat_attr = re.compile(r'^\s*([a-z_]+)\s*:\s*(.+?)\s*;')
    for line in open(path, encoding="utf-8", errors="replace"):
        opens, closes = line.count("{"), line.count("}")
        m = pat_cell.match(line)
        if m:
            name = m.group(1)
            short = name.split("__", 1)[1] if "__" in name else name
            cur = cells.setdefault(short, {"pins": {}, "pg": []})
            cell_depth = depth + 1
            pin = None
        elif cur is not None:
            mp, mg = pat_pin.match(line), pat_pg.match(line)
            if mp and depth == cell_depth:
                pin = cur["pins"].setdefault(mp.group(1), {})
                pin_depth = depth + 1
            elif mg and depth == cell_depth:
                cur["pg"].append(mg.group(1))
            else:
                ma = pat_attr.match(line)
                if ma:
                    k, v = ma.group(1), ma.group(2).strip('"')
                    if pin is not None and depth == pin_depth and k in ("direction", "function", "capacitance", "max_capacitance", "three_state", "clock"):
                        pin[k] = v
                    elif depth == cell_depth and k in ("area", "cell_footprint", "cell_leakage_power"):
                        cur[k] = v
        depth += opens - closes
        if cur is not None and depth < cell_depth:
            cur, pin = None, None
        elif pin is not None and depth < pin_depth:
            pin = None
    return cells


def parse_lef(path):
    macros, cur, pin, layer = {}, None, None, None
    for raw in open(path, encoding="utf-8", errors="replace"):
        t = raw.split()
        if not t:
            continue
        if t[0] == "MACRO":
            name = t[1]
            short = name.split("__", 1)[1] if "__" in name else name
            cur = macros.setdefault(short, {"pins": {}})
            pin = layer = None
        elif cur is None:
            continue
        elif t[0] == "SIZE":
            cur["size"] = [float(t[1]), float(t[3])]
        elif t[0] == "SITE":
            cur["site"] = t[1]
        elif t[0] == "SYMMETRY":
            cur["sym"] = " ".join(t[1:-1])
        elif t[0] == "PIN":
            pin = cur["pins"].setdefault(t[1], {"rects": []})
        elif t[0] == "DIRECTION" and pin is not None:
            pin["dir"] = t[1]
        elif t[0] == "USE" and pin is not None:
            pin["use"] = t[1]
        elif t[0] == "ANTENNAGATEAREA" and pin is not None:
            pin["ag"] = float(t[1])
        elif t[0] == "LAYER" and pin is not None:
            layer = t[1]
        elif t[0] == "RECT" and pin is not None:
            pin["rects"].append([layer] + [float(x) for x in t[1:5]])
        elif t[0] == "OBS":
            pin = None
    return macros


# ---- rule-based plain-language description (Korean) from the cell's base name ----
def describe(base):
    b = re.sub(r"_\d+$", "", base)
    n = lambda s: {"2": "2", "3": "3", "4": "4"}.get(s, s)
    if b.startswith("lpflow_"):
        return "저전력(power-gating) 설계용 셀 — isolation·level shift·전원 스위치 등 (lpflow). 일반 합성에는 안 쓰임"
    simple = {
        "inv": "인버터 — 입력을 반전", "buf": "버퍼 — 입력을 그대로 내보내되 구동력을 키움",
        "clkbuf": "클록 트리용 버퍼 — 상승/하강 지연이 대칭", "clkinv": "클록 트리용 인버터",
        "clkdlybuf4s15": "클록용 지연 버퍼", "clkdlybuf4s18": "클록용 지연 버퍼", "clkdlybuf4s25": "클록용 지연 버퍼", "clkdlybuf4s50": "클록용 지연 버퍼",
        "bufbuf": "2단 버퍼(큰 부하 구동)", "bufinv": "버퍼+인버터 조합",
        "dlygate4sd1": "지연 게이트 — hold 위반 수리용", "dlygate4sd2": "지연 게이트 — hold 위반 수리용", "dlygate4sd3": "지연 게이트 — hold 위반 수리용",
        "dlymetal6s2s": "금속 배선 지연 셀", "dlymetal6s4s": "금속 배선 지연 셀", "dlymetal6s6s": "금속 배선 지연 셀",
        "einvn": "3-state 인버터 (TE_B=0일 때 구동)", "einvp": "3-state 인버터 (TE=1일 때 구동)",
        "ebufn": "3-state 버퍼 (TE_B=0일 때 구동)",
        "conb": "tie 셀 — 상수 1(HI)과 상수 0(LO)을 만들어 줌", "diode": "안테나 방지 다이오드 — 긴 배선의 전하를 방전",
        "tap": "well tap — N-well/P-sub를 전원에 묶어 latch-up 방지 (로직 아님)",
        "tapvpwrvgnd": "well tap (VPWR/VGND 직결)", "tapvgnd": "well tap (VGND)", "tapvgnd2": "well tap (VGND, 2폭)",
        "fill": "필러 — 셀 사이 빈 자리를 채워 well/power rail 연속성 확보", "decap": "디커플링 커패시터 — 전원 노이즈(IR drop) 완화",
        "probe_p": "프로브 셀 (테스트 접근용)", "probec_p": "프로브 셀 (테스트 접근용)",
        "macro_sparecell": "스페어 게이트 묶음 — 사후 ECO(메탈 수정)용 예비 로직",
        "maj3": "다수결(majority) — 3입력 중 2개 이상이 1이면 1",
        "ha": "반가산기 — SUM=A^B, COUT=A&B", "fa": "전가산기 — SUM=A^B^CIN, COUT=다수결",
        "mux2": "2:1 멀티플렉서 — S=0이면 A0, S=1이면 A1", "mux2i": "2:1 멀티플렉서, 출력 반전", "mux4": "4:1 멀티플렉서 — S1,S0로 A0~A3 선택",
        "dlclkp": "클록 게이팅 셀(ICG) — GATE로 클록을 안전하게 켜고 끔", "sdlclkp": "스캔 지원 클록 게이팅 셀(ICG)",
        "xor2": "XOR 2입력 — 서로 다르면 1", "xor3": "XOR 3입력", "xnor2": "XNOR 2입력 — 같으면 1", "xnor3": "XNOR 3입력",
    }
    if b in simple:
        return simple[b]
    if b.startswith("decap"):
        return simple["decap"] + " (ef: 큰 폭 변형)"
    if b == "clkinvlp":
        return "저전력(low-power) 클록 인버터"
    if b in ("fah", "fahcin", "fahcon"):
        return "전가산기 변형 — " + {"fah": "표준 전가산기(SUM, COUT)", "fahcin": "캐리 입력(CIN)이 반전", "fahcon": "캐리 출력(COUT)이 반전"}[b]
    if b.startswith("lsbuf"):
        kind = "고전압→고전압" if "hv2hv" in b else "고전압→저전압(1.8V)" if "hv2lv" in b else "저전압(1.8V)→고전압"
        return f"레벨 시프터 — {kind} 신호 레벨 변환 (서로 다른 전원 도메인 사이)"
    if b == "schmittbuf":
        return "슈미트 트리거 버퍼 — 히스테리시스로 느린/잡음 있는 입력을 깨끗한 디지털 신호로 정리"
    if b == "sdlxtp":
        return "스캔 D 래치 — SCE=1이면 SCD(스캔 입력)를 캡처 · 테스트(DFT)용"
    m = re.match(r"^(and|or|nand|nor)(\d)(b{1,2}|bb)?$", b)
    if m:
        op, k, inv = m.group(1), m.group(2), m.group(3)
        ko = {"and": "AND", "or": "OR", "nand": "NAND", "nor": "NOR"}[op]
        s = f"{ko} {k}입력 게이트"
        if inv:
            s += f" — {'일부 입력(_N)이 반전 입력'}"
        return s
    # AND-OR / OR-AND family: a21oi = AND2·AND1 의 OR, 출력 반전. digits = 각 그룹의 입력 수,
    # 'b' = 해당 입력이 반전 입력(_N), 끝의 'i' = 출력 반전.
    m = re.match(r"^([ao])([0-9b]+)([oa])(i?)$", b)
    if m:
        first, mid, _last, inv = m.groups()
        groups = re.findall(r"\d", mid)
        has_b = "b" in mid
        if first == "a":
            s = ("AND-OR" + ("-INVERT" if inv else "") + " 복합 게이트 — " + " + ".join(f"AND{g}" for g in groups) + " (AND 결과들을 OR)")
        else:
            s = ("OR-AND" + ("-INVERT" if inv else "") + " 복합 게이트 — " + " · ".join(f"OR{g}" for g in groups) + " (OR 결과들을 AND)")
        if inv:
            s += ", 출력 반전"
        if has_b:
            s += " · 일부 입력(_N)이 반전 입력"
        return s
    ff = {
        "dfxtp": "D 플립플롭 (상승 에지, Q만)", "dfxbp": "D 플립플롭 (상승 에지, Q와 Q_N)",
        "dfrtp": "D 플립플롭 + 비동기 리셋(RESET_B)", "dfrtn": "D 플립플롭 (하강 에지) + 비동기 리셋", "dfrbp": "D 플립플롭 + 비동기 리셋, Q와 Q_N",
        "dfstp": "D 플립플롭 + 비동기 셋(SET_B)", "dfsbp": "D 플립플롭 + 비동기 셋, Q와 Q_N",
        "dfbbp": "D 플립플롭 + 비동기 셋/리셋, Q와 Q_N", "dfbbn": "D 플립플롭 (하강 에지) + 비동기 셋/리셋",
        "dlxtp": "D 래치 (CLK 하이일 때 투명)", "dlxtn": "D 래치 (GATE_N 로우일 때 투명)", "dlxbp": "D 래치, Q와 Q_N", "dlxbn": "D 래치 (로우 투명), Q와 Q_N",
        "dlrtp": "D 래치 + 비동기 리셋", "dlrtn": "D 래치(로우 투명) + 비동기 리셋", "dlrbp": "D 래치 + 리셋, Q와 Q_N", "dlrbn": "D 래치(로우 투명) + 리셋, Q와 Q_N",
        "edfxtp": "enable 플립플롭 (DE=1일 때만 D 캡처)", "edfxbp": "enable 플립플롭, Q와 Q_N",
    }
    if b in ff:
        return ff[b]
    m = re.match(r"^(sdf|sedf)([a-z]+)$", b)
    if m:
        return "스캔 플립플롭 — SCE=1이면 SCD(스캔 입력)를, 아니면 D를 캡처" + (" + enable" if m.group(1) == "sedf" else "") + " · 테스트(DFT)용"
    return "기능 설명 규칙에 없는 셀 — liberty의 불리언 함수와 핀 목록 참고"


for lib, (prefix, lib_path, lef_path) in LIBS.items():
    path = f"{ROOT}/public/stdcells/{lib}.cells.json"
    cells = json.load(open(path))
    libc = {}
    for lp in ([] if not lib_path else lib_path if isinstance(lib_path, list) else [lib_path]):
        for k, v in parse_liberty(lp).items():
            libc.setdefault(k, v)
    lef = parse_lef(lef_path)
    hit = 0
    for short, c in cells.items():
        L, M = libc.get(short, {}), lef.get(short, {})
        pins = []
        names = list(dict.fromkeys(list(M.get("pins", {}).keys()) + list(L.get("pins", {}).keys())))
        for pn in names:
            lp, mp = L.get("pins", {}).get(pn, {}), M.get("pins", {}).get(pn, {})
            pins.append({"n": pn, "dir": (lp.get("direction") or mp.get("dir") or "").lower(), "use": mp.get("use", "").lower(),
                         "fn": lp.get("function"), "cap": float(lp["capacitance"]) if "capacitance" in lp else None,
                         "rects": [[r[0]] + [round(x, 3) for x in r[1:]] for r in mp.get("rects", [])]})
        c["info"] = {"size": M.get("size"), "site": M.get("site"), "sym": M.get("sym"),
                     "area": float(L["area"]) if "area" in L else None,
                     "footprint": (L.get("cell_footprint") or "").split("__")[-1] or None,
                     "leak": float(L["cell_leakage_power"]) if "cell_leakage_power" in L else None,
                     "desc": describe(short), "pins": pins}
        hit += 1 if M.get("size") else 0
    json.dump(cells, open(path, "w"), separators=(",", ":"))
    print(lib, len(cells), "cells; with LEF size:", hit, "; with liberty:", sum(1 for s in cells if s in libc), "->", os.path.getsize(path) // 1024, "KB")

# ---- techlef: site + routing layer pitch (for the "how they connect" explainer) ----
tech = glob.glob(f"{REF}/sky130_fd_sc_hd/techlef/sky130_fd_sc_hd__nom.tlef")
facts = {}
if tech:
    txt = open(tech[0], encoding="utf-8", errors="replace").read()
    m = re.search(r"SITE (\w+)\s+.*?SIZE ([\d.]+) BY ([\d.]+)", txt, re.S)
    if m:
        facts["site"] = {"name": m.group(1), "w": float(m.group(2)), "h": float(m.group(3))}
    for lay in ("li1", "met1", "met2", "met3", "met4", "met5"):
        # one LAYER ... END <lay> block; dashboard's virtual-rule check needs direction, track
        # pitch/offset, min width, base min spacing (first SPACINGTABLE entry) and min area.
        blk = re.search(r"LAYER %s\s(.*?)END %s" % (lay, lay), txt, re.S)
        if not blk:
            continue
        b = blk.group(1)
        mm = re.search(r"PITCH ([\d.]+).*?WIDTH ([\d.]+)", b, re.S)
        if not mm:
            continue
        rec = {"pitch": float(mm.group(1)), "width": float(mm.group(2))}
        d = re.search(r"DIRECTION (\w+)", b)
        if d:
            rec["dir"] = d.group(1).lower()
        o = re.search(r"OFFSET ([\d.]+)", b)
        if o:
            rec["offset"] = float(o.group(1))
        sp = re.search(r"SPACINGTABLE\s+(?:PARALLELRUNLENGTH [\d. ]+\s+)?WIDTH\s+0\s+([\d.]+)", b)
        if sp:
            rec["spacing"] = float(sp.group(1))
        a = re.search(r"\n\s*AREA ([\d.]+)", b)
        if a:
            rec["area"] = float(a.group(1))
        facts.setdefault("layers", {})[lay] = rec
info_path = f"{ROOT}/src/data/sky130_pdk_info.json"
info = json.load(open(info_path, encoding="utf-8"))
info["techlef"] = facts
json.dump(info, open(info_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("techlef:", facts)
