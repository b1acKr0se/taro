import re

from .errors import FrontmatterError

_LINE = re.compile(r"([A-Za-z_][A-Za-z0-9_-]*):(?: +(.*))?")
_INT = re.compile(r"[+-]?[0-9]+")
_ESC = {'"': '"', "\\": "\\", "n": "\n", "t": "\t"}


def _dq(s: str, i: int) -> tuple[str, int]:
    """Parse a double-quoted string starting at s[i]. Returns (value, index after)."""
    out = []
    i += 1
    n = len(s)
    while i < n:
        c = s[i]
        if c == "\\":
            if i + 1 >= n:
                raise FrontmatterError("unterminated string")
            nxt = s[i + 1]
            if nxt not in _ESC:
                raise FrontmatterError(f"invalid escape: \\{nxt}")
            out.append(_ESC[nxt])
            i += 2
        elif c == '"':
            return "".join(out), i + 1
        else:
            out.append(c)
            i += 1
    raise FrontmatterError("unterminated string")


def _sq(s: str, i: int) -> tuple[str, int]:
    out = []
    i += 1
    n = len(s)
    while i < n:
        c = s[i]
        if c == "'":
            if i + 1 < n and s[i + 1] == "'":
                out.append("'")
                i += 2
            else:
                return "".join(out), i + 1
        else:
            out.append(c)
            i += 1
    raise FrontmatterError("unterminated string")


def _scalar(v: str):
    if v == "true":
        return True
    if v == "false":
        return False
    if _INT.fullmatch(v):
        return int(v)
    return v


def _list(v: str) -> list:
    if not v.endswith("]") or len(v) < 2:
        raise FrontmatterError("unterminated list")
    inner = v[1:-1]
    if not inner.strip():
        return []
    items = []
    i = 0
    n = len(inner)
    while True:
        while i < n and inner[i].isspace():
            i += 1
        if i >= n:
            raise FrontmatterError("empty list item")
        c = inner[i]
        if c == '"' or c == "'":
            val, i = (_dq if c == '"' else _sq)(inner, i)
            while i < n and inner[i].isspace():
                i += 1
            if i < n and inner[i] != ",":
                raise FrontmatterError("unexpected text after quoted item")
        else:
            j = inner.find(",", i)
            if j == -1:
                j = n
            raw = inner[i:j].strip()
            if not raw:
                raise FrontmatterError("empty list item")
            if "[" in raw:
                raise FrontmatterError("nested list")
            val = _scalar(raw)
            i = j
        items.append(val)
        if i >= n:
            break
        i += 1  # skip comma
    return items


def _value(raw: str):
    v = raw.strip()
    if v == "":
        return ""
    if v[0] == '"':
        val, end = _dq(v, 0)
        if end != len(v):
            raise FrontmatterError("unexpected text after string")
        return val
    if v[0] == "'":
        val, end = _sq(v, 0)
        if end != len(v):
            raise FrontmatterError("unexpected text after string")
        return val
    if v[0] == "[":
        return _list(v)
    return _scalar(v)


def parse(text: str) -> tuple[dict, str]:
    text = text.replace("\r\n", "\n")
    lines = text.split("\n")
    if lines[0] != "---":
        return {}, text
    end = None
    for idx in range(1, len(lines)):
        if lines[idx] == "---":
            end = idx
            break
    if end is None:
        raise FrontmatterError("unterminated front matter")
    meta: dict = {}
    for line in lines[1:end]:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        m = _LINE.fullmatch(line)
        if not m:
            raise FrontmatterError(f"invalid front matter line: {line!r}")
        key = m.group(1)
        if key in meta:
            raise FrontmatterError(f"duplicate key: {key}")
        meta[key] = _value(m.group(2) or "")
    return meta, "\n".join(lines[end + 1:])
