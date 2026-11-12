import pytest

BASE_FILES = {
    "site.toml": 'title = "My Blog"\nurl = "https://example.com/"\nauthor = "A"\n',
    "templates/post.html": "<h1>{{ post.title }}</h1>\n{{ post.content|safe }}",
    "templates/index.html": (
        "{% for p in posts %}{{ p.slug }},{% endfor %}|"
        "{% for t in tags %}{{ t.slug }}={{ t.count }} {% endfor %}"
    ),
    "templates/tag.html": (
        "{{ tag.name }}:{{ tag.count }}:{% for p in posts %}{{ p.slug }};{% endfor %}"
    ),
    "content/b.md": "---\ntitle: Hello World\ndate: 2024-01-02\ntags: [Python, web dev]\n---\nHi *you*",
    "content/a.md": "---\ntitle: Hello World\ndate: 2024-01-05\ndraft: false\n---\nx",
    "content/d.md": "---\ndraft: true\n---\nsecret",
    "static/css/s.css": b"body{color:red}\r\n\x00\xff",
}


@pytest.fixture
def site_factory(tmp_path):
    """Return f(overrides=None) -> (src, out). A None override removes the file."""

    def make(overrides=None):
        files = dict(BASE_FILES)
        files.update(overrides or {})
        src = tmp_path / "src"
        out = tmp_path / "out"
        src.mkdir(exist_ok=True)
        for rel, data in files.items():
            if data is None:
                continue
            p = src / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            if isinstance(data, bytes):
                p.write_bytes(data)
            else:
                p.write_bytes(data.encode("utf-8"))
        return src, out

    return make
