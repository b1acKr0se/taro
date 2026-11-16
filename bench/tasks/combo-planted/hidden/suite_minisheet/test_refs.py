import pytest


def test_parse_ref_simple():
    from minisheet.refs import Ref, parse_ref
    assert parse_ref("B12") == Ref(1, 11, False, False)


def test_parse_ref_absolute_lowercase_max_bounds():
    from minisheet.refs import Ref, parse_ref
    assert parse_ref("$zz$9999") == Ref(701, 9998, True, True)


def test_parse_range_normalizes_corners_and_dollar_flags():
    from minisheet.refs import Ref, parse_range
    assert parse_range("$C3:A$1") == (Ref(0, 0, False, True), Ref(2, 2, True, False))


def test_to_a1_absolute_column():
    from minisheet.refs import Ref, to_a1
    assert to_a1(Ref(26, 0, True, False)) == "$AA1"


def test_parse_ref_rejects_invalid():
    from minisheet.refs import parse_ref
    for bad in ["A0", "A01", "AAA1", "A10000"]:
        with pytest.raises(ValueError):
            parse_ref(bad)


def test_parse_range_bare_ref_is_value_error():
    from minisheet.refs import parse_range
    with pytest.raises(ValueError):
        parse_range("A1")
