"""Test iterparse streaming parser on CFR XML fixture."""
import io
import sqlite3
import unittest
import xml.etree.ElementTree as ET

from app.build import front_matter_xml, stream_parse_xml

SAMPLE_CFR_XML = """<DIV1 N="29">
  <DIV5 N="1910">
    <HEAD>PART 1910 - OCCUPATIONAL SAFETY AND HEALTH STANDARDS</HEAD>
    <AUTH><HED>Authority:</HED><PSPACE>29 U.S.C. 653, 655, 657.</PSPACE></AUTH>
    <DIV6 N="A">
      <HEAD>Subpart A - General</HEAD>
      <SOURCE><HED>Source:</HED><PSPACE>39 FR 23502, June 27, 1974.</PSPACE></SOURCE>
      <DIV8 N="1910.1">
        <HEAD>§ 1910.1 Purpose and scope.</HEAD>
        <P>(a) Section 6(a) of the Williams-Steiger Occupational Safety and Health Act...</P>
      </DIV8>
      <DIV8 N="1910.2">
        <HEAD>§ 1910.2 Definitions.</HEAD>
        <P>As used in this part...</P>
      </DIV8>
      <DIV9 N="Appendix A to § 1910.2">
        <HEAD>Appendix A to § 1910.2 - Reference Guide</HEAD>
        <P>This appendix provides non-mandatory guidance.</P>
      </DIV9>
    </DIV6>
  </DIV5>
</DIV1>"""


class TestIterparse(unittest.TestCase):
    def test_fixture_parse(self):
        con = sqlite3.connect(":memory:")
        import tempfile
        from pathlib import Path

        with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".xml", delete=False) as f:
            f.write(SAMPLE_CFR_XML)
            tmp_path = Path(f.name)

        try:
            front = stream_parse_xml(tmp_path, con)
            rows = con.execute("SELECT kind, id FROM staging_leaves ORDER BY id").fetchall()

            self.assertEqual(len(rows), 3)
            self.assertEqual(rows[0], ("section", "1910.1"))
            self.assertEqual(rows[1], ("section", "1910.2"))
            self.assertEqual(rows[2], ("appendix", "Appendix A to § 1910.2"))

            # Front matter tests
            self.assertIn("part/1910", front)
            self.assertIn("29 U.S.C. 653", front["part/1910"])
            self.assertIn("part/1910/subpart/A", front)
            self.assertIn("39 FR 23502", front["part/1910/subpart/A"])
        finally:
            tmp_path.unlink(missing_ok=True)
            con.close()


if __name__ == "__main__":
    unittest.main()
