import unittest

from hidden_support import lazy

index = lazy("notesite.index")


def note(slug, title=None, date=None, tags=(), body=""):
    return {"slug": slug, "title": title or slug, "date": date, "tags": list(tags), "body": body}


class Home(unittest.TestCase):
    def test_newest_first_undated_last_ties_by_title(self):
        notes = [note("old", date="2025-01-01"), note("undated-b", "Beta"), note("new", date="2026-03-01"), note("tie-z", "Zed", "2026-01-01"), note("tie-a", "alpha", "2026-01-01"), note("undated-a", "Alpha")]
        self.assertEqual(index.build(notes)["home"], ["new", "tie-a", "tie-z", "old", "undated-a", "undated-b"])

    def test_empty(self):
        self.assertEqual(index.build([]), {"home": [], "tags": {}, "backlinks": {}, "broken": {}})


class Tags(unittest.TestCase):
    def test_tags_map_to_slugs_in_home_order(self):
        notes = [note("a", date="2025-01-01", tags=["x", "y"]), note("b", date="2026-01-01", tags=["x"]), note("c", tags=["y"])]
        self.assertEqual(index.build(notes)["tags"], {"x": ["b", "a"], "y": ["a", "c"]})

    def test_a_repeated_tag_on_one_note_counts_once(self):
        self.assertEqual(index.build([note("a", tags=["x", "x"])])["tags"], {"x": ["a"]})


class Links(unittest.TestCase):
    def test_backlinks_are_sorted_without_self_links_or_duplicates(self):
        notes = [note("a", body="[[c]] and [[c]] and [[a]]"), note("b", body="see [[c]]"), note("c", body="nothing")]
        shape = index.build(notes)
        self.assertEqual(shape["backlinks"]["c"], ["a", "b"])
        self.assertEqual(shape["backlinks"].get("a", []), [])

    def test_unknown_targets_are_broken(self):
        shape = index.build([note("a", body="[[b]] [[missing]] [[missing]]"), note("b")])
        self.assertEqual(shape["broken"]["a"], ["missing"])
        self.assertEqual(shape["broken"].get("b", []), [])

    def test_links_inside_code_do_not_count(self):
        shape = index.build([note("a", body="`[[b]]`\n\n```\n[[b]]\n```"), note("b")])
        self.assertEqual(shape["backlinks"].get("b", []), [])

    def test_a_very_large_site(self):
        notes = [note(f"n{number}", date=f"2026-01-{number % 28 + 1:02d}", tags=[f"t{number % 7}"], body=f"[[n{(number + 1) % 3000}]]") for number in range(3000)]
        shape = index.build(notes)
        self.assertEqual(len(shape["home"]), 3000)
        self.assertEqual(len(shape["backlinks"]["n5"]), 1)


if __name__ == "__main__":
    unittest.main()
