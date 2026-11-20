""""Cited by" for a U.S. Code section: what in the local library points at it.

Three groups, all from data already on disk (no network):

- `usc`: sections of installed U.S. Code titles whose USLM text links to it
  (`<ref href="/us/usc/t{T}/s{S}…">`), found with a LIKE scan over `sections.xml`;
- `cfr`: sections of installed CFR titles whose text cites it ("16 U.S.C. 1532(5)"),
  found with an FTS5 query (`"16 u s c" AND "1532"`) and confirmed by the shared citation
  parser, so "16 U.S.C. 15320" or a different title never counts;
- `authority`: CFR parts whose Authority line (front matter) cites it — the regulations
  written under this statute.

A range ("16 U.S.C. 1531-1544") counts only for its endpoints, like the CFR's own graph.
"""
from __future__ import annotations

import re
import sqlite3

from . import config, store, usc_store
from .citations.parser import extract_reference_spans
from .render.text import clean_label

MAX_ROWS = 200
_TAG_RE = re.compile(r"<[^>]+>")


def _usc_citers(title: int, sid: str) -> list[dict]:
    target = f"/us/usc/t{title}/s{sid}"
    out: list[dict] = []
    for t in usc_store.installed_titles():
        with usc_store.read_con(t) as con:
            if con is None:
                continue
            try:
                rows = con.execute(
                    "SELECT id, label, heading FROM sections WHERE (xml LIKE ? OR xml LIKE ?) AND NOT (? = ? AND id = ?) "
                    "ORDER BY ord LIMIT ?",
                    (f'%"{target}"%', f'%"{target}/%', t, title, sid, MAX_ROWS)).fetchall()
            except sqlite3.Error:
                continue
        out += [{"title": t, "id": r["id"], "label": r["label"], "heading": r["heading"]} for r in rows]
    return out


def _cites(text: str, title: int, sid: str) -> list[str]:
    """Paragraphs of `title` U.S.C. `sid` cited in `text` ('' for the whole section)."""
    return [s.paragraph for s in extract_reference_spans(text, 0)
            if s.kind == "usc" and s.title == title and s.target == sid]


def _cfr_citers(title: int, sid: str) -> list[dict]:
    q = f'"{title} u s c" AND "{sid.lower()}"'
    out: list[dict] = []
    for t in config.installed_titles():
        try:
            with store.read_db(t) as con:
                rows = con.execute(
                    "SELECT s.id, s.part, s.label, s.title, s.text FROM sections_fts f "
                    "JOIN sections s ON s.rowid = f.rowid WHERE sections_fts MATCH ? ORDER BY s.ord LIMIT ?",
                    (q, MAX_ROWS)).fetchall()
        except (sqlite3.Error, OSError):
            continue
        for r in rows:
            paras = _cites(r["text"] or "", title, sid)
            if paras:
                out.append({"title": t, "id": r["id"], "part": r["part"] or "", "label": clean_label(r["label"]),
                            "heading": clean_label(r["title"]), "paragraphs": sorted({p for p in paras if p})})
    return out


def _authority_parts(title: int, sid: str) -> list[dict]:
    needle = f"{title} U.S.C"
    out: list[dict] = []
    for t in config.installed_titles():
        try:
            with store.read_db(t) as con:
                rows = con.execute(
                    "SELECT key, xml FROM front_matter WHERE key LIKE 'part/%' AND key NOT LIKE '%/subpart/%' "
                    "AND instr(xml, ?) > 0", (needle,)).fetchall()
        except (sqlite3.Error, OSError):
            continue
        for r in rows:
            if _cites(_TAG_RE.sub(" ", r["xml"]), title, sid):
                out.append({"title": t, "part": r["key"].split("/", 1)[1]})
    return sorted(out, key=lambda x: (x["title"], x["part"].zfill(8)))


def cited_by(title: int, section_id: str) -> dict | None:
    sid = usc_store.normalize_section_id(section_id)
    if not usc_store.has_section(title, sid):
        return None
    usc, cfr, authority = _usc_citers(title, sid), _cfr_citers(title, sid), _authority_parts(title, sid)
    return {"title": title, "section_id": sid, "citation": f"{title} U.S.C. {sid}",
            "usc": usc, "cfr": cfr, "authority": authority,
            "count": len(usc) + len(cfr) + len(authority)}
