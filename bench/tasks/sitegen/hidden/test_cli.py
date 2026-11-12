def test_build_success_prints_summary_line(site_factory, capsys):
    from sitegen.cli import main
    src, out = site_factory()
    code = main(["build", str(src), str(out)])
    captured = capsys.readouterr()
    assert code == 0
    assert captured.out == "built: 2 posts, 2 tag pages, 1 static files, 1 drafts skipped\n"
    assert (out / "index.html").is_file()


def test_build_failure_prints_error_to_stderr_and_returns_1(site_factory, capsys):
    from sitegen.cli import main
    src, out = site_factory({"site.toml": None})
    code = main(["build", str(src), str(out)])
    captured = capsys.readouterr()
    assert code == 1
    assert captured.err.startswith("error: ")
    assert captured.out == ""


def test_check_not_a_directory(tmp_path, capsys):
    from sitegen.cli import main
    missing = str(tmp_path / "nope")
    code = main(["check", missing])
    captured = capsys.readouterr()
    assert code == 1
    assert f"error: not a directory: {missing}" in captured.err.splitlines()


def test_check_reports_broken_links_and_exit_1(tmp_path, capsys):
    from sitegen.cli import main
    (tmp_path / "index.html").write_text('<a href="/missing">m</a><a href="/about.html">a</a>')
    (tmp_path / "about.html").write_text("")
    (tmp_path / "feed.xml").write_text("<a href='/zzz'>")
    code = main(["check", str(tmp_path)])
    lines = capsys.readouterr().out.splitlines()
    assert code == 1
    assert lines == ["broken: /index.html -> /missing", "checked 2 pages, 1 broken links"]




def test_usage_errors_return_2_without_raising(tmp_path, capsys):
    from sitegen.cli import main
    assert main([]) == 2
    assert main(["frobnicate"]) == 2
    assert main(["build", "only-one"]) == 2
    assert main(["check", str(tmp_path), "extra"]) == 2
    assert main(["check", "--bogus", str(tmp_path)]) == 2
    capsys.readouterr()


