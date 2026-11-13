def same(actual, expected):
    assert type(actual) is type(expected), (actual, expected)
    assert actual == expected, (actual, expected)


def err(code):
    from minisheet.values import ErrorValue
    return ErrorValue(code)


def fn(name):
    from minisheet.functions import FUNCTIONS
    return FUNCTIONS[name]


def thunk(v):
    return lambda: v


# ---- math ----

def test_sum_scalars_and_coercion():
    s = fn("SUM")
    same(s(1.0, 2.0, 3.0), 6.0)
    same(s(), err("#VALUE!"))
    same(s("2", True), 3.0)
    same(s("x"), err("#VALUE!"))


def test_sum_range_skips_non_numbers_and_returns_first_error():
    from minisheet.values import Empty
    s = fn("SUM")
    same(s([1.0, "x", Empty]), 1.0)
    same(s([1.0, "x", err("#DIV/0!")]), err("#DIV/0!"))


def test_average():
    from minisheet.values import Empty
    a = fn("AVERAGE")
    same(a([Empty, Empty, Empty]), err("#DIV/0!"))
    same(a(1.0, 2.0), 1.5)


def test_min_max():
    from minisheet.values import Empty
    same(fn("MIN")(3.0, -1.0, 2.0), -1.0)
    same(fn("MAX")([Empty, Empty, Empty]), 0.0)


def test_count_counts_only_floats_in_range():
    from minisheet.values import Empty
    same(fn("COUNT")([1.0, "x", True, Empty]), 1.0)


def test_round_half_away_from_zero_and_negative_digits():
    r = fn("ROUND")
    same(r(2.5, 0.0), 3.0)
    same(r(-2.5, 0.0), -3.0)
    same(r(2.675, 2.0), 2.68)
    same(r(1234.0, -2.0), 1200.0)


def test_abs_coerces_and_wrong_arity_or_range_is_value():
    same(fn("ABS")(-3.0), 3.0)
    same(fn("ABS")("-2"), 2.0)
    same(fn("ROUND")(1.0), err("#VALUE!"))
    same(fn("ABS")([1.0]), err("#VALUE!"))


# ---- logic / text ----

def test_if_evaluates_only_chosen_branch():
    f = fn("IF")

    def boom():
        raise AssertionError("untaken branch evaluated")

    same(f(thunk(1.0), thunk("y"), thunk("n")), "y")
    same(f(thunk(0.0), thunk("y")), False)
    same(f(thunk(True), thunk(1.0), boom), 1.0)


def test_if_error_and_bad_condition():
    f = fn("IF")
    same(f(thunk("x"), thunk(1.0), thunk(2.0)), err("#VALUE!"))
    same(f(thunk(err("#DIV/0!")), thunk(1.0), thunk(2.0)), err("#DIV/0!"))
    same(f(thunk([1.0]), thunk(1.0), thunk(2.0)), err("#VALUE!"))


def test_and_or_not():
    from minisheet.values import Empty
    same(fn("AND")(True, 1.0), True)
    same(fn("OR")(0.0, False), False)
    same(fn("AND")([Empty, Empty]), err("#VALUE!"))
    same(fn("NOT")("true"), False)


def test_concat_joins_scalars_and_range_elements():
    from minisheet.values import Empty
    same(fn("CONCAT")("a", 1.0, [Empty, "z"]), "a1z")


def test_len_upper_lower():
    same(fn("LEN")(12.5), 4.0)
    same(fn("UPPER")("aB"), "AB")
    same(fn("LOWER")(True), "true")


def test_left():
    f = fn("LEFT")
    same(f("hello", 2.0), "he")
    same(f("hello"), "h")
    same(f("a", -1.0), err("#VALUE!"))


def test_right():
    f = fn("RIGHT")
    same(f("hello", 9.0), "hello")
    same(f("hello", 0.0), "")
    same(f("a", -1.0), err("#VALUE!"))
