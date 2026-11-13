import re
from html import escape as _esc

from .errors import TemplateError


def esc(s: str) -> str:
    return _esc(s, quote=True)


class _Undefined:
    def __repr__(self) -> str:
        return "UNDEFINED"


UNDEFINED = _Undefined()

_NAME = r"[A-Za-z_][A-Za-z0-9_]*"
_PATH = re.compile(_NAME + r"(?:\." + r"(?:" + _NAME + r"|[0-9]+))*")
_FILTER_NAME = re.compile(r"[a-z]+")
_NOT = re.compile(r"not\s+(.*)", re.S)
_IF = re.compile(r"(if|elif)\s+(.*)", re.S)
_FOR = re.compile(r"for\s+(" + _NAME + r")\s+in\s+(.*)", re.S)
_FILTERS = {
    "upper": False,
    "lower": False,
    "title": False,
    "escape": False,
    "safe": False,
    "default": True,
    "join": True,
    "length": False,
}


def _parse_expr(src: str):
    """Returns (segments, [(filter, arg)])."""
    m = _PATH.match(src)
    if not m:
        raise TemplateError(f"invalid expression: {src!r}")
    path = m.group(0).split(".")
    i = m.end()
    n = len(src)
    filters = []
    while True:
        while i < n and src[i].isspace():
            i += 1
        if i >= n:
            break
        if src[i] != "|":
            raise TemplateError(f"invalid expression: {src!r}")
        i += 1
        while i < n and src[i].isspace():
            i += 1
        fm = _FILTER_NAME.match(src, i)
        if not fm:
            raise TemplateError(f"invalid filter in: {src!r}")
        name = fm.group(0)
        i = fm.end()
        if i < n and not (src[i].isspace() or src[i] in ":|"):
            raise TemplateError(f"invalid filter in: {src!r}")
        while i < n and src[i].isspace():
            i += 1
        arg = None
        if i < n and src[i] == ":":
            i += 1
            while i < n and src[i].isspace():
                i += 1
            if i >= n or src[i] not in "\"'":
                raise TemplateError(f"invalid filter argument in: {src!r}")
            q = src[i]
            j = src.find(q, i + 1)
            if j == -1:
                raise TemplateError(f"unterminated filter argument in: {src!r}")
            arg = src[i + 1:j]
            i = j + 1
        if name not in _FILTERS:
            raise TemplateError(f"unknown filter: {name}")
        if _FILTERS[name] and arg is None:
            raise TemplateError(f"filter {name} requires an argument")
        if not _FILTERS[name] and arg is not None:
            raise TemplateError(f"filter {name} takes no argument")
        filters.append((name, arg))
    return path, filters


def _parse_cond(src: str):
    negate = False
    m = _NOT.fullmatch(src)
    if m:
        negate = True
        src = m.group(1).strip()
    path, filters = _parse_expr(src)
    return negate, path, filters


def _tokenize(template: str):
    tokens = []
    i = 0
    n = len(template)
    while i < n:
        a = template.find("{{", i)
        b = template.find("{%", i)
        cands = [x for x in (a, b) if x != -1]
        if not cands:
            tokens.append(("text", template[i:]))
            break
        s = min(cands)
        if s > i:
            tokens.append(("text", template[i:s]))
        if s == a:
            e = template.find("}}", s + 2)
            kind = "var"
        else:
            e = template.find("%}", s + 2)
            kind = "stmt"
        if e == -1:
            raise TemplateError("unclosed tag")
        tokens.append((kind, template[s + 2:e].strip()))
        i = e + 2
    return tokens


def _parse(template: str):
    tokens = _tokenize(template)
    pos = 0

    def block(terms: set[str]):
        """Parse nodes until a statement in terms. Returns (nodes, terminator)."""
        nonlocal pos
        nodes = []
        while pos < len(tokens):
            kind, val = tokens[pos]
            pos += 1
            if kind == "text":
                nodes.append(("text", val))
            elif kind == "var":
                path, filters = _parse_expr(val)
                nodes.append(("var", path, filters))
            else:
                if val in ("else", "endif", "endfor"):
                    if val in terms:
                        return nodes, (val, None)
                    raise TemplateError(f"unexpected {val}")
                m = _IF.fullmatch(val)
                if m:
                    kw, rest = m.group(1), m.group(2).strip()
                    cond = _parse_cond(rest)
                    if kw == "elif":
                        if "elif" in terms:
                            return nodes, ("elif", cond)
                        raise TemplateError("unexpected elif")
                    nodes.append(parse_if(cond))
                    continue
                m = _FOR.fullmatch(val)
                if m:
                    path, filters = _parse_expr(m.group(2).strip())
                    body, _ = block({"endfor"})
                    nodes.append(("for", m.group(1), path, filters, body))
                    continue
                raise TemplateError(f"unknown statement: {val!r}")
        if terms:
            raise TemplateError("unclosed block")
        return nodes, None

    def parse_if(cond):
        branches = []
        else_body = None
        while True:
            body, term = block({"elif", "else", "endif"})
            branches.append((cond, body))
            if term[0] == "endif":
                break
            if term[0] == "elif":
                cond = term[1]
                continue
            # else
            else_body, term = block({"endif"})
            break
        return ("if", branches, else_body)

    nodes, _ = block(set())
    return nodes


def _lookup(path, scopes, context):
    first = path[0]
    cur = UNDEFINED
    for sc in reversed(scopes):
        if first in sc:
            cur = sc[first]
            break
    else:
        if first in context:
            cur = context[first]
    for seg in path[1:]:
        if isinstance(cur, dict):
            cur = cur.get(seg, UNDEFINED)
        elif isinstance(cur, (list, tuple)) and seg.isascii() and seg.isdigit():
            idx = int(seg)
            cur = cur[idx] if idx < len(cur) else UNDEFINED
        else:
            return UNDEFINED
    return cur


def _s(v) -> str:
    if v is UNDEFINED or v is None:
        return ""
    return str(v)


def _apply(value, safe, filters):
    for name, arg in filters:
        if name == "upper":
            value = _s(value).upper()
        elif name == "lower":
            value = _s(value).lower()
        elif name == "title":
            value = _s(value).title()
        elif name == "escape":
            value = esc(_s(value))
            safe = True
        elif name == "safe":
            safe = True
        elif name == "default":
            if value is UNDEFINED or value is None or value == "":
                value = arg
                safe = False
        elif name == "join":
            if isinstance(value, (list, tuple)):
                value = arg.join(str(x) for x in value)
            else:
                value = _s(value)
            safe = False
        elif name == "length":
            if value is UNDEFINED or value is None:
                value = 0
            elif isinstance(value, (str, list, tuple, dict)):
                value = len(value)
            else:
                value = len(str(value))
    return value, safe


def _eval(path, filters, scopes, context):
    return _apply(_lookup(path, scopes, context), False, filters)


def _truthy(v) -> bool:
    return False if v is UNDEFINED else bool(v)


def _run(nodes, scopes, context, out):
    for node in nodes:
        t = node[0]
        if t == "text":
            out.append(node[1])
        elif t == "var":
            value, safe = _eval(node[1], node[2], scopes, context)
            text = _s(value)
            out.append(text if safe else esc(text))
        elif t == "if":
            for (negate, path, filters), body in node[1]:
                value, _ = _eval(path, filters, scopes, context)
                if _truthy(value) != negate:
                    _run(body, scopes, context, out)
                    break
            else:
                if node[2] is not None:
                    _run(node[2], scopes, context, out)
        else:
            _, name, path, filters, body = node
            value, _ = _eval(path, filters, scopes, context)
            if isinstance(value, (list, tuple)):
                items = list(value)
            elif isinstance(value, dict):
                items = list(value.keys())
            else:
                items = []
            total = len(items)
            for idx, item in enumerate(items):
                scope = {
                    name: item,
                    "loop": {
                        "index": idx + 1,
                        "index0": idx,
                        "first": idx == 0,
                        "last": idx == total - 1,
                        "length": total,
                    },
                }
                scopes.append(scope)
                try:
                    _run(body, scopes, context, out)
                finally:
                    scopes.pop()


def render(template: str, context: dict) -> str:
    nodes = _parse(template)
    out: list[str] = []
    _run(nodes, [], context, out)
    return "".join(out)
