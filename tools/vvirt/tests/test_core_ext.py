"""Core SKILL language builtins added in skill_core_ext (run: python3 tests/test_core_ext.py, no pytest needed)."""
import os, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from vvirt.skill_lang import Interp, SkillError, skill_repr
from vvirt.odb import Database
from vvirt.stdcell import StdCellLib
from vvirt import skill_funcs

ws = tempfile.mkdtemp(prefix="vvws_"); os.makedirs(os.path.join(ws, "_out"))
it = Interp(); skill_funcs.install(it, Database(os.path.join(ws, "libs"), StdCellLib()), os.path.join(ws, "_out"))

CASES = [  # (source, expected %L repr)
 ("setq(x 5) x", "5"), ("setq(y list(1 2)) y", "(1 2)"), ("lessp(1 2)", "t"), ("lessp(2 1)", "nil"), ("lessp(1 2 3)", "t"),
 ("greaterp(2 1)", "t"), ("leqp(2 2)", "t"), ("geqp(1 2)", "nil"), ("neq(1 2)", "t"), ("neq(1 1)", "nil"),
 ("expt(2 10)", "1024"), ("atan(1.0 1.0) > 0.78 && atan(1.0 1.0) < 0.79", "t"), ("log10(1000.0)", "3.0"), ("gcd(12 18)", "6"),
 ("logand(12 10)", "8"), ("logior(12 10)", "14"), ("logxor(12 10)", "6"), ("leftshift(1 4)", "16"), ("rightshift(16 2)", "4"),
 ("mapcan(lambda((x) list(x x)) list(1 2))", "(1 1 2 2)"), ("maplist(lambda((l) length(l)) list(1 2 3))", "(3 2 1)"),
 ("mapcon(lambda((l) list(car(l))) list(1 2))", "(1 2)"),
 ("memv(2 list(1 2 3))", "(2 3)"), ("assv(1 list(list(1 2) list(3 4)))", "(1 2)"),
 ("remd(list(1 2 1 3 2))", "(1 2 3)"), ("remq(1 list(1 2 1))", "(2)"),
 ("nconc(list(1 2) list(3))", "(1 2 3)"), ("let((l) l=list(1 2) setcar(l 9) l)", "(9 2)"), ("let((l) l=list(1 2 3) setcdr(l list(7)) l)", "(1 7)"),
 ("let((a b) a=list(1 list(2)) b=copy(a) setcar(cadr(b) 9) a)", "(1 (2))"),
 ("let((c) c=tconc(nil 1) c=tconc(c 2) car(c))", "(1 2)"), ("let((c) c=lconc(nil list(1 2)) c=lconc(c list(3)) car(c))", "(1 2 3)"),
 ("subst(9 2 list(1 2 list(2 3)))", "(1 9 (9 3))"), ("lindex(list(5 6 7) 7)", "2"), ("nthelem(2 list(5 6 7))", "6"),
 ("xcons(list(2 3) 1)", "(1 2 3)"), ("ncons(1)", "(1)"), ("cdddr(list(1 2 3 4))", "(4)"), ("cadddr(list(1 2 3 4))", "4"),
 ("let((s) s=list(nil) putprop(s 7 'a) get(s 'a))", "7"), ("let((s) s=list(nil) putprop(s 7 'a) getq(s a))", "7"),
 ("let((s) s='foo putprop(s 3 'k) get(s 'k))", "3"), ("get('nosuch 'k)", "nil"),
 ("let((t1) t1=makeTable(\"t\" 0) t1->a=5 list(t1->a t1->b))", "(5 0)"), ("let((t1) t1=makeTable(\"t\" nil) tableSet(t1 \"k\" 1) tableGet(t1 \"k\"))", "1"),
 ("index(\"abcdef\" \"cd\")", "\"cdef\""), ("rindex(\"abcabc\" \"b\")", "\"bc\""), ("nindex(\"abcdef\" \"cd\")", "3"),
 ("concat(\"a\" \"b\" 1)", "ab1"), ("strcmp(\"a\" \"b\")", "-1"), ("strcmp(\"b\" \"a\")", "1"), ("strcmp(\"a\" \"a\")", "0"),
 ("strncmp(\"abx\" \"aby\" 2)", "0"), ("strcasecmp(\"A\" \"a\")", "0"), ("getchar(\"abc\" 2)", "b"),
 ("asciiToString(list(72 105))", "\"Hi\""), ("symeval('x)", "5"),
 ("rexMatchp(\"^a.c$\" \"abc\")", "t"), ("rexMatchp(\"^a.c$\" \"abd\")", "nil"),
 ("rexCompile(\"b+\") rexExecute(\"abbbc\")", "t"), ("rexExecute(\"xyz\")", "nil"),
 ("type(1)", "fixnum"), ("type(1.5)", "flonum"), ("type(\"s\")", "string"), ("type('a)", "symbol"), ("type(list(1))", "list"),
 ("fboundp('car)", "t"), ("fboundp('noSuchFn)", "nil"), ("procedurep(lambda((x) x))", "t"),
 ("eval(list('plus 1 2))", "3"), ("eval(list('car list('quote list(4 5))))", "4"),
 ("random(10) < 10", "t"),
 ("dbTransformPoint(list(1 0) list(list(10 20) \"R90\"))", "(10.0 21.0)"), ("dbTransformPoint(list(1 2) list(list(0 0) \"MX\"))", "(1.0 -2.0)"),
]
bad = 0
for src, want in CASES:
    try:
        got = skill_repr(it.eval_text(src))
    except SkillError as e:
        got = "ERR " + str(e)
    except Exception as e:  # noqa
        got = "EXC %s" % e
    if got != want:
        bad += 1
        print("FAIL", src, "->", got, "(want %s)" % want)
# file I/O inside / outside the workspace
it.eval_text('let((p) p=outfile("t_out.txt") fprintf(p "line %d\n" 1) println(list(1 2) p) print("x" p) close(p))')
got = it.eval_text('let((p l) p=infile("t_out.txt") gets(l p) close(p) l)')
if got != "line 1\n": bad += 1; print("FAIL file roundtrip ->", repr(got))
if skill_repr(it.eval_text('getDirFiles(".")')).find("t_out.txt") < 0: bad += 1; print("FAIL getDirFiles")
try:
    it.eval_text('outfile("/etc/vvirt_should_not_exist")'); bad += 1; print("FAIL: outside-workspace write was allowed")
except SkillError as e:
    if "outside the vvirt workspace" not in str(e): bad += 1; print("FAIL wrong error", e)
try:
    it.eval_text('infile("../../etc/passwd")'); bad += 1; print("FAIL: ../ escape allowed")
except SkillError:
    pass
n = len(CASES) + 4
print("%d checks, %d failed" % (n, bad)); sys.exit(1 if bad else 0)
