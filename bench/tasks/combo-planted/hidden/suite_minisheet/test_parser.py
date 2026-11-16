import pytest


def test_precedence_mul_over_add():
    from minisheet.parser import BinOp, Num, parse
    assert parse("1+2*3") == BinOp("+", Num(1.0), BinOp("*", Num(2.0), Num(3.0)))


def test_power_is_left_associative():
    from minisheet.parser import BinOp, Num, parse
    assert parse("2^3^2") == BinOp("^", BinOp("^", Num(2.0), Num(3.0)), Num(2.0))


def test_unary_minus_binds_tighter_than_power():
    from minisheet.parser import BinOp, Num, UnaryOp, parse
    assert parse("-2^2") == BinOp("^", UnaryOp("-", Num(2.0)), Num(2.0))


def test_percent_postfix():
    from minisheet.parser import BinOp, Num, Percent, parse
    assert parse("50%+1") == BinOp("+", Percent(Num(50.0)), Num(1.0))


def test_call_with_range_and_number_args():
    from minisheet.parser import Call, Num, RangeRef, parse
    from minisheet.refs import Ref
    assert parse("sum(a1:b2,3)") == Call("SUM", (RangeRef(Ref(0, 0), Ref(1, 1)), Num(3.0)))


def test_badref_name_and_bool_nodes():
    from minisheet.parser import BadRef, BinOp, Bool, Name, parse
    assert parse("AAA1+foo+true") == BinOp(
        "+", BinOp("+", BadRef("AAA1"), Name("FOO")), Bool(True))


def test_parentheses_make_no_node_and_empty_call_is_valid():
    from minisheet.parser import Call, CellRef, parse
    from minisheet.refs import Ref
    assert parse("($A$1)") == CellRef(Ref(0, 0, True, True))
    assert parse("F()") == Call("F", ())


def test_syntax_error_position_2():
    from minisheet.lexer import FormulaSyntaxError
    from minisheet.parser import parse
    for text in ["1+", "(1", "1 2", "1+*2"]:
        with pytest.raises(FormulaSyntaxError) as e:
            parse(text)
        assert e.value.pos == 2, text


def test_empty_argument_and_empty_text_error_positions():
    from minisheet.lexer import FormulaSyntaxError
    from minisheet.parser import parse
    with pytest.raises(FormulaSyntaxError) as e:
        parse("SUM(1,)")
    assert e.value.pos == 6
    with pytest.raises(FormulaSyntaxError) as e2:
        parse("")
    assert e2.value.pos == 0


def test_negative_exponent_parses_and_subtraction_is_left_associative():
    from minisheet.parser import BinOp, Num, UnaryOp, parse
    assert parse("2^-1") == BinOp("^", Num(2.0), UnaryOp("-", Num(1.0)))
    assert parse("1-2-3") == BinOp("-", BinOp("-", Num(1.0), Num(2.0)), Num(3.0))
