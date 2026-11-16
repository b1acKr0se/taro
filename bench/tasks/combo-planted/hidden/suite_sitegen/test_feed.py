import pytest

SITE = {"title": "My Blog", "url": "https://example.com/", "author": "A"}


def post(title="T", url="/p/", date="2024-01-15", **kw):
    d = {"title": title, "url": url, "date": date}
    d.update(kw)
    return d


def test_rss_exact_example():
    from sitegen.feed import build_rss
    posts = [{"title": "First & Best", "url": "/posts/first/", "date": "2024-01-15",
              "summary": "Hi <you>"}]
    expected = "\n".join([
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0">',
        "<channel>",
        "<title>My Blog</title>",
        "<link>https://example.com/</link>",
        "<description>My Blog</description>",
        "<item>",
        "<title>First &amp; Best</title>",
        "<link>https://example.com/posts/first/</link>",
        "<guid>https://example.com/posts/first/</guid>",
        "<pubDate>Mon, 15 Jan 2024 00:00:00 +0000</pubDate>",
        "<description>Hi &lt;you&gt;</description>",
        "</item>",
        "</channel>",
        "</rss>",
    ])
    assert build_rss(SITE, posts) == expected


def test_rss_no_posts():
    from sitegen.feed import build_rss
    expected = "\n".join([
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0">',
        "<channel>",
        "<title>My Blog</title>",
        "<link>https://example.com/</link>",
        "<description>My Blog</description>",
        "</channel>",
        "</rss>",
    ])
    assert build_rss(SITE, []) == expected


def test_rss_pubdate_formats():
    from sitegen.feed import build_rss
    out = build_rss(SITE, [post(date="2024-03-01"), post(url="/q/", date="2023-12-25")])
    assert "<pubDate>Fri, 01 Mar 2024 00:00:00 +0000</pubDate>" in out
    assert "<pubDate>Mon, 25 Dec 2023 00:00:00 +0000</pubDate>" in out


def test_rss_limits_to_20_newest_items():
    from sitegen.feed import build_rss
    posts = [post(title=f"P{i:02d}", url=f"/p{i:02d}/", date=f"2024-01-{i + 1:02d}")
             for i in range(21)]
    out = build_rss(SITE, posts)
    assert out.count("<item>") == 20
    assert "<title>P00</title>" not in out
    assert "<title>P20</title>" in out


def test_rss_sorted_by_date_desc_then_url_asc_and_input_not_mutated():
    from sitegen.feed import build_rss
    posts = [post(title="old", url="/o/", date="2020-01-01"),
             post(title="b", url="/b/", date="2024-05-05"),
             post(title="a", url="/a/", date="2024-05-05"),
             post(title="new", url="/n/", date="2025-01-01")]
    snapshot = [dict(p) for p in posts]
    out = build_rss(SITE, posts)
    titles = [line for line in out.split("\n") if line.startswith("<title>")][1:]
    assert titles == ["<title>new</title>", "<title>a</title>", "<title>b</title>",
                      "<title>old</title>"]
    assert posts == snapshot


def test_rss_links_use_stripped_base_and_missing_summary_gives_empty_description():
    from sitegen.feed import build_rss
    out = build_rss({"title": "S", "url": "https://x.org//"}, [post(url="posts/z/")])
    lines = out.split("\n")
    assert "<link>https://x.org/</link>" in lines
    assert "<link>https://x.org/posts/z/</link>" in lines
    assert "<guid>https://x.org/posts/z/</guid>" in lines
    assert lines[-4] == "<description></description>"




def test_rss_invalid_input_raises_value_error():
    from sitegen.feed import build_rss
    for site, posts in [
        ({"title": "x"}, []),
        ({"url": "x"}, []),
        (SITE, [{"title": "t", "url": "/u/"}]),
        (SITE, [{"title": "t", "date": "2024-01-01"}]),
        (SITE, [post(date="2024-02-30")]),
        (SITE, [post(date="2024-1-5")]),
    ]:
        with pytest.raises(ValueError):
            build_rss(site, posts)
