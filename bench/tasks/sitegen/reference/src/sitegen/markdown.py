import re
from html import escape as _esc


def esc(s: str) -> str:
    return _esc(s, quote=True)


_HEADING = re.compile(r"(#{1,6}) +(.+)")
_HR = re.compile(r"-{3,}|\*{3,}|_{3,}")
_UL = re.compile(r"[-*+] +(.*)")
_OL = re.compile(r"[0-9]+\. +(.*)")
_CODE = re.compile(r"`([^`]+)`")
_IMG = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)\)")
_LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")
_PH_BASE = 0xF0000
_PH_RE = re.compile("[\U000F0000-\U000FFFFF]")


def _emphasis(t: str) -> str:
    t = re.sub(r"\*\*\*(?!\s)(.+?)(?<!\s)\*\*\*", r"<strong><em>\1</em></strong>", t)
    t = re.sub(r"\*\*(?!\s)(.+?)(?<!\s)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(
        r"(?<![A-Za-z0-9])__(?!\s)(.+?)(?<!\s)__(?![A-Za-z0-9])",
        r"<strong>\1</strong>",
        t,
    )
    t = re.sub(r"\*(?!\s)(.+?)(?<!\s)\*", r"<em>\1</em>", t)
    t = re.sub(
        r"(?<![A-Za-z0-9])_(?!\s)(.+?)(?<!\s)_(?![A-Za-z0-9])", r"<em>\1</em>", t
    )
    return t


def _inline(text: str) -> str:
    store: list[str] = []

    def ph(html: str) -> str:
        store.append(html)
        return chr(_PH_BASE + len(store) - 1)

    text = _CODE.sub(lambda m: ph("<code>" + esc(m.group(1)) + "</code>"), text)
    text = esc(text)
    text = _IMG.sub(
        lambda m: ph(f'<img src="{m.group(2)}" alt="{m.group(1)}">'), text
    )
    text = _LINK.sub(
        lambda m: ph(f'<a href="{m.group(2)}">{_emphasis(m.group(1))}</a>'), text
    )
    text = _emphasis(text)
    while True:
        new = _PH_RE.sub(lambda m: store[ord(m.group(0)) - _PH_BASE], text)
        if new == text:
            break
        text = new
    return text


def _starts_block(line: str) -> bool:
    return bool(
        line.startswith("```")
        or _HEADING.fullmatch(line)
        or _HR.fullmatch(line)
        or line.startswith(">")
        or _UL.fullmatch(line)
        or _OL.fullmatch(line)
    )


def render(md: str) -> str:
    md = md.replace("\r\n", "\n")
    raw = md.split("\n")
    blocks: list[str] = []
    i = 0
    n = len(raw)
    while i < n:
        line = raw[i].rstrip()
        if line == "":
            i += 1
            continue
        if line.startswith("```"):
            info = line[3:].strip()
            lang = info.split()[0] if info else ""
            i += 1
            code = []
            while i < n and raw[i].rstrip() != "```":
                code.append(raw[i])
                i += 1
            if i < n:
                i += 1
            body = esc("\n".join(code))
            if lang:
                blocks.append(
                    f'<pre><code class="language-{esc(lang)}">{body}</code></pre>'
                )
            else:
                blocks.append(f"<pre><code>{body}</code></pre>")
            continue
        m = _HEADING.fullmatch(line)
        if m:
            lvl = len(m.group(1))
            blocks.append(f"<h{lvl}>{_inline(m.group(2))}</h{lvl}>")
            i += 1
            continue
        if _HR.fullmatch(line):
            blocks.append("<hr>")
            i += 1
            continue
        if line.startswith(">"):
            inner = []
            while i < n and raw[i].rstrip().startswith(">"):
                l = raw[i].rstrip()[1:]
                if l.startswith(" "):
                    l = l[1:]
                inner.append(l)
                i += 1
            html = render("\n".join(inner))
            if html == "":
                blocks.append("<blockquote></blockquote>")
            else:
                blocks.append(f"<blockquote>\n{html}\n</blockquote>")
            continue
        mu = _UL.fullmatch(line)
        mo = None if mu else _OL.fullmatch(line)
        if mu or mo:
            rx, tag = (_UL, "ul") if mu else (_OL, "ol")
            items = []
            while i < n:
                mm = rx.fullmatch(raw[i].rstrip())
                if not mm:
                    break
                items.append(f"<li>{_inline(mm.group(1))}</li>")
                i += 1
            blocks.append(f"<{tag}>\n" + "\n".join(items) + f"\n</{tag}>")
            continue
        para = [line.strip()]
        i += 1
        while i < n:
            l = raw[i].rstrip()
            if l == "" or _starts_block(l):
                break
            para.append(l.strip())
            i += 1
        blocks.append("<p>" + _inline("\n".join(para)) + "</p>")
    return "\n".join(blocks)
