import pytest


def test_no_frontmatter_returns_empty_meta_and_text():
    from sitegen.frontmatter import parse
    assert parse("hello") == ({}, "hello")


def test_basic_title_and_body():
    from sitegen.frontmatter import parse
    assert parse("---\ntitle: Hi\n---\nBody\n") == ({"title": "Hi"}, "Body\n")


def test_crlf_is_normalized():
    from sitegen.frontmatter import parse
    assert parse("---\r\ntitle: Hi\r\n---\r\nB") == ({"title": "Hi"}, "B")




def test_scalar_types_and_quotes():
    from sitegen.frontmatter import parse
    text = "---\nn: 42\nok: true\nno: false\ns: \"a: b\"\nt: 'it''s'\n---\n"
    assert parse(text) == (
        {"n": 42, "ok": True, "no": False, "s": "a: b", "t": "it's"},
        "",
    )


def test_inline_lists_and_empty_value():
    from sitegen.frontmatter import parse
    text = '---\ntags: [a, "b, c", 3, true]\nempty: []\ne:\n---\nx'
    assert parse(text) == (
        {"tags": ["a", "b, c", 3, True], "empty": [], "e": ""},
        "x",
    )


def test_comments_blank_lines_dates_and_verbatim_body():
    from sitegen.frontmatter import parse
    text = "---\n# note\n\ndate: 2024-01-15\nslug: -x\n---\n\n\nbody"
    assert parse(text) == ({"date": "2024-01-15", "slug": "-x"}, "\n\nbody")


def test_empty_block():
    from sitegen.frontmatter import parse
    assert parse("---\n---\nbody") == ({}, "body")


def test_plain_string_edge_cases_and_ints():
    from sitegen.frontmatter import parse
    meta, _ = parse("---\na: True\nb: yes\nc: 007\nd: -5\ne: b: c\nf: null\ng: x # y\nh: 1.5\n---\n")
    assert meta == {"a": "True", "b": "yes", "c": 7, "d": -5, "e": "b: c",
                    "f": "null", "g": "x # y", "h": "1.5"}
    assert list(meta) == list("abcdefgh")






def test_invalid_frontmatter_raises_frontmatter_error():
    from sitegen.errors import FrontmatterError
    from sitegen.frontmatter import parse
    bad = [
        "---\ntitle: x\n",
        "---\ntitle x\n---\n",
        "---\na: 1\na: 2\n---\n",
        "---\na: [1,\n---\n",
        '---\na: "unterminated\n---\n',
        '---\na: "x\\q"\n---\n',
        "---\na: 'x' y\n---\n",
        "---\na: [a,,b]\n---\n",
        "---\na: [a,]\n---\n",
        "---\na: [[x]]\n---\n",
        "---\n  a: 1\n---\n",
    ]
    for text in bad:
        with pytest.raises(FrontmatterError):
            parse(text)


