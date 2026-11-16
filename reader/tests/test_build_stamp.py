"""The committed reader/static/dist/ bundle must match reader/frontend/ sources.

`vite build` writes dist/build-stamp.json: an LF-normalized SHA-256 over the
sorted (POSIX-path) files of frontend/src/ plus frontend/index.html. This test
recomputes the same hash in pure Python, so a source edit without a rebuild
(or a rebuild that was never committed) fails CI on every platform, while
Python-only users never need Node at runtime.
"""
from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path

from tests.base import HermeticTestCase

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
DIST = Path(__file__).resolve().parent.parent / "static" / "dist"


def source_stamp() -> dict:
    files = sorted(
        [p.relative_to(FRONTEND).as_posix() for p in (FRONTEND / "src").rglob("*") if p.is_file()]
        + ["index.html"]
    )
    h = hashlib.sha256()
    for f in files:
        h.update((f + "\n").encode("utf-8"))
        h.update((FRONTEND / f).read_text(encoding="utf-8").replace("\r\n", "\n").encode("utf-8"))
        h.update(b"\n")
    return {"sha256": h.hexdigest(), "files": files}


class BuildStampTests(HermeticTestCase):
    def test_dist_matches_frontend_sources(self):
        stamp_file = DIST / "build-stamp.json"
        self.assertTrue(stamp_file.exists(),
                        "reader/static/dist/build-stamp.json missing; run `npm run build` in reader/frontend")
        committed = json.loads(stamp_file.read_text(encoding="utf-8"))
        current = source_stamp()
        self.assertEqual(committed["files"], current["files"],
                         "frontend source file list changed; run `npm run build` in reader/frontend and commit dist/")
        self.assertEqual(committed["sha256"], current["sha256"],
                         "frontend sources changed since the committed dist/ was built; "
                         "run `npm run build` in reader/frontend and commit dist/")

    def test_dist_serves_fixed_names(self):
        for name in ("index.html", "app.js", "app.css"):
            self.assertTrue((DIST / name).exists(), f"dist/{name} missing")
        html = (DIST / "index.html").read_text(encoding="utf-8")
        self.assertIn('src="/static/dist/app.js"', html)
        self.assertIn('href="/static/dist/app.css"', html)


if __name__ == "__main__":
    unittest.main()
