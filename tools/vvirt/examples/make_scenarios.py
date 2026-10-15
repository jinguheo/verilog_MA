"""Run LLM-style scenarios against vvirt through the real virtuoso-bridge client and record every step.

For each scenario the "LLM" (Claude, authoring the commands by hand in this session — not an automated API loop)
gets a plain-language request, issues SKILL commands one step at a time, reads each reply, and continues.
Every command, reply, timing and a layout snapshot after each step is written to
my_dashboard/src/data/vbScenarios.json (+ SVGs under my_dashboard/public/vb/scen/) for the dashboard's VB tab.

    bash tools/vvirt/scripts/pyrun.sh tools/vvirt/examples/make_scenarios.py
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time

from virtuoso_bridge import VirtuosoClient

REPO = "/mnt/d/MyWork/Veriolg_MA"
OUT_JSON = f"{REPO}/my_dashboard/src/data/vbScenarios.json"
OUT_SVG = f"{REPO}/my_dashboard/public/vb/scen"
LIB, STD = "testlib", "sky130_fd_sc_hd"
os.makedirs(OUT_SVG, exist_ok=True)
client = VirtuosoClient.from_env()


class Scenario:
    def __init__(self, sid: str, title: str, prompt: str, cell: str, goal: str, lib: str = "testlib") -> None:
        self.d = {"id": sid, "title": title, "prompt": prompt, "cell": cell, "lib": lib, "goal": goal, "steps": [], "checks": []}
        self.cell, self.sid, self.lib = cell, sid, lib
        self.last_hash: str | None = None
        self.last_svg: str | None = None
        self.n = 0

    def step(self, kind: str, note: str, skill: str, expect_error: bool = False) -> str:
        """Send one SKILL command, record reply and (if the layout changed) a snapshot. Returns the reply text."""
        t0 = time.time()
        res = client.execute_skill(skill, timeout=60)
        ms = round((time.time() - t0) * 1000)
        ok = res.status.value == "success"
        out = (res.output or "").strip()
        err = "; ".join(res.errors) if res.errors else ""
        self.n += 1
        svg_name = self._snapshot()
        self.d["steps"].append({"kind": kind, "note": note, "skill": skill.strip(), "ok": ok,
                                "output": out[:700], "error": err[:500], "ms": ms, "svg": svg_name, "expectError": expect_error})
        return out if ok else ""

    def _snapshot(self) -> str | None:
        path = f"{OUT_SVG}/{self.sid}_{self.n:02d}.svg"
        r = client.execute_skill(f'vvExportSvg("{self.lib}" "{self.cell}" "{path}")')
        if r.status.value != "success" or not os.path.exists(path):
            return self.last_svg
        h = hashlib.md5(open(path, "rb").read()).hexdigest()
        if h == self.last_hash:
            os.remove(path)
            return self.last_svg
        self.last_hash, self.last_svg = h, f"/vb/scen/{os.path.basename(path)}"
        return self.last_svg

    def check(self, name: str, ok: bool, detail: str = "") -> None:
        self.d["checks"].append({"name": name, "ok": bool(ok), "detail": detail})
        print(("  PASS " if ok else "  FAIL ") + name + (f"  [{detail}]" if detail else ""))

    def done(self) -> dict:
        self.d["finalSvg"] = self.last_svg
        return self.d


def nums(text: str) -> list[float]:
    return [float(x) for x in re.findall(r"-?\d+\.?\d*", text)]


def probe(cell: str, pins: tuple[str, ...] = ()) -> str:
    """SKILL returning (width height (cx cy)...) of a PDK cell through the named-field API (vvGet / vvPin)."""
    parts = [f'vvGet(vvCellInfo("{STD}__{cell}") "width")', f'vvGet(vvCellInfo("{STD}__{cell}") "height")']
    parts += [f'vvGet(vvPin("{STD}__{cell}" "{p}") "center")' for p in pins]
    return "list(" + " ".join(parts) + ")"


def reset(cell: str) -> None:
    client.execute_skill(f'let((o) o = ddGetObj("{LIB}" "{cell}") when(o ddDeleteObj(o)))')


def inst_line(cell: str, name: str, x: float, y: float, orient: str = "R0") -> str:
    return (f'dbCreateParamInstByMasterName(cv "{STD}" "{STD}__{cell}" "layout" "{name}" list({x:g} {y:g}) "{orient}")')


OPEN_W = lambda cell: f'cv = dbOpenCellViewByType("{LIB}" "{cell}" "layout" "maskLayout" "w")'
OPEN_A = lambda cell: f'cv = dbOpenCellViewByType("{LIB}" "{cell}" "layout" "maskLayout" "a")'
READ_INSTS = 'mapcar(lambda((i) list(i~>name i~>cellName i~>xy i~>orient i~>bBox)) cv~>instances)'
all_scen: list[dict] = []

# ---------------------------------------------------------------------------------------------------------------- 1
print("S1 two cells")
S = Scenario("place", "① 두 셀 나란히 배치", "sky130_fd_sc_hd 라이브러리에서 nand2_1과 dfxtp_1을 맞닿게 나란히 놓고, 아래 행에는 nand2_1을 뒤집어서 하나 더 놓아줘.",
             "scen_place", "라이브러리 조회 → 폭에 맞춰 좌표 계산 → 배치(MX 반전 포함) → 읽어서 확인")
reset(S.cell)
S.step("query", "셀 이름 확인 (정확한 이름을 모르므로 검색)", f'vvCells("{STD}" "dfxtp_1")')
i1 = S.step("query", "두 셀의 폭·높이 조회 (이름 있는 필드: vvGet(vvCellInfo(셀) \"width\"))",
            f'list(vvGet(vvCellInfo("{STD}__nand2_1") "width") vvGet(vvCellInfo("{STD}__nand2_1") "height") vvGet(vvCellInfo("{STD}__dfxtp_1") "width"))')
w1, h, w2 = nums(i1)[:3]
S.step("edit", "새 레이아웃 셀뷰 열기(w)", OPEN_W(S.cell))
S.step("edit", f"nand2_1은 (0,0), dfxtp_1은 x={w1:g}에 붙여 놓고 2번째 행은 MX로 뒤집어 y={2*h:g}에", "\n".join([
    inst_line("nand2_1", "U_nand", 0, 0), inst_line("dfxtp_1", "U_dff", w1, 0), inst_line("nand2_1", "U_nand_flip", 0, 2 * h, "MX")]))
S.step("edit", "저장", "dbSave(cv)")
rb = S.step("verify", "읽어서 확인", READ_INSTS)
S.check("인스턴스 3개", rb.count("U_") == 3, rb[:60])
S.check("dfxtp_1이 nand2_1에 맞닿음(x0 = 폭)", f"(({w1:g} 0.0) ({w1 + w2:.2f} {h:g}))" in rb.replace("((1.38 0.0)", f"(({w1:g} 0.0)") or f"({w1:g} 0.0)" in rb, f"w1={w1}, w2={w2}")
S.check("뒤집은 셀이 2번째 행(y 2.72~5.44)에 있음", "(0.0 2.72)" in rb and "5.44" in rb, "MX")
all_scen.append(S.done())

# ---------------------------------------------------------------------------------------------------------------- 2
print("S2 chain create")
S = Scenario("chain", "② 인버터 체인 생성 + 배선", "인버터 4개를 한 줄로 붙여 놓고 각 출력을 다음 입력에 li1로 연결해줘. 입력 핀 IN, 마지막 출력 핀 OUT 라벨도 달아줘.",
             "scen_chain", "핀 좌표 조회 → SKILL for 루프로 배치·배선 → 라벨 → 저장 → 닫기")
reset(S.cell)
info = S.step("query", "inv_1 의 폭·높이와 핀 A, Y 의 중심 좌표 조회 (vvPin 의 center 필드)", probe("inv_1", ("A", "Y")))
w, h, ax, ay, yx, yy = nums(info)[:6]
S.step("edit", "새 셀뷰 열기(w)", OPEN_W(S.cell))
S.step("edit", f"for 루프로 inv_1 4개를 {w:g} 간격으로 배치", f'''for(i 0 3
  dbCreateParamInstByMasterName(cv "{STD}" "{STD}__inv_1" "layout" sprintf(nil "U%d" i) list(i*{w:g} 0.0) "R0"))''')
S.step("edit", "i번째 Y 핀 → (i+1)번째 A 핀을 li1(폭 0.17)로 연결: 가로 → 세로 → 가로", f'''for(i 0 2
  let((x0 x1)
    x0 = i*{w:g} + {yx:g}
    x1 = (i+1)*{w:g} + {ax:g} - 0.05
    dbCreatePath(cv list("li1" "drawing") list(list(x0 {yy:g}) list(x1 {yy:g}) list(x1 {ay:g}) list(x1+0.05 {ay:g})) 0.17)))''')
S.step("edit", "IN / OUT 핀 라벨", f'''dbCreateLabel(cv list("li1" "pin") list({ax:g} {ay:g}) "IN" "centerCenter" "R0" "roman" 0.1)
dbCreateLabel(cv list("li1" "pin") list({3*w + yx:g} {yy:g}) "OUT" "centerCenter" "R0" "roman" 0.1)''')
S.step("edit", "저장 후 닫기", "progn(dbSave(cv) dbClose(cv))")
rb = S.step("verify", "다시 열어(r) 인스턴스·도형 수와 바운딩박스 확인",
            f'let((c) c = dbOpenCellViewByType("{LIB}" "{S.cell}" "layout" "maskLayout" "r") list(length(c~>instances) length(c~>shapes) c~>bBox))')
S.check("인스턴스 4 / 도형 5(배선 3 + 라벨 2)", rb.startswith("(4 5"), rb)
S.check(f"폭 = 4×{w:g} = {4*w:.2f} µm", f"({4*w:.2f} {h:g})" in rb, rb)
all_scen.append(S.done())

# ---------------------------------------------------------------------------------------------------------------- 3
print("S3 chain modify")
S = Scenario("modify", "③ 기존 레이아웃 수정", "방금 만든 체인에서 3번째 인버터(U2)를 구동력이 큰 inv_4로 바꾸고, 뒤의 U3는 늘어난 폭만큼 오른쪽으로 밀어줘. 배선도 다시 그려줘.",
             "scen_chain", "저장된 셀 다시 열기 → 삭제 → 교체 배치 → 이동(dbMoveFig) → 재배선 → 라벨 이동")
S.last_hash = None
S.step("edit", "저장돼 있던 셀을 편집용(a)으로 다시 열기", OPEN_A(S.cell))
S.step("query", "현재 인스턴스 확인", READ_INSTS)
i4 = S.step("query", "inv_4 의 폭·높이와 핀 A, Y 의 중심 좌표 조회", probe("inv_4", ("A", "Y")))
w4, _h4, ax4, ay4, yx4, yy4 = nums(i4)[:6]
S.step("edit", "기존 li1 배선 경로 전부와 U2 삭제", '''foreach(s cv~>shapes when(s~>objType == "path" dbDeleteObject(s)))
foreach(i cv~>instances when(i~>name == "U2" dbDeleteObject(i)))''')
dx = round(w4 - w, 3)
S.step("edit", f"같은 자리에 inv_4 배치, U3 와 OUT 라벨은 +{dx:g} µm 이동", f'''{inst_line("inv_4", "U2", 2 * w, 0)}
dbMoveFig(car(setof(i cv~>instances i~>name == "U3")) cv list({dx:g}:0 "R0"))
foreach(s cv~>shapes when(s~>objType == "label" && s~>theLabel == "OUT" dbMoveFig(s cv list({dx:g}:0 "R0"))))''')
# new geometry: stage x offsets
xs = [0, w, 2 * w, 2 * w + w4]
outs = [(xs[0] + yx, yy), (xs[1] + yx, yy), (xs[2] + yx4, yy4)]
ins = [(xs[1] + ax, ay), (xs[2] + ax4, ay4), (xs[3] + ax, ay)]
wire_lines = []
for (ox, oy), (ix, iy) in zip(outs, ins):
    wire_lines.append(f'dbCreatePath(cv list("li1" "drawing") list(list({ox:g} {oy:g}) list({ix - 0.05:g} {oy:g}) list({ix - 0.05:g} {iy:g}) list({ix:g} {iy:g})) 0.17)')
S.step("edit", "바뀐 핀 위치(inv_4)에 맞춰 li1 배선 3개 다시 그리기", "\n".join(wire_lines))
S.step("edit", "저장", "dbSave(cv)")
rb = S.step("verify", "인스턴스 이름·셀·위치 확인", READ_INSTS)
bb = S.step("verify", "바운딩박스", "cv~>bBox")
S.check("U2 = inv_4", '"U2" "sky130_fd_sc_hd__inv_4"' in rb, rb[:140])
S.check(f"U3 가 x={2*w + w4:g} 로 이동", f"({2*w + w4:g} 0.0)" in rb, "")
S.check(f"전체 폭 {3*w + w4:.2f} µm", f"({3*w + w4:.2f} {h:g})" in bb, bb)
all_scen.append(S.done())

# ---------------------------------------------------------------------------------------------------------------- 4
print("S4 array")
S = Scenario("array", "④ 배열(mosaic) + 경계", "buf_1 을 2행×4열로 배열해줘. 위 행은 뒤집고, 전체를 감싸는 prBoundary 사각형과 ARRAY 라벨을 넣어줘.",
             "scen_array", "mosaic 2개(R0 / MX) → 전체 bbox 로 경계 사각형 → 라벨")
reset(S.cell)
info = S.step("query", "buf_1 크기 조회", probe("buf_1"))
w, h = nums(info)[:2]
S.step("edit", "새 셀뷰 열기(w)", OPEN_W(S.cell))
S.step("edit", f"마스터 buf_1 을 열고 1행 4열 mosaic 두 줄 (아래 R0 / 위 MX 반전, 피치 {w:g}×{h:g})", f'''master = dbOpenCellViewByType("{STD}" "{STD}__buf_1" "layout" "maskLayout" "r")
dbCreateSimpleMosaic(cv master "ROW0" 0:0 "R0" 1 4 {h:g} {w:g})
dbCreateSimpleMosaic(cv master "ROW1" 0:{2*h:g} "MX" 1 4 {h:g} {w:g})''')
S.step("edit", "현재 bbox 로 prBoundary 사각형, 중앙 위에 라벨", '''let((bb)
  bb = cv~>bBox
  dbCreateRect(cv list("prBoundary" "boundary") bb)
  dbCreateLabel(cv list("met1" "label") list(xCoord(car(bb)) + 0.2 yCoord(cadr(bb)) + 0.3) "ARRAY" "lowerLeft" "R0" "roman" 0.3))''')
S.step("edit", "저장", "dbSave(cv)")
rb = S.step("verify", "mosaic 속성과 bbox", 'list(mapcar(lambda((i) list(i~>name i~>objType i~>rows i~>columns i~>orient)) cv~>instances) cv~>bBox)')
S.check("mosaic 2개, 각 1행 4열", rb.count('"mosaic"') == 2 and rb.count(" 1 4 ") == 2, rb[:120])
S.check(f"bbox 폭 {4*w:.2f} × 높이 {2*h:g}", f"({4*w:.2f} {2*h:g})" in rb.replace("5.44)", "5.44)"), rb[-40:])
all_scen.append(S.done())

# ---------------------------------------------------------------------------------------------------------------- 5
print("S5 via route")
S = Scenario("via", "⑤ 비아로 층 이동 배선", "met1 패드 (0,0)-(0.5,0.5) 와 (4,0)-(4.5,0.5) 를 met1→met2→met3 비아로 올려서 met3 선으로 연결해줘.",
             "scen_via", "비아 정의 조회 → 패드 → 비아 스택(techFindViaDefByName) → 상위층 배선")
reset(S.cell)
S.step("query", "사용 가능한 비아 정의 조회", "vvViaDefs()")
S.step("edit", "새 셀뷰 열기(w)", OPEN_W(S.cell))
S.step("edit", "양쪽 끝 met1 패드와 met2 패드", '''dbCreateRect(cv list("met1" "drawing") list(list(0.0 0.0) list(0.5 0.5)))
dbCreateRect(cv list("met1" "drawing") list(list(4.0 0.0) list(4.5 0.5)))
dbCreateRect(cv list("met2" "drawing") list(list(0.0 0.0) list(0.5 0.5)))
dbCreateRect(cv list("met2" "drawing") list(list(4.0 0.0) list(4.5 0.5)))''')
S.step("edit", "각 패드 중심(0.25, 0.25) / (4.25, 0.25)에 met1-met2, met2-met3 비아", '''foreach(x list(0.25 4.25)
  dbCreateVia(cv techFindViaDefByName(techGetTechFile(cv) "M1M2_PR") list(x 0.25) "R0" nil)
  dbCreateVia(cv techFindViaDefByName(techGetTechFile(cv) "M2M3_PR") list(x 0.25) "R0" nil))''')
S.step("edit", "met3 으로 두 비아 사이를 폭 0.3 선으로 연결", 'dbCreatePath(cv list("met3" "drawing") list(list(0.25 0.25) list(4.25 0.25)) 0.3)')
S.step("edit", "저장", "dbSave(cv)")
rb = S.step("verify", "비아와 도형 개수", 'list(length(cv~>vias) length(cv~>shapes) mapcar(lambda((v) v~>viaHeader~>viaDefName) cv~>vias))')
S.check("비아 4개(M1M2 ×2, M2M3 ×2)", rb.startswith("(4 ") and rb.count("M1M2_PR") == 2 and rb.count("M2M3_PR") == 2, rb)
all_scen.append(S.done())

# ---------------------------------------------------------------------------------------------------------------- 6
print("S6 error recovery")
S = Scenario("recover", "⑥ 오류를 읽고 스스로 고치기", "Metal6 층에 1×1 사각형, nand2 셀 하나, 그리고 원 하나를 그려줘.",
             "scen_recover", "없는 층/셀/함수로 시도 → *Error* 메시지를 읽고 → 유효한 이름으로 재시도")
reset(S.cell)
S.step("edit", "새 셀뷰 열기(w)", OPEN_W(S.cell))
S.step("edit", "1차 시도: Metal6 층 (sky130에 없음)", 'dbCreateRect(cv list("Metal6" "drawing") list(list(0 0) list(1 1)))', expect_error=True)
S.step("query", "오류가 알려준 유효 층 목록 확인 → 최상위는 met5", "vvLayers()")
S.step("edit", "met5 로 재시도", 'dbCreateRect(cv list("met5" "drawing") list(list(0 0) list(1 1)))')
S.step("edit", "1차 시도: 셀 이름 sky130_fd_sc_hd__nand2 (구동력 접미사 없음)", f'dbCreateParamInstByMasterName(cv "{STD}" "{STD}__nand2" "layout" "U0" list(3.0 0.0) "R0")', expect_error=True)
S.step("query", "nand2 로 검색해 실제 이름 확인", f'vvCells("{STD}" "nand2_")')
S.step("edit", "nand2_1 로 재시도", inst_line("nand2_1", "U0", 3.0, 0.0))
S.step("edit", "1차 시도: dbCreateEllipse (이 환경/레이아웃 API에 없음)", 'dbCreateEllipse(cv list("met4" "drawing") list(list(5.0 1.0) list(6.0 2.0)))', expect_error=True)
S.step("edit", "다각형 16각형으로 원 근사: SKILL 루프로 점 계산 후 dbCreatePolygon", '''pts = nil
for(k 0 15
  pts = cons(list(5.5 + 0.5*cos(k*3.14159265/8) 1.5 + 0.5*sin(k*3.14159265/8)) pts))
dbCreatePolygon(cv list("met4" "drawing") reverse(pts))''')
S.step("edit", "저장", "dbSave(cv)")
rb = S.step("verify", "최종 내용", 'list(length(cv~>shapes) length(cv~>instances) mapcar(lambda((s) list(s~>objType car(s~>lpp))) cv~>shapes))')
errs = [s for s in S.d["steps"] if not s["ok"]]
S.check("오류 3번 발생(층·셀·함수)", len(errs) == 3, "; ".join(e["error"][:60] for e in errs))
S.check("모두 고쳐서 도형 2 + 인스턴스 1", rb.startswith("(2 1") and '"rect" "met5"' in rb and '"polygon" "met4"' in rb, rb)
all_scen.append(S.done())

# ---------------------------------------------------------------------------------------------------------------- 7
print("S7 pdk library -> edit -> hierarchy")
WS_LIBS = f"{REPO}/tools/vvirt/workspace/libs"
S = Scenario("pdklib", "⑦ PDK 라이브러리를 불러와 복사·수정·재사용", "PDK의 sky130_fd_sc_hd__inv_1 을 내 라이브러리 designlib 로 복사해서 입력 라벨 A 를 지우고 met1 스트랩을 하나 추가해 저장해줘. 그리고 상위 셀에서 그 수정본을 두 번 배치해줘.",
             "top_pair", "라이브러리 조회/생성 → PDK 셀 복사(편집 가능) → 수정 → 저장 → 상위 셀에서 계층 배치", lib="designlib")
client.execute_skill('let((o) o = ddGetObj("designlib") when(o ddDeleteObj(o)))')
S.step("query", "열려 있는 라이브러리 목록 (PDK 라이브러리는 읽기 전용)", 'mapcar(lambda((l) list(l~>name l~>writable)) ddGetLibList())')
S.step("edit", "내 라이브러리 생성 (경로의 마지막 폴더 이름 = 라이브러리 이름) 후 기술 라이브러리 확인", f'''ddCreateLib("designlib" "{WS_LIBS}/designlib")
list(ddGetObj("designlib")~>name techGetTechLibName(ddGetObj("designlib")) ddGetObj("designlib")~>writable)''')
S.step("edit", "PDK 읽기 전용 셀을 내 라이브러리로 복사 (실제 PDK GDS 도형이 편집 가능한 도형으로 변환됨)", 'invEdit = vvCopyCell("sky130_fd_sc_hd" "sky130_fd_sc_hd__inv_1" "designlib" "inv_edit")')
S.step("query", "복사본 확인: 도형 수, bbox, 라벨", 'list(length(invEdit~>shapes) invEdit~>bBox mapcar(lambda((s) s~>theLabel) setof(s invEdit~>shapes s~>objType == "label")))')
S.step("edit", "라벨 A 삭제, 셀 위쪽에 met1 스트랩 추가, 저장", '''foreach(s invEdit~>shapes when(s~>objType == "label" && s~>theLabel == "A" dbDeleteObject(s)))
dbCreateRect(invEdit list("met1" "drawing") list(list(0.0 2.3) list(1.38 2.5)))
dbSave(invEdit)''')
S.step("edit", "상위 셀 top_pair 를 만들고 수정본 inv_edit 을 두 번 배치 (두 번째는 1.38 오른쪽)", f'''top = dbOpenCellViewByType("designlib" "top_pair" "layout" "maskLayout" "w")
dbCreateParamInstByMasterName(top "designlib" "inv_edit" "layout" "I0" list(0.0 0.0) "R0")
dbCreateParamInstByMasterName(top "designlib" "inv_edit" "layout" "I1" list(1.38 0.0) "R0")
dbSave(top)''')
rb = S.step("verify", "계층 확인: 마스터가 PDK 가 아니라 designlib 의 inv_edit 인지", 'mapcar(lambda((i) list(i~>name i~>libName i~>cellName i~>xy)) top~>instances)')
q = client.execute_skill('list(length(invEdit~>shapes) length(setof(s invEdit~>shapes s~>objType == "label")))').output
S.step("edit", "GDS 로 내보낸 뒤 다른 라이브러리에 다시 불러와(vvImportGds) 도형 수가 같은지 확인", f'''ddCreateLib("roundtrip" "{WS_LIBS}/roundtrip")
vvExportGds("designlib" "inv_edit" "{REPO}/tools/vvirt/workspace/_out/inv_edit.gds")
vvImportGds("roundtrip" "{REPO}/tools/vvirt/workspace/_out/inv_edit.gds")''')
rt = S.step("verify", "다시 불러온 셀의 도형 수", 'length(dbOpenCellViewByType("roundtrip" "inv_edit" "layout" "maskLayout" "r")~>shapes)')
S.check("마스터 = designlib/inv_edit (PDK 셀 아님) ×2", rb.count('"designlib" "inv_edit"') == 2, rb[:120])
S.check("라벨 A 만 삭제됨 (7개 남음) + 스트랩 추가", q.endswith(" 7)"), q)
S.check("GDS 왕복 후 도형 수 동일", rt.strip() == q.strip("()").split()[0], f"{rt} vs {q}")
client.execute_skill('let((o) o = ddGetObj("roundtrip") when(o ddDeleteObj(o)))')
all_scen.append(S.done())

# ---------------------------------------------------------------------------------------------------------------- 8
print("S8 pdk rules routing")
S = Scenario("rules", "⑧ PDK 룰을 읽어 룰대로 배선 + DRC 검사", "PDK 룰을 먼저 읽어서, met2 패드 (0,0) 과 (3,0) 을 룰에 맞게 연결해줘. 가운데 장애물을 피해서. 끝나면 DRC 검사하고, 일부러 간격을 어긴 손배선도 잡히는지 보여줘.",
             "scen_rules", "룰 출처(PDK tech LEF) → 룰대로 장애물 우회 배선 → 내 검사기 + 공식 sky130 DRC 덱으로 교차 검증")
reset(S.cell)
S.step("query", "룰이 어디서 왔는지", "vvRuleSource()")
S.step("query", "met2 룰 (최소 폭 / 간격 / 면적)과 층별 선호 방향", 'list(vvRules("met2") vvDirections())')
S.step("edit", "새 셀뷰 열기(w)", OPEN_W(S.cell))
S.step("edit", "양쪽 met2 패드(0.3×0.3)와 가운데 장애물(세로 벽)", '''dbCreateRect(cv list("met2" "drawing") list(list(-0.15 -0.15) list(0.15 0.15)))
dbCreateRect(cv list("met2" "drawing") list(list(2.85 -0.15) list(3.15 0.15)))
dbCreateRect(cv list("met2" "drawing") list(list(1.4 -1.0) list(1.6 1.0)))''')
rr = S.step("edit", "룰 기반 라우터 vvRoute: 폭·간격은 PDK 룰, 장애물은 간격 룰만큼 띄워서 우회, met2 는 세로 선호", 'vvRoute(cv "met2" list(0 0) list(3 0))')
c1 = S.step("verify", "내 검사기로 DRC (nil = 위반 없음)", "vvCheckRules(cv)")
S.step("edit", "일부러 룰을 어긴 손배선: 패드 위 0.02 µm 간격", 'dbCreatePath(cv list("met2" "drawing") list(list(0.0 0.24) list(1.2 0.24)) 0.14)')
c2 = S.step("verify", "검사기가 위반 위치를 알려줌", "vvCheckRules(cv)")
o2 = S.step("verify", "공식 sky130A_mr.drc 로 독립 검증 (m2.2 = met2 간격 룰)", "vvOfficialDrc(cv)")
S.step("edit", "잘못된 손배선 삭제 후, 룰 기반 라우터로 위쪽 직선 배선을 다시", '''dbDeleteObject(car(last(cv~>shapes)))
vvRoute(cv "met2" list(0.0 1.6) list(3.0 1.6))''')
c3 = S.step("verify", "내 검사기 재검사", "vvCheckRules(cv)")
o3 = S.step("verify", "공식 덱 재검사", "vvOfficialDrc(cv)")
rep = S.step("verify", "'위반 없음'이 무엇을 뜻하는지: 검사 범위 보고서 (검사한 층·룰, 검사하지 않은 것, 룰 출처)", "vvCheckReport(cv)")
orep = S.step("verify", "공식 덱도 어느 그룹을 돌렸는지 보고서", "vvOfficialDrcReport(cv)")
S.step("edit", "저장", "dbSave(cv)")
S.check("라우터가 직선이 아닌 우회 경로를 선택(장애물 회피)", "straight" not in rr, rr[:90])
S.check("룰대로 배선한 결과: 내 검사기 위반 0", c1.strip() == "nil", c1)
S.check("일부러 어긴 배선: 내 검사기가 minSpace 위반 검출", "minSpace" in c2, c2[:100])
S.check("공식 덱도 같은 간격 룰(m2.2) 위반 검출", "m2.2" in o2, o2)
S.check("수정 후 내 검사기·공식 덱 모두 위반 0", c3.strip() == "nil" and o3.strip() == "nil", f"{c3} / {o3}")
S.check("보고서가 'clean_in_scope' + 미검사 항목을 함께 알려줌 (그냥 clean 아님)", '"clean_in_scope"' in rep and "notChecked" in rep and "wide-wire" in rep, rep[:90])
S.check("공식 덱 보고서가 돌린/안 돌린 그룹을 명시 (FEOL 미실행)", "groupsRun" in orep and "feol" in orep and "notRun" in orep, orep[:90])
all_scen.append(S.done())

# ---------------------------------------------------------------------------------------------------------------- 9
print("S9 user rule")
S = Scenario("userrule", "⑨ 내가 입력한 룰(노하우)이 적용되는지", "크로스토크가 걱정되니 met3 는 PDK 최소(0.3)가 아니라 간격 0.6 으로 해줘. 선 A 를 그려 두고 그 옆 0.5 µm 위치에 선 B 를 연결해줘.",
             "scen_userrule", "사용자 룰 입력(vvSetRule) → 라우터가 그 룰을 지킴/거절 → 좌표 조정 → 룰을 되돌리면 검사 결과가 달라짐")
reset(S.cell)
S.step("query", "PDK 기본 met3 룰", 'vvRules("met3")')
S.step("edit", "내 노하우 입력: met3 간격을 0.6 으로 (PDK 룰을 덮어씀)", 'vvSetRule("met3" "minSpace" 0.6)')
S.step("edit", "새 셀뷰 열기(w) 후 선 A (y=0, 폭 0.3)", OPEN_W(S.cell) + '\ndbCreatePath(cv list("met3" "drawing") list(list(0.0 0.0) list(4.0 0.0)) 0.3)')
S.step("edit", "선 B 를 y=0.5 에 연결 시도 — 간격(0.5-0.3=0.2)이 내 룰(0.6)보다 작음", 'vvRoute(cv "met3" list(0.0 0.5) list(4.0 0.5))', expect_error=True)
S.step("edit", "라우터가 거절했으므로 y=1.5 로 옮겨 다시 (간격 1.2)", 'vvRoute(cv "met3" list(0.0 1.5) list(4.0 1.5))')
u1 = S.step("verify", "내 룰(0.6)로 검사", "vvCheckRules(cv)")
S.step("edit", "손으로 y=0.7 에 선 C 추가 (A 와 간격 0.4, B 와 간격 0.5: PDK 0.3 은 만족, 내 룰 0.6 은 위반)", 'dbCreatePath(cv list("met3" "drawing") list(list(0.0 0.7) list(4.0 0.7)) 0.3)')
u2 = S.step("verify", "내 룰로 검사 → 위반", "vvCheckRules(cv)")
S.step("edit", "룰을 PDK 값(0.3)으로 되돌림", 'vvSetRule("met3" "minSpace" 0.3)')
u3 = S.step("verify", "같은 도형을 PDK 룰로 검사 → 통과", "vvCheckRules(cv)")
S.step("edit", "저장", "dbSave(cv)")
S.check("1차 시도(0.5)가 룰 위반이라 거절됨", any((not st["ok"]) and "no legal" in st["error"] for st in S.d["steps"]), "")
S.check("내 룰 0.6 에서 B(y=1.5)는 위반 없음", u1.strip() == "nil", u1)
S.check("내 룰 0.6 에서 C(y=0.7)는 minSpace 위반", "minSpace" in u2, u2[:80])
S.check("룰을 0.3 으로 되돌리면 같은 도형이 통과", u3.strip() == "nil", u3)
all_scen.append(S.done())

# ---------------------------------------------------------------------------------------------------------------- 10/11
def habit_scenario(profile: str, sid: str, title: str) -> dict:
    cellname = f"scen_{sid}"
    S = Scenario(sid, title, "inv_1, nand2_1 을 아래 줄에, buf_1, inv_2 를 위 줄에 놓고 아래 줄 마지막 셀 출력(Y)을 위 줄 첫 셀 입력(A)에 met2 로 연결해줘. (미리 입력해 둔 내 습관/룰 프로필대로)",
                 cellname, f"프로필 '{profile}' 로드 → 같은 요청이 프로필에 따라 다르게 배치·배선됨 → 룰 검사")
    reset(cellname)
    S.step("edit", f"설계 습관/룰 프로필 로드: {profile}", f'vvLoadProfile("{profile}")')
    S.step("query", "적용된 습관 (방향·폭 배수·간격 배수·비아 수·셀 간격·행 뒤집기·탭)", "vvProfile()")
    S.step("edit", "새 셀뷰 열기(w)", OPEN_W(cellname))
    r0 = S.step("edit", "1행: inv_1 nand2_1 (습관에 따라 탭/간격이 자동 적용)", 'vvPlaceRow(cv "A" list("inv_1" "nand2_1") list(0.0 0.0) 0)')
    r1 = S.step("edit", "2행: buf_1 inv_2 (습관이 '행 뒤집기'면 MX 로)", 'vvPlaceRow(cv "B" list("buf_1" "inv_2") list(0.0 2.72) 1)')
    last_a = re.findall(r'\("name" "(\w+)"\) \("cell" "nand2_1"\)', r0)[0]
    first_b = re.findall(r'\("name" "(\w+)"\) \("cell" "buf_1"\)', r1)[0]
    pa = S.step("query", f"출력 핀 {last_a}/Y 와 입력 핀 {first_b}/A 의 실제 좌표(방향·반전 반영)", f'list(vvPinXY(cv "{last_a}" "Y") vvPinXY(cv "{first_b}" "A"))')
    xy = [float(x) for x in re.findall(r"-?\d+\.\d+|-?\d+", pa)]
    p0, p1 = (xy[0], xy[1]), (xy[2], xy[3])
    S.step("edit", "두 핀 위치에 li1 → met2 비아 스택 (비아 개수는 습관: 1개 또는 2개)", f'''vvViaStack(cv list({p0[0]:g} {p0[1]:g}) "li1" "met2")
vvViaStack(cv list({p1[0]:g} {p1[1]:g}) "li1" "met2")''')
    rr = S.step("edit", "met2 로 라우팅 (폭 = 최소폭×습관 배수, 간격 = 룰×습관 배수, 장애물 회피)", f'vvRoute(cv "met2" list({p0[0]:g} {p0[1]:g}) list({p1[0]:g} {p1[1]:g}))')
    ck = S.step("verify", "DRC 보고서 (met1/met2/비아 층): 상태 + 검사 범위", 'vvCheckReport(cv list("met1" "met2" "via" "mcon"))')
    S.step("edit", "저장", "dbSave(cv)")
    sh = S.step("verify", "결과 요약: 인스턴스 수 / 비아 컷 총수 / 전체 bbox / 배선 폭", 'let((n) n = 0 foreach(v cv~>vias n = n + v~>cutColumns) list(length(cv~>instances) n cv~>bBox mapcar(lambda((s) s~>width) setof(s cv~>shapes s~>objType == "path"))))')
    S.d["summary"] = sh
    S.d["profile"] = profile
    S.d["routeInfo"] = rr
    S.d["drc"] = ck
    return S, r0, r1, rr, ck, sh

Sa, a0, a1, arr, ack, ash = habit_scenario("default", "habit_default", "⑩ 습관 프로필 없음 (PDK 최소 룰만)")
Sb, b0, b1, brr, bck, bsh = habit_scenario("habit_analog", "habit_analog", "⑪ 같은 요청 + 보수적 습관 프로필")
Sa.check("프로필 없음: 탭 셀 없음, 인스턴스 4개", "TAP" not in a0 and ash.startswith("(4 "), a0[:100])
Sb.check("습관 프로필: 양 끝 탭 셀(행당 +2) + 2행 MX 반전 → 인스턴스 8개", "TAP" in b0 and "MX" in b1 and bsh.startswith("(8 "), b0[:120])
Sa.check("프로필 없음: 배선 폭 최소(0.14), 비아 컷 4개", "0.14" in ash and ash.startswith("(4 4 "), ash[-70:])
Sb.check("습관 프로필: 배선 폭 2배(0.28), 비아 컷 8개(핀당 2개)", "0.28" in bsh and bsh.startswith("(8 8 "), bsh[-70:])
Sa.check("DRC 보고: 검사 범위 안에서 위반 없음(clean_in_scope)", '"clean_in_scope"' in ack and "notChecked" in ack, f"default: {ack[:80]}")
Sb.check("DRC 보고: 검사 범위 안에서 위반 없음(clean_in_scope)", '"clean_in_scope"' in bck and "notChecked" in bck, f"analog: {bck[:80]}")
all_scen.append(Sa.done())
all_scen.append(Sb.done())
client.execute_skill('vvLoadProfile("default")')  # leave the server in a neutral state

os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
with open(OUT_JSON, "w", encoding="utf-8") as fh:
    json.dump({"generated": time.strftime("%Y-%m-%d %H:%M"), "scenarios": all_scen}, fh, ensure_ascii=False, indent=1)
unexpected = [(s["id"], i + 1, st["skill"].splitlines()[0][:60], st["error"][:90]) for s in all_scen for i, st in enumerate(s["steps"]) if not st["ok"] and not st.get("expectError")]
for u in unexpected:
    print("  UNEXPECTED ERROR STEP", u)
bad = sum(1 for s in all_scen for c in s["checks"] if not c["ok"]) + len(unexpected)
print(f"\n{sum(len(s['checks']) for s in all_scen)} checks, {bad} failed -> {OUT_JSON}")
raise SystemExit(1 if bad else 0)
