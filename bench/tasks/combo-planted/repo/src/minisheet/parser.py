"""Formula parser."""
from __future__ import annotations

from dataclasses import dataclass

from .lexer import FormulaSyntaxError, Token, tokenize
from .refs import Ref, parse_range, parse_ref


class Node:
    pass


@dataclass(frozen=True)
class Num(Node):
    value: float


@dataclass(frozen=True)
class Str(Node):
    value: str


@dataclass(frozen=True)
class Bool(Node):
    value: bool


@dataclass(frozen=True)
class CellRef(Node):
    ref: Ref


@dataclass(frozen=True)
class RangeRef(Node):
    start: Ref
    end: Ref


@dataclass(frozen=True)
class BadRef(Node):
    text: str


@dataclass(frozen=True)
class Name(Node):
    name: str


@dataclass(frozen=True)
class UnaryOp(Node):
    op: str
    operand: Node


@dataclass(frozen=True)
class Percent(Node):
    operand: Node


@dataclass(frozen=True)
class BinOp(Node):
    op: str
    left: Node
    right: Node


@dataclass(frozen=True)
class Call(Node):
    name: str
    args: tuple


_CMP = ("=", "<>", "<", "<=", ">", ">=")


class _Parser:
    def __init__(self, text: str):
        self.text = text
        self.toks = tokenize(text)
        self.i = 0

    def peek(self) -> Token | None:
        return self.toks[self.i] if self.i < len(self.toks) else None

    def error(self, tok: Token | None, msg: str = "syntax error"):
        return FormulaSyntaxError(msg, tok.pos if tok else len(self.text))

    def is_op(self, ops) -> bool:
        t = self.peek()
        return t is not None and t.kind == "OP" and t.text in ops

    def binary(self, sub, ops):
        left = sub()
        while self.is_op(ops):
            op = self.toks[self.i].text
            self.i += 1
            left = BinOp(op, left, sub())
        return left

    def expr(self):
        return self.binary(self.concat, _CMP)

    def concat(self):
        return self.binary(self.additive, ("&",))

    def additive(self):
        return self.binary(self.term, ("+", "-"))

    def term(self):
        return self.binary(self.power, ("*", "/"))

    def power(self):
        return self.binary(self.percent, ("^",))

    def percent(self):
        node = self.unary()
        while self.is_op(("%",)):
            self.i += 1
            node = Percent(node)
        return node

    def unary(self):
        if self.is_op(("-", "+")):
            op = self.toks[self.i].text
            self.i += 1
            return UnaryOp(op, self.unary())
        return self.primary()

    def primary(self):
        t = self.peek()
        if t is None:
            raise self.error(None, "unexpected end of formula")
        k = t.kind
        if k == "NUM":
            self.i += 1
            return Num(float(t.text))
        if k == "STR":
            self.i += 1
            return Str(t.text)
        if k == "REF":
            self.i += 1
            try:
                return CellRef(parse_ref(t.text))
            except ValueError:
                return BadRef(t.text)
        if k == "RANGE":
            self.i += 1
            try:
                a, b = parse_range(t.text)
                return RangeRef(a, b)
            except ValueError:
                return BadRef(t.text)
        if k == "NAME":
            self.i += 1
            nxt = self.peek()
            if nxt is not None and nxt.kind == "LPAREN":
                self.i += 1
                return self.call_args(t.text)
            if t.text in ("TRUE", "FALSE"):
                return Bool(t.text == "TRUE")
            return Name(t.text)
        if k == "LPAREN":
            self.i += 1
            node = self.expr()
            c = self.peek()
            if c is None or c.kind != "RPAREN":
                raise self.error(c, "expected ')'")
            self.i += 1
            return node
        raise self.error(t, f"unexpected token {t.text!r}")

    def call_args(self, name: str):
        args = []
        t = self.peek()
        if t is not None and t.kind == "RPAREN":
            self.i += 1
            return Call(name, ())
        while True:
            args.append(self.expr())
            t = self.peek()
            if t is not None and t.kind == "COMMA":
                self.i += 1
                continue
            if t is not None and t.kind == "RPAREN":
                self.i += 1
                return Call(name, tuple(args))
            raise self.error(t, "expected ',' or ')'")


def parse(text: str) -> Node:
    p = _Parser(text)
    node = p.expr()
    t = p.peek()
    if t is not None:
        raise p.error(t)
    return node
