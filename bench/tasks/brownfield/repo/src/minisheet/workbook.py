"""Workbook: cells, dependency tracking and recalculation."""
from __future__ import annotations

from .evaluator import evaluate
from .lexer import FormulaSyntaxError
from .parser import (
    BinOp,
    Call,
    CellRef,
    Node,
    Percent,
    RangeRef,
    UnaryOp,
    parse,
)
from .refs import Ref, parse_ref, to_a1
from .values import CIRC, VALUE, Empty, parse_number_text


class _Cell:
    __slots__ = ("raw", "formula", "ast", "cells", "ranges", "value")

    def __init__(self, raw, formula, value=Empty):
        self.raw = raw
        self.formula = formula
        self.ast = None
        self.cells = frozenset()
        self.ranges = ()
        self.value = value


def _collect(node: Node, cells: set, ranges: list) -> None:
    if isinstance(node, CellRef):
        cells.add((node.ref.col, node.ref.row))
    elif isinstance(node, RangeRef):
        ranges.append((node.start.col, node.start.row, node.end.col, node.end.row))
    elif isinstance(node, (UnaryOp, Percent)):
        _collect(node.operand, cells, ranges)
    elif isinstance(node, BinOp):
        _collect(node.left, cells, ranges)
        _collect(node.right, cells, ranges)
    elif isinstance(node, Call):
        for a in node.args:
            _collect(a, cells, ranges)


def _in_rect(key, rect) -> bool:
    c, r = key
    return rect[0] <= c <= rect[2] and rect[1] <= r <= rect[3]


def _strict_number(s: str):
    s = s.strip()
    if s == "":
        return None
    return parse_number_text(s)


class Workbook:
    def __init__(self):
        self._cells: dict = {}
        self._dependents: dict = {}      # (c, r) -> set of formula keys using that cell directly
        self._range_users: dict = {}     # formula key -> tuple of rects
        self._circ: set = set()
        self.recalc_count = 0
        self._last_changed: list = []

    # -- helpers ---------------------------------------------------------
    @staticmethod
    def _key(ref_str: str):
        ref = parse_ref(ref_str)
        return (ref.col, ref.row)

    @staticmethod
    def _name(key) -> str:
        return to_a1(Ref(key[0], key[1]))

    def _replace_with(self, other: "Workbook") -> None:
        self.__dict__.update(other.__dict__)

    def get_cell(self, ref: Ref):
        cell = self._cells.get((ref.col, ref.row))
        return Empty if cell is None else cell.value

    # -- public API ------------------------------------------------------
    def get(self, ref_str: str):
        cell = self._cells.get(self._key(ref_str))
        return Empty if cell is None else cell.value

    def raw(self, ref_str: str) -> str:
        cell = self._cells.get(self._key(ref_str))
        return "" if cell is None else cell.raw

    def cells(self) -> list:
        keys = sorted(self._cells, key=lambda k: (k[1], k[0]))
        return [self._name(k) for k in keys]

    @property
    def last_changed(self) -> list:
        return list(self._last_changed)

    def set(self, ref_str: str, raw: str, *, literal: bool = False) -> None:
        key = self._key(ref_str)
        self._unregister(key)
        if raw == "":
            self._cells.pop(key, None)
        elif not literal and raw[0] == "=":
            cell = _Cell(raw, True, VALUE)
            try:
                cell.ast = parse(raw[1:])
            except FormulaSyntaxError:
                cell.ast = None
            if cell.ast is not None:
                cs, rs = set(), []
                _collect(cell.ast, cs, rs)
                cell.cells = frozenset(cs)
                cell.ranges = tuple(rs)
            self._cells[key] = cell
            self._register(key, cell)
        else:
            value = raw
            if not literal:
                x = _strict_number(raw)
                if x is not None:
                    value = x
                else:
                    up = raw.strip().upper()
                    if up == "TRUE":
                        value = True
                    elif up == "FALSE":
                        value = False
            self._cells[key] = _Cell(raw, False, value)
        self._recalc(key)

    # -- dependency graph -----------------------------------------------
    def _unregister(self, key) -> None:
        cell = self._cells.get(key)
        if cell is None or not cell.formula:
            return
        for d in cell.cells:
            s = self._dependents.get(d)
            if s is not None:
                s.discard(key)
                if not s:
                    del self._dependents[d]
        self._range_users.pop(key, None)

    def _register(self, key, cell) -> None:
        for d in cell.cells:
            self._dependents.setdefault(d, set()).add(key)
        if cell.ranges:
            self._range_users[key] = cell.ranges

    def _direct_dependents(self, key):
        out = set(self._dependents.get(key, ()))
        for f, rects in self._range_users.items():
            if f not in out and any(_in_rect(key, r) for r in rects):
                out.add(f)
        return out

    def _recalc(self, start) -> None:
        # D = start + transitive dependents (BFS order)
        order = [start]
        seen = {start}
        i = 0
        while i < len(order):
            for d in sorted(self._direct_dependents(order[i]), key=lambda k: (k[1], k[0])):
                if d not in seen:
                    seen.add(d)
                    order.append(d)
            i += 1

        # edges restricted to D: formula -> deps within D
        edges = {}
        for k in order:
            cell = self._cells.get(k)
            if cell is None or not cell.formula:
                edges[k] = []
                continue
            es = [d for d in cell.cells if d in seen]
            if cell.ranges:
                es.extend(m for m in order if m not in cell.cells
                          and any(_in_rect(m, r) for r in cell.ranges))
            edges[k] = es

        sccs = _tarjan(order, edges)
        circ_new = set()
        result = []
        for comp in sccs:
            cyc = len(comp) > 1 or comp[0] in edges[comp[0]]
            if not cyc:
                k = comp[0]
                cell = self._cells.get(k)
                if cell is not None and cell.formula:
                    for d in cell.cells:
                        if d in self._circ and d not in seen:
                            cyc = True
                            break
                    if not cyc and cell.ranges:
                        for d in self._circ:
                            if d not in seen and any(_in_rect(d, r) for r in cell.ranges):
                                cyc = True
                                break
                    if not cyc and any(d in circ_new for d in edges[k]):
                        cyc = True
            if cyc:
                circ_new.update(comp)
            result.append((comp, cyc))

        for k in order:
            self._circ.discard(k)
        self._circ |= circ_new

        final = []
        for comp, cyc in result:
            for k in comp:
                final.append(k)
                cell = self._cells.get(k)
                if cell is None or not cell.formula:
                    continue
                if cyc:
                    cell.value = CIRC
                    continue
                self.recalc_count += 1
                if cell.ast is None:
                    cell.value = VALUE
                else:
                    cell.value = evaluate(cell.ast, self.get_cell)
        if final[0] != start:
            final.remove(start)
            final.insert(0, start)
        self._last_changed = [self._name(k) for k in final]


def _tarjan(nodes, edges):
    """Iterative Tarjan. Returns SCCs, dependencies before dependents."""
    index = {}
    low = {}
    on = set()
    stack = []
    out = []
    counter = 0
    for root in nodes:
        if root in index:
            continue
        work = [(root, iter(edges[root]))]
        index[root] = low[root] = counter
        counter += 1
        stack.append(root)
        on.add(root)
        while work:
            v, it = work[-1]
            advanced = False
            for w in it:
                if w not in index:
                    index[w] = low[w] = counter
                    counter += 1
                    stack.append(w)
                    on.add(w)
                    work.append((w, iter(edges[w])))
                    advanced = True
                    break
                if w in on:
                    low[v] = min(low[v], index[w])
            if advanced:
                continue
            work.pop()
            if work:
                p = work[-1][0]
                low[p] = min(low[p], low[v])
            if low[v] == index[v]:
                comp = []
                while True:
                    w = stack.pop()
                    on.discard(w)
                    comp.append(w)
                    if w == v:
                        break
                out.append(comp)
    return out
