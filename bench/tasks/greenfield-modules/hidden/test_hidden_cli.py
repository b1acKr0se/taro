import re
import tempfile
import unittest
from pathlib import Path

from hidden_support import SiteCase, snapshot, write_notes

NOTES = {
    "alpha.md": "---\ntitle: Alpha Note\ndate: 2026-01-10\ntags: [work, ideas]\n---\n# Heading\n\nSee [[beta]] and **bold**.\n",
    "beta.md": "---\ntitle: Beta Note\ndate: 2026-03-02\ntags: [work]\n---\nBeta body links to [[alpha]].\n",
    "gamma.md": "No front matter here, so the title comes from the heading.\n\n# Gamma Heading\n",
}


def hrefs(html: str) -> list[str]:
    return re.findall(r'href="([^"]*)"', html)


class Layout(SiteCase):
    def test_builds_the_site_and_says_how_many(self):
        write_notes(self.src, NOTES)
        result = self.build()
        self.assertEqual((result.returncode, result.stdout.strip()), (0, "built 3 notes"))
        for page in ["index.html", "alpha/index.html", "beta/index.html", "gamma/index.html", "tags/work/index.html", "tags/ideas/index.html"]:
            self.assertTrue((self.out / page).is_file(), page)

    def test_one_note_says_note(self):
        write_notes(self.src, {"only.md": "text"})
        self.assertEqual(self.build().stdout.strip(), "built 1 note")

    def test_home_lists_newest_first_undated_last_with_relative_links(self):
        write_notes(self.src, NOTES)
        self.build()
        home = self.page("index.html")
        self.assertLess(home.index("Beta Note"), home.index("Alpha Note"))
        self.assertLess(home.index("Alpha Note"), home.index("Gamma Heading"))
        self.assertEqual(hrefs(home), ["beta/", "alpha/", "gamma/"])

    def test_note_page_has_title_date_tags_body_and_backlinks(self):
        write_notes(self.src, NOTES)
        self.build()
        page = self.page("alpha/index.html")
        for part in ["<h1>Alpha Note</h1>", "2026-01-10", "<strong>bold</strong>", "Linked from"]:
            self.assertIn(part, page)
        self.assertIn("../beta/", hrefs(page))
        self.assertIn("../tags/work/", hrefs(page))
        self.assertIn("../tags/ideas/", hrefs(page))
        back = page[page.index("Linked from"):]
        self.assertIn('href="../beta/"', back)

    def test_a_note_nobody_links_to_has_no_linked_from_list(self):
        write_notes(self.src, NOTES)
        self.build()
        self.assertNotIn("Linked from", self.page("gamma/index.html"))

    def test_title_falls_back_to_the_heading_then_the_file_name(self):
        write_notes(self.src, NOTES | {"plain-file.md": "just words"})
        self.build()
        self.assertIn("Gamma Heading", self.page("gamma/index.html"))
        self.assertIn("plain-file", self.page("plain-file/index.html"))

    def test_tag_page_lists_its_notes_in_home_order_with_relative_links(self):
        write_notes(self.src, NOTES)
        self.build()
        tag = self.page("tags/work/index.html")
        self.assertEqual(hrefs(tag), ["../../beta/", "../../alpha/"])
        self.assertNotIn("Gamma", tag)

    def test_a_broken_link_is_marked_not_linked(self):
        write_notes(self.src, {"a.md": "see [[nowhere]]"})
        self.build()
        page = self.page("a/index.html")
        self.assertIn('class="broken-link"', page)
        self.assertNotIn("../nowhere/", page)

    def test_template_file_is_used(self):
        write_notes(self.src, NOTES)
        template = Path(self._scratch.name) / "t.html"
        template.write_text("<main data-x='1'><h1 class='site'>{{title}}</h1>{{content}}</main>", encoding="utf-8")
        self.assertEqual(self.build("--template", str(template)).returncode, 0)
        self.assertTrue(self.page("alpha/index.html").startswith("<main data-x='1'>"))
        self.assertIn("Alpha Note", self.page("alpha/index.html"))


class Messages(SiteCase):
    def test_no_notes_found(self):
        self.src.mkdir()
        (self.src / "readme.txt").write_text("not a note")
        result = self.build()
        self.assertEqual((result.returncode, result.stdout.strip()), (0, "no notes found"))
        self.assertFalse(self.out.exists())

    def test_notes_path_is_not_a_folder(self):
        result = self.build(src=Path(self._scratch.name) / "missing")
        self.assertEqual(result.returncode, 2)
        self.assertIn("is not a folder", result.stderr)
        self.assertFalse(self.out.exists())

    def test_subfolders_are_not_read(self):
        write_notes(self.src, {"top.md": "x"})
        write_notes(self.src / "sub", {"deep.md": "y"})
        self.assertEqual(self.build().stdout.strip(), "built 1 note")
        self.assertFalse((self.out / "deep").exists())

    def test_a_bad_note_after_good_ones_is_skipped_and_the_rest_built(self):
        write_notes(self.src, {"a.md": "fine", "b.md": "fine too", "z-bad.md": "---\ntitle: never closed\n"})
        result = self.build()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout.strip(), "built 2 notes")
        self.assertTrue(re.search(r"^skipped z-bad\.md: .+", result.stderr, re.M), result.stderr)
        self.assertTrue((self.out / "a" / "index.html").is_file())
        self.assertFalse((self.out / "z-bad").exists())

    def test_a_bad_date_is_skipped_too(self):
        write_notes(self.src, {"ok.md": "x", "bad.md": "---\ndate: 2026-02-30\n---\ny"})
        result = self.build()
        self.assertEqual(result.returncode, 1)
        self.assertIn("skipped bad.md", result.stderr)

    def test_a_very_long_note_and_title(self):
        write_notes(self.src, {"big.md": f"---\ntitle: {'T' * 5000}\n---\n" + "paragraph text\n\n" * 20_000})
        self.assertEqual(self.build().returncode, 0)
        self.assertIn("T" * 5000, self.page("big/index.html"))


class Slugs(SiteCase):
    """P1."""

    def test_p1_slugs_from_file_names(self):
        write_notes(self.src, {"Buy Milk!.md": "x", "  --Weird__Name--  .md": "y", "UPPER.md": "z"})
        self.build()
        for page in ["buy-milk/index.html", "weird-name/index.html", "upper/index.html"]:
            self.assertTrue((self.out / page).is_file(), self.files())

    def test_p1_an_empty_slug_is_note_and_collisions_count_up_in_file_name_order(self):
        write_notes(self.src, {"!!!.md": "a", "Same Name.md": "b", "same-name.md": "c", "same_name.md": "d"})
        self.build()
        self.assertTrue((self.out / "note" / "index.html").is_file())
        # file-name order: "Same Name.md" < "same-name.md" < "same_name.md"
        self.assertIn(">b<", self.page("same-name/index.html").replace("<p>", ">").replace("</p>", "<"))
        self.assertIn(">c<", self.page("same-name-2/index.html").replace("<p>", ">").replace("</p>", "<"))
        self.assertIn(">d<", self.page("same-name-3/index.html").replace("<p>", ">").replace("</p>", "<"))

    def test_p1_links_and_tags_use_the_same_rule(self):
        write_notes(self.src, {
            "buy-milk.md": "---\ntitle: Buy Milk Today\ntags: [Home Life, !!!]\n---\nbody",
            "other.md": "see [[Buy Milk]] and [[ BUY--MILK ]]",
        })
        self.build()
        page = self.page("other/index.html")
        self.assertEqual(hrefs(page).count("../buy-milk/"), 2)
        self.assertIn("Buy Milk Today", page)
        self.assertTrue((self.out / "tags" / "home-life" / "index.html").is_file())
        self.assertEqual([name for name in self.files() if name.startswith("tags/")], ["tags/home-life/index.html"])
        self.assertIn("../tags/home-life/", hrefs(self.page("buy-milk/index.html")))


class Safety(SiteCase):
    """P2."""

    def test_p2_raw_html_in_body_title_and_tags_is_text(self):
        write_notes(self.src, {"x.md": "---\ntitle: <u>Hi</u> & bye\ntags: [<b>tag</b>]\n---\n<script>alert(1)</script>\n"})
        self.build()
        for page in ["index.html", "x/index.html"] + [name for name in self.files() if name.startswith("tags/")]:
            html = self.page(page)
            self.assertNotIn("<script>", html, page)
            self.assertNotIn("<u>", html, page)
            self.assertNotIn("<b>tag", html, page)
        self.assertIn("&lt;script&gt;", self.page("x/index.html"))
        self.assertIn("&amp; bye", self.page("index.html"))

    def test_p2_unsafe_addresses_are_not_links(self):
        write_notes(self.src, {"x.md": "[bad](javascript:alert(1)) [ok](https://example.com/) [rel](../y/)"})
        self.build()
        addresses = hrefs(self.page("x/index.html"))
        self.assertNotIn("javascript:alert(1)", addresses)
        self.assertIn("https://example.com/", addresses)
        self.assertIn("../y/", addresses)
        self.assertIn("bad", self.page("x/index.html"))


class Rebuild(SiteCase):
    """P3, and rebuilding in general."""

    def test_p3_a_rebuild_is_byte_identical(self):
        write_notes(self.src, NOTES)
        self.build()
        first = snapshot(self.out)
        self.build()
        self.assertEqual(snapshot(self.out), first)

    def test_p3_a_removed_note_and_its_folders_are_deleted_on_rebuild(self):
        write_notes(self.src, NOTES)
        self.build()
        (self.src / "alpha.md").unlink()
        self.build()
        self.assertFalse((self.out / "alpha").exists())
        self.assertFalse((self.out / "tags" / "ideas").exists())
        self.assertTrue((self.out / "beta" / "index.html").is_file())
        self.assertNotIn("Alpha Note", self.page("index.html"))

    def test_p3_files_the_build_did_not_write_are_never_touched(self):
        write_notes(self.src, NOTES)
        self.out.mkdir()
        (self.out / "mine.txt").write_text("keep me")
        (self.out / "alpha").mkdir()
        (self.out / "alpha" / "extra.css").write_text("body{}")
        self.build()
        (self.src / "alpha.md").unlink()
        self.build()
        self.assertEqual((self.out / "mine.txt").read_text(), "keep me")
        self.assertEqual((self.out / "alpha" / "extra.css").read_text(), "body{}")
        self.assertFalse((self.out / "alpha" / "index.html").exists())

    def test_p3_the_manifest_names_what_was_written(self):
        write_notes(self.src, {"a.md": "x"})
        self.build()
        manifest = (self.out / ".notesite-manifest.json").read_text()
        for name in ["index.html", "a/index.html"]:
            self.assertIn(name, manifest)

    def test_p3_a_rebuild_after_an_error_still_cleans_up(self):
        write_notes(self.src, {"a.md": "x", "b.md": "y"})
        self.build()
        write_notes(self.src, {"b.md": "---\nunclosed\n"})
        result = self.build()
        self.assertEqual(result.returncode, 1)
        self.assertTrue((self.out / "a" / "index.html").is_file())
        self.assertFalse((self.out / "b").exists())

    def test_an_edit_shows_up_and_a_new_note_is_added(self):
        write_notes(self.src, {"a.md": "first version"})
        self.build()
        write_notes(self.src, {"a.md": "second version", "b.md": "new"})
        self.build()
        self.assertIn("second version", self.page("a/index.html"))
        self.assertIn("b/", hrefs(self.page("index.html")))


if __name__ == "__main__":
    unittest.main()
