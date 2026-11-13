import re
from datetime import date as _date

_DATE_RE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _x(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _parse_date(s) -> _date:
    if not isinstance(s, str) or not _DATE_RE.fullmatch(s):
        raise ValueError(f"invalid date: {s!r}")
    try:
        return _date(int(s[:4]), int(s[5:7]), int(s[8:10]))
    except ValueError as e:
        raise ValueError(f"invalid date: {s!r}") from e


def build_rss(site: dict, posts: list[dict]) -> str:
    for key in ("title", "url"):
        if key not in site:
            raise ValueError(f"site is missing {key!r}")
    for p in posts:
        for key in ("title", "url", "date"):
            if key not in p:
                raise ValueError(f"post is missing {key!r}")
        _parse_date(p["date"])
    ordered = sorted(posts, key=lambda p: p["url"])
    ordered = sorted(ordered, key=lambda p: p["date"], reverse=True)[:20]
    base = site["url"].rstrip("/")
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0">',
        "<channel>",
        f"<title>{_x(site['title'])}</title>",
        f"<link>{_x(base + '/')}</link>",
        f"<description>{_x(site['title'])}</description>",
    ]
    for p in ordered:
        d = _parse_date(p["date"])
        link = base + "/" + p["url"].lstrip("/")
        pub = f"{_DAYS[d.weekday()]}, {d.day:02d} {_MONTHS[d.month - 1]} {d.year:04d} 00:00:00 +0000"
        lines += [
            "<item>",
            f"<title>{_x(p['title'])}</title>",
            f"<link>{_x(link)}</link>",
            f"<guid>{_x(link)}</guid>",
            f"<pubDate>{pub}</pubDate>",
            f"<description>{_x(p.get('summary', ''))}</description>",
            "</item>",
        ]
    lines += ["</channel>", "</rss>"]
    return "\n".join(lines)
