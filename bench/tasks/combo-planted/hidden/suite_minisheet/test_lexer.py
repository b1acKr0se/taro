import pytest


def _kind(t):
    return getattr(t.kind, "name", t.kind)


def _flat(tokens):
    return [(_kind(t), t.text, t.pos) for t in tokens]


def test_tokenize_ref_op_num():
    from minisheet.lexer import tokenize
    assert _flat(tokenize("A1+2")) == [("REF", "A1", 0), ("OP", "+", 2), ("NUM", "2", 3)]


def test_tokenize_string_with_doubled_quote_and_call():
    from minisheet.lexer import tokenize
    assert _flat(tokenize('"a""b"&sum(1)')) == [
        ("STR", 'a"b', 0), ("OP", "&", 6), ("NAME", "SUM", 7),
        ("LPAREN", "(", 10), ("NUM", "1", 11), ("RPAREN", ")", 12),
    ]


def test_tokenize_range_two_char_operator_and_exponent_number():
    from minisheet.lexer import tokenize
    assert _flat(tokenize("$A$1:b2 <> 1e3")) == [
        ("RANGE", "$A$1:B2", 0), ("OP", "<>", 8), ("NUM", "1e3", 11),
    ]


def test_tokenize_errors_report_position():
    from minisheet.lexer import FormulaSyntaxError, tokenize
    with pytest.raises(FormulaSyntaxError) as e1:
        tokenize('"abc')
    assert e1.value.pos == 0
    with pytest.raises(FormulaSyntaxError) as e2:
        tokenize("1 + #")
    assert e2.value.pos == 4


def test_ref_shaped_before_paren_and_a1e3_are_names():
    from minisheet.lexer import tokenize
    assert _flat(tokenize("a1(2)")) == [
        ("NAME", "A1", 0), ("LPAREN", "(", 2), ("NUM", "2", 3), ("RPAREN", ")", 4),
    ]
    assert _flat(tokenize("a1e3")) == [("NAME", "A1E3", 0)]


def test_out_of_bounds_ref_shape_is_ref_token_uppercased():
    from minisheet.lexer import tokenize
    assert _flat(tokenize("aaa1")) == [("REF", "AAA1", 0)]
