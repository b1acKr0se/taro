STEPS = [
    ("A1", "1"), ("B1", "=A1+1"), ("C1", "=B1*2"), ("A1", "5"), ("C1", "=A1"),
    ("D1", "=SUM(A1:A3)"), ("A3", "9"), ("E1", "=B1+C1"), ("A1", "1"),
    ("A1", ""), ("F1", "=1+"),
]


def play(n):
    from minisheet import Workbook
    wb = Workbook()
    for ref, raw in STEPS[:n]:
        wb.set(ref, raw)
    return wb


def test_example1_dependency_chain_recalc_counts():
    from minisheet import Workbook
    wb = Workbook()
    assert wb.last_changed == []
    wb.set("A1", "1")
    assert wb.recalc_count == 0 and wb.get("A1") == 1.0
    wb.set("B1", "=A1+1")
    assert wb.recalc_count == 1 and wb.get("B1") == 2.0
    wb.set("C1", "=B1*2")
    assert wb.recalc_count == 2 and wb.get("C1") == 4.0
    wb.set("A1", "5")
    assert wb.recalc_count == 4
    assert wb.get("B1") == 6.0 and wb.get("C1") == 12.0
    wb.set("C1", "=A1")
    assert wb.recalc_count == 5 and wb.get("C1") == 5.0 and wb.get("B1") == 6.0


def test_example1_range_depends_on_blank_cell_set_later():
    wb = play(5)
    wb.set("D1", "=SUM(A1:A3)")
    assert wb.recalc_count == 6 and wb.get("D1") == 5.0
    wb.set("A3", "9")
    assert wb.recalc_count == 7 and wb.get("D1") == 14.0


def test_example1_recompute_each_dependent_once_in_topological_order():
    wb = play(8)
    assert wb.recalc_count == 8 and wb.get("E1") == 11.0
    wb.set("A1", "1")
    assert wb.recalc_count == 12 and wb.get("E1") == 3.0
    lc = wb.last_changed
    assert sorted(lc) == ["A1", "B1", "C1", "D1", "E1"]
    assert lc[0] == "A1"
    assert lc.index("E1") > lc.index("B1") and lc.index("E1") > lc.index("C1")


def test_example1_clearing_a_cell_recalculates_dependents():
    wb = play(9)
    wb.set("A1", "")
    assert wb.recalc_count == 16
    assert wb.get("B1") == 1.0 and wb.get("C1") == 0.0
    assert wb.get("D1") == 9.0 and wb.get("E1") == 1.0


def test_example1_unparseable_formula_is_value_and_keeps_raw():
    from minisheet.values import ErrorValue
    wb = play(10)
    wb.set("F1", "=1+")
    assert wb.recalc_count == 17
    assert wb.get("F1") == ErrorValue("#VALUE!")
    assert wb.raw("F1") == "=1+"


def test_example2_cycle_members_and_dependents_are_circ():
    from minisheet import Workbook
    from minisheet.values import ErrorValue
    wb = Workbook()
    wb.set("A1", "=B1")
    assert wb.recalc_count == 1 and wb.get("A1") == 0.0
    wb.set("B1", "=A1")
    assert wb.get("A1") == ErrorValue("#CIRC!") and wb.get("B1") == ErrorValue("#CIRC!")
    assert wb.recalc_count == 1
    wb.set("C1", "=A1+1")
    wb.set("D1", "=C1")
    assert wb.get("C1") == ErrorValue("#CIRC!") and wb.get("D1") == ErrorValue("#CIRC!")
    assert wb.recalc_count == 1


def test_example2_breaking_cycle_recovers_members_and_dependents():
    from minisheet import Workbook
    wb = Workbook()
    for ref, raw in [("A1", "=B1"), ("B1", "=A1"), ("C1", "=A1+1"), ("D1", "=C1")]:
        wb.set(ref, raw)
    wb.set("B1", "5")
    assert wb.recalc_count == 4
    assert wb.get("A1") == 5.0 and wb.get("C1") == 6.0 and wb.get("D1") == 6.0


def test_self_reference_is_circ_and_adds_no_evaluations():
    from minisheet import Workbook
    from minisheet.values import ErrorValue
    wb = Workbook()
    wb.set("A1", "=A1+1")
    assert wb.get("A1") == ErrorValue("#CIRC!")
    assert wb.recalc_count == 0


def test_example3_raw_classification():
    from minisheet import Workbook
    from minisheet.values import ErrorValue
    wb = Workbook()
    wb.set("A1", "007")
    assert wb.get("A1") == 7.0 and type(wb.get("A1")) is float
    assert wb.raw("A1") == "007"
    wb.set("A2", " true ")
    assert wb.get("A2") is True
    wb.set("A3", " =1")
    assert wb.get("A3") == " =1"
    wb.set("A4", "1,5")
    assert wb.get("A4") == "1,5"
    wb.set("A5", "=")
    assert wb.get("A5") == ErrorValue("#VALUE!")


def test_ref_string_accepts_lowercase_and_dollars_and_bad_ref_changes_nothing():
    import pytest
    from minisheet import Workbook
    wb = Workbook()
    wb.set("b2", "3")
    assert wb.get("$B$2") == 3.0
    assert wb.cells() == ["B2"]
    with pytest.raises(ValueError):
        wb.set("AAA1", "1")
    assert wb.cells() == ["B2"]


def test_cells_sorted_by_row_then_column_and_cleared_cells_dropped():
    from minisheet import Workbook
    from minisheet.values import Empty
    wb = Workbook()
    wb.set("C1", "1")
    wb.set("A2", "2")
    wb.set("B1", "3")
    assert wb.cells() == ["B1", "C1", "A2"]
    wb.set("B1", "")
    assert wb.cells() == ["C1", "A2"]
    assert wb.get("B1") is Empty or wb.get("B1") == Empty
    assert wb.raw("B1") == ""


def test_literal_flag_stores_formula_text_as_string():
    from minisheet import Workbook
    wb = Workbook()
    wb.set("A1", "=1+1", literal=True)
    assert wb.get("A1") == "=1+1"
    assert wb.raw("A1") == "=1+1"
    wb.set("A2", "5", literal=True)
    assert wb.get("A2") == "5"
