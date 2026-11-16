"""eCFR sometimes lists a subpart as an empty heading with its sections after it."""
import unittest

from app.build import leaf_paths, nest_loose_sections
from tests.base import HermeticTestCase


def node(t, id, c=None, **kw):
    n = {"t": t, "id": id, "l": id, "d": ""}
    if c:
        n["c"] = c
    n.update(kw)
    return n


class NestingTests(HermeticTestCase):
    def tree(self):
        return node("title", "29", [node("part", "1910", [
            node("subpart", "U", [node("section", "1910.501")]),
            node("section", "1910.901-1910.999", r=1),
            node("subpart", "Z"),                      # empty heading…
            node("section", "1910.1000"),               # …its sections follow as siblings
            node("section", "1910.1200"),
            node("appendix", "Appendix A to Subpart Z of Part 1910"),
            node("subpart", "R", r=1),                  # a reserved empty subpart adopts nothing
            node("section", "1910.2000"),
            node("appendix", "Appendix A to Part 1910"),
        ])])

    def test_loose_sections_move_into_empty_subpart(self):
        part = nest_loose_sections(self.tree())["c"][0]
        kinds = [(c["t"], c["id"]) for c in part["c"]]
        self.assertEqual(kinds, [("subpart", "U"), ("section", "1910.901-1910.999"), ("subpart", "Z"),
                                 ("subpart", "R"), ("section", "1910.2000"), ("appendix", "Appendix A to Part 1910")])
        z = part["c"][2]
        self.assertEqual([c["id"] for c in z["c"]], ["1910.1000", "1910.1200", "Appendix A to Subpart Z of Part 1910"])

    def test_breadcrumbs_include_the_subpart(self):
        paths = dict((i, p) for p, i in leaf_paths(nest_loose_sections(self.tree())))
        self.assertIn('"id": "Z"', paths["1910.1200"])
        self.assertNotIn('"id": "Z"', paths["1910.2000"])

    def test_already_nested_tree_is_unchanged(self):
        t = nest_loose_sections(self.tree())
        before = repr(t)
        self.assertEqual(repr(nest_loose_sections(t)), before)


if __name__ == "__main__":
    unittest.main()
