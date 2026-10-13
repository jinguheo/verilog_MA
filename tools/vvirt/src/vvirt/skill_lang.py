"""A small SKILL interpreter (subset) for the virtual Virtuoso.

Only what the virtuoso-bridge client/daemon and its layout/schematic helpers send is implemented:
infix and prefix call syntax, let/prog/progn/if/when/unless/foreach/for/while/unwindProtect/errset,
lambda/procedure, quoted data, attribute access (~>, ->), keyword arguments and %L printing.
Values: nil = None, t = True, list = Python list, symbol = Sym, string = str, numbers = int/float,
database objects = any object with skill_get(name) / skill_set(name, value).
"""
from __future__ import annotations

import math
import re
import time
from typing import Any, Callable

# ----------------------------------------------------------------------------- values


class Sym(str):
    """A SKILL symbol (quoted identifier)."""


class SkillError(Exception):
    """An error raised by the interpreted program (what SKILL would report as *Error*)."""

    def __init__(self, message: str, *extra: Any) -> None:
        super().__init__(message)
        self.message = message
        self.extra = list(extra)


class _Return(Exception):
    def __init__(self, value: Any) -> None:
        self.value = value


class Keyword(str):
    """?name keyword argument marker."""


# ----------------------------------------------------------------------------- tokenizer

_NUM = re.compile(r"(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?")
_ID = re.compile(r"[A-Za-z_][A-Za-z0-9_.]*")
_OPS = ["~>", "->", "<=", ">=", "==", "!=", "&&", "||", "**", "+", "-", "*", "/", "<", ">", "=", "!", ":", "%"]


class Tok:
    __slots__ = ("kind", "val", "sp_before", "sp_after", "pos")

    def __init__(self, kind: str, val: Any, sp_before: bool, pos: int) -> None:
        self.kind, self.val, self.sp_before, self.sp_after, self.pos = kind, val, sp_before, False, pos

    def __repr__(self) -> str:  # pragma: no cover
        return f"Tok({self.kind},{self.val!r})"


def tokenize(src: str) -> list[Tok]:
    toks: list[Tok] = []
    i, n = 0, len(src)
    space = True
    while i < n:
        c = src[i]
        if c in " \t\r\n\f":
            i += 1
            space = True
            continue
        if c == ";":  # comment to end of line
            while i < n and src[i] != "\n":
                i += 1
            space = True
            continue
        start = i
        if c == '"':
            i += 1
            buf: list[str] = []
            while i < n and src[i] != '"':
                if src[i] == "\\" and i + 1 < n:
                    nx = src[i + 1]
                    buf.append({"n": "\n", "t": "\t", "\\": "\\", '"': '"'}.get(nx, nx))
                    i += 2
                else:
                    buf.append(src[i])
                    i += 1
            if i >= n:
                raise SkillError("*Error* read: unterminated string")
            i += 1
            t = Tok("str", "".join(buf), space, start)
        elif c.isdigit() or (c == "." and i + 1 < n and src[i + 1].isdigit()):
            m = _NUM.match(src, i)
            txt = m.group(0)
            i = m.end()
            t = Tok("num", float(txt) if any(ch in txt for ch in ".eE") else int(txt), space, start)
        elif c.isalpha() or c == "_":
            m = _ID.match(src, i)
            i = m.end()
            # identifiers such as gnd! keep a trailing '!' unless it starts '!='
            if i < n and src[i] == "!" and not (i + 1 < n and src[i + 1] == "="):
                i += 1
            t = Tok("id", src[start:i], space, start)
        elif c == "?" and i + 1 < n and (src[i + 1].isalpha() or src[i + 1] == "_"):
            m = _ID.match(src, i + 1)
            i = m.end()
            t = Tok("kw", src[start + 1:i], space, start)
        elif c == "(":
            i += 1
            t = Tok("lp", c, space, start)
        elif c == ")":
            i += 1
            t = Tok("rp", c, space, start)
        elif c == "'":
            i += 1
            t = Tok("quote", c, space, start)
        elif c == "`":
            i += 1
            t = Tok("quote", c, space, start)
        elif c in "[]{},@#$\\":
            i += 1
            t = Tok("punct", c, space, start)
        else:
            for op in _OPS:
                if src.startswith(op, i):
                    i += len(op)
                    t = Tok("op", op, space, start)
                    break
            else:
                raise SkillError(f"*Error* read: unexpected character {c!r}")
        if toks:
            toks[-1].sp_after = space
        toks.append(t)
        space = False
    if toks:
        toks[-1].sp_after = True
    return toks


# ----------------------------------------------------------------------------- parser (AST = tuples)

_BIN_PREC = {
    "||": 20, "&&": 30, "==": 40, "!=": 40, "<": 50, ">": 50, "<=": 50, ">=": 50,
    "+": 60, "-": 60, "*": 70, "/": 70, "%": 70, "**": 80,
}


class Parser:
    def __init__(self, toks: list[Tok]) -> None:
        self.t, self.i = toks, 0

    def peek(self, k: int = 0) -> Tok | None:
        j = self.i + k
        return self.t[j] if j < len(self.t) else None

    def next(self) -> Tok:
        tok = self.t[self.i]
        self.i += 1
        return tok

    def parse_program(self) -> list:
        out = []
        while self.peek() is not None:
            if self.peek().kind == "rp":
                raise SkillError("*Error* read: unmatched )")
            out.append(self.expr())
        return out

    def parse_args(self) -> list:
        args = []
        while True:
            tok = self.peek()
            if tok is None:
                raise SkillError("*Error* read: missing )")
            if tok.kind == "rp":
                self.i += 1
                return args
            args.append(self.expr())

    # ---- expression with precedence climbing
    def expr(self, min_prec: int = 0) -> tuple:
        left = self.unary()
        while True:
            tok = self.peek()
            if tok is None or tok.kind != "op":
                break
            op = tok.val
            if op == "=":  # assignment: lowest precedence, right associative
                if min_prec > 10:
                    break
                self.i += 1
                rhs = self.expr(10)
                left = ("assign", left, rhs)
                continue
            prec = _BIN_PREC.get(op)
            if prec is None or prec < min_prec:
                break
            nxt = self.peek(1)
            # "a -b" inside an argument list is two arguments, not a subtraction
            if op in ("-", "+") and tok.sp_before and not tok.sp_after and nxt is not None and nxt.kind in ("num", "id", "lp"):
                break
            self.i += 1
            right = self.expr(prec + 1)
            left = ("bin", op, left, right)
        return left

    def unary(self) -> tuple:
        tok = self.peek()
        if tok is None:
            raise SkillError("*Error* read: unexpected end of input")
        if tok.kind == "op" and tok.val in ("!", "-", "+"):
            self.i += 1
            operand = self.unary()
            return ("un", tok.val, operand)
        return self.postfix(self.primary())

    def postfix(self, node: tuple) -> tuple:
        while True:
            tok = self.peek()
            if tok is not None and tok.kind == "op" and tok.val in ("~>", "->"):
                self.i += 1
                name = self.next()
                if name.kind not in ("id", "num") and not (name.kind == "op" and name.val in ("*",)):
                    raise SkillError("*Error* read: bad attribute name")
                node = ("attr", node, str(name.val))
                continue
            if tok is not None and tok.kind == "op" and tok.val == ":" and node[0] == "num":
                # point literal x:y
                self.i += 1
                y = self.unary()
                node = ("call", ("id", "list"), [node, y])
                continue
            break
        return node

    def primary(self) -> tuple:
        tok = self.next()
        k = tok.kind
        if k == "num":
            return ("num", tok.val)
        if k == "str":
            return ("str", tok.val)
        if k == "kw":
            return ("kw", tok.val)
        if k == "quote":
            return ("quoted", self.datum())
        if k == "id":
            nxt = self.peek()
            if nxt is not None and nxt.kind == "lp" and not nxt.sp_before:
                self.i += 1
                return ("call", ("id", tok.val), self.parse_args())
            return ("id", tok.val)
        if k == "lp":
            # A parenthesised group. One expression = grouping; several = variable list or Lisp-style call
            return ("paren", self.parse_args())
        raise SkillError(f"*Error* read: unexpected token {tok.val!r}")

    def datum(self) -> Any:
        """Quoted data: 'sym, '(1 2 (3 4)), 'string."""
        tok = self.next()
        if tok.kind == "lp":
            out = []
            while True:
                tk = self.peek()
                if tk is None:
                    raise SkillError("*Error* read: missing ) in quoted list")
                if tk.kind == "rp":
                    self.i += 1
                    return out
                out.append(self.datum())
        if tok.kind == "num":
            return tok.val
        if tok.kind == "str":
            return tok.val
        if tok.kind == "id":
            if tok.val == "nil":
                return None
            if tok.val == "t":
                return True
            return Sym(tok.val)
        if tok.kind == "op" and tok.val == "-" and self.peek() is not None and self.peek().kind == "num":
            return -self.next().val
        if tok.kind == "quote":
            return [Sym("quote"), self.datum()]
        if tok.kind == "kw":
            return Keyword(tok.val)
        raise SkillError(f"*Error* read: bad quoted datum {tok.val!r}")


def parse(src: str) -> list:
    return Parser(tokenize(src)).parse_program()


# ----------------------------------------------------------------------------- printer (%L / %s)


def _fmt_float(x: float) -> str:
    if math.isnan(x):
        return "nan"
    if math.isinf(x):
        return "inf" if x > 0 else "-inf"
    s = repr(x)
    return s


def skill_repr(v: Any) -> str:
    """%L formatting."""
    if v is None:
        return "nil"
    if v is True:
        return "t"
    if v is False:
        return "nil"
    if isinstance(v, Sym):
        return str(v)
    if isinstance(v, Keyword):
        return "?" + str(v)
    if isinstance(v, str):
        return '"' + v.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return _fmt_float(v)
    if isinstance(v, (list, tuple)):
        return "(" + " ".join(skill_repr(x) for x in v) + ")" if len(v) else "nil"
    if hasattr(v, "skill_repr"):
        return v.skill_repr()
    if callable(v):
        return "funobj:0x%x" % (id(v) & 0xFFFFFFF)
    return str(v)


def skill_str(v: Any) -> str:
    """%s formatting (strings unquoted)."""
    if isinstance(v, str):
        return str(v)
    return skill_repr(v)


def _truthy(v: Any) -> bool:
    return not (v is None or v is False or (isinstance(v, list) and len(v) == 0))


_FMT = re.compile(r"%(?P<flags>[-+ 0#]*)(?P<width>\d+|\*)?(?:\.(?P<prec>\d+))?(?P<conv>[dsfgeLcxXoE%])")


def skill_sprintf(fmt: str, args: list[Any]) -> str:
    out: list[str] = []
    pos = 0
    ai = 0
    for m in _FMT.finditer(fmt):
        out.append(fmt[pos:m.start()])
        pos = m.end()
        conv = m.group("conv")
        if conv == "%":
            out.append("%")
            continue
        if ai >= len(args):
            raise SkillError("*Error* sprintf: not enough arguments for format", fmt)
        a = args[ai]
        ai += 1
        spec = "%" + (m.group("flags") or "") + (m.group("width") or "") + ("." + m.group("prec") if m.group("prec") else "")
        if conv == "L":
            out.append((spec + "s") % skill_repr(a))
        elif conv == "s":
            out.append((spec + "s") % skill_str(a))
        elif conv == "c":
            out.append(chr(a) if isinstance(a, int) else str(a)[:1])
        elif conv in "dxXo":
            out.append((spec + conv) % int(a))
        else:
            out.append((spec + conv) % float(a))
    out.append(fmt[pos:])
    return "".join(out)


# ----------------------------------------------------------------------------- interpreter


class Lambda:
    def __init__(self, params: list[str], body: list, scope: "Scope", name: str = "lambda") -> None:
        self.params, self.body, self.scope, self.name = params, body, scope, name

    def skill_repr(self) -> str:
        return "funobj:0x%x" % (id(self) & 0xFFFFFFF)


class Scope:
    def __init__(self, parent: "Scope | None" = None) -> None:
        self.vars: dict[str, Any] = {}
        self.parent = parent

    def find(self, name: str) -> "Scope | None":
        s: Scope | None = self
        while s is not None:
            if name in s.vars:
                return s
            s = s.parent
        return None


class Interp:
    def __init__(self) -> None:
        self.globals = Scope()
        self.funcs: dict[str, Callable[..., Any]] = {}
        self.special: dict[str, Callable[[list, Scope], Any]] = {}
        self.cwd_load_root: str | None = None
        self.output: list[str] = []  # text written with printf/println (CIW)
        self.steps = 0
        self.max_steps = 20_000_000
        self._install_core()

    # ---- public API
    def eval_text(self, src: str) -> Any:
        result = None
        for node in parse(src):
            result = self.ev(node, self.globals)
        return result

    def call(self, fn: Any, args: list[Any]) -> Any:
        if isinstance(fn, Lambda):
            sc = Scope(fn.scope)
            for i, p in enumerate(fn.params):
                sc.vars[p] = args[i] if i < len(args) else None
            res = None
            try:
                for b in fn.body:
                    res = self.ev(b, sc)
            except _Return as r:
                return r.value
            return res
        if callable(fn):
            return fn(*args)
        raise SkillError("*Error* funcall: not a function", fn)

    # ---- evaluation
    def ev(self, node: tuple, sc: Scope) -> Any:
        self.steps += 1
        if self.steps > self.max_steps:
            raise SkillError("*Error* interpreter step limit exceeded")
        k = node[0]
        if k == "num" or k == "str":
            return node[1]
        if k == "id":
            return self.lookup(node[1], sc)
        if k == "quoted":
            return node[1]
        if k == "kw":
            return Keyword(node[1])
        if k == "call":
            return self.ev_call(node, sc)
        if k == "paren":
            items = node[1]
            if not items:
                return None
            if len(items) == 1:
                return self.ev(items[0], sc)
            head = items[0]
            if head[0] == "id" and (head[1] in self.special or head[1] in self.funcs or sc.find(head[1]) is not None):
                return self.ev_call(("call", head, list(items[1:])), sc)
            raise SkillError("*Error* eval: bad parenthesised expression")
        if k == "bin":
            return self.ev_bin(node, sc)
        if k == "un":
            v = self.ev(node[2], sc)
            if node[1] == "!":
                return None if _truthy(v) else True
            return -v if node[1] == "-" else v
        if k == "assign":
            return self.ev_assign(node, sc)
        if k == "attr":
            return self.getattr(self.ev(node[1], sc), node[2])
        raise SkillError(f"*Error* eval: bad node {k}")

    def lookup(self, name: str, sc: Scope) -> Any:
        if name == "nil":
            return None
        if name == "t":
            return True
        s = sc.find(name)
        if s is not None:
            return s.vars[name]
        if name in self.funcs:
            return self.funcs[name]
        raise SkillError(f"*Error* eval: unbound variable - {name}")

    def getattr(self, obj: Any, name: str) -> Any:
        if obj is None:
            return None
        if isinstance(obj, list):
            return [self.getattr(o, name) for o in obj]
        if hasattr(obj, "skill_get"):
            return obj.skill_get(name)
        raise SkillError(f"*Error* ~>: cannot read attribute {name} of", obj)

    def ev_assign(self, node: tuple, sc: Scope) -> Any:
        target, rhs = node[1], node[2]
        value = self.ev(rhs, sc)
        if target[0] == "id":
            name = target[1]
            s = sc.find(name)
            (s or self.globals).vars[name] = value
            return value
        if target[0] == "attr":
            obj = self.ev(target[1], sc)
            if hasattr(obj, "skill_set"):
                obj.skill_set(target[2], value)
                return value
            raise SkillError("*Error* ~>: cannot set attribute", target[2])
        if target[0] == "call" and target[1] == ("id", "arrayref"):
            raise SkillError("*Error* arrays are not supported")
        raise SkillError("*Error* assignment: bad target")

    def ev_bin(self, node: tuple, sc: Scope) -> Any:
        op = node[1]
        if op == "&&":
            a = self.ev(node[2], sc)
            return self.ev(node[3], sc) if _truthy(a) else None
        if op == "||":
            a = self.ev(node[2], sc)
            return a if _truthy(a) else self.ev(node[3], sc)
        a, b = self.ev(node[2], sc), self.ev(node[3], sc)
        try:
            if op == "+":
                if isinstance(a, str) and isinstance(b, str):
                    return a + b
                return a + b
            if op == "-":
                return a - b
            if op == "*":
                return a * b
            if op == "/":
                if isinstance(a, int) and isinstance(b, int) and b != 0 and a % b == 0:
                    return a // b
                return a / b
            if op == "%":
                return a % b
            if op == "**":
                return a ** b
            if op == "==":
                return True if self._eq(a, b) else None
            if op == "!=":
                return None if self._eq(a, b) else True
            if op == "<":
                return True if a < b else None
            if op == ">":
                return True if a > b else None
            if op == "<=":
                return True if a <= b else None
            if op == ">=":
                return True if a >= b else None
        except TypeError:
            raise SkillError(f"*Error* {op}: bad operands", a, b)
        except ZeroDivisionError:
            raise SkillError("*Error* /: division by zero")
        raise SkillError(f"*Error* bad operator {op}")

    @staticmethod
    def _eq(a: Any, b: Any) -> bool:
        if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
            return a == b
        return a == b

    def ev_call(self, node: tuple, sc: Scope) -> Any:
        fnode, argnodes = node[1], node[2]
        if fnode[0] == "id":
            name = fnode[1]
            sp = self.special.get(name)
            if sp is not None and sc.find(name) is None:
                return sp(argnodes, sc)
            f = None
            s = sc.find(name)
            if s is not None:
                f = s.vars[name]
            elif name in self.funcs:
                f = self.funcs[name]
            if f is None:
                raise SkillError(f"*Error* eval: undefined function - {name}")
        else:
            f = self.ev(fnode, sc)
        args: list[Any] = []
        kwargs_present = False
        for a in argnodes:
            args.append(self.ev(a, sc))
        if isinstance(f, Lambda):
            return self.call(f, args)
        # keyword arguments (?name value) are passed as a trailing dict
        kw: dict[str, Any] = {}
        pos: list[Any] = []
        i = 0
        while i < len(args):
            a = args[i]
            if isinstance(a, Keyword) and argnodes[i][0] == "kw":
                kw[str(a)] = args[i + 1] if i + 1 < len(args) else None
                i += 2
                kwargs_present = True
            else:
                pos.append(a)
                i += 1
        try:
            return f(*pos, **kw) if kwargs_present else f(*pos)
        except SkillError:
            raise
        except _Return:
            raise
        except TypeError as exc:
            raise SkillError(f"*Error* {getattr(f, '__name__', 'function')}: bad arguments ({exc})")

    # ---- special forms + core builtins
    def _install_core(self) -> None:
        sp, fn = self.special, self.funcs
        interp = self

        def split_then_else(args: list) -> tuple[list, list, list]:
            cond: list = []
            then_b: list = []
            else_b: list = []
            cur = cond
            seen_then = False
            for a in args:
                if a == ("id", "then"):
                    cur = then_b
                    seen_then = True
                elif a == ("id", "else"):
                    cur = else_b
                elif a == ("id", "elseif"):
                    raise SkillError("*Error* if: elseif is not supported")
                else:
                    cur.append(a)
            if not seen_then:
                # if(cond thenExpr elseExpr) form
                if len(args) < 2:
                    raise SkillError("*Error* if: too few arguments")
                return [args[0]], [args[1]], list(args[2:3])
            return cond, then_b, else_b

        def run(body: list, sc: Scope) -> Any:
            res = None
            for b in body:
                res = interp.ev(b, sc)
            return res

        def f_if(args, sc):
            cond, then_b, else_b = split_then_else(args)
            c = run(cond, sc)
            return run(then_b, sc) if _truthy(c) else run(else_b, sc)

        def f_when(args, sc):
            return run(args[1:], sc) if _truthy(interp.ev(args[0], sc)) else None

        def f_unless(args, sc):
            return None if _truthy(interp.ev(args[0], sc)) else run(args[1:], sc)

        def f_progn(args, sc):
            return run(args, sc)

        def make_scope(varspec, sc):
            new = Scope(sc)
            # initial values are evaluated in the OUTER scope (let semantics), then bound together
            for name, init in varspec_items(varspec):
                new.vars[name] = interp.ev(init, sc) if init is not None else None
            return new

        def varspec_items(spec):
            """(a b) or ((a 1) (b 2)) -> [(name, init-node or None), ...]"""
            if spec[0] != "paren":
                if spec[0] == "id":
                    return [(spec[1], None)]
                raise SkillError("*Error* let: bad variable specification")
            out = []
            for nd in spec[1]:
                if nd[0] == "id":
                    out.append((nd[1], None))
                elif nd[0] == "paren" and nd[1] and nd[1][0][0] == "id":
                    init = nd[1][1] if len(nd[1]) > 1 else None
                    out.append((nd[1][0][1], init))
                else:
                    raise SkillError("*Error* let: bad variable specification")
            return out

        def f_let(args, sc):
            new = make_scope(args[0], sc)
            return run(args[1:], new)

        def f_prog(args, sc):
            new = make_scope(args[0], sc)
            try:
                return run(args[1:], new)
            except _Return as r:
                return r.value

        def f_return(args, sc):
            raise _Return(interp.ev(args[0], sc) if args else None)

        def f_foreach(args, sc):
            var = args[0][1]
            lst = interp.ev(args[1], sc)
            res = None
            if lst is None:
                return None
            new = Scope(sc)
            for item in list(lst):
                new.vars[var] = item
                res = run(args[2:], new)
            return lst

        def f_for(args, sc):
            var = args[0][1]
            lo, hi = interp.ev(args[1], sc), interp.ev(args[2], sc)
            new = Scope(sc)
            for i in range(int(lo), int(hi) + 1):
                new.vars[var] = i
                run(args[3:], new)
            return None

        def f_while(args, sc):
            while _truthy(interp.ev(args[0], sc)):
                run(args[1:], sc)
            return None

        def f_and(args, sc):
            res: Any = True
            for a in args:
                res = interp.ev(a, sc)
                if not _truthy(res):
                    return None
            return res

        def f_or(args, sc):
            for a in args:
                res = interp.ev(a, sc)
                if _truthy(res):
                    return res
            return None

        def f_lambda(args, sc):
            params = [n for n, _ in varspec_items(args[0])]
            return Lambda(params, args[1:], sc)

        def f_procedure(args, sc):
            head = args[0]  # name(arg1 arg2)
            if head[0] != "call":
                raise SkillError("*Error* procedure: bad header")
            name = head[1][1]
            params = []
            optional = False
            for a in head[2]:
                if a[0] == "id" and a[1] == "@optional":
                    optional = True
                elif a[0] == "id":
                    params.append(a[1])
            interp.funcs[name] = Lambda(params, args[1:], interp.globals, name)
            return Sym(name)

        def f_unwind(args, sc):
            try:
                return interp.ev(args[0], sc)
            finally:
                run(args[1:], sc)

        def f_errset(args, sc):
            try:
                v = interp.ev(args[0], sc)
                return [v]
            except SkillError as e:
                info = [0, 0, 0, 0, [e.message] + list(e.extra)]
                interp.globals.vars["errset.errset"] = info
                show = len(args) > 1 and _truthy(interp.ev(args[1], sc))
                if show:
                    interp.output.append(e.message + "\n")
                return None
            except _Return:
                raise
            except RecursionError:
                interp.globals.vars["errset.errset"] = [0, 0, 0, 0, ["*Error* recursion too deep"]]
                return None

        def f_boundp(args, sc):
            name = interp.ev(args[0], sc)
            return True if (sc.find(str(name)) is not None or str(name) in ("nil", "t")) else None

        def f_quote(args, sc):
            return args[0][1] if args and args[0][0] == "quoted" else None

        def clause_values(node):
            """case() clause head -> (is_default, [literal values])"""
            if node[0] == "id":
                if node[1] in ("t", "else"):
                    return True, []
                return False, [Sym(node[1])]
            if node[0] in ("num", "str"):
                return False, [node[1]]
            if node[0] == "paren":
                vals = []
                for it in node[1]:
                    d, v = clause_values(it)
                    if d:
                        return True, []
                    vals.extend(v)
                return False, vals
            return False, []

        def f_case(args, sc):
            key = interp.ev(args[0], sc)
            for clause in args[1:]:
                if clause[0] != "paren" or not clause[1]:
                    raise SkillError("*Error* case: bad clause")
                default, vals = clause_values(clause[1][0])
                if default or any(key == v for v in vals):
                    return run(clause[1][1:], sc)
            return None

        def f_cond(args, sc):
            for clause in args:
                if clause[0] != "paren" or not clause[1]:
                    raise SkillError("*Error* cond: bad clause")
                test = interp.ev(clause[1][0], sc)
                if _truthy(test):
                    return run(clause[1][1:], sc) if len(clause[1]) > 1 else test
            return None

        def f_setof(args, sc):
            var = args[0][1]
            lst = interp.ev(args[1], sc)
            out = []
            new = Scope(sc)
            for item in list(lst or []):
                new.vars[var] = item
                if _truthy(run(args[2:], new)):
                    out.append(item)
            return out or None

        def f_mapcan(args, sc):
            raise SkillError("*Error* mapcan: use mapcar+append")

        for name, f in {
            "if": f_if, "when": f_when, "unless": f_unless, "progn": f_progn, "let": f_let, "prog": f_prog,
            "return": f_return, "foreach": f_foreach, "for": f_for, "while": f_while, "and": f_and, "or": f_or,
            "lambda": f_lambda, "procedure": f_procedure, "defun": f_procedure, "unwindProtect": f_unwind,
            "errset": f_errset, "boundp": f_boundp, "case": f_case, "caseq": f_case, "cond": f_cond, "setof": f_setof,
        }.items():
            sp[name] = f

        # ---- plain functions
        def to_list(x):
            return [] if x is None else x

        def car(x):
            return x[0] if x else None

        def cdr(x):
            return list(x[1:]) if x and len(x) > 1 else None

        def cons(a, b):
            return [a] + list(to_list(b))

        def nth(n, x):
            x = to_list(x)
            return x[n] if 0 <= n < len(x) else None

        def mapcar(f, *lists):
            ls = [to_list(l) for l in lists]
            if not ls:
                return None
            n = min(len(l) for l in ls)
            return [interp.call(f, [l[i] for l in ls]) for i in range(n)] or None

        def mapc(f, *lists):
            mapcar(f, *lists)
            return lists[0] if lists else None

        def exists(f, lst):
            for x in to_list(lst):
                r = interp.call(f, [x])
                if _truthy(r):
                    return r
            return None

        def forall(f, lst):
            for x in to_list(lst):
                if not _truthy(interp.call(f, [x])):
                    return None
            return True

        def member(x, lst):
            lst = to_list(lst)
            for i, v in enumerate(lst):
                if v == x:
                    return list(lst[i:])
            return None

        def assoc(key, alist):
            for pair in to_list(alist):
                if isinstance(pair, list) and pair and pair[0] == key:
                    return pair
            return None

        def sort_(lst, f):
            import functools

            def cmp(a, b):
                if _truthy(interp.call(f, [a, b])):
                    return -1
                if _truthy(interp.call(f, [b, a])):
                    return 1
                return 0

            return sorted(to_list(lst), key=functools.cmp_to_key(cmp)) or None

        def substring(s, a, b=None):
            # SKILL substring(str from to) is 1-based and inclusive
            n = len(s)
            end = n if b is None else b
            return s[a - 1:end]

        def build_string(lst, sep=" "):
            return str(sep).join(skill_str(x) for x in to_list(lst))

        def parse_string(s, sep=" \t\n"):
            parts = re.split("[" + re.escape(sep) + "]+", s)
            return [p for p in parts if p] or None

        def printf_(fmt, *args):
            interp.output.append(skill_sprintf(fmt, list(args)))
            return True

        def println_(x):
            interp.output.append(skill_repr(x) + "\n")
            return True

        def evalstring(s):
            return interp.eval_text(s)

        def load_(path, *rest):
            import os

            p = str(path)
            if not os.path.isabs(p) and interp.cwd_load_root:
                p = os.path.join(interp.cwd_load_root, p)
            try:
                with open(p, "r", encoding="utf-8") as fh:
                    text = fh.read()
            except OSError as exc:
                raise SkillError(f"*Error* load: can't open file {p} ({exc.strerror})")
            interp.eval_text(text)
            return True

        def error_(fmt, *args):
            msg = skill_sprintf(str(fmt), list(args))
            raise SkillError(msg if msg.startswith("*Error*") else "*Error* " + msg)

        def to_num(x):
            return float(x) if isinstance(x, (int, float)) else float(str(x))

        simple = {
            "list": lambda *a: list(a) or None,
            "car": car, "cdr": cdr, "cons": cons,
            "cadr": lambda x: car(cdr(x)), "cddr": lambda x: cdr(cdr(x)), "caar": lambda x: car(car(x)),
            "cdar": lambda x: cdr(car(x)), "caddr": lambda x: car(cdr(cdr(x))), "cadar": lambda x: car(cdr(car(x))),
            "nth": nth, "nthcdr": lambda n, x: (list(to_list(x)[n:]) or None),
            "last": lambda x: ([to_list(x)[-1]] if x else None),
            "length": lambda x: len(x) if x is not None else 0,
            "append": lambda *ls: [y for l in ls for y in to_list(l)] or None,
            "reverse": lambda x: (list(reversed(to_list(x))) or None),
            "mapcar": mapcar, "mapc": mapc, "exists": exists, "forall": forall, "member": member, "memq": member,
            "assoc": assoc, "assq": assoc, "sort": sort_, "sortcar": lambda l, f=None: sorted(to_list(l), key=lambda p: p[0]) or None,
            "remove": lambda x, l: [y for y in to_list(l) if y != x] or None,
            "remdup": lambda l: (list(dict.fromkeys(map(lambda v: v if not isinstance(v, list) else tuple(v), to_list(l)))) or None),
            "not": lambda x: None if _truthy(x) else True,
            "null": lambda x: True if not _truthy(x) else None,
            "atom": lambda x: None if isinstance(x, list) and x else True,
            "listp": lambda x: True if (x is None or isinstance(x, list)) else None,
            "stringp": lambda x: True if isinstance(x, str) and not isinstance(x, Sym) else None,
            "symbolp": lambda x: True if isinstance(x, Sym) else None,
            "numberp": lambda x: True if isinstance(x, (int, float)) and not isinstance(x, bool) else None,
            "integerp": lambda x: True if isinstance(x, int) and not isinstance(x, bool) else None,
            "floatp": lambda x: True if isinstance(x, float) else None,
            "fixp": lambda x: True if isinstance(x, int) and not isinstance(x, bool) else None,
            "equal": lambda a, b: True if a == b else None, "eq": lambda a, b: True if a == b else None,
            "plus": lambda *a: sum(a), "difference": lambda a, b: a - b, "times": lambda *a: math.prod(a),
            "quotient": lambda a, b: a / b, "add1": lambda a: a + 1, "sub1": lambda a: a - 1,
            "abs": abs, "min": min, "max": max, "sqrt": lambda x: math.sqrt(x),
            "float": lambda x: float(x), "fix": lambda x: int(x), "round": lambda x: int(round(x)),
            "floor": lambda x: int(math.floor(x)), "ceiling": lambda x: int(math.ceil(x)),
            "exp": math.exp, "log": math.log, "sin": math.sin, "cos": math.cos, "mod": lambda a, b: a % b,
            "evenp": lambda x: True if x % 2 == 0 else None, "oddp": lambda x: True if x % 2 else None,
            "zerop": lambda x: True if x == 0 else None, "plusp": lambda x: True if x > 0 else None,
            "minusp": lambda x: True if x < 0 else None,
            "xCoord": lambda p: p[0], "yCoord": lambda p: p[1],
            "sprintf": lambda dst, fmt, *a: skill_sprintf(str(fmt), list(a)),
            "strcat": lambda *a: "".join(skill_str(x) for x in a if x is not None),
            "substring": substring, "strlen": len, "lowerCase": lambda s: s.lower(), "upperCase": lambda s: s.upper(),
            "buildString": build_string, "parseString": parse_string,
            "atoi": lambda s: int(str(s)), "atof": lambda s: float(str(s)),
            "stringToSymbol": lambda s: Sym(s), "symbolToString": lambda s: str(s),
            "stringToTime": lambda s: None, "getCurrentTime": lambda: time.strftime("%b %d %H:%M:%S %Y"),
            "printf": printf_, "println": println_, "fprintf": lambda port, fmt, *a: printf_(fmt, *a),
            "evalstring": evalstring, "load": load_, "error": error_, "warn": lambda fmt, *a: printf_("*WARNING* " + str(fmt) + "\n", *a),
            "hiFlush": lambda: None, "hiRedraw": lambda: None, "gc": lambda *a: None,
            "getShellEnvVar": lambda n: __import__("os").environ.get(n), "setShellEnvVar": lambda n, v: __import__("os").environ.__setitem__(n, v) or True,
            "getVersion": lambda *a: "sub-version IC6.1.8-64b.500.17 (virtual)",
            "isCallable": lambda x: True if (x in interp.funcs if isinstance(x, str) else callable(x)) else None,
            "funcall": lambda f, *a: interp.call(f, list(a)),
            "apply": lambda f, args: interp.call(f, list(to_list(args))),
        }
        for k, v in simple.items():
            fn[k] = v
        # arithmetic on keywords commonly used as procedures
        interp.globals.vars["errset.errset"] = None
