"""Streaming USLM 1.0 parser for one U.S. Code title (`uscNN.xml` from the OLRC).

Shape (verified on Titles 1 and 4, release point 119-142):

    uscDoc/meta(docNumber, docPublicationName "Online@119-142", property is-positive-law)
    uscDoc/main/title(num, heading, note*, toc, notes?, chapter*(… subchapter/part …, section*))
    section(num, heading, content | chapeau + subsection*, sourceCredit, notes(note*))

Sections are leaves; `quotedContent` can embed whole sections and chapters (amendment
text), which belong to the quoting element, so nothing inside it is treated as
structure. Notes (QUIRK-006): a section's `<notes type="uscNote">` holds editorial notes
(amendments, codification, references in text) and statutory notes (effective dates,
short titles, uncodified provisions) separated by `note role="crossHeading"` dividers
(`topic="editorialNotes" | "statutoryNotes" | "execDoc"`). They are emitted separately
from the section, each with its `category`, so section text stays the operative law.

Memory stays flat: each section is cleared and detached once emitted.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Callable

NS = "http://xml.house.gov/schemas/uslm/1.0"
LEVELS = ("title", "subtitle", "chapter", "subchapter", "part", "subpart", "division",
          "subdivision", "article",
          # appendix titles (5a, 11a, 18a, 28a): the root, acts compiled into it, rule sets
          "appendix", "compiledAct", "courtRules", "reorganizationPlans")
ROOTS = ("title", "appendix")
# Readable units: sections, plus a court rule or a reorganization plan in an appendix title.
LEAVES = ("section", "courtRule", "reorganizationPlan")
CROSSHEADING_CATEGORY = {"editorialNotes": "editorial", "statutoryNotes": "statutory", "execDoc": "executive"}
STATUS_WORDS = ("repealed", "omitted", "transferred", "renumbered", "vacant", "reserved", "expired")
_STATUS_RE = re.compile(r"^\W*(" + "|".join(STATUS_WORDS) + r")\b", re.I)
_WS = re.compile(r"\s+")


def is_uslm(tag: str) -> bool:
    return isinstance(tag, str) and tag.startswith("{" + NS + "}")


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def strip_ns(el: ET.Element) -> ET.Element:
    """Drop namespaces from tags and attribute names in place (stored XML is plain)."""
    for e in el.iter():
        e.tag = local(e.tag)
        if any("}" in k for k in e.attrib):
            e.attrib = {local(k): v for k, v in e.attrib.items() if "XMLSchema-instance" not in k}
    return el


def text_of(el: ET.Element | None, skip: tuple[str, ...] = ()) -> str:
    if el is None:
        return ""
    parts: list[str] = []

    def walk(e: ET.Element) -> None:
        if local(e.tag) in skip:
            if e.tail:
                parts.append(e.tail)
            return
        if e.text:
            parts.append(e.text)
        for c in e:
            walk(c)
        if e.tail and e is not el:
            parts.append(e.tail)

    walk(el)
    return _WS.sub(" ", " ".join(parts)).strip()


def short_id(identifier: str | None, fallback: str = "") -> str:
    """'/us/usc/t42/s2000e-2' → '2000e-2'; '/us/usc/t4/ch1' → 'ch1'."""
    if not identifier:
        return fallback
    last = identifier.rstrip("/").rsplit("/", 1)[-1]
    if last.startswith("s") and len(last) > 1 and (last[1].isdigit()):
        return last[1:]
    return last


def section_status(el: ET.Element, heading: str) -> str | None:
    st = (el.get("status") or "").strip().lower()
    if st:
        return st
    m = _STATUS_RE.match(heading or "")
    return m.group(1).lower() if m else None


def _num_text(el: ET.Element) -> str:
    n = next((c for c in el if local(c.tag) == "num"), None)
    return text_of(n)


def _heading_text(el: ET.Element) -> str:
    h = next((c for c in el if local(c.tag) == "heading"), None)
    return text_of(h)


def split_notes(note_elements: list[ET.Element], default: str = "editorial") -> list[dict]:
    """Note elements in document order → [{category, topic, heading, xml, text}].
    crossHeading dividers set the category for the notes after them and are not kept."""
    out: list[dict] = []
    category = default
    for n in note_elements:
        topic = n.get("topic")
        if n.get("role") == "crossHeading":
            category = CROSSHEADING_CATEGORY.get(topic or "", topic or category)
            continue
        strip_ns(n)
        out.append({
            "category": category,
            "topic": topic,
            "heading": _heading_text(n),
            "xml": ET.tostring(n, encoding="unicode"),
            "text": text_of(n),
        })
    return out


def _collect_notes(container: ET.Element) -> list[ET.Element]:
    """Direct `note` children and the notes inside direct `notes` children, in order,
    detaching them from the container."""
    found: list[ET.Element] = []
    for c in list(container):
        t = local(c.tag)
        if t == "notes":
            found.extend(n for n in c if local(n.tag) == "note")
            container.remove(c)
        elif t == "note":
            found.append(c)
            container.remove(c)
    return found


def parse_title(
    xml_path: Path,
    on_section: Callable[[dict], None],
    on_notes: Callable[[str, str, list[dict]], None] | None = None,
) -> tuple[dict, dict]:
    """Stream one title. `on_section(rec)` gets every section in reading order:
    {id, identifier, label, heading, status, chapter, path, xml, text, source_credit, notes}.
    `on_notes(owner, owner_kind, notes)` gets notes attached to a title/chapter/… level.
    Returns (title_info, tree) where tree uses the CFR tree's compact keys
    (t/id/l/d/c, plus s = status on sections)."""
    info: dict = {"number": None, "name": "", "publication": None, "positive_law": None}
    stack: list[ET.Element] = []
    nodes: list[dict] = []           # tree nodes parallel to the level elements on `stack`
    quoted = 0
    root_node: dict | None = None

    with open(xml_path, "rb") as fh:
        for event, el in ET.iterparse(fh, events=("start", "end")):
            tag = local(el.tag)
            if event == "start":
                stack.append(el)
                if tag == "quotedContent":
                    quoted += 1
                elif not quoted and tag in LEVELS and is_uslm(el.tag):  # not dc:title
                    node = {"t": tag, "id": short_id(el.get("identifier"), tag), "l": "", "d": "", "c": []}
                    nodes.append(node)
                    if tag in ROOTS and root_node is None:
                        root_node = node
                continue

            stack.pop()
            parent = stack[-1] if stack else None
            ptag = local(parent.tag) if parent is not None else ""

            if tag == "quotedContent":
                quoted -= 1
                continue
            if quoted:
                continue

            if tag == "docNumber" and ptag == "meta":
                info["number"] = (el.text or "").strip()
            elif tag == "docPublicationName" and ptag == "meta":
                info["publication"] = (el.text or "").strip()
            elif tag == "property" and ptag == "meta" and el.get("role") == "is-positive-law":
                info["positive_law"] = (el.text or "").strip().lower() == "yes"
            elif tag in ("num", "heading") and ptag in LEVELS and nodes and is_uslm(parent.tag):
                nodes[-1]["l" if tag == "num" else "d"] = text_of(el).rstrip("—–- ").strip()
            elif tag == "toc" and ptag in LEVELS and parent is not None:
                parent.remove(el)
            elif tag in LEAVES:
                rec = _section_record(el, nodes, tag)
                if nodes:
                    nodes[-1]["c"].append({"t": "section", "id": rec["id"], "l": rec["label"],
                                           "d": rec["heading"], **({"s": rec["status"]} if rec["status"] else {})})
                on_section(rec)
                el.clear()
                if parent is not None:
                    parent.remove(el)
            elif tag in LEVELS and is_uslm(el.tag):
                node = nodes.pop() if nodes else None
                notes = _collect_notes(el)
                if notes and on_notes:
                    on_notes(el.get("identifier") or tag, tag, split_notes(notes))
                is_root = node is not None and node is root_node
                if is_root:
                    info["name"] = node["d"] if node else ""
                    if not info["number"] and node:
                        info["number"] = node["id"].lstrip("t")
                elif node is not None and nodes:
                    nodes[-1]["c"].append(node)
                el.clear()
                if parent is not None and not is_root:
                    parent.remove(el)

    tree = root_node or {"t": "title", "id": "", "l": "", "d": "", "c": []}
    return info, tree


def leaf_id(identifier: str, tag: str, num: str) -> str:
    """A section's id is its identifier's last segment ('/us/usc/t42/s2000e-2' → '2000e-2').
    Appendix units whose last segment repeats get more of the path: a reorganization plan
    '/us/usc/t5a/reorgPlan/1939/I' → 'reorgPlan-1939-I', a section of a compiled act
    '/us/usc/t18a/pl/91/538/s1' → 'pl91-538-s1'; a court rule keeps 'rule1001'."""
    fallback = re.sub(r"[^0-9A-Za-z.-]", "", num).strip(".")
    if not identifier:
        return fallback
    parts = [p for p in identifier.split("/") if p]
    if tag == "reorganizationPlan" and "reorgPlan" in parts:
        return "-".join(parts[parts.index("reorgPlan"):])
    if tag == "courtRule" and "courtRules" in parts[:-2]:      # 28a: App / Civil / Evid … share numbers
        i = parts.index("courtRules")
        return "-".join(parts[i + 1:])
    if tag == "section" and "pl" in parts[:-1]:
        i = parts.index("pl")
        return "pl" + "-".join(parts[i + 1:])
    return short_id(identifier, fallback)


def _section_record(el: ET.Element, nodes: list[dict], tag: str = "section") -> dict:
    identifier = el.get("identifier") or ""
    num = _num_text(el)
    sid = leaf_id(identifier, tag, num)
    heading = _heading_text(el)
    notes = split_notes(_collect_notes(el))
    sc = next((c for c in el if local(c.tag) == "sourceCredit"), None)
    source_credit = text_of(sc)
    status = section_status(el, heading)
    strip_ns(el)
    el.tail = None
    body_text = text_of(el, skip=("sourceCredit", "num", "heading"))
    ancestors = [{"t": n["t"], "id": n["id"], "l": n["l"], "d": n["d"]} for n in nodes[1:]] if nodes else []
    chapter = next((n["id"] for n in reversed(ancestors) if n["t"] == "chapter"), None)
    return {
        "id": sid,
        "identifier": identifier,
        "label": f"§ {sid}" if tag == "section" and not sid.startswith("pl") else (num.strip(" .—–") or sid),
        "heading": heading,
        "status": status,
        "chapter": chapter,
        "path": ancestors,
        "xml": ET.tostring(el, encoding="unicode"),
        "text": body_text,
        "source_credit": source_credit,
        "notes": notes,
    }
