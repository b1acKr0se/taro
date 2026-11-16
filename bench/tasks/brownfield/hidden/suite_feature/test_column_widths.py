"""Acceptance tests for the column-widths feature (SPEC sections 1-3)."""
import io
import os
import re
import subprocess
import sys

import pytest


def make_wb(cells):
    from minisheet import Workbook
    wb = Workbook()
    for ref, raw in cells.items():
        wb.set(ref, raw)
    return wb


GRID = {"A1": "ab", "B1": "c", "A2": "x,y", "B2": "=1+1"}


# ---- section 1: parse_widths ------------------------------------------------------------

def test_parse_widths_basic_columns():
    from minisheet.csvio import parse_widths
    assert parse_widths("A=12,C=8,AA=20") == {0: 12, 2: 8, 26: 20}
    assert all(type(v) is int for v in parse_widths("A=12").values())


def test_parse_widths_whitespace_case_leading_zeros_and_ranges():
    from minisheet.csvio import parse_widths
    assert parse_widths(" b = 05 , c - e =3 ") == {1: 5, 2: 3, 3: 3, 4: 3}
    assert parse_widths("zy-ZZ=7") == {700: 7, 701: 7}
    assert parse_widths("B-B=4") == {1: 4}
    assert parse_widths("A=1,B=255") == {0: 1, 1: 255}


def test_parse_widths_empty_spec_is_empty_dict():
    from minisheet.csvio import parse_widths
    assert parse_widths("") == {}
    assert parse_widths("  \t ") == {}


def test_parse_widths_rejects_malformed_items():
    from minisheet.csvio import parse_widths
    for bad in ["A", "A=", "=5", "A=0", "A=256", "A=-1", "A=+1", "A=1.5", "A=x", "AAA=5", "A1=5", "A=5 5",
                "C-A=5", "A=5,", ",A=5", "A=5,,B=6", "A - = 5", "A-C-E=5", "A:C=5"]:
        with pytest.raises(ValueError):
            parse_widths(bad)


def test_parse_widths_rejects_duplicates_and_non_str_and_names_the_item():
    from minisheet.csvio import parse_widths
    for bad, item in [("A=5,A=6", "A=6"), ("A=5,A=5", "A=5"), ("A-C=5,B=6", "B=6"),
                      ("D=1, C-E = 9", "C-E = 9".strip()), ("A=300", "A=300"), ("C-A=5", "C-A=5")]:
        with pytest.raises(ValueError) as ei:
            parse_widths(bad)
        assert item in str(ei.value), (bad, str(ei.value))
    for not_str in (5, None, ["A=5"], b"A=5"):
        with pytest.raises(ValueError):
            parse_widths(not_str)


# ---- section 2: to_csv_text / save_csv ----------------------------------------------------

def test_widths_none_and_empty_leave_output_unchanged():
    from minisheet.csvio import to_csv_text
    wb = make_wb(GRID)
    assert to_csv_text(wb) == 'ab,c\n"x,y",2\n'
    assert to_csv_text(wb, widths=None) == to_csv_text(wb)
    assert to_csv_text(wb, widths={}) == to_csv_text(wb)
    assert to_csv_text(wb, widths="") == to_csv_text(wb)
    assert to_csv_text(wb, False, None) == to_csv_text(wb, values=False)


def test_widths_pad_listed_columns_on_the_right_and_quote_after_padding():
    from minisheet.csvio import to_csv_text
    wb = make_wb(GRID)
    assert to_csv_text(wb, widths={0: 5}) == 'ab   ,c\n"x,y  ",2\n'
    assert to_csv_text(wb, widths="B=3,A=1") == 'ab,c  \n"x,y",2  \n'
    assert to_csv_text(wb, widths={0: 5, 1: 2}) == 'ab   ,c \n"x,y  ",2 \n'


def test_widths_never_truncate():
    from minisheet.csvio import to_csv_text
    wb = make_wb({"A1": "hello", "B1": "x"})
    assert to_csv_text(wb, widths={0: 2}) == "hello,x\n"
    assert to_csv_text(wb, widths={0: 5}) == "hello,x\n"
    assert to_csv_text(wb, widths={0: 6}) == "hello ,x\n"


def test_widths_pad_empty_cells_inside_rows_only():
    from minisheet.csvio import to_csv_text
    wb = make_wb({"A1": "a", "C1": "c", "A2": "z"})
    assert to_csv_text(wb, widths={1: 3}) == "a,   ,c\nz\n"
    # a width for a column no row reaches changes nothing; gap rows stay bare lines
    wb2 = make_wb({"A1": "a", "A3": "z"})
    assert to_csv_text(wb2, widths={5: 4, 0: 2}) == "a \n\nz \n"
    from minisheet import Workbook
    assert to_csv_text(Workbook(), widths={0: 3}) == ""


def test_widths_apply_to_raw_text_in_raw_mode_and_to_error_codes():
    from minisheet.csvio import to_csv_text
    wb = make_wb(GRID)
    assert to_csv_text(wb, values=False, widths={1: 6}) == 'ab,c     \n"x,y",=1+1  \n'
    wb = make_wb({"A1": "=1/0", "B1": "t"})
    assert to_csv_text(wb, widths={0: 8}) == "#DIV/0! ,t\n"


def test_widths_padding_sits_inside_the_quotes_and_counts_text_before_quoting():
    from minisheet.csvio import load_csv_text, to_csv_text
    wb = make_wb({"A1": "a\nb", "B1": 'say "x"', "C1": "plain"})
    out = to_csv_text(wb, widths={0: 5, 1: 10})
    assert out == '"a\nb  ","say ""x""   ",plain\n'
    back = load_csv_text(out)
    assert back.get("A1") == "a\nb  " and back.get("B1") == 'say "x"   '


def test_widths_validation_happens_first_and_rejects_bad_values():
    from minisheet import Workbook
    from minisheet.csvio import to_csv_text
    for bad in ({0: 0}, {0: 256}, {-1: 5}, {702: 5}, {0: True}, {True: 5}, {"A": 5}, {0: 2.0},
                [0, 5], 5, "A=0", "bogus"):
        with pytest.raises(ValueError):
            to_csv_text(make_wb(GRID), widths=bad)
        with pytest.raises(ValueError):
            to_csv_text(Workbook(), widths=bad)
    exp = 'ab' + ' ' * 253 + ',c\n"x,y' + ' ' * 252 + '",2\n'
    assert to_csv_text(make_wb(GRID), widths={0: 255, 701: 1}) == exp


def test_save_csv_writes_the_same_text_and_nothing_on_error(tmp_path):
    from minisheet.csvio import save_csv, to_csv_text
    wb = make_wb({"A1": "é", "B1": "x"})
    p = tmp_path / "o.csv"
    save_csv(wb, p, widths={0: 3})
    assert p.read_bytes() == "é  ,x\n".encode("utf-8")
    save_csv(wb, p, values=False, widths="A=2")
    assert p.read_bytes() == to_csv_text(wb, False, "A=2").encode("utf-8") == "é ,x\n".encode("utf-8")
    q = tmp_path / "never.csv"
    with pytest.raises(ValueError):
        save_csv(wb, q, widths={0: 0})
    assert not q.exists()
    save_csv(wb, q)
    assert q.read_bytes() == b"\xc3\xa9,x\n"


# ---- section 3: sheetsite bridge ------------------------------------------------------------

def test_widths_from_meta_forms():
    from sheetsite.bridge import widths_from_meta
    assert widths_from_meta({}) == {}
    assert widths_from_meta({"title": "x"}) == {}
    assert widths_from_meta({"csv_widths": "A=12, C=8"}) == {0: 12, 2: 8}
    assert widths_from_meta({"csv_widths": ["A=12", "B-C=8"]}) == {0: 12, 1: 8, 2: 8}
    assert widths_from_meta({"csv_widths": ["A=1,B=2", "D=3"]}) == {0: 1, 1: 2, 3: 3}
    assert widths_from_meta({"csv_widths": []}) == {}
    assert widths_from_meta({"csv_widths": ""}) == {}


def test_widths_from_meta_errors_are_prefixed():
    from sheetsite.bridge import widths_from_meta
    for value in [5, True, False, None, 1.5, {"A": 5}, [5], ["A=5", 6], ["A=5", ""],
                  "A=0", "A=5,A=6", "nonsense", ["A=5", "A=6"]]:
        with pytest.raises(ValueError) as ei:
            widths_from_meta({"csv_widths": value})
        assert str(ei.value).startswith("csv_widths: "), value


def test_widths_from_markdown_reads_real_front_matter():
    from sheetsite.bridge import widths_from_markdown
    from sitegen.errors import FrontmatterError
    assert widths_from_markdown("---\ntitle: T\ncsv_widths: A=4, C=2\n---\nbody") == {0: 4, 2: 2}
    assert widths_from_markdown('---\ncsv_widths: [A=4, "C-D=2"]\n---\n') == {0: 4, 2: 2, 3: 2}
    assert widths_from_markdown("---\r\ncsv_widths: B=9\r\n---\r\nx") == {1: 9}
    assert widths_from_markdown("no front matter, csv_widths: A=5") == {}
    assert widths_from_markdown("") == {}
    with pytest.raises(FrontmatterError):
        widths_from_markdown("---\ncsv_widths: A=4\n")
    with pytest.raises(ValueError) as ei:
        widths_from_markdown("---\ncsv_widths: 12\n---\n")
    assert str(ei.value).startswith("csv_widths: ")
    with pytest.raises(ValueError) as ei:
        widths_from_markdown("---\ncsv_widths: A=0\n---\n")
    assert str(ei.value).startswith("csv_widths: ") and "A=0" in str(ei.value)


def test_export_csv_uses_the_front_matter_widths():
    from minisheet.csvio import to_csv_text
    from sheetsite.bridge import export_csv
    wb = make_wb(GRID)
    md = "---\ncsv_widths: A=5\n---\nbody"
    assert export_csv(wb, md) == 'ab   ,c\n"x,y  ",2\n'
    assert export_csv(wb, md, values=False) == 'ab   ,c\n"x,y  ",=1+1\n'
    assert export_csv(wb, "no front matter") == to_csv_text(wb)
    with pytest.raises(ValueError):
        export_csv(wb, "---\ncsv_widths: Z\n---\n")


# ---- section 3: command line ------------------------------------------------------------------

def run_main(argv):
    from sheetsite.cli import main
    out, err = io.StringIO(), io.StringIO()
    code = main(argv, stdout=out, stderr=err)
    return code, out.getvalue(), err.getvalue()


def test_cli_export_spec_example_in_process(tmp_path):
    post, src, dst = tmp_path / "post.md", tmp_path / "in.csv", tmp_path / "out.csv"
    post.write_bytes("---\ntitle: T\ncsv_widths: A=4, C=2\n---\nbody".encode("utf-8"))
    src.write_bytes(b"a,b,c\nddddd,e,f\n")
    code, out, err = run_main(["export", str(post), str(src), str(dst)])
    assert (code, out, err) == (0, "exported: 2 sized columns\n", "")
    assert dst.read_bytes() == b"a   ,b,c \nddddd,e,f \n"


def test_cli_export_raw_option_anywhere_and_formulas(tmp_path):
    post, src, dst = tmp_path / "p.md", tmp_path / "i.csv", tmp_path / "o.csv"
    post.write_text("---\ncsv_widths: [B=6]\n---\n", encoding="utf-8")
    src.write_bytes(b"1,=A1+1\n")
    assert run_main(["export", str(post), str(src), str(dst)])[0] == 0
    assert dst.read_bytes() == b"1,2     \n"
    code, out, _ = run_main(["export", "--raw", str(post), str(src), str(dst)])
    assert code == 0 and out == "exported: 1 sized columns\n"
    assert dst.read_bytes() == b"1,=A1+1 \n"
    dst.unlink()
    assert run_main(["export", str(post), str(src), str(dst), "--raw"])[0] == 0
    assert dst.read_bytes() == b"1,=A1+1 \n"


def test_cli_export_without_widths_reports_zero_columns(tmp_path):
    post, src, dst = tmp_path / "p.md", tmp_path / "i.csv", tmp_path / "o.csv"
    post.write_text("just text\n", encoding="utf-8")
    src.write_bytes(b"a,b\n")
    code, out, _ = run_main(["export", str(post), str(src), str(dst)])
    assert (code, out) == (0, "exported: 0 sized columns\n")
    assert dst.read_bytes() == b"a,b\n"


def test_cli_export_errors_exit_1_and_leave_output_alone(tmp_path):
    post, src, dst = tmp_path / "p.md", tmp_path / "i.csv", tmp_path / "o.csv"
    src.write_bytes(b"a,b\n")
    post.write_text("---\ncsv_widths: A=0\n---\n", encoding="utf-8")
    code, out, err = run_main(["export", str(post), str(src), str(dst)])
    assert code == 1 and out == "" and err.startswith("error: csv_widths: ") and err.endswith("\n")
    assert err.count("\n") == 1 and not dst.exists()
    post.write_text("---\ncsv_widths: A=2\n", encoding="utf-8")  # unterminated front matter
    code, _, err = run_main(["export", str(post), str(src), str(dst)])
    assert code == 1 and err.startswith("error: ") and not dst.exists()
    post.write_text("---\ncsv_widths: A=2\n---\n", encoding="utf-8")
    for missing in ([str(tmp_path / "nope.md"), str(src)], [str(post), str(tmp_path / "nope.csv")]):
        code, out, err = run_main(["export", *missing, str(dst)])
        assert code == 1 and out == "" and err.startswith("error: ") and not dst.exists()
    post.write_bytes(b"---\ncsv_widths: \xff\xfe\n---\n")
    code, _, err = run_main(["export", str(post), str(src), str(dst)])
    assert code == 1 and err.startswith("error: ") and not dst.exists()
    dst_dir = tmp_path / "dir"
    dst_dir.mkdir()
    post.write_text("---\ncsv_widths: A=2\n---\n", encoding="utf-8")
    code, _, err = run_main(["export", str(post), str(src), str(dst_dir)])
    assert code == 1 and err.startswith("error: ")


def test_cli_usage_errors_exit_2():
    for argv in ([], ["bogus"], ["export"], ["export", "a", "b"], ["export", "a", "b", "c", "d"],
                 ["export", "a", "b", "c", "--nope"], ["export", "--raw", "a", "b"], ["-h"]):
        code, out, err = run_main(argv)
        assert code == 2 and out == "" and err.startswith("usage: "), argv


def test_python_dash_m_sheetsite_end_to_end(tmp_path):
    post, src, dst = tmp_path / "post.md", tmp_path / "in.csv", tmp_path / "out.csv"
    post.write_bytes(b"---\ntitle: T\ncsv_widths: A=4, C=2\n---\nbody")
    src.write_bytes(b"a,b,c\nddddd,e,f\n")
    proc = subprocess.run([sys.executable, "-m", "sheetsite", "export", str(post), str(src), str(dst)],
                          capture_output=True, text=True, timeout=60, env=dict(os.environ))
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout == "exported: 2 sized columns\n"
    assert dst.read_bytes() == b"a   ,b,c \nddddd,e,f \n"
    bad = subprocess.run([sys.executable, "-m", "sheetsite", "export", str(post)],
                         capture_output=True, text=True, timeout=60, env=dict(os.environ))
    assert bad.returncode == 2 and re.match(r"usage: ", bad.stderr)
    miss = subprocess.run([sys.executable, "-m", "sheetsite", "export", str(post), str(tmp_path / "x.csv"),
                           str(tmp_path / "y.csv")], capture_output=True, text=True, timeout=60, env=dict(os.environ))
    assert miss.returncode == 1 and miss.stderr.startswith("error: ")


def test_same_post_builds_in_sitegen_and_yields_widths(tmp_path):
    # sitegen itself must keep ignoring unknown front matter keys such as csv_widths
    from sheetsite.bridge import widths_from_markdown
    from sitegen.site import build
    src, out = tmp_path / "src", tmp_path / "out"
    files = {
        "site.toml": 'title = "T"\nurl = "https://e.com/"\nauthor = "A"\n',
        "templates/post.html": "{{ post.title }}",
        "templates/index.html": "{% for p in posts %}{{ p.slug }},{% endfor %}",
        "templates/tag.html": "x",
        "content/a.md": "---\ntitle: A\ndate: 2024-01-02\ncsv_widths: A=5, B-C=3\n---\nbody",
    }
    for name, text in files.items():
        p = src / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    build(src, out)
    assert (out / "index.html").read_text(encoding="utf-8") == "a,"
    assert widths_from_markdown(files["content/a.md"]) == {0: 5, 1: 3, 2: 3}
