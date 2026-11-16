import json
import os
import re
import tomllib
from dataclasses import dataclass, field
from datetime import date as _date
from pathlib import Path

from . import frontmatter, markdown, templates
from .errors import BuildError, FrontmatterError, SitegenError, TemplateError
from .feed import build_rss
from .search import build_index
from .slug import slugify, unique_slug

_DATE_RE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


@dataclass
class BuildReport:
    posts: int
    drafts: int
    tag_pages: int
    static_files: int
    output_files: list[str] = field(default_factory=list)


def _read_text(path: Path) -> str:
    try:
        return path.read_bytes().decode("utf-8")
    except (OSError, UnicodeDecodeError) as e:
        raise BuildError(f"{path}: cannot read: {e}") from e


def _valid_date(s) -> bool:
    if not isinstance(s, str) or not _DATE_RE.fullmatch(s):
        return False
    try:
        _date(int(s[:4]), int(s[5:7]), int(s[8:10]))
    except ValueError:
        return False
    return True


def _render(path: Path, template: str, context: dict) -> str:
    try:
        return templates.render(template, context)
    except TemplateError as e:
        raise BuildError(f"{path}: {e}") from e


def build(src, out) -> BuildReport:
    src = Path(src)
    out = Path(out)
    if not src.is_dir():
        raise BuildError(f"source directory not found: {src}")

    # site.toml
    toml_path = src / "site.toml"
    if not toml_path.is_file():
        raise BuildError(f"{toml_path}: not found")
    try:
        with open(toml_path, "rb") as f:
            site = tomllib.load(f)
    except tomllib.TOMLDecodeError as e:
        raise BuildError(f"{toml_path}: invalid TOML: {e}") from e
    except (OSError, UnicodeDecodeError) as e:
        raise BuildError(f"{toml_path}: cannot read: {e}") from e
    for key in ("title", "url", "author"):
        if key not in site:
            raise BuildError(f"{toml_path}: missing required key {key!r}")
        if not isinstance(site[key], str):
            raise BuildError(f"{toml_path}: key {key!r} must be a string")

    # templates
    tpl = {}
    for name in ("post", "index", "tag"):
        p = src / "templates" / f"{name}.html"
        if not p.is_file():
            raise BuildError(f"{p}: template not found")
        tpl[name] = (p, _read_text(p))

    # content
    content_dir = src / "content"
    files: list[Path] = []
    if content_dir.is_dir():
        try:
            entries = list(content_dir.iterdir())
        except OSError as e:
            raise BuildError(f"{content_dir}: {e}") from e
        files = sorted(
            (e for e in entries
             if e.name.endswith(".md") and not e.name.startswith(".") and e.is_file()),
            key=lambda e: e.name,
        )

    taken: set[str] = set()
    posts: list[dict] = []
    drafts = 0
    for f in files:
        text = _read_text(f)
        try:
            meta, body = frontmatter.parse(text)
        except FrontmatterError as e:
            raise BuildError(f"{f}: {e}") from e
        if "draft" in meta:
            if not isinstance(meta["draft"], bool):
                raise BuildError(f"{f}: 'draft' must be a boolean")
            if meta["draft"]:
                drafts += 1
                continue
        title = meta.get("title")
        if not isinstance(title, str) or not title.strip():
            raise BuildError(f"{f}: 'title' is required and must be a non-empty string")
        date = meta.get("date")
        if not _valid_date(date):
            raise BuildError(f"{f}: 'date' is required and must be a valid YYYY-MM-DD date")
        fm_slug = meta.get("slug", "")
        if not isinstance(fm_slug, str):
            raise BuildError(f"{f}: 'slug' must be a string")
        tags = meta.get("tags", [])
        if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
            raise BuildError(f"{f}: 'tags' must be a list of strings")
        summary = meta.get("summary", "")
        if not isinstance(summary, str):
            raise BuildError(f"{f}: 'summary' must be a string")
        slug = unique_slug(fm_slug if fm_slug else title, taken)
        taken.add(slug)
        posts.append(
            {
                "title": title,
                "slug": slug,
                "date": date,
                "tags": list(tags),
                "summary": summary,
                "url": f"/posts/{slug}/",
                "content": markdown.render(body),
                "tag_links": [],
                "_body": body,
            }
        )

    # tags (posts are still in filename order here)
    tag_map: dict[str, dict] = {}
    post_tag_slugs: dict[str, set[str]] = {}
    for p in posts:
        seen: list[str] = []
        for t in p["tags"]:
            ts = slugify(t)
            if not ts:
                continue
            if ts not in tag_map:
                tag_map[ts] = {"name": t, "slug": ts, "url": f"/tags/{ts}/", "count": 0}
            if ts not in seen:
                seen.append(ts)
                tag_map[ts]["count"] += 1
        post_tag_slugs[p["slug"]] = set(seen)
        p["tag_links"] = [
            {"name": tag_map[ts]["name"], "slug": ts, "url": tag_map[ts]["url"]}
            for ts in seen
        ]

    posts.sort(key=lambda p: p["slug"])
    posts.sort(key=lambda p: p["date"], reverse=True)
    tag_list = [tag_map[k] for k in sorted(tag_map)]

    # generated outputs
    generated: dict[str, str] = {}
    path, text = tpl["index"]
    pub_posts = [{k: v for k, v in p.items() if k != "_body"} for p in posts]
    generated["index.html"] = _render(
        path, text, {"site": site, "posts": pub_posts, "tags": tag_list}
    )
    by_slug = {p["slug"]: p for p in pub_posts}
    path, text = tpl["post"]
    for p in pub_posts:
        generated[f"posts/{p['slug']}/index.html"] = _render(
            path, text, {"site": site, "post": p}
        )
    path, text = tpl["tag"]
    for t in tag_list:
        tposts = [p for p in pub_posts if t["slug"] in post_tag_slugs[p["slug"]]]
        generated[f"tags/{t['slug']}/index.html"] = _render(
            path, text, {"site": site, "tag": t, "posts": tposts}
        )
    try:
        generated["feed.xml"] = build_rss(
            site,
            [
                {k: p[k] for k in ("title", "url", "date", "summary")}
                for p in pub_posts
            ],
        )
        docs = [
            {"slug": p["slug"], "title": p["title"], "text": p["_body"]}
            for p in posts
        ]
        generated["search.json"] = json.dumps(
            build_index(docs),
            sort_keys=True,
            ensure_ascii=False,
            separators=(",", ":"),
        )
    except ValueError as e:
        raise BuildError(f"cannot build feed/search: {e}") from e

    # static
    static_dir = src / "static"
    static: dict[str, Path] = {}
    if static_dir.is_dir():
        for root, dirs, fnames in os.walk(static_dir):
            dirs.sort()
            for fn in sorted(fnames):
                fp = Path(root) / fn
                rel = fp.relative_to(static_dir).as_posix()
                if rel in generated:
                    raise BuildError(
                        f"{fp}: static file collides with generated file {rel}"
                    )
                static[rel] = fp

    # write
    try:
        out.mkdir(parents=True, exist_ok=True)
        for rel, data in generated.items():
            dest = out / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data.encode("utf-8"))
        for rel, fp in static.items():
            dest = out / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(fp.read_bytes())
    except OSError as e:
        raise BuildError(f"{out}: cannot write output: {e}") from e

    return BuildReport(
        posts=len(posts),
        drafts=drafts,
        tag_pages=len(tag_list),
        static_files=len(static),
        output_files=sorted(list(generated) + list(static)),
    )
