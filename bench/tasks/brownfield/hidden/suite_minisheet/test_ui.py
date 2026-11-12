import pytest

READY = 'body[data-ready="true"]'


@pytest.fixture
def open_ui(server, api):
    """Returns open(seeds=()) -> page, with seeds POSTed to the API before loading."""
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:  # pragma: no cover
        pytest.fail("INFRA: playwright not importable: %r" % (e,))
    pw = sync_playwright().start()
    try:
        try:
            browser = pw.chromium.launch(headless=True)
        except Exception as e:
            pytest.fail("INFRA: chromium could not launch: %r" % (e,))

        def open_page(seeds=()):
            for ref, raw in seeds:
                status, _ = api.post_cell(ref, raw)
                assert status == 200
            page = browser.new_page()
            page.goto(server + "/")
            page.wait_for_selector(READY, state="attached", timeout=10000)
            return page

        yield open_page
        browser.close()
    finally:
        pw.stop()


def selected(page):
    return page.eval_on_selector_all(
        "td.selected", "els => els.map(e => e.dataset.ref)")


def wait(page, js):
    page.wait_for_function(js, timeout=5000)


def name_is(page, ref):
    wait(page, "() => document.querySelector('#cell-name').textContent.trim() === '%s'" % ref)


def text_of(page, ref):
    return page.eval_on_selector('td[data-ref="%s"]' % ref, "e => e.textContent")


def classes(page, ref):
    return page.eval_on_selector('td[data-ref="%s"]' % ref, "e => Array.from(e.classList)")


def bar(page):
    return page.input_value("#formula-bar")


def test_initial_state_of_empty_workbook(open_ui):
    page = open_ui()
    assert page.eval_on_selector_all("td[data-ref]", "els => els.length") == 1300
    assert page.eval_on_selector_all(
        "td[data-ref]", "els => els.filter(e => e.textContent !== '').length") == 0
    assert selected(page) == ["A1"]
    assert page.text_content("#cell-name").strip() == "A1"
    assert bar(page) == ""
    assert page.text_content("#status").strip() == ""


def test_enter_in_bar_commits_number_and_selects_cell_below(open_ui):
    page = open_ui()
    page.fill("#formula-bar", "2")
    page.press("#formula-bar", "Enter")
    wait(page, "() => document.querySelector('td[data-ref=\"A1\"]').textContent === '2.00'")
    assert "num" in classes(page, "A1")
    assert page.eval_on_selector(
        'td[data-ref="A1"]', "e => getComputedStyle(e).textAlign") == "right"
    name_is(page, "A2")
    assert selected(page) == ["A2"]


def test_error_value_gets_error_class_and_loses_it_when_fixed(open_ui):
    page = open_ui()
    page.fill("#formula-bar", "=1/0")
    page.press("#formula-bar", "Enter")
    wait(page, "() => document.querySelector('td[data-ref=\"A1\"]').textContent === '#DIV/0!'")
    cl = classes(page, "A1")
    assert "error" in cl and "num" not in cl
    page.click('td[data-ref="A1"]')
    name_is(page, "A1")
    page.fill("#formula-bar", "7")
    page.press("#formula-bar", "Enter")
    wait(page, "() => document.querySelector('td[data-ref=\"A1\"]').textContent === '7.00'")
    assert "error" not in classes(page, "A1")


def test_click_selects_cell_and_arrows_move_with_top_left_clamping(open_ui):
    page = open_ui(seeds=[("B1", "=A1*2")])
    page.click('td[data-ref="B1"]')
    name_is(page, "B1")
    assert bar(page) == "=A1*2"
    assert selected(page) == ["B1"]
    page.keyboard.press("ArrowUp")
    name_is(page, "B1")
    assert selected(page) == ["B1"]
    page.keyboard.press("ArrowLeft")
    name_is(page, "A1")
    page.keyboard.press("ArrowLeft")
    name_is(page, "A1")
    assert selected(page) == ["A1"]


def test_arrows_move_down_right_and_clamp_at_bottom_right(open_ui):
    page = open_ui()
    page.keyboard.press("ArrowDown")
    name_is(page, "A2")
    page.keyboard.press("ArrowRight")
    name_is(page, "B2")
    page.click('td[data-ref="Z50"]')
    name_is(page, "Z50")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("ArrowRight")
    name_is(page, "Z50")
    assert selected(page) == ["Z50"]


def test_dependent_cell_updates_without_page_reload(open_ui):
    page = open_ui(seeds=[("A1", "1"), ("B1", "=A1*2")])
    wait(page, "() => document.querySelector('td[data-ref=\"B1\"]').textContent === '2.00'")
    page.evaluate("() => { window.__no_reload_marker = 42; }")
    page.fill("#formula-bar", "5")
    page.press("#formula-bar", "Enter")
    wait(page, "() => document.querySelector('td[data-ref=\"B1\"]').textContent === '10.00'")
    assert page.evaluate("() => window.__no_reload_marker") == 42


def test_tab_in_bar_commits_and_selects_cell_to_the_right(open_ui):
    page = open_ui()
    page.fill("#formula-bar", "5")
    page.press("#formula-bar", "Tab")
    wait(page, "() => document.querySelector('td[data-ref=\"A1\"]').textContent === '5.00'")
    name_is(page, "B1")
    assert selected(page) == ["B1"]


def test_escape_in_bar_reverts_to_raw_and_focuses_grid(open_ui):
    page = open_ui(seeds=[("A1", "3")])
    page.click('td[data-ref="A1"]')
    name_is(page, "A1")
    page.fill("#formula-bar", "999")
    page.press("#formula-bar", "Escape")
    wait(page, "() => document.querySelector('#formula-bar').value === '3'")
    assert page.evaluate("() => document.activeElement.id") == "grid"
    assert text_of(page, "A1") == "3.00"


def test_typing_a_character_in_grid_starts_editing_in_bar(open_ui):
    page = open_ui()
    page.focus("#grid")
    page.keyboard.press("x")
    wait(page, "() => document.activeElement.id === 'formula-bar'")
    assert bar(page) == "x"


def test_failed_post_shows_error_in_status_and_keeps_selection_and_bar(open_ui):
    page = open_ui()

    def handler(route):
        if route.request.method == "POST":
            route.fulfill(status=400, content_type="application/json",
                          body='{"error":"bad reference: X"}')
        else:
            route.continue_()

    page.route("**/api/cells", handler)
    page.fill("#formula-bar", "1")
    page.press("#formula-bar", "Enter")
    wait(page, "() => document.querySelector('#status').textContent.trim() === 'bad reference: X'")
    assert selected(page) == ["A1"]
    assert page.text_content("#cell-name").strip() == "A1"
    assert bar(page) == "1"
    assert page.evaluate("() => document.activeElement.id") == "formula-bar"
