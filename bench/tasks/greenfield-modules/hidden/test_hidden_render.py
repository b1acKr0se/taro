import unittest

from hidden_support import lazy

render = lazy("notesite.render")


class Template(unittest.TestCase):
    def test_replaces_title_escaped_and_content_raw_everywhere(self):
        out = render.apply_template("<title>{{title}}</title><h1>{{title}}</h1>{{content}}|{{content}}", "A & <B>", "<p>x</p>")
        self.assertEqual(out, "<title>A &amp; &lt;B&gt;</title><h1>A &amp; &lt;B&gt;</h1><p>x</p>|<p>x</p>")

    def test_what_is_inserted_is_not_searched_again(self):
        out = render.apply_template("{{content}}", "T", "literal {{title}} and {{content}}")
        self.assertEqual(out, "literal {{title}} and {{content}}")
        self.assertEqual(render.apply_template("{{title}}", "{{content}}", "C"), "{{content}}")

    def test_other_placeholders_stay(self):
        self.assertEqual(render.apply_template("{{other}} {{ title }} {{content}}", "T", "C"), "{{other}} {{ title }} C")

    def test_a_default_template_has_both(self):
        self.assertIn("{{title}}", render.DEFAULT_TEMPLATE)
        self.assertIn("{{content}}", render.DEFAULT_TEMPLATE)


class Fragments(unittest.TestCase):
    def test_note_shows_title_date_tags_body_and_backlinks(self):
        html = render.render_note("My Note", "2026-01-05", "<p>body</p>", [("../tags/home/", "home")], [("../other/", "Other")])
        for part in ["<h1>My Note</h1>", "2026-01-05", '<a href="../tags/home/">home</a>', "<p>body</p>", "Linked from", '<a href="../other/">Other</a>']:
            self.assertIn(part, html)

    def test_note_without_date_tags_or_backlinks_leaves_them_out(self):
        html = render.render_note("Plain", None, "<p>b</p>", [], [])
        self.assertNotIn("Linked from", html)
        self.assertNotIn("None", html)
        self.assertNotIn("Tags", html)

    def test_note_title_and_labels_are_escaped(self):
        html = render.render_note("<i>T</i>", None, "", [("../tags/x/", "<b>")], [("../o/", "a & b")])
        self.assertNotIn("<i>T</i>", html)
        self.assertNotIn("<b>", html)
        self.assertIn("a &amp; b", html)

    def test_list_has_heading_and_entries_in_order(self):
        html = render.render_list("Notes", [("a/", "Alpha", "2026-01-02"), ("b/", "Beta", None)])
        self.assertIn("<h1>Notes</h1>", html)
        self.assertLess(html.index("Alpha"), html.index("Beta"))
        self.assertIn('<a href="a/">Alpha</a>', html)
        self.assertIn("2026-01-02", html)
        self.assertNotIn("None", html)

    def test_empty_list(self):
        self.assertIn("<h1>Notes</h1>", render.render_list("Notes", []))


if __name__ == "__main__":
    unittest.main()
