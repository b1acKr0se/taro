import json

import pytest

from sitegen import cli
from sitegen.errors import BuildError
from sitegen.site import BuildReport, build

TOML = 'title = "My Blog"\nurl = "https://example.com"\nauthor = "Me"\nextra = "kept"\n'


def make_site(tmp_path, post_tpl="<h1>{{ post.title }}</h1>\n{{ post.content|safe }}"):
    src = tmp_path / "src"
    (src / "templates").mkdir(parents=True)
    (src / "content").mkdir()
    (src / "static" / "css").mkdir(parents=True)
    (src / "site.toml").write_text(TOML, encoding="utf-8")
    (src / "templates" / "post.html").write_bytes(post_tpl.encode())
    (src / "templates" / "index.html").write_text(
        "{% for p in posts %}{{ p.slug }},{% endfor %}|{% for t in tags %}{{ t.slug }}={{ t.count }},{% endfor %}|{{ site.extra }}",
        encoding="utf-8",
    )
    (src / "templates" / "tag.html").write_text(
        "{{ tag.name }}:{% for p in posts %}{{ p.slug }}{% endfor %}", encoding="utf-8"
    )
    (src / "content" / "b.md").write_text(
        "---\ntitle: Hello World\ndate: 2024-01-02\ntags: [Python, web dev]\n---\nHi *you*", encoding="utf-8"
    )
    (src / "content" / "a.md").write_text(
        "---\ntitle: Hello World\ndate: 2024-01-05\ndraft: false\n---\nx", encoding="utf-8"
    )
    (src / "content" / "d.md").write_text("---\ndraft: true\n---\nzzz", encoding="utf-8")
    (src / "content" / ".hidden.md").write_text("junk", encoding="utf-8")
    (src / "content" / "note.txt").write_text("junk", encoding="utf-8")
    (src / "static" / "css" / "s.css").write_bytes(b"a{}\r\n")
    return src


def test_build_example(tmp_path):
    src = make_site(tmp_path)
    out = tmp_path / "out"
    r = build(src, out)
    files = [
        "css/s.css",
        "feed.xml",
        "index.html",
        "posts/hello-world-2/index.html",
        "posts/hello-world/index.html",
        "search.json",
        "tags/python/index.html",
        "tags/web-dev/index.html",
    ]
    assert r == BuildReport(posts=2, drafts=1, tag_pages=2, static_files=1, output_files=files)
    assert (out / "posts/hello-world-2/index.html").read_bytes() == b"<h1>Hello World</h1>\n<p>Hi <em>you</em></p>"
    assert (out / "index.html").read_text(encoding="utf-8") == "hello-world,hello-world-2,|python=1,web-dev=1,|kept"
    assert (out / "tags/python/index.html").read_text() == "Python:hello-world-2"
    assert (out / "css/s.css").read_bytes() == b"a{}\r\n"
    idx = json.loads((out / "search.json").read_text())
    assert set(idx["docs"]) == {"hello-world", "hello-world-2"}
    assert (out / "search.json").read_text().startswith('{"docs":{"hello-world":')
    assert "<link>https://example.com/posts/hello-world/</link>" in (out / "feed.xml").read_text()


def test_build_errors(tmp_path):
    with pytest.raises(BuildError):
        build(tmp_path / "nope", tmp_path / "o")
    src = make_site(tmp_path)
    (src / "content" / "bad.md").write_text("---\ntitle x\n---\n", encoding="utf-8")
    with pytest.raises(BuildError, match="bad.md"):
        build(src, tmp_path / "o")
    (src / "content" / "bad.md").write_text("---\ntitle: T\ndate: 2024-02-30\n---\n", encoding="utf-8")
    with pytest.raises(BuildError):
        build(src, tmp_path / "o")
    (src / "content" / "bad.md").write_text("---\ntitle: T\ndate: 2024-02-03\ndraft: yes\n---\n", encoding="utf-8")
    with pytest.raises(BuildError):
        build(src, tmp_path / "o")
    (src / "content" / "bad.md").write_text("---\ntitle: T\ndate: 2024-02-03\ntags: x\n---\n", encoding="utf-8")
    with pytest.raises(BuildError):
        build(src, tmp_path / "o")
    (src / "content" / "bad.md").unlink()
    (src / "static" / "feed.xml").write_text("x")
    with pytest.raises(BuildError):
        build(src, tmp_path / "o")
    (src / "static" / "feed.xml").unlink()
    (src / "templates" / "tag.html").unlink()
    with pytest.raises(BuildError):
        build(src, tmp_path / "o")
    (src / "site.toml").write_text('title = "x"\nurl = 1\nauthor = "a"\n')
    with pytest.raises(BuildError):
        build(src, tmp_path / "o")


def test_cli_build_and_check(tmp_path, capsys):
    src = make_site(tmp_path)
    out = tmp_path / "out"
    assert cli.main(["build", str(src), str(out)]) == 0
    assert capsys.readouterr().out == "built: 2 posts, 2 tag pages, 1 static files, 1 drafts skipped\n"
    (out / "extra.html").write_text('<a href="/nope">x</a><a href="/index.html">ok</a>', encoding="utf-8")
    assert cli.main(["check", str(out)]) == 1
    assert capsys.readouterr().out == "broken: /extra.html -> /nope\nchecked 6 pages, 1 broken links\n"
    (out / "extra.html").unlink()
    assert cli.main(["check", str(out)]) == 0
    assert capsys.readouterr().out == "checked 5 pages, 0 broken links\n"
    assert cli.main(["check", str(tmp_path / "zz")]) == 1
    assert capsys.readouterr().err == f"error: not a directory: {tmp_path / 'zz'}\n"
    assert cli.main(["build", str(tmp_path / "zz"), str(out)]) == 1
    assert capsys.readouterr().err.startswith("error: ")


def test_cli_usage(capsys):
    assert cli.main([]) == 2
    assert cli.main(["bogus"]) == 2
    assert cli.main(["build", "x"]) == 2
    assert cli.main(["check", "a", "b"]) == 2
    assert cli.main(["check", "--zz", "a"]) == 2
    assert cli.main(["-h"]) == 0
    assert cli.main(["build", "-h"]) == 0
    capsys.readouterr()
