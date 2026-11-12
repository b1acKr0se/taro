def same(actual, expected):
    assert type(actual) is type(expected), (actual, expected)
    assert actual == expected, (actual, expected)


def err(code):
    from minisheet.values import ErrorValue
    return ErrorValue(code)


def ev(formula, cells=None):
    from minisheet.evaluator import evaluate
    from minisheet.parser import parse
    from minisheet.refs import parse_ref
    from minisheet.values import Empty
    store = {}
    for k, v in (cells or {}).items():
        r = parse_ref(k)
        store[(r.col, r.row)] = v
    return evaluate(parse(formula), lambda ref: store.get((ref.col, ref.row), Empty))


def test_arithmetic_precedence_percent_and_zero_power():
    same(ev("-2^2"), 4.0)
    same(ev("2^3^2"), 64.0)
    same(ev("2^-1"), 0.5)
    same(ev("50%"), 0.5)
    same(ev("200%*3"), 6.0)
    same(ev("0^0"), 1.0)


def test_division_power_and_overflow_errors():
    same(ev("1/0"), err("#DIV/0!"))
    same(ev("0/0"), err("#DIV/0!"))
    same(ev("0^-1"), err("#DIV/0!"))
    same(ev("(-8)^0.5"), err("#VALUE!"))
    same(ev("1E308*10"), err("#VALUE!"))


def test_concatenation_uses_text_conversion():
    same(ev("1&2"), "12")
    same(ev('"a"&1.5&TRUE'), "a1.5TRUE")


def test_arithmetic_coerces_operands():
    same(ev('"3"+1'), 4.0)
    same(ev('""+1'), 1.0)
    same(ev('"x"+1'), err("#VALUE!"))
    same(ev("TRUE+1"), 2.0)


def test_comparisons_across_types():
    same(ev('1<"a"'), True)
    same(ev('"a"<TRUE'), True)
    same(ev('"A"="a"'), True)
    same(ev('2="2"'), False)
    same(ev("TRUE<5"), False)


def test_blank_cell_behaviour_in_expressions():
    same(ev("A1+1"), 1.0)
    same(ev('A1&"x"'), "x")
    same(ev("A1=0"), True)
    same(ev('A1=""'), True)
    same(ev("A1"), 0.0)


def test_error_precedence_and_no_short_circuit():
    same(ev("(1/0)+NOPE()"), err("#DIV/0!"))
    same(ev("NOPE()+(1/0)"), err("#NAME?"))
    same(ev('"a"+(1/0)'), err("#DIV/0!"))


def test_name_badref_and_unknown_function_errors():
    same(ev("FOO"), err("#NAME?"))
    same(ev("NOPE(1/0)"), err("#NAME?"))
    same(ev("AAA1"), err("#REF!"))
    same(ev("A0"), err("#REF!"))
    same(ev("A1:A2+1"), err("#VALUE!"))


def test_top_level_range_is_value_error():
    same(ev("A1:A2"), err("#VALUE!"))


def test_unknown_function_arguments_are_not_evaluated():
    from minisheet.evaluator import evaluate
    from minisheet.parser import parse

    def boom(ref):
        raise AssertionError("get_cell must not be called")

    same(evaluate(parse("NOPE(A1)"), boom), err("#NAME?"))


def test_normal_function_gets_evaluated_args_and_row_major_range_list():
    from minisheet.functions import register
    seen = []

    @register("evtest_echo")
    def echo(*args):
        seen.append(args)
        return 0.0

    ev("EVTEST_ECHO(A1:B2, 1+1)", {"A1": 1.0, "B1": 2.0, "A2": 3.0, "B2": 4.0})
    assert seen == [([1.0, 2.0, 3.0, 4.0], 2.0)]


def test_lazy_function_receives_callables_and_only_called_ones_run():
    from minisheet import functions
    from minisheet.functions import register
    calls = []

    @register("evtest_lazy", lazy=True)
    def lz(a, b):
        calls.append("lz")
        return b()

    assert "EVTEST_LAZY" in functions.LAZY
    same(ev("EVTEST_LAZY(1/0, 2)"), 2.0)
    assert calls == ["lz"]
