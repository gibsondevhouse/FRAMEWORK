"""Streaming XML parsing: eCFR paths, part/subpart front matter, and the iterparse
pass that stages every section and appendix into SQLite with flat memory."""
from __future__ import annotations

import html
import json
import sqlite3
import xml.etree.ElementTree as ET
from pathlib import Path

from ..render import element_to_text

def ecfr_path(el: ET.Element) -> str | None:
    meta = el.get("hierarchy_metadata")
    if not meta:
        return None
    try:
        data = json.loads(html.unescape(html.unescape(meta)))
        return data.get("path", "").replace("/on/_SUBSTITUTE_DATE_", "/current") or None
    except (ValueError, AttributeError):
        return None


def front_matter_xml(el: ET.Element) -> str:
    """Authority, source, and notes that sit directly under a part or subpart."""
    keep = [c for c in el if not c.tag.startswith("DIV") and c.tag != "HEAD"]
    wrapper = ET.Element("FRONT")
    for c in keep:
        wrapper.append(c)
    return ET.tostring(wrapper, encoding="unicode") if keep else ""


def stream_parse_xml(xml_path: Path, con: sqlite3.Connection, on_leaf=None) -> dict[str, str]:
    """Parse XML with iterparse, streaming sections to staging SQLite table and flatlining RAM.
    Can be called once per downloaded piece; leaves accumulate in the same staging table.
    `on_leaf()` is called after each section or appendix (for progress)."""
    front: dict[str, str] = {}
    stack: list[ET.Element] = []
    batch: list[tuple] = []

    con.execute(
        "CREATE TEMP TABLE IF NOT EXISTS staging_leaves (kind TEXT, id TEXT, ecfr_path TEXT, xml TEXT, text TEXT, PRIMARY KEY(kind, id))"
    )

    with open(xml_path, "rb") as xml_file:
        context = ET.iterparse(xml_file, events=("start", "end"))
        for event, elem in context:
            if event == "start":
                stack.append(elem)
            elif event == "end":
                stack.pop()
                parent = stack[-1] if stack else None

                if elem.tag in ("DIV8", "DIV9"):
                    kind = "section" if elem.tag == "DIV8" else "appendix"
                    ident = elem.get("N")
                    elem.tail = None
                    p = ecfr_path(elem)
                    x = ET.tostring(elem, encoding="unicode")
                    t = element_to_text(elem)
                    batch.append((kind, ident, p, x, t))
                    if on_leaf:
                        on_leaf()
                    if len(batch) >= 500:
                        con.executemany("INSERT OR REPLACE INTO staging_leaves VALUES (?,?,?,?,?)", batch)
                        batch.clear()
                    elem.clear()
                    if parent is not None:
                        parent.remove(elem)
                elif elem.tag == "DIV6":
                    subpart = elem.get("N")
                    part = next((e.get("N") for e in reversed(stack) if e.tag == "DIV5"), None)
                    if part:
                        front[f"part/{part}/subpart/{subpart}"] = front_matter_xml(elem)
                    elem.clear()
                    if parent is not None:
                        parent.remove(elem)
                elif elem.tag == "DIV5":
                    part = elem.get("N")
                    front[f"part/{part}"] = front_matter_xml(elem)
                    elem.clear()
                    if parent is not None:
                        parent.remove(elem)

        del context

    if batch:
        con.executemany("INSERT OR REPLACE INTO staging_leaves VALUES (?,?,?,?,?)", batch)
        batch.clear()

    return front
