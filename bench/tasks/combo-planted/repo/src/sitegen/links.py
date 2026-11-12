import re

_A_TAG = re.compile(r"<a\s[^>]*>", re.I)
_HREF = re.compile(r"""(?<![\w-])href\s*=\s*(?:"([^"]*)"|'([^']*)')""", re.I)
_ID = re.compile(r"""(?<![\w-])id\s*=\s*(?:"([^"]*)"|'([^']*)')""", re.I)
_SCHEME = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*:")


def _val(m) -> str:
    return m.group(1) if m.group(1) is not None else m.group(2)


def _resolve(page: str, rest: str) -> tuple[str, bool]:
    """Returns (resolved path, is_directory_style)."""
    if rest.startswith("/"):
        joined = rest
    else:
        joined = page[: page.rfind("/") + 1] + rest
    segs: list[str] = []
    for seg in joined.split("/"):
        if seg == "" or seg == ".":
            continue
        if seg == "..":
            if segs:
                segs.pop()
            continue
        segs.append(seg)
    result = "/" + "/".join(segs)
    last = joined.split("/")[-1]
    directory = joined.endswith("/") or last in (".", "..") or not segs
    return result, directory


def find_broken_links(pages: dict[str, str]) -> list[tuple[str, str]]:
    for key in pages:
        if not key.startswith("/"):
            raise ValueError(f"page path must start with '/': {key!r}")
    ids: dict[str, set[str]] = {}
    for path, content in pages.items():
        if path.endswith(".html"):
            ids[path] = {_val(m) for m in _ID.finditer(content)}
    broken: list[tuple[str, str]] = []
    for page in sorted(pages):
        if not page.endswith(".html"):
            continue
        for tag in _A_TAG.finditer(pages[page]):
            hm = _HREF.search(tag.group(0))
            if not hm:
                continue
            href = _val(hm)
            if href == "" or href.startswith("//") or _SCHEME.match(href):
                continue
            rest, _, frag = href.partition("#")
            rest = rest.split("?", 1)[0]
            if rest == "":
                target = page
            else:
                result, directory = _resolve(page, rest)
                if directory:
                    target = result.rstrip("/") + "/index.html"
                else:
                    target = result
                    if target not in pages and result + "/index.html" in pages:
                        target = result + "/index.html"
            if target not in pages:
                broken.append((page, href))
                continue
            if frag and not (target in ids and frag in ids[target]):
                broken.append((page, href))
    return broken
