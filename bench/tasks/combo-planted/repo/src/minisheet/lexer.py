"""Formula tokenizer."""
from __future__ import annotations

import re
from dataclasses import dataclass


class FormulaSyntaxError(ValueError):
    def __init__(self, msg: str, pos: int):
        super().__init__(msg)
        self.msg = msg
        self.pos = pos


@dataclass
class Token:
    kind: str
    text: str
    pos: int


_NUM = re.compile(r"(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")
_REFSHAPE = r"\$?[A-Za-z]+\$?[0-9]+"
_RANGE = re.compile(_REFSHAPE + ":" + _REFSHAPE)
_REF = re.compile(_REFSHAPE)
_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_NAME_CONT = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_")
_OPS2 = ("<>", "<=", ">=")
_OPS1 = "+-*/^&=<>%"
_ASCII_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"


def tokenize(text: str) -> list[Token]:
    toks: list[Token] = []
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch in " \t":
            i += 1
            continue
        if ch in "0123456789" or (ch == "." and i + 1 < n and text[i + 1] in "0123456789"):
            m = _NUM.match(text, i)
            toks.append(Token("NUM", m.group(), i))
            i = m.end()
            continue
        if ch == '"':
            j = i + 1
            buf = []
            while True:
                if j >= n:
                    raise FormulaSyntaxError("unterminated string", i)
                if text[j] == '"':
                    if j + 1 < n and text[j + 1] == '"':
                        buf.append('"')
                        j += 2
                        continue
                    j += 1
                    break
                buf.append(text[j])
                j += 1
            toks.append(Token("STR", "".join(buf), i))
            i = j
            continue
        if ch == "$" or ch in _ASCII_LETTERS or ch == "_":
            m = _RANGE.match(text, i)
            if m:
                toks.append(Token("RANGE", m.group().upper(), i))
                i = m.end()
                continue
            m = _REF.match(text, i)
            if m:
                end = m.end()
                nxt = text[end] if end < n else ""
                if nxt not in _NAME_CONT and nxt != "(":
                    toks.append(Token("REF", m.group().upper(), i))
                    i = end
                    continue
            m = _NAME.match(text, i)
            if m:
                toks.append(Token("NAME", m.group().upper(), i))
                i = m.end()
                continue
            raise FormulaSyntaxError(f"unexpected character {ch!r}", i)
        if text[i:i + 2] in _OPS2:
            toks.append(Token("OP", text[i:i + 2], i))
            i += 2
            continue
        if ch in _OPS1:
            toks.append(Token("OP", ch, i))
            i += 1
            continue
        if ch == "(":
            toks.append(Token("LPAREN", ch, i))
        elif ch == ")":
            toks.append(Token("RPAREN", ch, i))
        elif ch == ",":
            toks.append(Token("COMMA", ch, i))
        else:
            raise FormulaSyntaxError(f"unexpected character {ch!r}", i)
        i += 1
    return toks
