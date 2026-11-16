"""Cell references."""
from __future__ import annotations

import re
from dataclasses import dataclass

MAX_COL = 701
MAX_ROW = 9998

_REF_FULL = re.compile(r"(\$?)([A-Za-z]{1,2})(\$?)([1-9][0-9]{0,3})")


@dataclass(frozen=True)
class Ref:
    col: int
    row: int
    abs_col: bool = False
    abs_row: bool = False


def col_letters(col: int) -> str:
    if not 0 <= col <= MAX_COL:
        raise ValueError(f"column out of range: {col}")
    n = col + 1
    out = ""
    while n:
        n, rem = divmod(n - 1, 26)
        out = chr(65 + rem) + out
    return out


def parse_ref(s: str) -> Ref:
    m = _REF_FULL.fullmatch(s) if isinstance(s, str) else None
    if m is None:
        raise ValueError(f"bad reference: {s!r}")
    n = 0
    for ch in m.group(2).upper():
        n = n * 26 + (ord(ch) - 64)
    return Ref(n - 1, int(m.group(4)) - 1, m.group(1) == "$", m.group(3) == "$")


def parse_range(s: str) -> tuple[Ref, Ref]:
    if not isinstance(s, str) or s.count(":") != 1:
        raise ValueError(f"bad range: {s!r}")
    a_s, b_s = s.split(":")
    a, b = parse_ref(a_s), parse_ref(b_s)
    lo_col, lo_abs_col = (a.col, a.abs_col) if a.col <= b.col else (b.col, b.abs_col)
    hi_col, hi_abs_col = (a.col, a.abs_col) if a.col >= b.col else (b.col, b.abs_col)
    lo_row, lo_abs_row = (a.row, a.abs_row) if a.row <= b.row else (b.row, b.abs_row)
    hi_row, hi_abs_row = (a.row, a.abs_row) if a.row >= b.row else (b.row, b.abs_row)
    return (Ref(lo_col, lo_row, lo_abs_col, lo_abs_row),
            Ref(hi_col, hi_row, hi_abs_col, hi_abs_row))


def to_a1(ref: Ref) -> str:
    if not (0 <= ref.col <= MAX_COL and 0 <= ref.row <= MAX_ROW):
        raise ValueError(f"reference out of range: {ref!r}")
    return (("$" if ref.abs_col else "") + col_letters(ref.col)
            + ("$" if ref.abs_row else "") + str(ref.row + 1))
