import pytest


def F(pages):
    from sitegen.links import find_broken_links
    return find_broken_links(pages)


def test_missing_target_is_reported():
    pages = {"/index.html": '<a href="/about.html">A</a> <a href="/missing.html">M</a>',
             "/about.html": ""}
    assert F(pages) == [("/index.html", "/missing.html")]


def test_relative_directory_links_resolve_to_index():
    pages = {"/posts/a/index.html": '<a href="../b/">x</a><a href="../c/">y</a>',
             "/posts/b/index.html": ""}
    assert F(pages) == [("/posts/a/index.html", "../c/")]


def test_fragments_check_ids_in_target_page():
    pages = {
        "/index.html": ('<h2 id="s1">h</h2><a href="#s1">1</a><a href="#s2">2</a>'
                        '<a href="/other.html#z">3</a><a href="/other.html#y">4</a>'),
        "/other.html": "<p id='y'></p>",
    }
    assert F(pages) == [("/index.html", "#s2"), ("/index.html", "/other.html#z")]


def test_skipped_hrefs_and_case_insensitive_attribute():
    pages = {"/index.html": ('<a href="https://x.com/a">e</a><a href="mailto:a@b.c">m</a>'
                             '<a href="//cdn.x/y">c</a><a href="">e</a><a HREF="/nope">n</a>')}
    assert F(pages) == [("/index.html", "/nope")]


def test_path_resolution_rules():
    pages = {
        "/index.html": ('<a href="posts/p">1</a><a href="./posts/p/">2</a>'
                        '<a href="/style.css">3</a><a href="/style.css#x">4</a>'
                        '<a href="?q=1">5</a><a href=\'/../index.html\'>6</a>'),
        "/posts/p/index.html": "",
        "/style.css": "",
    }
    assert F(pages) == [("/index.html", "/style.css#x")]


def test_output_sorted_by_page_and_duplicates_kept():
    pages = {"/b.html": '<a href="/z">1</a>',
             "/a.html": '<a href="/y">2</a><a href="/y">3</a>'}
    assert F(pages) == [("/a.html", "/y"), ("/a.html", "/y"), ("/b.html", "/z")]


def test_non_absolute_page_path_raises_value_error():
    with pytest.raises(ValueError):
        F({"index.html": ""})




