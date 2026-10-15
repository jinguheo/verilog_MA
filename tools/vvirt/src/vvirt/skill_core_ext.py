"""Additional core SKILL language builtins for the virtual Virtuoso (added 2026-10-14).

Kept in its own module so the base interpreter (skill_lang) stays untouched; skill_funcs.install() calls install().
Everything here is pure language / data functions, plus file I/O that is confined to the vvirt workspace directory.

What is deliberately NOT here (see tools/vvirt/SUPPORT.md for the full table with reasons):
  * host access: system / sh / unix, deleting files, file access outside the workspace
  * array syntax a[i] and makeVector/arrayref/setarray (the parser has no index syntax)
  * defmacro / mprocedure / backquote (no macro expansion in the evaluator)
  * rexReplace group semantics (Cadence regex groups differ from Python's)
"""
from __future__ import annotations

import copy as _copy
import math
import os
import random as _random
import re
from typing import Any

from .skill_lang import Interp, Keyword, SkillError, Sym, _truthy, skill_repr, skill_sprintf, skill_str


def _lst(x: Any) -> list:
    return [] if x is None else x


class Table:
    """SKILL association table: tbl->sym / tbl->sym = v work for symbol keys, tableGet/tableSet for any key."""

    def __init__(self, name: str, default: Any) -> None:
        self.name, self.default, self.data = name, default, {}

    def skill_get(self, key: str) -> Any:
        return self.data.get(key, self.default)

    def skill_set(self, key: str, value: Any) -> None:
        self.data[key] = value

    def skill_repr(self) -> str:
        return "table:%s" % self.name


class Port:
    """File port (outfile / infile). Only exists inside the workspace directory."""

    def __init__(self, fh, path: str) -> None:
        self.fh, self.path = fh, path

    def skill_repr(self) -> str:
        return "port:%s" % os.path.basename(self.path)


def install(interp: Interp, workspace: str, db: Any = None) -> None:
    fn, sp = interp.funcs, interp.special
    ws = os.path.realpath(workspace)
    props: dict[Any, dict[str, Any]] = {}
    rex = {"pat": None, "m": None}

    # ------------------------------------------------------------------ assignment and symbol-ish special forms
    def f_setq(args, sc):
        if len(args) != 2 or args[0][0] != "id":
            raise SkillError("*Error* setq: expected setq(symbol value)")
        return interp.ev_assign(("assign", args[0], args[1]), sc)

    def key_of(node, sc):
        if node[0] == "id":
            return node[1]
        if node[0] == "quoted":
            return str(node[1])
        return str(interp.ev(node, sc))

    def pkey(obj):
        return str(obj) if isinstance(obj, Sym) else id(obj)

    def f_getq(args, sc):
        obj = interp.ev(args[0], sc)
        return get_prop(obj, key_of(args[1], sc))

    def f_putpropq(args, sc):
        obj, val = interp.ev(args[0], sc), interp.ev(args[1], sc)
        return put_prop(obj, val, key_of(args[2], sc))

    def get_prop(obj, key):
        if isinstance(obj, list) and obj and obj[0] is None:  # disembodied property list (nil k v k v)
            for i in range(1, len(obj) - 1, 2):
                if str(obj[i]) == key:
                    return obj[i + 1]
            return None
        if hasattr(obj, "skill_get"):
            return obj.skill_get(key)
        return props.get(pkey(obj), {}).get(key)

    def put_prop(obj, val, key):
        key = str(key)
        if isinstance(obj, list) and obj and obj[0] is None:
            for i in range(1, len(obj) - 1, 2):
                if str(obj[i]) == key:
                    obj[i + 1] = val
                    return val
            obj.extend([Sym(key), val])
            return val
        if hasattr(obj, "skill_set"):
            obj.skill_set(key, val)
            return val
        props.setdefault(pkey(obj), {})[key] = val
        return val

    def f_quote(args, sc):
        return Sym(args[0][1]) if args[0][0] == "id" else interp.ev(args[0], sc)

    sp["quote"] = f_quote
    sp["setq"] = f_setq
    sp["getq"] = f_getq
    sp["putpropq"] = f_putpropq

    # ------------------------------------------------------------------ comparison / numeric
    def cmp_chain(op):
        def f(a, b, *rest):
            xs = [a, b, *rest]
            return True if all(op(xs[i], xs[i + 1]) for i in range(len(xs) - 1)) else None
        return f

    fn["lessp"] = cmp_chain(lambda a, b: a < b)
    fn["greaterp"] = cmp_chain(lambda a, b: a > b)
    fn["leqp"] = cmp_chain(lambda a, b: a <= b)
    fn["geqp"] = cmp_chain(lambda a, b: a >= b)
    fn["neq"] = lambda a, b: True if a != b else None
    fn["eqv"] = lambda a, b: True if a == b else None
    fn["atan"] = lambda x, y=None: math.atan(x) if y is None else math.atan2(x, y)
    fn["atan2"] = lambda y, x: math.atan2(y, x)
    fn["tan"], fn["asin"], fn["acos"] = math.tan, math.asin, math.acos
    fn["sinh"], fn["cosh"], fn["tanh"] = math.sinh, math.cosh, math.tanh
    fn["log10"] = math.log10
    fn["expt"] = lambda a, b: a ** b
    fn["minus"] = lambda x: -x
    fn["truncate"] = lambda x: int(x)
    fn["gcd"] = math.gcd
    fn["onep"] = lambda x: True if x == 1 else None
    fn["random"] = lambda n=None: _random.randrange(int(n)) if n else _random.randrange(2 ** 31)
    fn["srandom"] = lambda n: (_random.seed(n), n)[1]
    fn["logand"] = lambda *a: _fold(a, lambda x, y: x & y)
    fn["logior"] = lambda *a: _fold(a, lambda x, y: x | y)
    fn["logxor"] = lambda *a: _fold(a, lambda x, y: x ^ y)
    fn["lognot"] = lambda x: ~x
    fn["leftshift"] = lambda x, n: x << n
    fn["rightshift"] = lambda x, n: x >> n

    def _fold(a, f):
        r = a[0]
        for v in a[1:]:
            r = f(r, v)
        return r

    # ------------------------------------------------------------------ lists
    def nconc(*ls):
        res = None
        for l in ls:
            if l is None:
                continue
            if res is None:
                res = l
            else:
                res.extend(l)
        return res

    def tconc(c, data):
        if c is None:
            return [[data], data]
        c[0].append(data)
        c[1] = data
        return c

    def lconc(c, lst):
        if lst is None:
            return c
        if c is None:
            return [list(lst), lst[-1]]
        c[0].extend(lst)
        c[1] = lst[-1]
        return c

    def setcar(l, v):
        l[0] = v
        return v

    def setcdr(l, rest):
        l[1:] = list(_lst(rest))
        return rest

    def mapcan(f, *lists):
        ls = [_lst(l) for l in lists]
        out: list = []
        for i in range(min(len(l) for l in ls) if ls else 0):
            r = interp.call(f, [l[i] for l in ls])
            if r is not None:
                out.extend(r)
        return out or None

    def maplist(f, lst):
        l = _lst(lst)
        return [interp.call(f, [list(l[i:])]) for i in range(len(l))] or None

    def mapcon(f, lst):
        l = _lst(lst)
        out: list = []
        for i in range(len(l)):
            r = interp.call(f, [list(l[i:])])
            if r is not None:
                out.extend(r)
        return out or None

    def memv(x, lst):
        l = _lst(lst)
        for i, v in enumerate(l):
            if v == x:
                return list(l[i:])
        return None

    def assv(key, alist):
        for p in _lst(alist):
            if isinstance(p, list) and p and p[0] == key:
                return p
        return None

    def remd(lst):
        out, seen = [], []
        for v in _lst(lst):
            if v not in seen:
                seen.append(v)
                out.append(v)
        return out or None

    def subst(new, old, tree):
        if tree == old:
            return new
        if isinstance(tree, list):
            return [subst(new, old, t) for t in tree] or None
        return tree

    def lindex(lst, item):
        for i, v in enumerate(_lst(lst)):
            if v == item:
                return i
        return None

    fn["nconc"], fn["tconc"], fn["lconc"] = nconc, tconc, lconc
    fn["setcar"], fn["setcdr"] = setcar, setcdr
    fn["copy"] = lambda x: _copy.deepcopy(x)
    fn["mapcan"], fn["maplist"], fn["mapcon"] = mapcan, maplist, mapcon
    fn["memv"], fn["assv"] = memv, assv
    fn["remd"] = fn["remdq"] = fn["remdup"] = remd
    fn["remq"] = lambda x, l: [y for y in _lst(l) if y != x] or None
    fn["subst"] = fn["substitute"] = subst
    fn["lindex"] = lindex
    fn["tailp"] = lambda a, b: True if a is not None and isinstance(b, list) and any(b[i:] == a for i in range(len(b))) else None
    fn["xcons"] = lambda a, b: [b] + _lst(a)
    fn["ncons"] = lambda a: [a]
    fn["nthelem"] = lambda n, l: (_lst(l)[n - 1] if 1 <= n <= len(_lst(l)) else None)
    fn["cdddr"] = lambda x: (list(x[3:]) or None) if x else None
    fn["cadddr"] = lambda x: x[3] if x and len(x) > 3 else None
    fn["caadr"] = lambda x: (x[1][0] if x and len(x) > 1 and x[1] else None)
    fn["cddar"] = lambda x: (list(x[0][2:]) or None) if x and x[0] else None
    fn["lastelem"] = lambda l: (l[-1] if l else None)
    fn["rassoc"] = lambda key, alist: next((p for p in _lst(alist) if isinstance(p, list) and len(p) > 1 and p[-1] == key), None)
    fn["listp"] = lambda x: True if (x is None or isinstance(x, list)) else None

    # ------------------------------------------------------------------ property lists and tables
    fn["putprop"] = lambda obj, val, key: put_prop(obj, val, key)
    fn["get"] = lambda obj, key: get_prop(obj, str(key))
    fn["makeTable"] = lambda name, default=None: Table(str(name), default)
    fn["tableGet"] = lambda t, k: t.data.get(_hk(k), t.default)
    fn["tableSet"] = lambda t, k, v: (t.data.__setitem__(_hk(k), v), v)[1]
    fn["tableKeys"] = lambda t: [_unhk(k) for k in t.data] or None
    fn["tableToList"] = lambda t: [[_unhk(k), v] for k, v in t.data.items()] or None
    fn["tablep"] = lambda x: True if isinstance(x, Table) else None
    fn["remove_from_table"] = fn["tableRemove"] = lambda t, k: (t.data.pop(_hk(k), None), True)[1]

    def _hk(k):
        return tuple(k) if isinstance(k, list) else k

    def _unhk(k):
        return list(k) if isinstance(k, tuple) else k

    # ------------------------------------------------------------------ strings / symbols
    def index_(s, sub):
        i = str(s).find(str(sub))
        return str(s)[i:] if i >= 0 else None

    def rindex_(s, sub):
        i = str(s).rfind(str(sub))
        return str(s)[i:] if i >= 0 else None

    def concat(*a):
        return Sym("".join(skill_str(x) for x in a if x is not None))

    def cmp3(a, b):
        a, b = str(a), str(b)
        return -1 if a < b else (1 if a > b else 0)

    fn["index"], fn["rindex"] = index_, rindex_
    fn["nindex"] = lambda s, sub: (str(s).find(str(sub)) + 1) or None
    fn["concat"] = concat
    fn["strcmp"] = cmp3
    fn["strncmp"] = lambda a, b, n: cmp3(str(a)[:n], str(b)[:n])
    fn["strcasecmp"] = lambda a, b: cmp3(str(a).lower(), str(b).lower())
    fn["strncasecmp"] = lambda a, b, n: cmp3(str(a)[:n].lower(), str(b)[:n].lower())
    fn["getchar"] = lambda s, n: (Sym(str(s)[n - 1]) if 1 <= n <= len(str(s)) else None)
    fn["asciiToString"] = lambda codes: "".join(chr(c) for c in _lst(codes))
    fn["stringToList"] = lambda s: [Sym(c) for c in str(s)] or None
    fn["symeval"] = lambda s: interp.globals.vars.get(str(s))
    fn["gensym"] = lambda prefix="g": Sym("%s%d" % (prefix, _random.randrange(10 ** 6)))
    fn["print"] = lambda x, port=None: (_out(port, skill_repr(x)), True)[1]
    fn["println"] = lambda x, port=None: (_out(port, skill_repr(x) + "\n"), True)[1]
    fn["printf"] = lambda fmt, *a: (_out(None, skill_sprintf(str(fmt), list(a))), True)[1]
    fn["lowerCase"] = lambda s: str(s).lower()
    fn["upperCase"] = lambda s: str(s).upper()

    # ------------------------------------------------------------------ regular expressions (Python re; see module docstring)
    def to_re(p):
        return re.compile(str(p))

    def rex_compile(p):
        try:
            rex["pat"] = to_re(p)
        except re.error as exc:
            return str(exc)
        return None

    def rex_execute(s):
        if rex["pat"] is None:
            raise SkillError("*Error* rexExecute: no pattern compiled (call rexCompile first)")
        rex["m"] = rex["pat"].search(str(s))
        return True if rex["m"] else None

    def rex_matchp(p, s):
        try:
            return True if to_re(p).search(str(s)) else None
        except re.error as exc:
            raise SkillError("*Error* rexMatchp: bad pattern (%s)" % exc)

    fn["rexCompile"], fn["rexExecute"], fn["rexMatchp"] = rex_compile, rex_execute, rex_matchp
    fn["rexMatchList"] = lambda p, s: ([str(m) for m in re.findall(str(p), str(s))] or None)

    # ------------------------------------------------------------------ introspection / evaluation
    def tname(x):
        if x is None or isinstance(x, list):
            return Sym("list")
        if x is True:
            return Sym("t")
        if isinstance(x, bool):
            return Sym("list")
        if isinstance(x, int):
            return Sym("fixnum")
        if isinstance(x, float):
            return Sym("flonum")
        if isinstance(x, Sym):
            return Sym("symbol")
        if isinstance(x, str):
            return Sym("string")
        if isinstance(x, Table):
            return Sym("table")
        if isinstance(x, Port):
            return Sym("port")
        if callable(x):
            return Sym("funobj")
        return Sym("userType")

    def to_node(v):
        if v is None:
            return ("quoted", None)
        if v is True:
            return ("id", "t")
        if isinstance(v, Sym):
            return ("id", str(v))
        if isinstance(v, str):
            return ("str", str(v))
        if isinstance(v, (int, float)):
            return ("num", v)
        if isinstance(v, list):
            if v and isinstance(v[0], Sym):
                return ("call", ("id", str(v[0])), [to_node(a) for a in v[1:]])
            return ("quoted", v)
        return ("quoted", v)

    fn["type"] = tname
    fn["typep"] = lambda x: tname(x)
    fn["fboundp"] = lambda s: True if (str(s) in interp.funcs or str(s) in interp.special) else None
    fn["procedurep"] = lambda x: True if (callable(x) or hasattr(x, "params")) else None
    fn["eval"] = lambda form, *env: interp.ev(to_node(form), interp.globals)
    fn["vectorp"] = lambda x: None

    # ------------------------------------------------------------------ file I/O confined to the workspace
    def safe(path, what):
        p = str(path)
        if not os.path.isabs(p):
            p = os.path.join(ws, p)
        rp = os.path.realpath(p)
        if rp != ws and not rp.startswith(ws + os.sep):
            raise SkillError("*Error* %s: %s is outside the vvirt workspace (file access is limited to %s)" % (what, p, ws))
        return rp

    def outfile(path, mode="w"):
        p = safe(path, "outfile")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        return Port(open(p, "a" if str(mode).startswith("a") else "w", encoding="utf-8"), p)

    def infile(path):
        p = safe(path, "infile")
        try:
            return Port(open(p, "r", encoding="utf-8"), p)
        except OSError as exc:
            raise SkillError("*Error* infile: cannot open %s (%s)" % (p, exc.strerror))

    def _out(port, text):
        if port is None or port is True:
            interp.output.append(text)
        elif isinstance(port, Port):
            port.fh.write(text)
        else:
            interp.output.append(text)

    def f_gets(args, sc):
        port = interp.ev(args[1], sc) if len(args) > 1 else None
        if not isinstance(port, Port):
            raise SkillError("*Error* gets: second argument must be an input port")
        line = port.fh.readline()
        if args[0][0] == "id":
            interp.ev_assign(("assign", args[0], ("quoted", line if line else None)), sc)
        return line if line else None

    def close(port):
        if isinstance(port, Port):
            port.fh.close()
        return True

    sp["gets"] = f_gets
    fn["outfile"], fn["infile"], fn["close"] = outfile, infile, close
    fn["fprintf"] = lambda port, fmt, *a: (_out(port, skill_sprintf(str(fmt), list(a))), True)[1]
    fn["drain"] = lambda port=None: (port.fh.flush() if isinstance(port, Port) else None, True)[1]
    fn["fputs"] = lambda s, port: (_out(port, str(s)), True)[1]
    fn["getDirFiles"] = lambda path=".": (sorted(os.listdir(safe(path, "getDirFiles"))) or None)
    fn["createDir"] = lambda path: (os.makedirs(safe(path, "createDir"), exist_ok=True), True)[1]

    # ------------------------------------------------------------------ small db helpers that need no new data model
    from .odb import transform_point

    def db_transform_point(pt, xform):
        origin = tuple(xform[0]) if xform and isinstance(xform[0], list) else (0.0, 0.0)
        orient = str(xform[1]) if xform and len(xform) > 1 else "R0"
        mag = float(xform[2]) if xform and len(xform) > 2 else 1.0
        x, y = transform_point((float(pt[0]), float(pt[1])), origin, orient, mag)
        return [round(x, 6), round(y, 6)]

    fn["dbTransformPoint"] = db_transform_point
    fn["dbIsCellViewModified"] = lambda cv: True if getattr(cv, "dirty", False) else None
