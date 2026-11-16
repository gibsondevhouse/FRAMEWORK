"""Units: a long section read one clause or appendix chapter at a time."""
from __future__ import annotations

import html
import re
import xml.etree.ElementTree as ET
from typing import Callable

from .hierarchy import _MARKERS, compute_levels, marker_tokens
from .linkifier import make_linkifier
from .text import _plain

HEAD_TAGS = ("HD1", "HD2", "HD3", "HED", "HEAD")
# A section is read unit by unit when it is longer than this (in characters of text) or
# carries appendices inside it; anything shorter reads as one page.
UNIT_MODE_MIN_CHARS = 25_000
# An embedded appendix this long is split further at its own top-level headings.
APPENDIX_SPLIT_MIN_CHARS = 15_000
_APPENDIX_TITLE = re.compile(r"^Appendix\s+([A-Z0-9]+(?:-\d+)?)\b\s*(?:to\s+[^—–-]*?)?\s*[—–-]?\s*(.*)$", re.IGNORECASE)
_CHAPTER = re.compile(r"^((?:[A-Z]\.\d+(?:\.\d+)*)|(?:Part\s+[A-Z0-9]+))\s*[—–:.]?\s*(.+)$")
_NOT_CHAPTER = re.compile(r"^(figure|fig\.|table|note|example|exhibit)\b", re.IGNORECASE)


def appendix_heading(el: ET.Element) -> str | None:
    """If `el` is an EXTRACT holding an appendix ("Appendix A to § 1910.1200—…"), its heading."""
    if el.tag != "EXTRACT":
        return None
    for c in el:
        if c.tag in HEAD_TAGS:
            text = _plain(c)
            return text if text.lower().startswith("appendix") else None
        if _plain(c):
            return None
    return None


def _runin_title(p: ET.Element) -> str:
    """The run-in heading of a clause: '(c) <I>Definitions.</I> …' -> 'Definitions'."""
    rest = _MARKERS.sub("", p.text or "", count=1)
    if not rest.strip() and len(p) and p[0].tag in ("I", "E"):
        return re.sub(r"[\s.:;,—–-]+$", "", _plain(p[0]))
    words = _MARKERS.sub("", _plain(p), count=1).strip()
    stop = re.search(r"[.—]\s", words[:70])   # "Definitions. Action level means…" -> "Definitions"
    if stop:
        return words[:stop.start()].strip()
    short = " ".join(words.split()[:8])
    return short + ("…" if len(words) > len(short) else "")


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "x"


def split_units(root: ET.Element, levels: dict[int, int]) -> list[dict]:
    """Cut a section into reading units, in order.

    - Each top-level lettered clause (a), (b), … is a unit; text before (a) joins (a).
    - Each appendix embedded in the section is a unit, or, when it is long, one unit per
      top-level heading inside it (A.0, A.1, … / Part A, Part B).
    Every unit is {key, label, title, kind, group, group_label, group_title, chars, elements}.
    """
    units: list[dict] = []
    intro: list[ET.Element] = []
    current: dict | None = None
    last_letter = ""

    def new(kind: str, key: str, label: str, title: str, elements: list, **group) -> dict:
        u = {"key": key, "label": label, "title": title, "kind": kind,
             "group": group.get("group"), "group_label": group.get("group_label"),
             "group_title": group.get("group_title"), "elements": elements}
        units.append(u)
        return u

    for child in root:
        if child.tag in ("HEAD", "CITA"):
            continue
        heading = appendix_heading(child)
        if heading:
            current = None
            _appendix_units(child, heading, new)
            continue
        tokens = marker_tokens(child)
        letter = tokens[0][0] if tokens and not tokens[1] else ""
        if (letter and len(letter) == 1 and letter.islower() and letter > last_letter
                and levels.get(id(child)) == 1):
            current = new("clause", letter, f"({letter})", _runin_title(child), intro + [child])
            intro = []
            last_letter = letter
            continue
        if current is not None:
            current["elements"].append(child)
        elif units:
            units[-1]["elements"].append(child)   # stray text after an appendix
        else:
            intro.append(child)

    if intro and not units and sum(len(_plain(e)) for e in intro) > UNIT_MODE_MIN_CHARS:
        # A long text with no clauses (a standalone appendix, a long narrative section):
        # read it chapter by chapter at its own top-level headings.
        _chapter_units(intro, -1, "part", {}, new)
        intro = [] if units else intro
    if intro:  # no lettered clauses before the first appendix (or at all)
        units.insert(0, {"key": "text", "label": "§", "title": "Section text", "kind": "text",
                         "group": None, "group_label": None, "group_title": None, "elements": intro})

    seen: set[str] = set()
    for u in units:
        base, n = u["key"], 2
        while u["key"] in seen:
            u["key"] = f"{base}-{n}"
            n += 1
        seen.add(u["key"])
        u["chars"] = sum(len(_plain(e)) for e in u["elements"])
    return units


def _appendix_units(extract: ET.Element, heading: str, new) -> None:
    m = _APPENDIX_TITLE.match(heading)
    letter = m.group(1) if m else ""
    if letter.lower() == "to":
        letter = ""
    rest = (m.group(2) if m else "") or ""
    group_title = re.sub(r"^[\s:—–-]*(?:§+\s*[\d.]+[a-z]?)?[\s:—–-]*", "", rest).strip() or heading
    group = f"appendix-{_slug(letter)}" if letter else "appendix"
    group_label = f"Appendix {letter}" if letter else "Appendix"
    kids = list(extract)
    meta = {"group": group, "group_label": group_label, "group_title": group_title}
    total = sum(len(_plain(c)) for c in kids)
    title_idx = next((i for i, c in enumerate(kids) if c.tag in HEAD_TAGS), 0)
    if total < APPENDIX_SPLIT_MIN_CHARS or not _chapter_units(kids, title_idx, group, meta, new):
        new("appendix", group, group_label, group_title, kids, **meta)


def _chapter_units(kids: list[ET.Element], title_idx: int, key_prefix: str, meta: dict, new) -> bool:
    """Split `kids` at their top-level HD1 headings (after `title_idx`), skipping figure and table
    captions. The first chapter also carries whatever precedes it. False if there are < 2."""
    for tag in ("HD1", "HD2"):   # chapters are usually HD1; some appendices only use HD2
        splits = [i for i, c in enumerate(kids)
                  if i > title_idx and c.tag == tag and _plain(c) and not _NOT_CHAPTER.match(_plain(c))]
        if len(splits) >= 2:
            break
    else:
        return False
    bounds = [0] + splits[1:] + [len(kids)]
    for (start, end), head_idx in zip(zip(bounds, bounds[1:]), splits):
        text = _plain(kids[head_idx])
        cm = _CHAPTER.match(text)
        code, title = (cm.group(1), cm.group(2)) if cm else ("", text)
        key = f"{key_prefix}-{_slug(code)}" if code else f"{key_prefix}-{_slug(title)[:24].strip('-')}"
        new("chapter", key, code, title.strip(), kids[start:end], **meta)
    return True


class SectionDoc:
    """A parsed section, ready to render whole or one unit at a time."""

    def __init__(self, xml: str, linkify: Callable[[str], str]):
        self.root = ET.fromstring(xml)
        self.linkify = linkify
        self.levels = compute_levels(self.root)
        self.units = split_units(self.root, self.levels)
        text_chars = sum(u["chars"] for u in self.units)
        has_appendix = any(u["group"] for u in self.units)
        self.mode = "units" if len(self.units) >= 2 and (text_chars > UNIT_MODE_MIN_CHARS or has_appendix) else "page"

    def outline(self) -> list[dict]:
        return [{k: v for k, v in u.items() if k != "elements"} for u in self.units]

    def find(self, key: str | None) -> dict | None:
        if not self.units:
            return None
        if key:
            for u in self.units:
                if u["key"] == key:
                    return u
            for u in self.units:          # a group key opens the group's first chapter
                if u["group"] == key:
                    return u
        return self.units[0]

    def unit_html(self, key: str) -> str:
        unit = self.find(key)
        if unit is None:
            return ""
        from .html import Renderer  # deferred: html.py imports this module at top level
        return Renderer(self.linkify).render_elements(unit["elements"], self.levels)

    def full_html(self) -> str:
        """Every unit in order, each in its own anchored <section>, then the source history."""
        from .html import Renderer  # deferred: html.py imports this module at top level
        r = Renderer(self.linkify)
        parts = []
        for u in self.units:
            body = r.render_elements(u["elements"], self.levels)
            parts.append(f'<section class="reg-unit" id="u-{html.escape(u["key"])}" data-unit="{html.escape(u["key"])}">{body}</section>')
        if not self.units:
            parts.append(r.render_elements([c for c in self.root if c.tag not in ("HEAD", "CITA")], self.levels))
        return "".join(parts) + r.render_history(self.root)


def section_doc(
    xml: str,
    known: Callable[[str], bool],
    title: int = 29,
    known_by_title: Callable[[int, str], bool] | None = None,
    installed_titles: Callable[[], list[int]] | None = None,
) -> SectionDoc:
    linkify = make_linkifier(known, title=title, known_by_title=known_by_title, installed_titles=installed_titles)
    return SectionDoc(xml, linkify)
