import pytest

from sitegen import feed, frontmatter, links, markdown, search, slug, templates
from sitegen.errors import FrontmatterError, TemplateError


# ---------------- frontmatter ----------------
@pytest.mark.parametrize(
    "text,expected",
    [
        ("hello", ({}, "hello")),
        ("---\ntitle: Hi\n---\nBody\n", ({"title": "Hi"}, "Body\n")),
        ("---\r\ntitle: Hi\r\n---\r\nB", ({"title": "Hi"}, "B")),
        (
            "---\nn: 42\nok: true\nno: false\ns: \"a: b\"\nt: 'it''s'\n---\n",
            ({"n": 42, "ok": True, "no": False, "s": "a: b", "t": "it's"}, ""),
        ),
        (
            '---\ntags: [a, "b, c", 3, true]\nempty: []\ne:\n---\nx',
            ({"tags": ["a", "b, c", 3, True], "empty": [], "e": ""}, "x"),
        ),
        (
            "---\n# note\n\ndate: 2024-01-15\nslug: -x\n---\n\n\nbody",
            ({"date": "2024-01-15", "slug": "-x"}, "\n\nbody"),
        ),
        ("---\n---\nbody", ({}, "body")),
        ("---\nn: 007\nm: -5\nb: True\nc: a: b\n---", ({"n": 7, "m": -5, "b": "True", "c": "a: b"}, "")),
    ],
)
def test_frontmatter_ok(text, expected):
    assert frontmatter.parse(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        "---\ntitle: x\n",
        "---\ntitle x\n---\n",
        "---\na: 1\na: 2\n---\n",
        "---\na: [1,\n---\n",
        "---\na: [a,,b]\n---\n",
        "---\na: [a,]\n---\n",
        "---\na: [[x]]\n---\n",
        '---\na: "x\\q"\n---\n',
        '---\na: "x" y\n---\n',
        "---\na: 'x' y\n---\n",
        '---\na: "x\n---\n',
        "---\n  a: 1\n---\n",
    ],
)
def test_frontmatter_errors(text):
    with pytest.raises(FrontmatterError):
        frontmatter.parse(text)


def test_frontmatter_error_is_valueerror():
    assert issubclass(FrontmatterError, ValueError)


# ---------------- markdown ----------------
FENCE = "```"
MD = [
    ("# Hello", "<h1>Hello</h1>"),
    ("Hello *world* and **bold**", "<p>Hello <em>world</em> and <strong>bold</strong></p>"),
    ("a < b & \"c\" 'd'", "<p>a &lt; b &amp; &quot;c&quot; &#x27;d&#x27;</p>"),
    ("<script>alert(1)</script>", "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>"),
    ("para one\nstill one\n\n\npara two\n", "<p>para one\nstill one</p>\n<p>para two</p>"),
    (
        "- a\n- b\n\n1. x\n2. y",
        "<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n<ol>\n<li>x</li>\n<li>y</li>\n</ol>",
    ),
    (
        f"{FENCE}python\nprint('<hi>')\n{FENCE}",
        '<pre><code class="language-python">print(&#x27;&lt;hi&gt;&#x27;)</code></pre>',
    ),
    ("> quote *x*\n> more", "<blockquote>\n<p>quote <em>x</em>\nmore</p>\n</blockquote>"),
    (
        "[a](http://x.com/a_b_c?q=1&r=2)",
        '<p><a href="http://x.com/a_b_c?q=1&amp;r=2">a</a></p>',
    ),
    ("![alt](/i.png)", '<p><img src="/i.png" alt="alt"></p>'),
    ("***bold italic***", "<p><strong><em>bold italic</em></strong></p>"),
    (
        "**bold with *nested em* inside** and *em with **strong** inside*",
        "<p><strong>bold with <em>nested em</em> inside</strong> and <em>em with <strong>strong</strong> inside</em></p>",
    ),
    (
        "use `a<b` and snake_case_name, 2 * 3 * 4",
        "<p>use <code>a&lt;b</code> and snake_case_name, 2 * 3 * 4</p>",
    ),
    ("---", "<hr>"),
    ("", ""),
    ("\n\n  \n", ""),
    ("- a\n\n- b", "<ul>\n<li>a</li>\n</ul>\n<ul>\n<li>b</li>\n</ul>"),
    ("## Title\ntext\n---\nmore", "<h2>Title</h2>\n<p>text</p>\n<hr>\n<p>more</p>"),
    ("#x\n\n####### x\n\n#", "<p>#x</p>\n<p>####### x</p>\n<p>#</p>"),
    (f"{FENCE}\n{FENCE}", "<pre><code></code></pre>"),
    (f"{FENCE}\na  \n  b", "<pre><code>a  \n  b</code></pre>"),
    (">", "<blockquote></blockquote>"),
    ("  # x", "<p># x</p>"),
    ("[**b**](/u_v_w)", '<p><a href="/u_v_w"><strong>b</strong></a></p>'),
    ("snake_case and _em_", "<p>snake_case and <em>em</em></p>"),
]


@pytest.mark.parametrize("md,html", MD)
def test_markdown(md, html):
    assert markdown.render(md) == html


# ---------------- templates ----------------
def R(t, c=None):
    return templates.render(t, c or {})


def test_templates_examples():
    assert R("Hello {{ name }}!", {"name": "World"}) == "Hello World!"
    x = "<a href=\"u\">&'"
    assert R("{{ x }}", {"x": x}) == "&lt;a href=&quot;u&quot;&gt;&amp;&#x27;"
    assert R("{{ x|safe }}", {"x": x}) == x
    assert R("{{ s|escape }}", {"s": "<b>"}) == "&lt;b&gt;"
    assert R("[{{ missing }}][{{ a.b.c }}][{{ n }}]", {"a": {"b": {}}, "n": None}) == "[][][]"
    assert (
        R("{{ t|upper }} {{ t|lower }} {{ t|title }}", {"t": "hello woRLD"})
        == "HELLO WORLD hello world Hello World"
    )
    assert R('{{ tags|join:", " }} / {{ tags|length }}', {"tags": ["a", "b"]}) == "a, b / 2"
    assert R('{{ tags|join:" | "|safe }}', {"tags": ["a", "b"]}) == "a | b"
    assert R('{{ nick|default:"anon" }}', {}) == "anon"
    assert R('{{ nick|default:"anon" }}', {"nick": ""}) == "anon"
    assert R('{{ nick|default:"anon" }}', {"nick": 0}) == "0"
    t = "{% for t in tags %}{{ loop.index }}:{{ t }}{% if not loop.last %}, {% endif %}{% endfor %}"
    assert R(t, {"tags": ["a", "b"]}) == "1:a, 2:b"
    t = "{% if a %}A{% elif b %}B{% else %}C{% endif %}"
    assert R(t, {"a": 0, "b": [1]}) == "B"
    assert R(t, {"a": 0, "b": []}) == "C"
    t = "{% if x %}\nA\n{% endif %}\n"
    assert R(t, {"x": True}) == "\nA\n\n"
    assert R(t, {"x": False}) == "\n"
    t = "{% for p in posts %}{{ p.title }}{% endfor %}|{% for p in nothing %}x{% endfor %}"
    assert R(t, {"posts": [{"title": "T1"}, {"title": "T2"}]}) == "T1T2|"
    assert R("") == ""
    assert R("{{ items.0 }}-{{ items.5 }}", {"items": ["z"]}) == "z-"


@pytest.mark.parametrize(
    "t",
    [
        "{% if n > 1 %}x{% endif %}",
        "{{ a|bogus }}",
        "{{ name",
        "{% for x in y %}no end",
        "{% endif %}",
        "{% if a %}{% else %}{% else %}{% endif %}",
        "{{ }}",
        "{{ 1a }}",
        "{% for k, v in x %}{% endfor %}",
        "{{ a|default }}",
        '{{ a|upper:"x" }}',
        "{% if a %}{% elif %}{% endif %}",
        "{% bogus %}",
        "{% else %}",
        "{% endfor %}",
        "{% if a %}{% endfor %}",
        "{% if false %}{{ a|bogus }}{% endif %}",
        "{% else x %}",
    ],
)
def test_templates_errors(t):
    with pytest.raises(TemplateError):
        R(t, {})


def test_templates_misc():
    assert R("{ } {# x #} { {{ a }}", {"a": 1}) == "{ } {# x #} { 1"
    assert R("{{ a }}", {"a": True}) == "True"
    assert R("{{ a }}", {"a": [1, "<"]}) == "[1, &#x27;&lt;&#x27;]"
    assert R("{{ a|length }}", {"a": 12345}) == "5"
    assert R("{{ a|length }}", {}) == "0"
    ctx = {"xs": [1, 2]}
    R("{% for x in xs %}{{ x }}{% endfor %}", ctx)
    assert ctx == {"xs": [1, 2]}
    t = "{% for a in xs %}{% for b in ys %}{{ loop.index }}{% endfor %}{{ loop.index }}{% endfor %}{{ loop.index }}|"
    assert R(t, {"xs": [1, 2], "ys": [1, 2]}) == "121122|"
    assert R("{% for k in d %}{{ k }}{% endfor %}", {"d": {"p": 1, "q": 2}}) == "pq"
    assert R("{% for k in s %}{{ k }}{% endfor %}", {"s": "abc"}) == ""
    assert R("{{ a|default:'x' }}{{ b | upper }}", {"b": "q"}) == "xQ"
    assert R('{{ a|default:"<b>" }}', {}) == "&lt;b&gt;"
    assert R("{{ a }}}}", {"a": 1}) == "1}}"


# ---------------- slug ----------------
@pytest.mark.parametrize(
    "t,s",
    [
        ("Hello, World!", "hello-world"),
        ("  Multiple   Spaces  ", "multiple-spaces"),
        ("Café Münster", "cafe-munster"),
        ("C++ & Rust", "c-rust"),
        ("Don't Stop", "don-t-stop"),
        ("snake_case v1.2.3", "snake-case-v1-2-3"),
        ("---", ""),
        ("", ""),
        ("日本語", ""),
    ],
)
def test_slugify(t, s):
    assert slug.slugify(t) == s


def test_unique_slug():
    u = slug.unique_slug
    assert u("Hello", set()) == "hello"
    assert u("Hello", {"hello"}) == "hello-2"
    assert u("Hello", {"hello", "hello-2"}) == "hello-3"
    assert u("!!!", set()) == "untitled"
    assert u("!!!", {"untitled"}) == "untitled-2"
    assert u("Hello 2", {"hello-2"}) == "hello-2-2"
    taken = {"a"}
    u("a", taken)
    assert taken == {"a"}


# ---------------- feed ----------------
SITE = {"title": "My Blog", "url": "https://example.com/", "author": "A"}
RSS_ONE = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>My Blog</title>
<link>https://example.com/</link>
<description>My Blog</description>
<item>
<title>First &amp; Best</title>
<link>https://example.com/posts/first/</link>
<guid>https://example.com/posts/first/</guid>
<pubDate>Mon, 15 Jan 2024 00:00:00 +0000</pubDate>
<description>Hi &lt;you&gt;</description>
</item>
</channel>
</rss>"""


def test_feed_example():
    posts = [{"title": "First & Best", "url": "/posts/first/", "date": "2024-01-15", "summary": "Hi <you>"}]
    assert feed.build_rss(SITE, posts) == RSS_ONE


def test_feed_empty_and_dates():
    out = feed.build_rss(SITE, [])
    assert out == "\n".join(
        [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<rss version="2.0">',
            "<channel>",
            "<title>My Blog</title>",
            "<link>https://example.com/</link>",
            "<description>My Blog</description>",
            "</channel>",
            "</rss>",
        ]
    )
    out = feed.build_rss(
        SITE,
        [
            {"title": "a", "url": "x", "date": "2024-03-01"},
            {"title": "b", "url": "y", "date": "2023-12-25"},
        ],
    )
    assert "<pubDate>Fri, 01 Mar 2024 00:00:00 +0000</pubDate>" in out
    assert "<pubDate>Mon, 25 Dec 2023 00:00:00 +0000</pubDate>" in out
    assert "<link>https://example.com/x</link>" in out
    assert "<description></description>" in out


def test_feed_limit_order_errors():
    posts = [{"title": f"t{i}", "url": f"/p{i:02d}/", "date": f"2024-01-{i + 1:02d}"} for i in range(21)]
    orig = list(posts)
    out = feed.build_rss(SITE, posts)
    assert posts == orig
    assert out.count("<item>") == 20
    assert "t0<" not in out and "t20<" in out
    tie = feed.build_rss(
        SITE,
        [
            {"title": "B", "url": "/b/", "date": "2024-01-01"},
            {"title": "A", "url": "/a/", "date": "2024-01-01"},
        ],
    )
    assert tie.index("<title>A") < tie.index("<title>B")
    for bad in (
        [{"title": "t", "url": "/", "date": "2024-02-30"}],
        [{"title": "t", "url": "/", "date": "2024-2-3"}],
        [{"title": "t", "url": "/"}],
    ):
        with pytest.raises(ValueError):
            feed.build_rss(SITE, bad)
    with pytest.raises(ValueError):
        feed.build_rss({"title": "x"}, [])


# ---------------- search ----------------
def test_search():
    docs = [
        {"slug": "b", "title": "Beta", "text": "the beta and alpha"},
        {"slug": "a", "title": "Alpha", "text": "alpha alpha"},
    ]
    idx = search.build_index(docs)
    assert idx == {
        "docs": {"a": {"title": "Alpha", "length": 3}, "b": {"title": "Beta", "length": 3}},
        "terms": {"alpha": {"a": 3, "b": 1}, "beta": {"b": 2}},
    }
    assert list(idx["terms"]) == ["alpha", "beta"]
    s = search.search
    assert s(idx, "alpha") == ["a", "b"]
    assert s(idx, "ALPHA", limit=1) == ["a"]
    assert s(idx, "alpha beta") == ["b"]
    assert s(idx, "alpha alpha") == ["a", "b"]
    assert s(idx, "the of") == []
    assert s(idx, "zzz") == []
    assert s(idx, "") == []
    assert s(idx, "alpha", limit=0) == []
    idx2 = search.build_index(
        [{"slug": "z", "title": "", "text": "foo"}, {"slug": "m", "title": "", "text": "foo"}]
    )
    assert s(idx2, "foo") == ["m", "z"]
    assert search.build_index([]) == {"docs": {}, "terms": {}}
    assert search.tokenize("The Cat & the HAT, x2!") == ["cat", "hat", "x2"]
    assert search.tokenize("café") == ["caf"]
    assert isinstance(search.STOPWORDS, frozenset)
    with pytest.raises(ValueError):
        search.build_index([{"slug": "a", "title": "t"}])
    with pytest.raises(ValueError):
        search.build_index([{"slug": "a", "title": "t", "text": ""}] * 2)


# ---------------- links ----------------
def test_links_examples():
    f = links.find_broken_links
    assert f({"/index.html": '<a href="/about.html">A</a> <a href="/missing.html">M</a>', "/about.html": ""}) == [
        ("/index.html", "/missing.html")
    ]
    assert f(
        {"/posts/a/index.html": '<a href="../b/">x</a><a href="../c/">y</a>', "/posts/b/index.html": ""}
    ) == [("/posts/a/index.html", "../c/")]
    assert f(
        {
            "/index.html": '<h2 id="s1">h</h2><a href="#s1">1</a><a href="#s2">2</a><a href="/other.html#z">3</a><a href="/other.html#y">4</a>',
            "/other.html": "<p id='y'></p>",
        }
    ) == [("/index.html", "#s2"), ("/index.html", "/other.html#z")]
    assert f(
        {
            "/index.html": '<a href="https://x.com/a">e</a><a href="mailto:a@b.c">m</a><a href="//cdn.x/y">c</a><a href="">e</a><a HREF="/nope">n</a>'
        }
    ) == [("/index.html", "/nope")]
    assert f(
        {
            "/index.html": '<a href="posts/p">1</a><a href="./posts/p/">2</a><a href="/style.css">3</a><a href="/style.css#x">4</a><a href="?q=1">5</a><a href=\'/../index.html\'>6</a>',
            "/posts/p/index.html": "",
            "/style.css": "",
        }
    ) == [("/index.html", "/style.css#x")]
    assert f({"/b.html": '<a href="/z">1</a>', "/a.html": '<a href="/y">2</a><a href="/y">3</a>'}) == [
        ("/a.html", "/y"),
        ("/a.html", "/y"),
        ("/b.html", "/z"),
    ]
    with pytest.raises(ValueError):
        f({"index.html": ""})


def test_links_misc():
    f = links.find_broken_links
    assert f({"/index.html": '<a href="/">r</a><a href="#">t</a><a href="/a/..">u</a>'}) == []
    assert f({"/index.html": "<a href=/x>r</a>"}) == []
