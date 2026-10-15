"""Build the SKILL support matrix: what vvirt supports, and for everything it does not, WHY.

    (in WSL)  PYTHONPATH=tools/vvirt/src python3 tools/vvirt/examples/support_matrix.py
Writes tools/vvirt/SUPPORT.md and my_dashboard/src/data/vbSupport.json.

Two reference sets:
  1. core SKILL language functions (a hand-picked list of commonly used ones - NOT the complete SKILL language)
  2. the Cadence-prefixed functions that the virtuoso-bridge docs/examples/skills tell an LLM to call
     (names scanned into workspace/_cov/coverage.json by workspace/_cov/coverage.py)
Status "supported" means the name is defined in the interpreter; examples with checked results are in tests/test_core_ext.py.
"""
import collections
import json
import os
import sys
import tempfile

ROOT = "/mnt/d/MyWork/Veriolg_MA"
sys.path.insert(0, ROOT + "/tools/vvirt/src")
from vvirt import skill_funcs  # noqa: E402
from vvirt.odb import Database  # noqa: E402
from vvirt.skill_lang import Interp  # noqa: E402
from vvirt.stdcell import StdCellLib  # noqa: E402

ws = tempfile.mkdtemp()
os.makedirs(ws + "/_out")
it = Interp()
skill_funcs.install(it, Database(ws + "/libs", StdCellLib()), ws + "/_out")
DEF = set(it.funcs) | set(it.special)
STUB = set(skill_funcs.STUBS)

CORE = {
    "제어·함수": "if when unless cond case caseq for foreach while prog return let progn lambda procedure defun unwindProtect errset error warn and or not setq".split(),
    "리스트": "car cdr cons list append reverse length nth nthcdr last member memq memv assoc assq assv remove remd remdq remdup mapcar mapc mapcan maplist mapcon sort sortcar exists forall setof nconc tconc lconc setcar setcdr copy subst lindex tailp xcons ncons nthelem cadr cddr caar cdar caddr cdddr cadddr".split(),
    "수치·비트": "plus difference times quotient add1 sub1 abs min max sqrt exp log log10 sin cos tan asin acos atan atan2 expt round fix float floor ceiling truncate mod zerop plusp minusp evenp oddp lessp greaterp leqp geqp equal neq eq random logand logior logxor lognot leftshift rightshift gcd".split(),
    "문자열·심볼": "sprintf strcat strlen substring index rindex nindex upperCase lowerCase parseString buildString stringp concat strcmp strncmp strcasecmp getchar symbolToString stringToSymbol atoi atof asciiToString symbolp numberp listp".split(),
    "정규식": "rexCompile rexExecute rexMatchp rexMatchList rexReplace".split(),
    "속성·테이블·타입": "putprop get getq putpropq makeTable tableGet tableSet tableKeys symeval boundp fboundp type typep".split(),
    "입출력(workspace 안에서만)": "printf println print fprintf fputs outfile infile close gets drain getDirFiles isFile isDir createDir load".split(),
    "평가": "eval evalstring funcall apply isCallable procedurep".split(),
    "배열·매크로": "makeVector arrayref setarray vectorp declare defmacro mprocedure".split(),
    "호스트 실행·파일 변경": "system sh unix ipcBeginProcess deleteFile renameFile copyFile".split(),
}
WHY_CORE = {
    "makeVector": ("parser", "배열 자료형(vector)과 a[i] 인덱스 구문이 파서에 없음 — 구현하려면 파서와 값 타입을 함께 확장해야 함"),
    "arrayref": ("parser", "a[i] 인덱스 구문이 파서에 없음"),
    "setarray": ("parser", "a[i]=v 대입 구문이 파서에 없음"),
    "vectorp": ("parser", "vector 타입이 없어 항상 nil로 응답함(오해 소지) — 미지원으로 취급"),
    "declare": ("parser", "배열 선언 구문 없음"),
    "defmacro": ("evaluator", "평가기에 매크로 확장 단계가 없음 — backquote(`) 파싱·치환이 필요해 구현하지 않음"),
    "mprocedure": ("evaluator", "매크로 확장 단계 없음"),
    "rexReplace": ("semantics", "Cadence 정규식 그룹 문법이 Python re와 달라 같은 의미로 재현하기 어려움"),
    "system": ("safety", "호스트 명령 실행 — 안전을 위해 의도적으로 제외"),
    "sh": ("safety", "호스트 명령 실행 — 의도적 제외"),
    "unix": ("safety", "호스트 명령 실행 — 의도적 제외"),
    "ipcBeginProcess": ("safety", "외부 프로세스 실행 — 의도적 제외"),
    "deleteFile": ("safety", "파일 삭제 — 의도적 제외"),
    "renameFile": ("safety", "파일 이동 — 의도적 제외"),
    "copyFile": ("safety", "호스트 파일 복사 — 의도적 제외"),
}


def fam_reason(n):
    if n in STUB:
        return ("stub", "호출은 받지만 아무 일도 하지 않고 nil을 돌려줌(화면·GUI·환경 설정 함수)")
    if n.startswith("mae"):
        return ("scope", "Maestro(시뮬레이션 설정·실행) — 레이아웃 도구 범위 밖이라 구현하지 않음")
    if n.startswith(("axl", "asi", "sev")):
        return ("scope", "ADE Assembler/Explorer 시뮬레이션 세션 — 범위 밖")
    if n.startswith("sch"):
        return ("scope", "스키매틱 편집 — 범위 밖(레이아웃 전용)")
    if n.startswith("cdf"):
        return ("scope", "CDF(소자 파라미터 정의) — 범위 밖")
    if n.startswith("hi"):
        return ("scope", "GUI 폼·창 — 화면이 없음")
    if n.startswith("ddCat"):
        return ("todo", "라이브러리 카테고리 관리 — 사용 빈도가 낮아 미구현(구현 가능)")
    if n in ("dbCreateNet", "dbCreateTerm", "dbCreatePin", "dbCreateInstTerm", "dbAddFigToNet"):
        return ("model", "넷·단자·핀을 데이터 모델에 담지 않음 — 구현하려면 연결(connectivity) 모델 추가가 필요")
    if n == "dbCreateLine":
        return ("model", "선(line) 도형 종류가 없음(path만 있음)")
    if n in ("dbOpenBag", "dbSet"):
        return ("model", "bag/속성 직접 설정 모델이 없음")
    if n.startswith(("dd", "db", "cds", "env", "ge", "le", "tech")):
        return ("todo", "미구현(구현 가능) — 사용 빈도가 낮아 보류")
    return ("todo", "미구현")


res = {"core": {}, "bridge": [], "summary": {}}
tot = sup = 0
for g, names in CORE.items():
    rows = []
    for n in names:
        ok = n in DEF and n not in WHY_CORE
        tot += 1
        sup += ok
        row = {"name": n, "status": "supported" if ok else "unsupported"}
        if not ok:
            kind, why = WHY_CORE.get(n, ("todo", "미구현"))
            row["kind"], row["why"] = kind, why
        rows.append(row)
    res["core"][g] = rows

cov = json.load(open(ROOT + "/tools/vvirt/workspace/_cov/coverage.json", encoding="utf8"))
c = collections.Counter()
for st in ("impl", "stub", "missing"):
    for n in cov[st]:
        status = "supported" if (n in DEF and n not in STUB) else ("stub" if n in STUB else "unsupported")
        row = {"name": n, "status": status}
        if status != "supported":
            kind, why = fam_reason(n)
            row["kind"], row["why"] = kind, why
        res["bridge"].append(row)
        c[status] += 1

res["summary"] = {"core_total": tot, "core_supported": sup, "bridge_total": len(res["bridge"]), "bridge": dict(c),
                  "vvirt_functions": len(it.funcs), "special_forms": len(it.special)}
json.dump(res, open(ROOT + "/my_dashboard/src/data/vbSupport.json", "w", encoding="utf8"), indent=1, ensure_ascii=False)

L = ["# vvirt SKILL 지원 현황 (자동 생성: examples/support_matrix.py)", "",
     "상태는 인터프리터에 이름이 정의돼 있는지로 판정했다. 핵심 언어 목록은 흔히 쓰는 것을 골라 만든 것이며 SKILL 전체가 아니다.", "",
     "## 요약", f"- 핵심 SKILL 언어(고른 {tot}개): 지원 {sup}개, 미지원 {tot - sup}개",
     f"- virtuoso-bridge 문서·예제가 LLM에게 쓰라고 하는 Cadence 함수 {len(res['bridge'])}개: 지원 {c['supported']}, 빈 껍데기 {c['stub']}, 미지원 {c['unsupported']}",
     f"- vvirt 정의 함수 {len(it.funcs)}개 + 특수 형식 {len(it.special)}개", "", "## 핵심 언어 — 미지원과 사유"]
for g, rows in res["core"].items():
    bad = [r for r in rows if r["status"] != "supported"]
    L.append(f"### {g}: {len(rows) - len(bad)}/{len(rows)} 지원")
    for r in bad:
        L.append(f"- `{r['name']}` — [{r['kind']}] {r['why']}")
L += ["", "## 브리지가 참조하는 Cadence 함수 — 지원 안 되는 것과 사유"]
by = collections.defaultdict(list)
for r in res["bridge"]:
    if r["status"] != "supported":
        by[(r["kind"], r["why"])].append(r["name"])
for (k, w), ns in sorted(by.items(), key=lambda kv: -len(kv[1])):
    L.append(f"- **{len(ns)}개** [{k}] {w}: " + ", ".join(f"`{x}`" for x in ns[:14]) + (" …" if len(ns) > 14 else ""))
L += ["", "사유 분류: safety=호스트 안전을 위해 의도적 제외 · parser/evaluator=해석기 구조 한계 · semantics=의미를 같게 재현하기 어려움 · scope=레이아웃 도구 범위 밖 · model=데이터 모델에 없음 · stub=호출만 받고 동작 없음 · todo=구현 가능하나 미구현"]
open(ROOT + "/tools/vvirt/SUPPORT.md", "w", encoding="utf8").write("\n".join(L) + "\n")
print(json.dumps(res["summary"], ensure_ascii=False))
