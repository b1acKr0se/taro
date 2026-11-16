import pytest

from minisheet import Workbook
from minisheet.evaluator import evaluate
from minisheet.functions import FUNCTIONS, LAZY, register
from minisheet.lexer import FormulaSyntaxError, tokenize
from minisheet.parser import (BadRef, BinOp, Bool, Call, CellRef, Name, Num,
                              Percent, RangeRef, Str, UnaryOp, parse)
from minisheet.refs import Ref, parse_range, parse_ref, to_a1
from minisheet.values import (CIRC, DIV0, NAME, REF, VALUE, Empty, ErrorValue,
                              format_number, to_bool, to_number, to_text)


# ---- refs
def test_refs():
    assert parse_ref("B12") == Ref(1, 11, False, False)
    assert parse_ref("$zz$9999") == Ref(701, 9998, True, True)
    assert parse_range("$C3:A$1") == (Ref(0, 0, False, True), Ref(2, 2, True, False))
    assert to_a1(Ref(26, 0, True, False)) == "$AA1"
    assert parse_range("A1:A1") == (Ref(0, 0), Ref(0, 0))
    for bad in ("A0", "A01", "AAA1", "A10000", "A1 ", ""):
        with pytest.raises(ValueError):
            parse_ref(bad)
    with pytest.raises(ValueError):
        parse_range("A1")
    with pytest.raises(ValueError):
        to_a1(Ref(702, 0))
    with pytest.raises(ValueError):
        to_a1(Ref(0, 9999))
    with pytest.raises(AttributeError):
        parse_ref("A1").col = 3


# ---- lexer
def tk(s):
    return [(t.kind, t.text, t.pos) for t in tokenize(s)]


def test_lexer():
    assert tk("A1+2") == [("REF", "A1", 0), ("OP", "+", 2), ("NUM", "2", 3)]
    assert tk('"a""b"&sum(1)') == [("STR", 'a"b', 0), ("OP", "&", 6), ("NAME", "SUM", 7),
                                  ("LPAREN", "(", 10), ("NUM", "1", 11), ("RPAREN", ")", 12)]
    assert tk("$A$1:b2 <> 1e3") == [("RANGE", "$A$1:B2", 0), ("OP", "<>", 8), ("NUM", "1e3", 11)]
    for s, pos in (('"abc', 0), ("1 + #", 4), ("a!", 1), ("$", 0), (":", 0)):
        with pytest.raises(FormulaSyntaxError) as ei:
            tokenize(s)
        assert ei.value.pos == pos
        assert isinstance(ei.value, ValueError)
    assert tk("AAA1") == [("REF", "AAA1", 0)]
    assert tk("a1(") [0][:2] == ("NAME", "A1")
    assert tk("A1E3") == [("NAME", "A1E3", 0)]
    assert tk(".5e-2") == [("NUM", ".5e-2", 0)]
    assert tk("1.") == [("NUM", "1.", 0)]
    assert tk(" \t1") == [("NUM", "1", 2)]
    assert [t[1] for t in tk("<=>=<>")] == ["<=", ">=", "<>"]


# ---- parser
def test_parser():
    assert parse("1+2*3") == BinOp("+", Num(1.0), BinOp("*", Num(2.0), Num(3.0)))
    assert parse("2^3^2") == BinOp("^", BinOp("^", Num(2.0), Num(3.0)), Num(2.0))
    assert parse("-2^2") == BinOp("^", UnaryOp("-", Num(2.0)), Num(2.0))
    assert parse("50%+1") == BinOp("+", Percent(Num(50.0)), Num(1.0))
    assert parse("sum(a1:b2,3)") == Call("SUM", (RangeRef(Ref(0, 0), Ref(1, 1)), Num(3.0)))
    assert parse("AAA1+foo+true") == BinOp("+", BinOp("+", BadRef("AAA1"), Name("FOO")), Bool(True))
    assert parse("($A$1)") == CellRef(Ref(0, 0, True, True))
    assert parse("F()") == Call("F", ())
    assert parse("2^-1") == BinOp("^", Num(2.0), UnaryOp("-", Num(1.0)))
    assert parse('"x"') == Str("x")
    for s, pos in (("1+", 2), ("(1", 2), ("1 2", 2), ("1+*2", 2), ("SUM(1,)", 6), ("", 0)):
        with pytest.raises(FormulaSyntaxError) as ei:
            parse(s)
        assert ei.value.pos == pos, s


# ---- values
def test_values():
    assert to_number("  3.5 ") == 3.5
    assert to_number("") == 0.0
    assert to_number("abc") == VALUE
    assert to_number(True) == 1.0 and to_number(Empty) == 0.0
    assert to_number(DIV0) is DIV0
    assert to_number("1e999") == VALUE
    assert to_bool(" true ") is True and to_bool(0.0) is False and to_bool("x") == VALUE
    assert to_text(True) == "TRUE" and to_text(Empty) == "" and to_text(2.5) == "2.5"
    assert [format_number(x) for x in (3.0, 2.5, 0.1 + 0.2, 1 / 3, 1e20, -0.0)] == \
        ["3", "2.5", "0.3", "0.333333333333333", "1e+20", "0"]
    assert not Empty and Empty is type(Empty)()
    assert str(DIV0) == "#DIV/0!" and ErrorValue("#X") == ErrorValue("#X")
    assert (DIV0.code, VALUE.code, REF.code, NAME.code, CIRC.code) == \
        ("#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#CIRC!")


# ---- evaluator / functions
def ev(formula, cells=None):
    cells = {k.upper(): v for k, v in (cells or {}).items()}

    def get(ref):
        return cells.get(to_a1(ref), Empty)
    r = evaluate(parse(formula), get)
    return r


@pytest.mark.parametrize("f,exp", [
    ("-2^2", 4.0), ("2^3^2", 64.0), ("2^-1", 0.5), ("50%", 0.5), ("200%*3", 6.0),
    ("1/0", DIV0), ("0/0", DIV0), ("0^-1", DIV0), ("(-8)^0.5", VALUE), ("0^0", 1.0),
    ("1&2", "12"), ('"a"&1.5&TRUE', "a1.5TRUE"),
    ('"3"+1', 4.0), ('""+1', 1.0), ('"x"+1', VALUE), ("TRUE+1", 2.0),
    ('1<"a"', True), ('"a"<TRUE', True), ('"A"="a"', True), ('2="2"', False), ("TRUE<5", False),
    ("(1/0)+NOPE()", DIV0), ("NOPE()+(1/0)", NAME), ('"a"+(1/0)', DIV0),
    ("FOO", NAME), ("NOPE(1/0)", NAME), ("AAA1", REF), ("A0", REF), ("A1:A2+1", VALUE),
    ("A1:A2", VALUE), ("10^1000", VALUE), ("1e300*1e300", VALUE),
    ("SUM(1,2,3)", 6.0), ("SUM()", VALUE), ('SUM("2",TRUE)', 3.0), ('SUM("x")', VALUE),
    ("AVERAGE(1,2)", 1.5), ("MIN(3,-1,2)", -1.0),
    ("ROUND(2.5,0)", 3.0), ("ROUND(-2.5,0)", -3.0), ("ROUND(2.675,2)", 2.68),
    ("ROUND(1234,-2)", 1200.0), ("ROUND(1)", VALUE), ("ABS(-3)", 3.0), ('ABS("-2")', 2.0),
    ('IF(1,"y","n")', "y"), ('IF(0,"y")', False), ("IF(TRUE,1,1/0)", 1.0),
    ('IF("x",1,2)', VALUE), ("IF(1/0,1,2)", DIV0),
    ("AND(TRUE,1)", True), ("OR(0,FALSE)", False), ('NOT("true")', False),
    ("LEN(12.50)", 4.0), ('UPPER("aB")', "AB"), ("LOWER(TRUE)", "true"),
    ('LEFT("hello",2)', "he"), ('LEFT("hello")', "h"), ('RIGHT("hello",9)', "hello"),
    ('RIGHT("hello",0)', ""), ('LEFT("a",-1)', VALUE), ('RIGHT("hello",2)', "lo"),
    ('LEFT("hello",1.9)', "h"), ("SUM(A1:A2)", 1.0), ("ABS(1,2)", VALUE),
    ("IF(1)", VALUE), ("NOT()", VALUE), ("AND(1/0,TRUE)", DIV0), ("AND()", VALUE),
    ("1=1", True), ('"a"<"B"', True), ("FALSE<TRUE", True),
])
def test_eval(f, exp):
    got = ev(f)
    if f in ("SUM(A1:A2)",):
        got = ev(f, {"A1": "x", "A2": 1.0})
    assert got == exp and type(got) is type(exp)


def test_eval_cells():
    assert ev("A1+1") == 1.0
    assert ev('A1&"x"') == "x"
    assert ev("A1=0") is True and ev('A1=""') is True
    assert ev("A1") == 0.0
    assert ev("SUM(A1:A3)", {"A1": 1.0, "A2": "x"}) == 1.0
    assert ev("SUM(A1:A3)", {"A1": 1.0, "A2": DIV0}) == DIV0
    assert ev("AVERAGE(A1:A3)") == DIV0
    assert ev("MAX(A1:A3)") == 0.0
    assert ev("COUNT(A1:A4)", {"A1": 1.0, "A2": "x", "A3": True}) == 1.0
    assert ev("AND(A1:A2)") == VALUE
    assert ev('CONCAT("a",1,A1:A2)', {"A2": "z"}) == "a1z"
    assert ev("SUM(A1)", {"A1": "x"}) == VALUE
    assert ev("A1:B2") == VALUE
    assert ev("ABS(A1:A2)") == VALUE
    assert ev("SUM(A1:B2)", {"A1": 1.0, "B2": 2.0, "A2": 3.0}) == 6.0
    assert ev("COUNT(1,TRUE,\"x\",\"2\")") == 3.0
    assert ev("OR(A1:A2)", {"A1": 0.0, "A2": 3.0}) is True


def test_register_and_lazy():
    assert LAZY == {"IF"} and "SUM" in FUNCTIONS
    called = []

    @register("twice")
    def twice(*a):
        called.append(a)
        return 2.0
    assert FUNCTIONS["TWICE"] is twice
    assert ev("twice(1)") == 2.0
    del FUNCTIONS["TWICE"]


# ---- workbook
def test_workbook_example1():
    wb = Workbook()
    assert wb.recalc_count == 0 and wb.last_changed == []
    steps = [
        ("A1", "1", 0), ("B1", "=A1+1", 1), ("C1", "=B1*2", 2), ("A1", "5", 4),
        ("C1", "=A1", 5), ("D1", "=SUM(A1:A3)", 6), ("A3", "9", 7), ("E1", "=B1+C1", 8),
        ("A1", "1", 12), ("A1", "", 16), ("F1", "=1+", 17)]
    for ref, raw, cnt in steps:
        wb.set(ref, raw)
        assert wb.recalc_count == cnt, (ref, raw)
        if (ref, raw) == ("A1", "5"):
            assert (wb.get("B1"), wb.get("C1")) == (6.0, 12.0)
            assert wb.last_changed == ["A1", "B1", "C1"]
        if (ref, raw) == ("C1", "=A1"):
            assert wb.get("C1") == 5.0 and wb.get("B1") == 6.0
        if (ref, raw) == ("A3", "9"):
            assert wb.get("D1") == 14.0
        if (ref, raw, cnt) == ("A1", "1", 12):
            assert wb.get("E1") == 3.0
            assert wb.last_changed[0] == "A1" and sorted(wb.last_changed[1:]) == ["B1", "C1", "D1", "E1"]
    assert (wb.get("B1"), wb.get("C1"), wb.get("D1"), wb.get("E1")) == (1.0, 0.0, 9.0, 1.0)
    assert wb.get("F1") == VALUE and wb.raw("F1") == "=1+"
    assert wb.get("A1") is Empty and wb.raw("A1") == ""


def test_workbook_topological_order():
    wb = Workbook()
    wb.set("B1", "=A1+1")
    wb.set("C1", "=B1+A1")
    wb.set("A1", "1")
    assert wb.last_changed == ["A1", "B1", "C1"]


def test_workbook_cycles():
    wb = Workbook()
    wb.set("A1", "=B1")
    assert wb.recalc_count == 1 and wb.get("A1") == 0.0
    wb.set("B1", "=A1")
    assert wb.get("A1") == CIRC and wb.get("B1") == CIRC and wb.recalc_count == 1
    wb.set("C1", "=A1+1")
    wb.set("D1", "=C1")
    assert wb.get("C1") == CIRC and wb.get("D1") == CIRC and wb.recalc_count == 1
    wb.set("B1", "5")
    assert wb.recalc_count == 4
    assert (wb.get("A1"), wb.get("C1"), wb.get("D1")) == (5.0, 6.0, 6.0)
    wb.set("A1", "=A1+1")
    assert wb.get("A1") == CIRC and wb.recalc_count == 4
    wb.set("E1", "=SUM(E1:E3)")
    assert wb.get("E1") == CIRC
    wb.set("F1", "=SUM(A1:A1)")
    assert wb.get("F1") == CIRC and wb.recalc_count == 4
    wb.set("A1", "1")
    assert wb.get("F1") == 1.0 and wb.get("C1") == 2.0


def test_workbook_classification():
    wb = Workbook()
    wb.set("A1", "007")
    assert wb.get("A1") == 7.0 and wb.raw("A1") == "007" and type(wb.get("A1")) is float
    wb.set("A2", " true ")
    assert wb.get("A2") is True
    wb.set("A3", " =1")
    assert wb.get("A3") == " =1"
    wb.set("A4", "1,5")
    assert wb.get("A4") == "1,5"
    wb.set("A5", "=")
    assert wb.get("A5") == VALUE
    wb.set("A6", "   ")
    assert wb.get("A6") == "   "
    wb.set("A7", "=1+1", literal=True)
    assert wb.get("A7") == "=1+1"
    wb.set("A8", "1e999")
    assert wb.get("A8") == "1e999"
    wb.set("a9", "x")
    wb.set("$B$1", "y")
    assert wb.cells() == ["A1", "B1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9"]
    n = wb.recalc_count
    with pytest.raises(ValueError):
        wb.set("AAA1", "1")
    with pytest.raises(ValueError):
        wb.get("A0")
    with pytest.raises(ValueError):
        wb.raw("zzz")
    assert wb.recalc_count == n


def test_workbook_deps_untaken_branch_and_unknown_fn():
    wb = Workbook()
    wb.set("A1", "=IF(TRUE,1,B1)")
    wb.set("C1", "=NOPE(B1)")
    n = wb.recalc_count
    wb.set("B1", "3")
    assert wb.recalc_count == n + 2
    wb.set("D1", "=AAA1+1")
    assert wb.get("D1") == REF
    wb.set("E1", "=1+")
    n = wb.recalc_count
    wb.set("E1", "=1+")
    assert wb.recalc_count == n + 1
