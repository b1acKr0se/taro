import unittest

from hidden_support import lazy

_markdown = lazy("notesite.markdown")


def to_html(*args, **kwargs):
    return _markdown.to_html(*args, **kwargs)


class Blocks(unittest.TestCase):
    def test_headings(self):
        html = to_html("# One\n\n## Two\n\n### Three")
        for level, text in [(1, "One"), (2, "Two"), (3, "Three")]:
            self.assertIn(f"<h{level}>{text}</h{level}>", html)

    def test_four_hashes_is_not_a_heading(self):
        self.assertNotIn("<h4>", to_html("#### deep"))
        self.assertNotIn("<h1>", to_html("#no space"))

    def test_paragraph_lines_are_joined(self):
        html = to_html("first line\nsecond line\n\nnext")
        self.assertIn("<p>first line second line</p>", html)
        self.assertIn("<p>next</p>", html)

    def test_list(self):
        html = to_html("- one\n- two\n- three")
        self.assertEqual(html.count("<li>"), 3)
        self.assertEqual(html.count("<ul>"), 1)
        self.assertIn("<li>two</li>", html)

    def test_fenced_code_is_not_interpreted(self):
        html = to_html("```\n# not a heading\n**not bold** <b>\n```")
        self.assertIn("<pre><code>", html)
        self.assertNotIn("<h1>", html)
        self.assertNotIn("<strong>", html)
        self.assertIn("&lt;b&gt;", html)

    def test_empty_input(self):
        self.assertEqual(to_html("").strip(), "")
        self.assertEqual(to_html("\n\n  \n").strip(), "")


class Inline(unittest.TestCase):
    def test_marks(self):
        html = to_html("a **bold** and *em* and `code` and [site](https://example.com/x)")
        for part in ["<strong>bold</strong>", "<em>em</em>", "<code>code</code>", '<a href="https://example.com/x">site</a>']:
            self.assertIn(part, html)

    def test_code_span_is_literal(self):
        html = to_html("use `*x*` here")
        self.assertIn("<code>*x*</code>", html)
        self.assertNotIn("<em>", html)

    def test_unmatched_marks_stay_text(self):
        html = to_html("price is 5 * 3\n\n**never closed")
        self.assertIn("5 * 3", html)
        self.assertIn("**never closed", html)
        self.assertNotIn("<em>", html)
        self.assertNotIn("<strong>", html)

    def test_a_very_long_paragraph(self):
        html = to_html("word " * 200_000)
        self.assertTrue(html.startswith("<p>") and html.endswith("</p>"))


class WikiLinks(unittest.TestCase):
    def test_without_resolve_the_link_stays_text(self):
        self.assertIn("[[other]]", to_html("see [[other]]"))

    def test_resolved_link(self):
        html = to_html("see [[other]] now", resolve=lambda target: (f"../{target}/", "Other Note"))
        self.assertIn('<a href="../other/">Other Note</a>', html)

    def test_unknown_target_is_a_broken_link_span(self):
        html = to_html("see [[nope]]", resolve=lambda target: None)
        self.assertIn('<span class="broken-link">nope</span>', html)
        self.assertNotIn("<a ", html)

    def test_links_in_code_are_not_resolved(self):
        calls = []
        to_html("`[[a]]`\n\n```\n[[b]]\n```", resolve=lambda target: calls.append(target))
        self.assertEqual(calls, [])


class Safety(unittest.TestCase):
    """P2: output is safe."""

    def test_p2_raw_html_is_escaped(self):
        html = to_html('<script>alert("x")</script>\n\nhi <b>there</b> & more')
        self.assertNotIn("<script>", html)
        self.assertNotIn("<b>", html)
        self.assertIn("&lt;script&gt;", html)
        self.assertIn("&amp; more", html)

    def test_p2_unsafe_link_schemes_are_not_links(self):
        for url in ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,x", "vbscript:x"]:
            html = to_html(f"[click me]({url})")
            self.assertNotIn("<a ", html, url)
            self.assertIn("click me", html, url)

    def test_p2_safe_and_relative_links_stay_links(self):
        for url in ["http://a.example/", "https://a.example/", "mailto:me@example.com", "../other/", "page.html", "#top"]:
            self.assertIn(f'href="{url}"', to_html(f"[t]({url})"), url)

    def test_p2_a_quote_in_an_address_cannot_break_out(self):
        html = to_html('[t](https://a.example/"onmouseover="x)')
        self.assertNotIn('"onmouseover="', html)


if __name__ == "__main__":
    unittest.main()
