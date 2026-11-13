def test_save_quotes_fields_and_writes_values():
    from minisheet import Workbook
    from minisheet.csvio import save_csv
    import tempfile, os
    wb = Workbook()
    wb.set("A1", "1")
    wb.set("B1", "=A1/4")
    wb.set("A2", 'say "hi", ok')
    wb.set("C2", "x")
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "o.csv")
        save_csv(wb, p)
        with open(p, "rb") as f:
            assert f.read() == b'1,0.25\n"say ""hi"", ok",,x\n'


def test_load_places_fields_and_evaluates_formulas():
    from minisheet.csvio import load_csv
    import tempfile, os
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "i.csv")
        with open(p, "wb") as f:
            f.write(b'a,"b\nc"\n,=A1&"!"\n')
        wb = load_csv(p)
        assert wb.get("A1") == "a"
        assert wb.get("B1") == "b\nc"
        assert wb.get("B2") == "a!"


def test_load_without_formulas_keeps_equals_fields_as_text():
    from minisheet.csvio import load_csv
    import tempfile, os
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "i.csv")
        with open(p, "wb") as f:
            f.write(b'a,"b\nc"\n,=A1&"!"\n')
        wb = load_csv(p, formulas=False)
        assert wb.get("B2") == '=A1&"!"'
        assert wb.raw("B2") == '=A1&"!"'


def test_load_accepts_all_line_endings_and_blank_record_keeps_row():
    from minisheet.csvio import load_csv
    import tempfile, os
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "i.csv")
        with open(p, "wb") as f:
            f.write(b"1,2\r\n3,4\r5,6\n\n7")
        wb = load_csv(p)
        assert wb.get("A1") == 1.0 and wb.get("B1") == 2.0
        assert wb.get("A2") == 3.0 and wb.get("B2") == 4.0
        assert wb.get("A3") == 5.0 and wb.get("B3") == 6.0
        assert wb.get("A5") == 7.0
        assert "A4" not in wb.cells()


def test_save_empty_workbook_gap_rows_and_raw_mode():
    from minisheet import Workbook
    from minisheet.csvio import save_csv
    import tempfile, os
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "o.csv")
        save_csv(Workbook(), p)
        with open(p, "rb") as f:
            assert f.read() == b""
        wb = Workbook()
        wb.set("A1", "=1+1")
        wb.set("A3", "z")
        save_csv(wb, p, values=False)
        with open(p, "rb") as f:
            assert f.read() == b"=1+1\n\nz\n"
