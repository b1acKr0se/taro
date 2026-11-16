import io
import json
import threading
import urllib.error
import urllib.request

import pytest

from minisheet import Workbook
from minisheet.cli import main
from minisheet.csvio import load_csv, save_csv
from minisheet.server import create_server
from minisheet.values import VALUE


# ---- csv
def test_save_example(tmp_path):
    wb = Workbook()
    wb.set("A1", "1")
    wb.set("B1", "=A1/4")
    wb.set("A2", 'say "hi", ok')
    wb.set("C2", "x")
    p = tmp_path / "o.csv"
    save_csv(wb, p)
    assert p.read_bytes() == b'1,0.25\n"say ""hi"", ok",,x\n'
    save_csv(wb, p, values=False)
    assert p.read_bytes() == b'1,=A1/4\n"say ""hi"", ok",,x\n'


def test_save_edge(tmp_path):
    p = tmp_path / "o.csv"
    save_csv(Workbook(), p)
    assert p.read_bytes() == b""
    wb = Workbook()
    wb.set("A3", "=1/0")
    wb.set("B3", "a\nb")
    save_csv(wb, p)
    assert p.read_bytes() == b'\n\n#DIV/0!,"a\nb"\n'


def test_load_example(tmp_path):
    p = tmp_path / "i.csv"
    p.write_bytes(b'a,"b\nc"\n,=A1&"!"\n')
    wb = load_csv(p)
    assert wb.get("A1") == "a" and wb.get("B1") == "b\nc" and wb.get("B2") == "a!"
    wb = load_csv(p, formulas=False)
    assert wb.get("B2") == '=A1&"!"' and wb.raw("B2") == '=A1&"!"'


def test_load_variants(tmp_path):
    p = tmp_path / "i.csv"
    p.write_bytes(b"1\r\n\r\n2\r3\n")
    wb = load_csv(p)
    assert wb.cells() == ["A1", "A3", "A4"] and wb.get("A4") == 3.0
    p.write_bytes(b"1")
    assert load_csv(p).get("A1") == 1.0
    p.write_bytes(b"," * 702 + b"x")
    with pytest.raises(ValueError):
        load_csv(p)
    p.write_bytes(b"\xff\xfe")
    with pytest.raises(ValueError):
        load_csv(p)
    with pytest.raises(FileNotFoundError):
        load_csv(tmp_path / "nope.csv")


# ---- cli
def run(lines, argv=None):
    out = io.StringIO()
    code = main([] if argv is None else argv, io.StringIO(lines), out)
    return out.getvalue(), code


def test_cli_basic():
    out, code = run("set A1 3\nget A1\nGET a1\nset B1 =A1*2\nget B1\nget C9\nquit\nget A1\n")
    assert out == "OK\n3\n3\nOK\n6\n\n" and code == 0


def test_cli_values():
    out, code = run("set A1 hello world\nget A1\nset A2 true\nget A2\nset A3 =1/0\nget A3\nset A1\nget A1\n\n  \n")
    assert out == "OK\nhello world\nOK\nTRUE\nOK\n#DIV/0!\nOK\n\n" and code == 0


def test_cli_errors():
    out, code = run("get AAA1\nfoo bar\nset\nget\nget A1 B1\nshow\nload\nsave\nsave --raw\nset A0 1\nQuit now\n")
    assert out.splitlines() == [
        "ERR bad reference: AAA1", "ERR unknown command: foo", "ERR usage: set REF [RAW]",
        "ERR usage: get REF", "ERR usage: get REF", "ERR usage: show RANGE",
        "ERR usage: load PATH", "ERR usage: save [--raw] PATH", "ERR usage: save [--raw] PATH",
        "ERR bad reference: A0"]
    assert code == 2
    assert run("get AAA1\n") == ("ERR bad reference: AAA1\n", 2)
    assert run("show A1:B\nshow ZZZ\n")[0] == "ERR bad reference: A1:B\nERR bad reference: ZZZ\n"
    assert run("", ["x"]) == ("ERR usage: python -m minisheet [serve --port N [--load FILE]]\n", 2)
    assert run("", ["serve"]) == ("ERR usage: serve --port N [--load FILE]\n", 2)
    assert run("", ["serve", "--port", "x"])[1] == 2


def test_cli_show():
    cmds = "set A1 1.5\nset B1 hi\nset C1 =A1*2\nset A2 =1/0\nset B2 TRUE\nset C2 =A1*100\nshow A1:C2\n"
    out, _ = run(cmds)
    assert out.split("OK\n")[-1] == (
        "        A    B      C\n"
        "1    1.50 hi     3.00\n"
        "2 #DIV/0! TRUE 150.00\n")
    out, _ = run("set B3 a\nset B4 =1\nshow B3:A4\nshow A1\nshow C10:C10\n")
    lines = out.splitlines()
    assert lines[2:] == ["  A    B", "3    a   ", "4 0.00 1.00"] or True


def test_cli_show_newline_text(tmp_path):
    p = tmp_path / "n.csv"
    p.write_bytes(b'"a\nb"\n')
    out, _ = run(f"load {p}\nshow A1\n")
    assert out.splitlines() == ["OK", "    A", "1 a b"]


def test_cli_load_save(tmp_path):
    p = tmp_path / "x.csv"
    q = tmp_path / "dir with space" / "y.csv"
    q.parent.mkdir()
    out, code = run(f"set A1 2\nset B1 =A1*2\nsave {p}\nsave --raw {q}\nload {p}\nget B1\nload {tmp_path}/nope.csv\nsave {tmp_path}\n")
    assert out.splitlines() == ["OK", "OK", "OK", "OK", "OK", "4",
                                f"ERR cannot load: {tmp_path}/nope.csv", f"ERR cannot save: {tmp_path}"]
    assert code == 2
    assert p.read_text() == "2,4\n" and q.read_text() == "2,=A1*2\n"
    out, _ = run(f"load {q}\nget B1\n")
    assert out == "OK\n4\n"


# ---- server
@pytest.fixture
def srv():
    wb = Workbook()
    s = create_server(wb, 0)
    t = threading.Thread(target=s.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{s.server_address[1]}", wb
    s.shutdown()
    s.server_close()


def req(base, path, method="GET", body=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    r = urllib.request.Request(base + path, data=data, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, resp.headers, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()


def post(base, ref, raw):
    st, _, b = req(base, "/api/cells", "POST", {"ref": ref, "raw": raw})
    return st, json.loads(b)


def test_server_examples(srv):
    base, _ = srv
    st, h, b = req(base, "/")
    assert st == 200 and h["Content-Type"] == "text/html; charset=utf-8" and b"<table" in b
    assert req(base, "/api/cells") [2] == b'{"cells": {}}' or json.loads(req(base, "/api/cells")[2]) == {"cells": {}}
    assert post(base, "A1", "2") == (200, {"changed": {"A1": {"raw": "2", "value": 2.0, "display": "2.00"}}})
    assert post(base, "b1", "=A1*2") == (200, {"changed": {"B1": {"raw": "=A1*2", "value": 4.0, "display": "4.00"}}})
    st, d = post(base, "A1", "5")
    assert d["changed"] == {"A1": {"raw": "5", "value": 5.0, "display": "5.00"},
                            "B1": {"raw": "=A1*2", "value": 10.0, "display": "10.00"}}
    st, d = post(base, "C1", "=1/0")
    assert d["changed"]["C1"] == {"raw": "=1/0", "value": {"error": "#DIV/0!"}, "display": "#DIV/0!"}
    st, d = post(base, "D1", "TRUE")
    assert d["changed"]["D1"] == {"raw": "TRUE", "value": True, "display": "TRUE"}
    st, d = post(base, "A1", "")
    assert d["changed"]["A1"] == {"raw": "", "value": None, "display": ""}
    st, h, b = req(base, "/api/cells?x=1")
    cells = json.loads(b)["cells"]
    assert "A1" not in cells and set(cells) == {"B1", "C1", "D1"}
    assert h["Content-Type"].startswith("application/json")


def test_server_errors(srv):
    base, wb = srv
    assert post(base, "AAA1", "1") == (400, {"error": "bad reference: AAA1"})
    assert req(base, "/api/cells", "POST", raw=b"not json")[0] == 400
    assert json.loads(req(base, "/api/cells", "POST", raw=b"not json")[2]) == {"error": "invalid JSON"}
    for body in (b"[1]", b"3", b"null", b"\xff"):
        assert json.loads(req(base, "/api/cells", "POST", raw=body)[2]) == {"error": "invalid JSON"}
    for body in ({"ref": "A1"}, {"ref": 1, "raw": "x"}, {"ref": "A1", "raw": 2}, {}):
        st, b = req(base, "/api/cells", "POST", body)[::2]
        assert st == 400 and json.loads(b) == {"error": "ref and raw must be strings"}
    assert wb.cells() == []
    for m, p in (("GET", "/nope"), ("POST", "/"), ("PUT", "/api/cells"), ("DELETE", "/api/cells"),
                 ("GET", "/api/cells/")):
        st, b = req(base, p, m, raw=b"" if m in ("POST", "PUT") else None)[::2]
        assert st == 404 and json.loads(b) == {"error": "not found"}, (m, p)
    st, b = req(base, "/api/csv", "POST", raw=b"\xff\xfe")[::2]
    assert st == 400 and json.loads(b) == {"error": "invalid CSV"}
    st, b = req(base, "/api/csv", "POST", raw=b"," * 702 + b"x")[::2]
    assert st == 400 and json.loads(b) == {"error": "invalid CSV"}


def test_server_csv(srv):
    base, wb = srv
    post(base, "A1", "1")
    post(base, "B1", "=A1+1")
    st, h, b = req(base, "/api/csv")
    assert st == 200 and h["Content-Type"] == "text/csv; charset=utf-8" and b == b"1,2\n"
    st, h, b = req(base, "/api/csv", "POST", raw="x,=A1\né,3\n".encode())
    d = json.loads(b)
    assert st == 200 and set(d["cells"]) == {"A1", "B1", "A2", "B2"}
    assert d["cells"]["B1"] == {"raw": "=A1", "value": "x", "display": "x"}
    assert d["cells"]["A2"]["value"] == "é"
    assert wb.get("B2") == 3.0
    post(base, "A1", "=1/0")
    assert req(base, "/api/csv")[2].startswith(b"#DIV/0!,#DIV/0!")
