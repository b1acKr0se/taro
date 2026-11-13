"""AST evaluator."""
from __future__ import annotations

import math

from . import functions
from .parser import (
    BadRef,
    BinOp,
    Bool,
    Call,
    CellRef,
    Name,
    Num,
    Percent,
    RangeRef,
    Str,
    UnaryOp,
)
from .refs import Ref
from .values import (
    DIV0,
    NAME,
    REF,
    VALUE,
    Empty,
    ErrorValue,
    to_number,
    to_text,
)


def _range_values(node: RangeRef, get_cell):
    a, b = node.start, node.end
    return [get_cell(Ref(c, r))
            for r in range(a.row, b.row + 1)
            for c in range(a.col, b.col + 1)]


def _rank(v):
    if isinstance(v, bool):
        return 2
    if isinstance(v, float):
        return 0
    return 1


def _compare(op, l, r):
    if l is Empty and r is Empty:
        l = r = 0.0
    elif l is Empty:
        l = {0: 0.0, 1: "", 2: False}[_rank(r)]
    elif r is Empty:
        r = {0: 0.0, 1: "", 2: False}[_rank(l)]
    kl = (_rank(l), l.lower() if isinstance(l, str) else l)
    kr = (_rank(r), r.lower() if isinstance(r, str) else r)
    if op == "=":
        return kl == kr
    if op == "<>":
        return kl != kr
    if op == "<":
        return kl < kr
    if op == "<=":
        return kl <= kr
    if op == ">":
        return kl > kr
    return kl >= kr


def _arith(op, a, b):
    if op == "+":
        res = a + b
    elif op == "-":
        res = a - b
    elif op == "*":
        res = a * b
    elif op == "/":
        if b == 0:
            return DIV0
        res = a / b
    else:  # ^
        if a == 0 and b < 0:
            return DIV0
        if a < 0 and b != math.floor(b):
            return VALUE
        try:
            res = a ** b
        except (OverflowError, ZeroDivisionError, ValueError):
            return VALUE
        if isinstance(res, complex):
            return VALUE
    if not math.isfinite(res):
        return VALUE
    return res


def _ev(node, get_cell, allow_range=False):
    if isinstance(node, Num):
        return node.value
    if isinstance(node, Str):
        return node.value
    if isinstance(node, Bool):
        return node.value
    if isinstance(node, CellRef):
        return get_cell(node.ref)
    if isinstance(node, RangeRef):
        return _range_values(node, get_cell) if allow_range else VALUE
    if isinstance(node, BadRef):
        return REF
    if isinstance(node, Name):
        return NAME
    if isinstance(node, UnaryOp):
        x = to_number(_ev(node.operand, get_cell))
        if isinstance(x, ErrorValue):
            return x
        return -x if node.op == "-" else x
    if isinstance(node, Percent):
        x = to_number(_ev(node.operand, get_cell))
        if isinstance(x, ErrorValue):
            return x
        return x / 100
    if isinstance(node, BinOp):
        l = _ev(node.left, get_cell)
        r = _ev(node.right, get_cell)
        if isinstance(l, ErrorValue):
            return l
        if isinstance(r, ErrorValue):
            return r
        op = node.op
        if op in ("=", "<>", "<", "<=", ">", ">="):
            return _compare(op, l, r)
        conv = to_text if op == "&" else to_number
        lc = conv(l)
        if isinstance(lc, ErrorValue):
            return lc
        rc = conv(r)
        if isinstance(rc, ErrorValue):
            return rc
        if op == "&":
            return lc + rc
        return _arith(op, lc, rc)
    if isinstance(node, Call):
        fn = functions.FUNCTIONS.get(node.name)
        if fn is None:
            return NAME
        if node.name in functions.LAZY:
            thunks = [(lambda a=a: _ev(a, get_cell, True)) for a in node.args]
            return fn(*thunks)
        args = [_ev(a, get_cell, True) for a in node.args]
        return fn(*args)
    return VALUE


def evaluate(node, get_cell):
    v = _ev(node, get_cell)
    if isinstance(v, list):
        return VALUE
    if v is Empty:
        return 0.0
    return v
