"""Value types and coercions."""
from __future__ import annotations

import math
import re
from dataclasses import dataclass


class _Empty:
    _inst = None

    def __new__(cls):
        if cls._inst is None:
            cls._inst = super().__new__(cls)
        return cls._inst

    def __bool__(self):
        return False

    def __repr__(self):
        return "Empty"


Empty = _Empty()


@dataclass(frozen=True)
class ErrorValue:
    code: str

    def __str__(self):
        return self.code


DIV0 = ErrorValue("#DIV/0!")
VALUE = ErrorValue("#VALUE!")
REF = ErrorValue("#REF!")
NAME = ErrorValue("#NAME?")
CIRC = ErrorValue("#CIRC!")

_NUM_RE = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")


def parse_number_text(s: str):
    """Return float if s (stripped) matches the number grammar and is finite, else None."""
    s = s.strip()
    if s == "":
        return 0.0
    if not _NUM_RE.fullmatch(s):
        return None
    try:
        x = float(s)
    except ValueError:
        return None
    return x if math.isfinite(x) else None


def to_number(v):
    if isinstance(v, ErrorValue):
        return v
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, float):
        return v
    if v is Empty:
        return 0.0
    if isinstance(v, str):
        x = parse_number_text(v)
        return VALUE if x is None else x
    return VALUE


def to_bool(v):
    if isinstance(v, ErrorValue):
        return v
    if isinstance(v, bool):
        return v
    if isinstance(v, float):
        return v != 0
    if v is Empty:
        return False
    if isinstance(v, str):
        s = v.strip().upper()
        if s == "TRUE":
            return True
        if s == "FALSE":
            return False
    return VALUE


def format_number(x: float) -> str:
    s = format(x, ".15g")
    return "0" if s == "-0" else s


def to_text(v):
    if isinstance(v, ErrorValue):
        return v
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, float):
        return format_number(v)
    if v is Empty:
        return ""
    if isinstance(v, str):
        return v
    return VALUE


def display_text(v) -> str:
    """Cell text as used by `show` and the server's `display` field."""
    if isinstance(v, ErrorValue):
        return v.code
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, float):
        return f"{v:.2f}"
    if isinstance(v, str):
        return v.replace("\n", " ").replace("\r", " ")
    return ""
