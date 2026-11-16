def R(md):
    from sitegen.markdown import render
    return render(md)


def test_heading():
    assert R("# Hello") == "<h1>Hello</h1>"


def test_emphasis_and_strong():
    assert R("Hello *world* and **bold**") == "<p>Hello <em>world</em> and <strong>bold</strong></p>"


def test_html_escaping_of_quotes_and_symbols():
    assert R("a < b & \"c\" 'd'") == "<p>a &lt; b &amp; &quot;c&quot; &#x27;d&#x27;</p>"


def test_raw_html_is_escaped():
    assert R("<script>alert(1)</script>") == "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>"


def test_paragraphs_soft_breaks_and_no_trailing_newline():
    assert R("para one\nstill one\n\n\npara two\n") == "<p>para one\nstill one</p>\n<p>para two</p>"


def test_unordered_and_ordered_lists():
    assert R("- a\n- b\n\n1. x\n2. y") == (
        "<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n<ol>\n<li>x</li>\n<li>y</li>\n</ol>"
    )


def test_fenced_code_with_language():
    md = "```python\nprint('<hi>')\n```"
    assert R(md) == '<pre><code class="language-python">print(&#x27;&lt;hi&gt;&#x27;)</code></pre>'








def test_blockquote_renders_recursively():
    assert R("> quote *x*\n> more") == "<blockquote>\n<p>quote <em>x</em>\nmore</p>\n</blockquote>"


def test_link_url_is_not_emphasis_processed_and_is_escaped():
    assert R("[a](http://x.com/a_b_c?q=1&r=2)") == '<p><a href="http://x.com/a_b_c?q=1&amp;r=2">a</a></p>'


def test_image():
    assert R("![alt](/i.png)") == '<p><img src="/i.png" alt="alt"></p>'


def test_strong_emphasis_triple_star():
    assert R("***bold italic***") == "<p><strong><em>bold italic</em></strong></p>"


def test_nested_emphasis():
    assert R("**bold with *nested em* inside** and *em with **strong** inside*") == (
        "<p><strong>bold with <em>nested em</em> inside</strong> and "
        "<em>em with <strong>strong</strong> inside</em></p>"
    )


def test_code_span_and_non_emphasis_stars_and_underscores():
    assert R("use `a<b` and snake_case_name, 2 * 3 * 4") == (
        "<p>use <code>a&lt;b</code> and snake_case_name, 2 * 3 * 4</p>"
    )




def test_empty_and_whitespace_only_input():
    assert R("") == ""
    assert R("\n\n  \n") == ""


def test_blank_line_starts_new_list():
    assert R("- a\n\n- b") == "<ul>\n<li>a</li>\n</ul>\n<ul>\n<li>b</li>\n</ul>"


def test_hr_after_text_ends_paragraph_no_setext():
    assert R("## Title\ntext\n---\nmore") == "<h2>Title</h2>\n<p>text</p>\n<hr>\n<p>more</p>"
















