import unittest

from hidden_support import lazy

frontmatter = lazy("notesite.frontmatter")


class FrontMatter(unittest.TestCase):
    def test_reads_title_date_tags_and_body(self):
        meta, body = frontmatter.parse("---\ntitle: Hello World\ndate: 2026-01-05\ntags: [home, errands]\n---\nBody text\n")
        self.assertEqual(meta, {"title": "Hello World", "date": "2026-01-05", "tags": ["home", "errands"]})
        self.assertEqual(body.strip(), "Body text")

    def test_no_front_matter_is_all_body(self):
        self.assertEqual(frontmatter.parse("# Just a heading\n\ntext"), ({}, "# Just a heading\n\ntext"))

    def test_empty_text(self):
        meta, body = frontmatter.parse("")
        self.assertEqual((meta, body.strip()), ({}, ""))

    def test_empty_and_missing_tags(self):
        self.assertEqual(frontmatter.parse("---\ntags: []\n---\nx")[0].get("tags", []), [])
        self.assertEqual(frontmatter.parse("---\ntags:\n---\nx")[0].get("tags", []), [])
        self.assertEqual(frontmatter.parse("---\ntitle: T\n---\nx")[0].get("tags", []), [])

    def test_unknown_keys_are_ignored(self):
        meta, _ = frontmatter.parse("---\ntitle: T\nmood: happy\n---\nx")
        self.assertEqual(meta.get("title"), "T")
        self.assertNotIn("mood", meta)

    def test_value_may_contain_a_colon(self):
        self.assertEqual(frontmatter.parse("---\ntitle: Re: the plan\n---\nx")[0]["title"], "Re: the plan")

    def test_unclosed_front_matter_is_a_value_error(self):
        with self.assertRaises(ValueError):
            frontmatter.parse("---\ntitle: T\nbody never starts")

    def test_a_line_that_is_not_key_value_is_a_value_error(self):
        with self.assertRaises(ValueError):
            frontmatter.parse("---\njust some words\n---\nx")

    def test_bad_dates_are_value_errors(self):
        for date in ["2026-13-01", "2026-02-30", "yesterday", "2026-1-5", ""]:
            with self.assertRaises(ValueError, msg=date):
                frontmatter.parse(f"---\ndate: {date}\n---\nx")

    def test_a_dash_line_inside_the_body_does_not_end_it_early(self):
        meta, body = frontmatter.parse("---\ntitle: T\n---\nabove\n\n---\n\nbelow")
        self.assertEqual(meta["title"], "T")
        self.assertIn("below", body)
        self.assertIn("---", body)

    def test_a_very_long_body(self):
        text = "---\ntitle: Long\n---\n" + "line\n" * 100_000
        self.assertEqual(len(frontmatter.parse(text)[1].splitlines()), 100_000)


if __name__ == "__main__":
    unittest.main()
