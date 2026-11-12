import argparse
import sys
from pathlib import Path

from .errors import SitegenError
from .links import find_broken_links
from .site import build


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="sitegen", description="Static site generator")
    sub = p.add_subparsers(dest="command", required=True)
    b = sub.add_parser("build", help="build a site")
    b.add_argument("src")
    b.add_argument("out")
    c = sub.add_parser("check", help="check built output for broken links")
    c.add_argument("out")
    return p


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    try:
        args = _parser().parse_args(argv)
    except SystemExit as e:
        code = e.code
        if code is None:
            return 0
        return code if isinstance(code, int) else 2

    if args.command == "build":
        try:
            r = build(Path(args.src), Path(args.out))
        except SitegenError as e:
            print(f"error: {e}", file=sys.stderr)
            return 1
        print(
            f"built: {r.posts} posts, {r.tag_pages} tag pages, "
            f"{r.static_files} static files, {r.drafts} drafts skipped"
        )
        return 0

    out = Path(args.out)
    if not out.is_dir():
        print(f"error: not a directory: {args.out}", file=sys.stderr)
        return 1
    pages: dict[str, str] = {}
    html_count = 0
    for f in sorted(out.rglob("*")):
        if not f.is_file():
            continue
        key = "/" + f.relative_to(out).as_posix()
        if key.endswith(".html"):
            pages[key] = f.read_bytes().decode("utf-8", errors="replace")
            html_count += 1
        else:
            pages[key] = ""
    broken = find_broken_links(pages)
    for page, href in broken:
        print(f"broken: {page} -> {href}")
    print(f"checked {html_count} pages, {len(broken)} broken links")
    return 1 if broken else 0
