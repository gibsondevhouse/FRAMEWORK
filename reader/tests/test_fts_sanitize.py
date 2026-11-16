"""Test FTS5 query sanitizer and query string construction."""
import unittest

from app.store import fts_query
from tests.base import HermeticTestCase


class TestFtsSanitize(HermeticTestCase):
    def test_basic_token(self):
        q = "respirator"
        out = fts_query(q)
        self.assertEqual(out, '"respirator"*')

    def test_phrase_query(self):
        q = '"confined space"'
        out = fts_query(q)
        self.assertEqual(out, '"confined space"')

    def test_section_number_with_dot(self):
        q = "1910.120"
        out = fts_query(q)
        self.assertEqual(out, '"1910.120"*')

    def test_section_symbol_and_punctuation(self):
        q = "§ 1910.120(a)(1)"
        out = fts_query(q)
        self.assertIn('"1910.120"', out)
        self.assertIn('"a"', out)
        self.assertIn('"1"', out)

    def test_quotes_sanitization(self):
        q = 'unbalanced "quotes and special * chars'
        out = fts_query(q)
        # Should not raise exception and should produce safe quoted tokens
        self.assertTrue(len(out) > 0)
        self.assertNotIn('***', out)


if __name__ == "__main__":
    unittest.main()

