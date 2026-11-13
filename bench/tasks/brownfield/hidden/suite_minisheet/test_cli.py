import io


def run(argv, text=""):
    from minisheet.cli import main
    out = io.StringIO()
    code = main(argv, stdin=io.StringIO(text), stdout=out)
    return code, out.getvalue()


def test_set_get_blank_and_raw_with_spaces():
    code, out = run([], "set A1 3\nget A1\nget B1\nset A2 hello world\nget A2\nquit\n")
    assert out == "OK\n3\n\nOK\nhello world\n"
    assert code == 0


def test_show_grid_exact_layout():
    script = (
        "set A1 1.5\nset B1 hi\nset C1 =A1*2\nset A2 =1/0\nset B2 TRUE\n"
        "set C2 =A1*100\nshow A1:C2\n"
    )
    code, out = run([], script)
    expected = (
        "OK\n" * 6
        + "        A    B      C\n"
        + "1    1.50 hi     3.00\n"
        + "2 #DIV/0! TRUE 150.00\n"
    )
    assert out == expected
    assert code == 0


def test_bad_reference_message_and_exit_code():
    code, out = run([], "get AAA1\n")
    assert out == "ERR bad reference: AAA1\n"
    assert code == 2


def test_unknown_command_echoed_as_typed_and_processing_continues():
    code, out = run([], "Foo bar\nset A1 1\nget A1\n")
    assert out == "ERR unknown command: Foo\nOK\n1\n"
    assert code == 2


def test_unknown_argv_prints_usage_and_returns_2():
    code, out = run(["bogus"])
    assert out == "ERR usage: python -m minisheet [serve --port N [--load FILE]]\n"
    assert code == 2
