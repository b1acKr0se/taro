"""Built-in functions."""
from __future__ import annotations

import math
from decimal import ROUND_HALF_UP, Decimal, localcontext

from .values import (
    VALUE,
    DIV0,
    Empty,
    ErrorValue,
    to_bool,
    to_number,
    to_text,
)

FUNCTIONS: dict = {}
LAZY: set = set()


def register(name: str, *, lazy: bool = False):
    def deco(fn):
        FUNCTIONS[name.upper()] = fn
        if lazy:
            LAZY.add(name.upper())
        else:
            LAZY.discard(name.upper())
        return fn
    return deco


def _first_error(args):
    for a in args:
        if isinstance(a, list):
            for x in a:
                if isinstance(x, ErrorValue):
                    return x
        elif isinstance(a, ErrorValue):
            return a
    return None


def _prep(args, lo, hi=None, ranges=False):
    """Arity, first error, list check. Returns an ErrorValue or None."""
    if len(args) < lo or (hi is not None and len(args) > hi):
        return VALUE
    err = _first_error(args)
    if err is not None:
        return err
    if not ranges and any(isinstance(a, list) for a in args):
        return VALUE
    return None


def _collect_numbers(args, count_mode=False):
    out = []
    for a in args:
        if isinstance(a, list):
            out.extend(x for x in a if isinstance(x, float))
        elif isinstance(a, bool):
            out.append(1.0 if a else 0.0)
        elif isinstance(a, float):
            out.append(a)
        elif a is Empty or a == "":
            continue
        else:
            x = to_number(a)
            if isinstance(x, ErrorValue):
                if count_mode:
                    continue
                return x
            out.append(x)
    return out


def _finite(x: float):
    return x if math.isfinite(x) else VALUE


@register("SUM")
def _sum(*args):
    err = _prep(args, 1, None, True)
    if err is not None:
        return err
    nums = _collect_numbers(args)
    if isinstance(nums, ErrorValue):
        return nums
    total = 0.0
    for x in nums:
        total += x
    return _finite(total)


@register("AVERAGE")
def _average(*args):
    err = _prep(args, 1, None, True)
    if err is not None:
        return err
    nums = _collect_numbers(args)
    if isinstance(nums, ErrorValue):
        return nums
    if not nums:
        return DIV0
    total = 0.0
    for x in nums:
        total += x
    return _finite(total / len(nums))


@register("MIN")
def _min(*args):
    err = _prep(args, 1, None, True)
    if err is not None:
        return err
    nums = _collect_numbers(args)
    if isinstance(nums, ErrorValue):
        return nums
    return min(nums) if nums else 0.0


@register("MAX")
def _max(*args):
    err = _prep(args, 1, None, True)
    if err is not None:
        return err
    nums = _collect_numbers(args)
    if isinstance(nums, ErrorValue):
        return nums
    return max(nums) if nums else 0.0


@register("COUNT")
def _count(*args):
    err = _prep(args, 1, None, True)
    if err is not None:
        return err
    nums = _collect_numbers(args, count_mode=True)
    return float(len(nums))


@register("ROUND")
def _round(*args):
    err = _prep(args, 2, 2)
    if err is not None:
        return err
    x = to_number(args[0])
    if isinstance(x, ErrorValue):
        return x
    n = to_number(args[1])
    if isinstance(n, ErrorValue):
        return n
    n = math.trunc(n)
    if n > 400:
        return x
    if n < -400:
        return 0.0
    with localcontext() as ctx:
        ctx.prec = 900
        d = Decimal(repr(x)).quantize(Decimal(1).scaleb(-n), rounding=ROUND_HALF_UP)
        r = float(d)
    return 0.0 if r == 0 else r


@register("ABS")
def _abs(*args):
    err = _prep(args, 1, 1)
    if err is not None:
        return err
    x = to_number(args[0])
    return x if isinstance(x, ErrorValue) else abs(x)


@register("IF", lazy=True)
def _if(*args):
    if len(args) < 2 or len(args) > 3:
        return VALUE
    c = args[0]()
    if isinstance(c, list):
        return VALUE
    if isinstance(c, ErrorValue):
        return c
    b = to_bool(c)
    if isinstance(b, ErrorValue):
        return b
    if b:
        res = args[1]()
    elif len(args) == 3:
        res = args[2]()
    else:
        return False
    return VALUE if isinstance(res, list) else res


def _bools(args):
    out = []
    for a in args:
        if isinstance(a, list):
            for x in a:
                if isinstance(x, bool):
                    out.append(x)
                elif isinstance(x, float):
                    out.append(x != 0)
        elif a is Empty:
            continue
        else:
            b = to_bool(a)
            if isinstance(b, ErrorValue):
                return b
            out.append(b)
    return out


@register("AND")
def _and(*args):
    err = _prep(args, 1, None, True)
    if err is not None:
        return err
    bs = _bools(args)
    if isinstance(bs, ErrorValue):
        return bs
    if not bs:
        return VALUE
    return all(bs)


@register("OR")
def _or(*args):
    err = _prep(args, 1, None, True)
    if err is not None:
        return err
    bs = _bools(args)
    if isinstance(bs, ErrorValue):
        return bs
    if not bs:
        return VALUE
    return any(bs)


@register("NOT")
def _not(*args):
    err = _prep(args, 1, 1)
    if err is not None:
        return err
    b = to_bool(args[0])
    return b if isinstance(b, ErrorValue) else (not b)


@register("CONCAT")
def _concat(*args):
    err = _prep(args, 1, None, True)
    if err is not None:
        return err
    parts = []
    for a in args:
        if isinstance(a, list):
            parts.extend(to_text(x) for x in a)
        else:
            parts.append(to_text(a))
    return "".join(parts)


@register("LEN")
def _len(*args):
    err = _prep(args, 1, 1)
    if err is not None:
        return err
    return float(len(to_text(args[0])))


@register("UPPER")
def _upper(*args):
    err = _prep(args, 1, 1)
    if err is not None:
        return err
    return to_text(args[0]).upper()


@register("LOWER")
def _lower(*args):
    err = _prep(args, 1, 1)
    if err is not None:
        return err
    return to_text(args[0]).lower()


def _side(args, left: bool):
    err = _prep(args, 1, 2)
    if err is not None:
        return err
    s = to_text(args[0])
    n = 1
    if len(args) == 2:
        x = to_number(args[1])
        if isinstance(x, ErrorValue):
            return x
        n = math.trunc(x)
    if n < 0:
        return VALUE
    if n >= len(s):
        return s
    if n == 0:
        return ""
    return s[:n] if left else s[len(s) - n:]


@register("LEFT")
def _left(*args):
    return _side(args, True)


@register("RIGHT")
def _right(*args):
    return _side(args, False)
