"""CSV import/export."""
from __future__ import annotations

import csv
import io

from .refs import MAX_COL, MAX_ROW, Ref, to_a1
from .values import ErrorValue, to_text
from .workbook import Workbook

try:
    csv.field_size_limit(2**30)
except OverflowError:  # pragma: no cover
    pass


def load_csv_text(text: str, formulas: bool = True) -> Workbook:
    wb = Workbook()
    try:
        records = list(csv.reader(io.StringIO(text, newline=""), delimiter=",", quotechar='"'))
    except csv.Error as e:
        raise ValueError(str(e)) from e
    for i, rec in enumerate(records):
        for j, field in enumerate(rec):
            if field == "":
                continue
            if j > MAX_COL or i > MAX_ROW:
                raise ValueError("cell out of bounds")
            ref = to_a1(Ref(j, i))
            wb.set(ref, field, literal=(not formulas and field[0] == "="))
    return wb


def load_csv(path, formulas: bool = True) -> Workbook:
    with open(path, "r", encoding="utf-8", newline="") as f:
        text = f.read()
    return load_csv_text(text, formulas)


def _field(s: str) -> str:
    if any(ch in s for ch in ',"\n\r'):
        return '"' + s.replace('"', '""') + '"'
    return s


def to_csv_text(wb: Workbook, values: bool = True) -> str:
    keys = []
    for name in wb.cells():
        ref = _parse(name)
        keys.append((ref.row, ref.col, name))
    if not keys:
        return ""
    last_row = max(k[0] for k in keys)
    max_col = {}
    for r, c, _ in keys:
        max_col[r] = max(max_col.get(r, -1), c)
    lines = []
    for r in range(last_row + 1):
        if r not in max_col:
            lines.append("\n")
            continue
        fields = []
        for c in range(max_col[r] + 1):
            name = to_a1(Ref(c, r))
            if values:
                v = wb.get(name)
                text = str(v) if isinstance(v, ErrorValue) else to_text(v)
            else:
                text = wb.raw(name)
            fields.append(_field(text))
        lines.append(",".join(fields) + "\n")
    return "".join(lines)


def _parse(name):
    from .refs import parse_ref
    return parse_ref(name)


def save_csv(wb: Workbook, path, values: bool = True) -> None:
    text = to_csv_text(wb, values)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)
