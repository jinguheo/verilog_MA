"""Interpreter tests: the exact wrappers the virtuoso-bridge daemon sends, plus common SKILL idioms."""
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from vvirt.skill_lang import Interp, SkillError, skill_repr  # noqa: E402

fails = 0


def check(name, got, want):
    global fails
    ok = got == want
    print(("PASS" if ok else "FAIL"), name, "" if ok else f"-> got {got!r}, want {want!r}")
    if not ok:
        fails += 1


def run(src, it=None):
    it = it or Interp()
    return skill_repr(it.eval_text(src))


# --- basics
check("arithmetic infix", run("1+2"), "3")
check("float", run("0.5 + 0.25"), "0.75")
check("list", run("list(1 2 3)"), "(1 2 3)")
check("quoted list", run("'(1 2 (3 4))"), "(1 2 (3 4))")
check("string", run('"a\\"b"'), '"a\\"b"')
check("nil/t", run("list(nil t)"), "(nil t)")
check("negative arg", run("list(2 -1)"), "(2 -1)")
check("binary minus", run("5 - 3"), "2")
check("point literal", run("1:2"), "(1 2)")
check("strcat/sprintf", run('strcat("a" sprintf(nil "%d-%s" 3 "x"))'), '"a3-x"')
check("%L", run('sprintf(nil "%L" list(1 "a" nil))'), '"(1 \\"a\\" nil)"')

# --- control flow
check("if then else", run("if(1 == 1 then 10 else 20)"), "10")
check("if else branch", run("if(nil then 10 else 20)"), "20")
check("if no else", run("if(nil then 10)"), "nil")
check("when", run("when(t 1 2 3)"), "3")
check("unless", run("unless(nil 7)"), "7")
check("let", run("let((a (b 2)) a = 1 a + b)"), "3")
check("let init pairs", run("let(((a 1) (b 2)) a + b)"), "3")
check("assign and use", run("x = 5 x * 2"), "10")
check("foreach", run("s = 0 foreach(i list(1 2 3) s = s + i) s"), "6")
check("mapcar lambda", run("mapcar(lambda((x) x * 2) list(1 2 3))"), "(2 4 6)")
check("prog return", run("prog((a) a = 3 return(a + 1) 99)"), "4")
check("and/or", run("list(and(1 2) or(nil 5))"), "(2 5)")
check("&& ||", run("list((1 && 2) (nil || 3))"), "(2 3)")
check("not", run("!nil"), "t")
check("boundp unbound", run("boundp('nosuchvar)"), "nil")
check("boundp bound", run("zz = 1 boundp('zz)"), "t")
check("procedure", run("procedure(dbl(x) x * 2) dbl(21)"), "42")
check("unwindProtect", run("a = 0 unwindProtect(a = 1 a = a + 10)  a"), "11")

# --- errors
it = Interp()
try:
    it.eval_text("nosuchfn(1)")
    check("undefined function raises", "no error", "error")
except SkillError as e:
    check("undefined function message", e.message, "*Error* eval: undefined function - nosuchfn")
try:
    it.eval_text("unboundvar + 1")
except SkillError as e:
    check("unbound variable message", e.message, "*Error* eval: unbound variable - unboundvar")
check("errset success", run("errset(1+1)"), "(2)")
check("errset failure", run("errset(nosuch())"), "nil")

# --- the exact wrappers sent by ramic_bridge_daemon_3.py
check("one-line wrapper", run("let(((__vb_r progn(1+2))) hiFlush() __vb_r)"), "3")

MULTI_PREFIX = "_vb_eval_ok = errset(progn(\n"
MULTI_SUFFIX = "\n) t)\n_vb_eval_err = unless(_vb_eval_ok errset.errset)\n"
MULTI_RESULT = (
    'if(_vb_eval_err then let((m) m = nth(4 _vb_eval_err) '
    'error("%s" if(and(m stringp(car(m))) '
    'strcat(if(substring(car(m) 1 8) == "*Error* " substring(car(m) 9) car(m)) '
    'if(cdr(m) strcat(" - " buildString(mapcar(lambda((x) sprintf(nil "%L" x)) cdr(m)) " ")) "")) '
    'sprintf(nil "%L" _vb_eval_err)))) else car(_vb_eval_ok))'
)


def multiline(code):
    fd, path = tempfile.mkstemp(suffix=".il", prefix="vb_eval_")
    with os.fdopen(fd, "w") as fh:
        fh.write(MULTI_PREFIX + code + MULTI_SUFFIX)
    send = f'_vb_eval_ok = _vb_eval_err = nil load("{path}") hiFlush() {MULTI_RESULT}'
    try:
        return send
    finally:
        pass


it = Interp()
check("multiline ok", skill_repr(it.eval_text(multiline("a = 4\nb = 5\na * b"))), "20")
it = Interp()
try:
    it.eval_text(multiline("x = 1\nnosuchfn(x)"))
    check("multiline error", "no error", "error")
except SkillError as e:
    check("multiline error message", e.message, "*Error* eval: undefined function - nosuchfn")
check("multiline nil result", skill_repr(Interp().eval_text(multiline("nil"))), "nil")

# --- constructs used by the layout editor batch
it = Interp()
final = it.eval_text(
    "cv = 5\nvbEditorCv = cv vbEditorOpenedCv = t\nvbLayoutEditCv = cv\n"
    "unwindProtect(progn(r = let((rbCv) rbCv = if(boundp('cv) && cv then cv else 0) if(rbCv then rbCv + 1 else nil)) "
    "when(vbEditorOpenedCv && vbEditorCv vbEditorOpenedCv = nil)) vbLayoutEditCv = nil)")
check("layout-batch result variable", skill_repr(it.eval_text("r")), "6")
check("batch returns last value (nil)", skill_repr(final), "nil")
check("flag cleared", skill_repr(it.eval_text("vbEditorOpenedCv")), "nil")
check("marker cleared by unwindProtect", skill_repr(it.eval_text("vbLayoutEditCv")), "nil")

print("\n%d failure(s)" % fails)
sys.exit(1 if fails else 0)
