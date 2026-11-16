import json
import xml.etree.ElementTree as ET

import pytest

EXPECTED_FILES = [
    "css/s.css", "feed.xml", "index.html",
    "posts/hello-world-2/index.html", "posts/hello-world/index.html",
    "search.json", "tags/python/index.html", "tags/web-dev/index.html",
]


def build(factory, overrides=None):
    from sitegen.site import build as b
    src, out = factory(overrides)
    return b(src, out), src, out


def read(out, rel):
    return (out / rel).read_bytes().decode("utf-8")


def test_report_for_spec_example(site_factory):
    report, _, _ = build(site_factory)
    assert report.posts == 2
    assert report.drafts == 1
    assert report.tag_pages == 2
    assert report.static_files == 1
    assert report.output_files == EXPECTED_FILES




def test_post_page_is_template_output_exactly(site_factory):
    _, _, out = build(site_factory)
    assert read(out, "posts/hello-world-2/index.html") == "<h1>Hello World</h1>\n<p>Hi <em>you</em></p>"




def test_index_lists_posts_by_date_desc_and_tags_by_slug(site_factory):
    _, _, out = build(site_factory)
    assert read(out, "index.html") == "hello-world,hello-world-2,|python=1 web-dev=1 "


def test_tag_page_context(site_factory):
    _, _, out = build(site_factory)
    assert read(out, "tags/python/index.html") == "Python:1:hello-world-2;"
    assert read(out, "tags/web-dev/index.html") == "web dev:1:hello-world-2;"


def test_post_tag_links_shape(site_factory):
    tpl = "{% for l in post.tag_links %}{{ l.name }}|{{ l.slug }}|{{ l.url }};{% endfor %}[{{ post.url }}]"
    _, _, out = build(site_factory, {"templates/post.html": tpl})
    assert read(out, "posts/hello-world-2/index.html") == (
        "Python|python|/tags/python/;web dev|web-dev|/tags/web-dev/;[/posts/hello-world-2/]")
    assert read(out, "posts/hello-world/index.html") == "[/posts/hello-world/]"




def test_feed_is_valid_rss_with_posts_newest_first(site_factory):
    _, _, out = build(site_factory)
    root = ET.fromstring((out / "feed.xml").read_bytes())
    items = root.find("channel").findall("item")
    assert [i.find("link").text for i in items] == [
        "https://example.com/posts/hello-world/",
        "https://example.com/posts/hello-world-2/"]
    assert items[0].find("pubDate").text == "Fri, 05 Jan 2024 00:00:00 +0000"
    assert root.find("channel").find("title").text == "My Blog"


def test_search_json_exact(site_factory):
    _, _, out = build(site_factory)
    expected = {
        "docs": {"hello-world": {"title": "Hello World", "length": 3},
                 "hello-world-2": {"title": "Hello World", "length": 4}},
        "terms": {"hello": {"hello-world": 1, "hello-world-2": 1},
                  "hi": {"hello-world-2": 1},
                  "world": {"hello-world": 1, "hello-world-2": 1},
                  "x": {"hello-world": 1},
                  "you": {"hello-world-2": 1}},
    }
    text = read(out, "search.json")
    assert json.loads(text) == expected
    assert text == json.dumps(expected, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def test_static_files_copied_byte_for_byte(site_factory):
    _, _, out = build(site_factory)
    assert (out / "css" / "s.css").read_bytes() == b"body{color:red}\r\n\x00\xff"




def test_existing_output_contents_not_removed(site_factory):
    src, out = site_factory()
    out.mkdir()
    (out / "old.txt").write_text("keep")
    (out / "index.html").write_text("stale")
    from sitegen.site import build as b
    report = b(src, out)
    assert (out / "old.txt").read_text() == "keep"
    assert "old.txt" not in report.output_files
    assert read(out, "index.html") != "stale"


def test_empty_tag_slug_and_duplicate_tags_in_post(site_factory):
    post = "---\ntitle: T\ndate: 2024-02-02\ntags: [Py, py, '!!!', Zed]\n---\nbody"
    tpl = "{% for l in post.tag_links %}{{ l.name }},{% endfor %}|{{ post.tags|length }}"
    report, _, out = build(site_factory, {
        "content/a.md": post, "content/b.md": None, "content/d.md": None,
        "templates/post.html": tpl,
        "templates/index.html": "{% for t in tags %}{{ t.name }}:{{ t.count }};{% endfor %}"})
    assert report.tag_pages == 2
    assert read(out, "posts/t/index.html") == "Py,Zed,|4"
    assert read(out, "index.html") == "Py:1;Zed:1;"


def test_build_error_for_missing_inputs(site_factory):
    from sitegen.errors import BuildError
    from sitegen.site import build as b
    for rel in ["site.toml", "templates/post.html", "templates/index.html", "templates/tag.html"]:
        src, out = site_factory({rel: None})
        with pytest.raises(BuildError):
            b(src, out)
        import shutil
        shutil.rmtree(src)
    with pytest.raises(BuildError):
        b(out.parent / "does-not-exist", out)




def test_build_error_for_invalid_content(site_factory):
    from sitegen.errors import BuildError
    from sitegen.site import build as b
    bad = [
        "---\ntitle: T\ndate: 2024-13-01\n---\n",
        "---\ntitle: T\n---\n",
        "---\ndate: 2024-01-01\n---\n",
        "---\ntitle: T\ndate: 2024-01-01\ndraft: yes\n---\n",
        "---\ntitle: T\ndate: 2024-01-01\ntags: x\n---\n",
        "---\ntitle: T\ndate: 2024-01-01\n",
    ]
    for text in bad:
        src, out = site_factory({"content/z.md": text})
        with pytest.raises(BuildError):
            b(src, out)
        (src / "content" / "z.md").unlink()




def test_static_file_colliding_with_generated_file_is_build_error(site_factory):
    from sitegen.errors import BuildError
    from sitegen.site import build as b
    src, out = site_factory({"static/feed.xml": "x"})
    with pytest.raises(BuildError):
        b(src, out)


def test_content_filtering_ignores_hidden_non_md_and_subdirs(site_factory):
    good = "---\ntitle: Only\ndate: 2024-01-01\n---\n"
    report, _, out = build(site_factory, {
        "content/a.md": good, "content/b.md": None, "content/d.md": None,
        "content/.hidden.md": "garbage", "content/notes.txt": "garbage",
        "content/sub/x.md": "garbage"})
    assert report.posts == 1
    assert read(out, "index.html") == "only,|"




