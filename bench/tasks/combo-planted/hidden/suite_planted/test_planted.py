"""One defect-specific test per planted defect (see PLANTED.md). Each fails on start/ and passes on the clean code."""
import io

import pytest


# 1. sitegen/feed.py: an RSS post date with text after the YYYY-MM-DD part must raise ValueError.
def test_planted_1_rss_rejects_dates_with_trailing_text():
    from sitegen.feed import build_rss
    site = {"title": "T", "url": "https://e.com/"}
    for bad in ("2024-01-15T10:00:00", "2024-01-15 ", "2024-01-155", "2024-01-15\n"):
        with pytest.raises(ValueError):
            build_rss(site, [{"title": "x", "url": "/x/", "date": bad}])
    assert "<item>" in build_rss(site, [{"title": "x", "url": "/x/", "date": "2024-01-15"}])


# 2. minisheet/functions.py: ROUND truncates n toward zero (a fractional negative n is 0, not -1).
def test_planted_2_round_truncates_digits_toward_zero():
    from minisheet import Workbook
    wb = Workbook()
    wb.set("A1", "=ROUND(15.5,-0.5)")
    wb.set("A2", "=ROUND(2.5,-0.9)")
    wb.set("A3", "=ROUND(1.26,1.9)")
    assert wb.get("A1") == 16.0
    assert wb.get("A2") == 3.0
    assert wb.get("A3") == 1.3


# 3. minisheet/workbook.py: overwriting a range formula must drop its range dependency.
def test_planted_3_overwritten_range_formula_stops_depending_on_range():
    from minisheet import Workbook
    wb = Workbook()
    wb.set("A1", "1")
    wb.set("B1", "=SUM(A1:A3)")
    wb.set("B1", "=A1+1")
    wb.set("C1", "=SUM(A1:A3)")
    wb.set("C1", "7")
    before = wb.recalc_count
    wb.set("A3", "9")
    assert wb.last_changed == ["A3"]
    assert wb.recalc_count == before
    wb.set("A1", "5")
    assert wb.last_changed == ["A1", "B1"]
    assert wb.get("B1") == 6.0 and wb.get("C1") == 7.0


# 4. sitegen/links.py: an href is stripped of surrounding whitespace before use and before reporting.
def test_planted_4_href_whitespace_is_stripped():
    from sitegen.links import find_broken_links
    pages = {
        "/index.html": '<a href=" /about.html ">ok</a><a href="\t/missing.html ">bad</a>',
        "/about.html": "",
    }
    assert find_broken_links(pages) == [("/index.html", "/missing.html")]


# 5. sitegen/site.py: posts with the same date are ordered by slug ASCENDING in every posts list.
def test_planted_5_same_date_posts_are_ordered_by_slug_ascending(tmp_path):
    from sitegen.site import build
    src, out = tmp_path / "src", tmp_path / "out"
    files = {
        "site.toml": 'title = "T"\nurl = "https://e.com/"\nauthor = "A"\n',
        "templates/post.html": "{{ post.title }}",
        "templates/index.html": "{% for p in posts %}{{ p.slug }},{% endfor %}",
        "templates/tag.html": "{% for p in posts %}{{ p.slug }},{% endfor %}",
        "content/1.md": "---\ntitle: Beta\ndate: 2024-01-02\ntags: [t]\n---\nx",
        "content/2.md": "---\ntitle: Alpha\ndate: 2024-01-02\ntags: [t]\n---\ny",
        "content/3.md": "---\ntitle: Gamma\ndate: 2024-01-03\ntags: [t]\n---\nz",
        "content/4.md": "---\ntitle: Old\ndate: 2023-05-05\ntags: [t]\n---\nw",
    }
    for name, text in files.items():
        p = src / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    build(src, out)
    expected = "gamma,alpha,beta,old,"
    assert (out / "index.html").read_text(encoding="utf-8") == expected
    assert (out / "tags" / "t" / "index.html").read_text(encoding="utf-8") == expected


# 6. sitegen/search.py: duplicate query terms count once in the score.
def test_planted_6_duplicate_query_terms_do_not_double_the_score():
    from sitegen.search import build_index, search
    idx = build_index([
        {"slug": "x", "title": "X", "text": "foo foo foo bar"},
        {"slug": "y", "title": "Y", "text": "foo bar bar bar bar"},
    ])
    assert search(idx, "foo bar") == ["y", "x"]
    assert search(idx, "foo foo bar") == ["y", "x"]


# 7. minisheet/csvio.py: a field containing \r is quoted on save, so it survives a round trip.
def test_planted_7_csv_save_quotes_carriage_return():
    from minisheet import Workbook
    from minisheet.csvio import load_csv_text, to_csv_text
    wb = Workbook()
    wb.set("A1", "a\rb")
    wb.set("B1", "x")
    text = to_csv_text(wb)
    assert text == '"a\rb",x\n'
    back = load_csv_text(text)
    assert back.get("A1") == "a\rb" and back.get("B1") == "x" and back.cells() == ["A1", "B1"]


# 8. minisheet/cli.py: the show grid's row-number width L comes from the LAST row of the range.
def test_planted_8_show_grid_row_number_width_uses_largest_row():
    from minisheet.cli import main
    out = io.StringIO()
    code = main([], stdin=io.StringIO("set A9 1\nset A10 2\nshow A9:A10\n"), stdout=out)
    assert code == 0
    assert out.getvalue().split("\n") == ["OK", "OK", "      A", " 9 1.00", "10 2.00", ""]
