import subprocess
import sys

import pytest

playwright_sync = pytest.importorskip("playwright.sync_api")


@pytest.fixture(scope="module")
def base():
    p = subprocess.Popen([sys.executable, "-m", "minisheet", "serve", "--port", "0"],
                         stdout=subprocess.PIPE, text=True)
    line = p.stdout.readline().strip()
    assert line.startswith("Serving on http://127.0.0.1:")
    yield line[len("Serving on "):]
    p.kill()
    p.wait()


@pytest.fixture
def page(base):
    import urllib.request
    # reset workbook
    urllib.request.urlopen(urllib.request.Request(base + "/api/csv", data=b"", method="POST")).read()
    with playwright_sync.sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page()
        pg.goto(base + "/")
        pg.wait_for_selector("body[data-ready=true]")
        yield pg
        b.close()


def sel_name(pg):
    return pg.inner_text("#cell-name")


def test_initial(page):
    assert page.locator("td[data-ref]").count() == 1300
    assert page.locator("[data-ref]").count() == 1300
    assert page.locator("td.selected").count() == 1
    assert page.locator("td[data-ref=A1].selected").count() == 1
    assert sel_name(page) == "A1"
    assert page.input_value("#formula-bar") == ""
    assert page.inner_text("#status") == ""
    assert page.evaluate("document.activeElement.id") == "grid"
    assert page.locator("#grid tbody tr").count() == 50
    heads = page.locator("#grid thead th").all_inner_texts()
    assert heads[0] == "" and heads[1] == "A" and heads[-1] == "Z" and len(heads) == 27
    assert page.locator("#grid tbody tr").first.locator("th").inner_text() == "1"


def test_enter_commit(page):
    page.fill("#formula-bar", "2")
    page.press("#formula-bar", "Enter")
    page.wait_for_selector("td[data-ref=A2].selected")
    a1 = page.locator("td[data-ref=A1]")
    assert a1.inner_text() == "2.00"
    assert "num" in a1.get_attribute("class")
    assert a1.evaluate("e => getComputedStyle(e).textAlign") == "right"
    assert sel_name(page) == "A2"
    assert page.evaluate("document.activeElement.id") == "grid"


def test_error_class(page):
    page.fill("#formula-bar", "=1/0")
    page.press("#formula-bar", "Enter")
    page.wait_for_selector("td[data-ref=A2].selected")
    a1 = page.locator("td[data-ref=A1]")
    assert a1.inner_text() == "#DIV/0!"
    cls = a1.get_attribute("class")
    assert "error" in cls and "num" not in cls
    page.click("td[data-ref=A1]")
    assert page.input_value("#formula-bar") == "=1/0"
    page.fill("#formula-bar", "7")
    page.press("#formula-bar", "Enter")
    page.wait_for_selector("td[data-ref=A2].selected")
    assert a1.inner_text() == "7.00"
    assert "error" not in a1.get_attribute("class")
    assert a1.evaluate("e => getComputedStyle(e).textAlign") == "right"


def test_navigation(page):
    page.fill("#formula-bar", "3")
    page.press("#formula-bar", "Enter")
    page.wait_for_selector("td[data-ref=A2].selected")
    page.click("td[data-ref=A1]")
    page.press("#formula-bar", "Tab")
    page.wait_for_selector("td[data-ref=B1].selected")
    page.fill("#formula-bar", "=A1*2")
    page.press("#formula-bar", "Enter")
    page.wait_for_selector("td[data-ref=B2].selected")
    assert page.inner_text("td[data-ref=B1]") == "6.00"
    page.click("td[data-ref=B1]")
    assert sel_name(page) == "B1" and page.input_value("#formula-bar") == "=A1*2"
    page.keyboard.press("ArrowUp")
    assert sel_name(page) == "B1"
    page.keyboard.press("ArrowLeft")
    assert sel_name(page) == "A1"
    page.keyboard.press("ArrowLeft")
    assert sel_name(page) == "A1"
    page.keyboard.press("ArrowDown")
    assert sel_name(page) == "A2"


def test_typing_and_escape(page):
    page.keyboard.press("x")
    assert page.input_value("#formula-bar") == "x"
    assert page.evaluate("document.activeElement.id") == "formula-bar"
    page.keyboard.press("y")
    assert page.input_value("#formula-bar") == "xy"
    page.keyboard.press("Escape")
    assert page.input_value("#formula-bar") == ""
    assert page.evaluate("document.activeElement.id") == "grid"
    page.dblclick("td[data-ref=C3]")
    assert sel_name(page) == "C3"
    assert page.evaluate("document.activeElement.id") == "formula-bar"
    page.keyboard.press("ArrowLeft")
    assert sel_name(page) == "C3"


def test_error_status(page):
    page.evaluate("""() => { window.fetch = () => Promise.resolve(new Response(
        JSON.stringify({error: 'bad reference: X'}), {status: 400})); }""")
    page.fill("#formula-bar", "1")
    page.press("#formula-bar", "Enter")
    page.wait_for_function("document.getElementById('status').textContent !== ''")
    assert page.inner_text("#status") == "bad reference: X"
    assert sel_name(page) == "A1"
    assert page.input_value("#formula-bar") == "1"
    assert page.evaluate("document.activeElement.id") == "formula-bar"
    page.evaluate("() => { window.fetch = () => Promise.resolve(new Response('x', {status: 500})); }")
    page.press("#formula-bar", "Enter")
    page.wait_for_function("document.getElementById('status').textContent === 'HTTP 500'")


def test_tab_commit_and_bounds(page):
    page.fill("#formula-bar", "5")
    page.press("#formula-bar", "Tab")
    page.wait_for_selector("td[data-ref=B1].selected")
    assert page.inner_text("td[data-ref=A1]") == "5.00"
    page.click("td[data-ref=Z50]")
    page.fill("#formula-bar", "hi")
    page.press("#formula-bar", "Enter")
    page.wait_for_function("document.getElementById('status').textContent === '' && document.querySelector('td[data-ref=Z50]').textContent === 'hi'")
    assert sel_name(page) == "Z50"
    assert page.locator("td[data-ref=Z50]").evaluate("e => getComputedStyle(e).textAlign") == "left"
    page.click("td[data-ref=A1]")
    page.reload()
    page.wait_for_selector("body[data-ready=true]")
    assert page.inner_text("td[data-ref=A1]") == "5.00"
