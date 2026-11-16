"""Convert eCFR XML into readable HTML (for the reader) and plain text (for search and Claude)."""
from __future__ import annotations

import html
import re
import xml.etree.ElementTree as ET
from typing import Callable
from urllib.parse import quote

# ---------------------------------------------------------------------------
# Plain text
# ---------------------------------------------------------------------------

BLOCK_TAGS = {
    "P", "FP", "FP-1", "FP-2", "FP1-2", "FP2-3", "FP-DASH", "P-2", "FL-2", "FRP",
    "HEAD", "HD1", "HD2", "HD3", "HED", "PSPACE", "CITA", "TR", "CAPTION", "BCAP", "TCAP",
    "NOTE", "EXTRACT", "EXAMPLE", "FTNT", "AUTH", "SOURCE", "SECAUTH", "APPRO", "EDNOTE",
    "EFFDNOT", "CROSSREF", "STARS", "DIV", "MATH",
}
CELL_TAGS = {"TD", "TH"}
_WS = re.compile(r"[ \t\r\n\u00a0]+")


def element_to_text(el: ET.Element) -> str:
    """Readable plain text with one line per paragraph and ' | ' between table cells."""
    out: list[str] = []

    def walk(node: ET.Element) -> None:
        if node.tag == "img":
            out.append(" [figure] ")
        if node.text:
            out.append(node.text)
        for child in node:
            walk(child)
            if child.tag in CELL_TAGS:
                out.append(" | ")
            if child.tail:
                out.append(child.tail)
        if node.tag in BLOCK_TAGS:
            out.append("\n")

    walk(el)
    lines = (_WS.sub(" ", line).strip(" |") for line in "".join(out).split("\n"))
    return "\n".join(line.strip() for line in lines if line.strip())


# ---------------------------------------------------------------------------
# Paragraph levels: (a) -> (1) -> (i) -> (A) -> (1 italic) -> (i italic)
# ---------------------------------------------------------------------------

_FIRST = re.compile(r"\(([a-zA-Z0-9]+)\)")
_MARKERS = re.compile(r"^(\s*(?:\([a-zA-Z0-9]+\)\s*)+)")
ROMAN = {"i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x",
         "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii", "xix", "xx"}


ROMAN_ORDER = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x",
               "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii", "xix", "xx"]


class LevelTracker:
    """Infers paragraph depth from markers.

    The hard case is a lone (i), (v) or (x): each is both a letter (level 1, the clause after
    (h), (u) or (w)) and a roman numeral (level 3). We decide from both sides: the marker of
    the next paragraph (`next_first`, from a pre-pass over the whole section) and what came
    before (the last clause letter and the last roman numeral seen).
    """

    def __init__(self) -> None:
        self.last_level = 0
        self.last_tokens: list[str] = []
        self.last_letter: str | None = None  # last single-letter clause at level 1
        self.last_roman: str | None = None   # last roman numeral at level 3, in the current list

    def observe(self, tokens: list[str], italic: bool = False, next_first: str | None = None) -> int:
        if not tokens:
            return self.last_level
        self.last_tokens = tokens
        first = tokens[0]
        if italic:
            lvl = 5 if first.isdigit() else 6
        elif first.isalpha() and first.islower() and first not in ROMAN:
            lvl = 1
        elif first.isdigit():
            lvl = 2
        elif first.isalpha() and first.isupper():
            lvl = 4
        elif first.lower() in ROMAN:
            lvl = self._resolve_roman(first.lower(), tokens[1] if len(tokens) > 1 else None, next_first)
        else:
            return self.last_level
        if lvl == 1:
            self.last_letter = first if len(first) == 1 else self.last_letter
            self.last_roman = None
        elif lvl == 2:
            self.last_roman = None  # a new numbered paragraph starts any roman list afresh
        elif lvl == 3:
            self.last_roman = first.lower()
        self.last_level = lvl
        return lvl

    def _resolve_roman(self, tok: str, peek: str | None, nxt: str | None) -> int:
        if tok in ("i", "v", "x"):
            roman_next = ROMAN_ORDER[ROMAN_ORDER.index(tok) + 1]
            roman_prev = ROMAN_ORDER[ROMAN_ORDER.index(tok) - 1] if tok != "i" else None
            letter_next = chr(ord(tok) + 1)
            letter_prev = chr(ord(tok) - 1)
            if peek and peek.isdigit():          # "(i)(1)": only a letter clause has numbered children inline
                return 1
            if nxt == roman_next:                # (i) then (ii): a roman list
                return 3
            if roman_prev and self.last_roman == roman_prev:   # (iv) then (v): continuing a roman list
                return 3
            if nxt == letter_next:               # (i) then (j)
                return 1
            if self.last_letter == letter_prev:  # (h) … then (i)
                return 1
            if nxt and nxt.isdigit():            # (i) then (1): a clause with numbered paragraphs
                return 1
            if nxt and nxt.isalpha() and nxt.isupper():  # (i) then (A)
                return 3
            if self.last_level in (0, 1):
                return 1
            return 3
        # ii, iii, iv, vi, … are never letters
        return 3


def marker_tokens(el: ET.Element) -> tuple[list[str], bool] | None:
    """The paragraph-marker tokens at the start of a P/FP, as the renderer reads them.

    Returns (tokens, italic) or None. Mirrors `Renderer.paragraph`, which must agree.
    """
    if el.tag not in ("P", "FP"):
        return None
    text = el.text or ""
    m = _MARKERS.match(text)
    if m:
        return _FIRST.findall(m.group(1)), False
    if (text.strip() == "(" and len(el) and el[0].tag in ("I", "E")
            and (el[0].text or "").strip() and len((el[0].text or "").strip()) <= 4
            and (el[0].tail or "").startswith(")")):
        return [el[0].text.strip()], True
    return None


def compute_levels(root: ET.Element) -> dict[int, int]:
    """Depth of every marked paragraph under `root`, keyed by id(element).

    Done as one pass over the whole section so that rendering any slice of it (one clause,
    one appendix chapter) gives exactly the same indentation as rendering all of it.
    """
    marked = [(e, t) for e in root.iter() if (t := marker_tokens(e))]
    tracker = LevelTracker()
    levels: dict[int, int] = {}
    for i, (e, (tokens, italic)) in enumerate(marked):
        nxt = marked[i + 1][1][0][0] if i + 1 < len(marked) else None
        levels[id(e)] = tracker.observe(tokens, italic=italic, next_first=nxt)
    return levels


# ---------------------------------------------------------------------------
# Cross-reference & Citation links: CFR, U.S.C., FR, Web URLs
# ---------------------------------------------------------------------------

_SEC_NUM = r"\d{1,4}\.[\d]+(?:-\d+)?[a-z]?"
_PARA = r"(?:\([a-zA-Z0-9]{1,4}\))*"
_SEP = r"(?:\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or|through|to)\s+)"

_XREF = re.compile(rf"(§§?\s*)({_SEC_NUM}{_PARA}(?:{_SEP}{_SEC_NUM}{_PARA})*)")
_WORD_SEC = re.compile(rf"\b(sections?\s+)({_SEC_NUM}{_PARA}(?:{_SEP}{_SEC_NUM}{_PARA})*)", re.IGNORECASE)
_NUM_IN_LIST = re.compile(rf"({_SEC_NUM})({_PARA})")

_CROSS_TITLE = re.compile(
    rf"\b(\d{{1,2}})\s*C\.?F\.?R\.?\s*(?:(part\s+\d+)|(§§?\s*)({_SEC_NUM}{_PARA}(?:{_SEP}{_SEC_NUM}{_PARA})*)|({_SEC_NUM}{_PARA}))(?:\b|(?<=\)))",
    re.IGNORECASE,
)

_WEB_URL = re.compile(
    r'\b((?:https?://|www\.)[^\s<>"\'\)]+(?:\([^\s<>"\'\)]+\)|[^\s<>"\'\.,;:?!]))',
    re.IGNORECASE,
)
_USC = re.compile(
    r"\b(\d{1,2})\s*U\.?S\.?C\.?\s*(?:§+|sec\.?|section)?\s*([0-9]+[a-z]?(?:-[0-9]+[a-z]?)?)\b",
    re.IGNORECASE,
)
_FR = re.compile(r"\b(\d{1,3})\s*FR\s*([0-9]+)\b", re.IGNORECASE)
_WORD_PART = re.compile(r"\b(parts?\s+(\d{1,4}))\b", re.IGNORECASE)
_TAG_SPLIT = re.compile(r"(<[^>]+>)")
_ANCHOR_SPLIT = re.compile(r"(<a\b[^>]*>.*?</a>)", re.IGNORECASE | re.DOTALL)


def _outside_anchors(text: str, fn: Callable[[str], str]) -> str:
    """Apply `fn` to the parts of `text` that are not already inside an `<a>…</a>`."""
    if "<a" not in text:
        return fn(text)
    return "".join(piece if piece.lower().startswith("<a") else fn(piece)
                   for piece in _ANCHOR_SPLIT.split(text) if piece)


def make_linkifier(
    known: Callable[[str], bool],
    title: int = 29,
    known_by_title: Callable[[int, str], bool] | None = None,
    installed_titles: Callable[[], list[int]] | None = None,
) -> Callable[[str], str]:
    """Build a linkifier function that converts internal and cross-title citations, U.S.C., FR, and web URLs into links."""

    def is_title_installed(t: int) -> bool:
        if installed_titles:
            return t in installed_titles()
        return t in (29, 40, 49)

    def is_section_known(t: int, sec: str) -> bool:
        if t == title:
            return known(sec)
        if known_by_title:
            return known_by_title(t, sec)
        return False

    def link_num_current_title(m: re.Match) -> str:
        num, para = m.group(1), m.group(2)
        if not known(num):
            return m.group(0)
        href = f"#/title/{title}/section/{num}" + (f"?p={quote(para)}" if para else "")
        return f'<a class="xref" href="{href}">{num}{para}</a>'

    def link_cross_title(m: re.Match) -> str:
        t_num = int(m.group(1))
        part_match = m.group(2)
        sec_prefix = m.group(3)
        sec_list = m.group(4)
        bare_sec = m.group(5)

        full_text = m.group(0)
        installed = is_title_installed(t_num)

        # 1. Part citation: e.g. "40 CFR Part 261"
        if part_match:
            p_val = re.sub(r"[^\d]", "", part_match)
            if installed:
                href = f"#/title/{t_num}/part/{p_val}"
                return f'<a class="xref xref-cross" href="{href}">{full_text}</a>'
            href = f"https://www.ecfr.gov/current/title-{t_num}/part-{p_val}"
            return f'<a class="xref xref-external" target="_blank" rel="noopener noreferrer" title="Title {t_num} not installed - view on eCFR" href="{href}">{full_text}</a>'

        # 2. Section list with prefix: e.g. "40 CFR § 261.3" or "40 CFR §§ 261.1 through 261.5"
        if sec_list:
            def replace_item(im: re.Match) -> str:
                num, para = im.group(1), im.group(2)
                if installed and is_section_known(t_num, num):
                    href = f"#/title/{t_num}/section/{num}" + (f"?p={quote(para)}" if para else "")
                    return f'<a class="xref xref-cross" href="{href}">{num}{para}</a>'
                href = f"https://www.ecfr.gov/current/title-{t_num}/section-{num}"
                return f'<a class="xref xref-external" target="_blank" rel="noopener noreferrer" href="{href}">{num}{para}</a>'

            linked_list = _NUM_IN_LIST.sub(replace_item, sec_list)
            return f"{t_num} CFR {sec_prefix or ''}{linked_list}"

        # 3. Bare section: e.g. "40 CFR 261.3(a)(1)"
        if bare_sec:
            bm = _NUM_IN_LIST.match(bare_sec)
            if bm:
                num, para = bm.group(1), bm.group(2)
                if installed and is_section_known(t_num, num):
                    href = f"#/title/{t_num}/section/{num}" + (f"?p={quote(para)}" if para else "")
                    return f'<a class="xref xref-cross" href="{href}">{full_text}</a>'
                href = f"https://www.ecfr.gov/current/title-{t_num}/section-{num}"
                return f'<a class="xref xref-external" target="_blank" rel="noopener noreferrer" href="{href}">{full_text}</a>'

        return full_text

    def transform_text_chunk(text: str) -> str:
        """Run all link transformations on pure text nodes outside of tags. Each pass only
        touches text that an earlier pass hasn't already wrapped in an anchor, so "40 CFR part 262"
        becomes one cross-title link rather than a part link nested inside it."""
        if not text:
            return ""

        # A. Web URLs: https://... or www....
        if "http" in text or "www." in text:
            def replace_url(m: re.Match) -> str:
                raw_url = m.group(1)
                href = f"https://{raw_url}" if raw_url.lower().startswith("www.") else raw_url
                return f'<a class="xref xref-web" target="_blank" rel="noopener noreferrer" href="{href}">{raw_url}</a>'
            text = _WEB_URL.sub(replace_url, text)

        # B. U.S. Code: e.g. 29 U.S.C. 653
        if "U.S.C" in text or "USC" in text:
            def replace_usc(m: re.Match) -> str:
                u_title, u_sec = m.group(1), m.group(2)
                href = f"https://www.law.cornell.edu/uscode/text/{u_title}/{u_sec}"
                return f'<a class="xref xref-usc" target="_blank" rel="noopener noreferrer" title="View {u_title} U.S.C. {u_sec} at Cornell LII" href="{href}">{m.group(0)}</a>'
            text = _outside_anchors(text, lambda t: _USC.sub(replace_usc, t))

        # C. Federal Register: e.g. 39 FR 23502
        if " FR " in text:
            def replace_fr(m: re.Match) -> str:
                vol, page = m.group(1), m.group(2)
                href = f"https://www.federalregister.gov/citation/{vol}-FR-{page}"
                return f'<a class="xref xref-fr" target="_blank" rel="noopener noreferrer" title="View Federal Register citation {vol} FR {page}" href="{href}">{m.group(0)}</a>'
            text = _outside_anchors(text, lambda t: _FR.sub(replace_fr, t))

        # D. Cross-Title CFR: e.g. 40 CFR § 261.3 or 49 CFR Part 172
        if "CFR" in text or "C.F.R" in text:
            text = _outside_anchors(text, lambda t: _CROSS_TITLE.sub(link_cross_title, t))

        # E. Internal bare § / §§ citations for current title
        if "§" in text:
            text = _outside_anchors(text, lambda t: _XREF.sub(
                lambda m: m.group(1) + _NUM_IN_LIST.sub(link_num_current_title, m.group(2)), t))

        # F. Word-based section citations: e.g. "section 1910.120"
        if "section" in text.lower():
            text = _outside_anchors(text, lambda t: _WORD_SEC.sub(
                lambda m: m.group(1) + _NUM_IN_LIST.sub(link_num_current_title, m.group(2)), t))

        # G. Internal Part citations: e.g. "Part 1910"
        if "part" in text.lower():
            def replace_part(m: re.Match) -> str:
                p_num = m.group(2)
                # Link if any section in this title belongs to this part
                href = f"#/title/{title}/part/{p_num}"
                return f'<a class="xref xref-part" href="{href}">{m.group(0)}</a>'
            text = _outside_anchors(text, lambda t: _WORD_PART.sub(replace_part, t))

        return text

    def linkify(escaped: str) -> str:
        if not escaped:
            return escaped

        # Split on HTML tags so we never linkify or mutate inside existing tags/attributes
        pieces = _TAG_SPLIT.split(escaped)
        out: list[str] = []
        in_anchor = False

        for piece in pieces:
            if not piece:
                continue
            if piece.startswith("<"):
                lower = piece.lower()
                if lower.startswith("<a ") or lower == "<a>":
                    in_anchor = True
                elif lower == "</a>":
                    in_anchor = False
                out.append(piece)
            else:
                if in_anchor:
                    out.append(piece)
                else:
                    out.append(transform_text_chunk(piece))

        return "".join(out)

    return linkify


# ---------------------------------------------------------------------------
# HTML
# ---------------------------------------------------------------------------

PARA_TAGS = {"P", "FP", "FP-1", "FP-2", "FP1-2", "FP2-3", "P-2", "FL-2", "FRP", "PSPACE"}
FLUSH_INDENT = {"FP-1": 1, "FP-2": 2, "FP1-2": 2, "FP2-3": 3, "P-2": 2, "FL-2": 2}
CALLOUTS = {
    "NOTE": ("note", "Note"),
    "EXAMPLE": ("example", "Example"),
    "EXTRACT": ("extract", None),
    "EDNOTE": ("ednote", "Editorial note"),
    "EFFDNOT": ("effdnote", "Effective date note"),
    "CROSSREF": ("crossref", "Cross reference"),
    "AUTH": ("auth", "Authority"),
    "SOURCE": ("source", "Source"),
    "SECAUTH": ("auth", "Authority"),
    "APPRO": ("approval", "OMB approval"),
}
INLINE_MAP = {
    "I": "em", "em": "em", "B": "strong", "strong": "strong",
    "sup": "sup", "SU": "sup", "sub": "sub",
}
E_STYLES = {
    "01": "strong", "02": "strong", "04": "strong", "15": "strong", "8064": "strong",
    "03": "em", "7462": "em", "0714": "em",
    "51": "sup", "53": "sup", "52": "sub", "54": "sub",
}
TABLE_TAGS = {"TABLE": "table", "THEAD": "thead", "TBODY": "tbody", "TFOOT": "tfoot",
              "TR": "tr", "TH": "th", "TD": "td", "CAPTION": "caption"}
SAFE_CELL_CLASSES = {"left", "right", "center"}


def _esc(text: str | None) -> str:
    return html.escape(_WS.sub(" ", text), quote=False) if text else ""


def _plain(el: ET.Element) -> str:
    return " ".join("".join(el.itertext()).split())


# ---------------------------------------------------------------------------
# Figures
# ---------------------------------------------------------------------------

# eCFR XML names figures after their Federal Register source, e.g. /graphics/er08ja26.000.gif.
# The old ecfr.gov/graphics/ path is gone; eCFR itself now serves them from the Federal
# Register's image host as PNG, which is what we link to.
_FR_IMG = re.compile(r"^/graphics/([a-z]{2}\d{2}[a-z]{2}\d{2}[a-z]?\.\d{3})\.gif$", re.IGNORECASE)


def image_urls(src: str) -> tuple[str, str] | None:
    """(inline, full-size) URLs for an eCFR figure, or None if it can't be shown."""
    m = _FR_IMG.match(src)
    if m:
        name = m.group(1).upper()
        base = f"https://img.federalregister.gov/{name}/{name}"
        return base + "_large.png", base + "_original_size.png"
    if src.startswith("/graphics/"):
        # A few dozen legacy names (e.g. "53-49a.eps.gif") have no known public URL; the reader
        # shows a fallback when this fails to load.
        url = "https://www.ecfr.gov" + src
        return url, url
    if src.startswith("https://"):
        return src, src
    return None


# ---------------------------------------------------------------------------
# Units: a long section read one clause or appendix chapter at a time
# ---------------------------------------------------------------------------

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
        return Renderer(self.linkify).render_elements(unit["elements"], self.levels)

    def full_html(self) -> str:
        """Every unit in order, each in its own anchored <section>, then the source history."""
        r = Renderer(self.linkify)
        parts = []
        for u in self.units:
            body = r.render_elements(u["elements"], self.levels)
            parts.append(f'<section class="reg-unit" id="u-{html.escape(u["key"])}" data-unit="{html.escape(u["key"])}">{body}</section>')
        if not self.units:
            parts.append(r.render_elements([c for c in self.root if c.tag not in ("HEAD", "CITA")], self.levels))
        return "".join(parts) + r.render_history(self.root)


class Renderer:
    def __init__(self, linkify: Callable[[str], str]):
        self.linkify = linkify
        self.levels_map: dict[int, int] = {}
        self.history: list[str] = []
        self.footnotes: list[str] = []
        self.para_count = 0

    # -- public -------------------------------------------------------------
    def render_elements(self, elements: list[ET.Element], levels_map: dict[int, int]) -> str:
        """One unit of a section (a clause, an appendix chapter): its elements, in a .reg-body.

        `levels_map` comes from the whole section, so a slice indents exactly as it would in
        the full text. Footnotes are per unit; CITA history is left to the full view.
        """
        self.levels_map = levels_map
        self.footnotes = []
        body = "".join(self.node(e) + self.text(e.tail) for e in elements)
        return self._wrap(body)

    def render_history(self, el: ET.Element) -> str:
        self.history = [self.children(c).strip() for c in el if c.tag == "CITA"]
        return self._history()

    def render_fragment(self, el: ET.Element) -> str:
        self.levels_map = compute_levels(el)
        out = self.children(el)
        if self.history:
            out += "".join(f'<p class="reg-cita">{h}</p>' for h in self.history)
        return out

    def _wrap(self, body: str) -> str:
        out = f'<div class="reg-body">{body}</div>'
        if self.footnotes:
            out += '<section class="reg-footnotes"><h4>Footnotes</h4>' + "".join(self.footnotes) + "</section>"
        return out

    def _history(self) -> str:
        if not self.history:
            return ""
        return ('<details class="reg-history"><summary>Source &amp; amendment history</summary>'
                + "".join(f"<p>{h}</p>" for h in self.history) + "</details>")

    # -- internals ----------------------------------------------------------
    def text(self, value: str | None) -> str:
        return self.linkify(_esc(value))

    def children(self, el: ET.Element, skip_head: bool = False) -> str:
        out = [self.text(el.text)]
        for child in el:
            if not (skip_head and child.tag == "HEAD"):
                out.append(self.node(child))
            out.append(self.text(child.tail))
        return "".join(out)

    def node(self, el: ET.Element) -> str:
        tag = el.tag
        if tag in PARA_TAGS:
            return self.paragraph(el)
        if tag in INLINE_MAP:
            t = INLINE_MAP[tag]
            return f"<{t}>{self.children(el)}</{t}>"
        if tag == "E":
            t = E_STYLES.get(el.get("T", ""), "span")
            return f"<{t}>{self.children(el)}</{t}>"
        if tag == "br":
            return "<br>"
        if tag in ("HEAD", "HD1", "HD2", "HD3"):
            level = {"HEAD": 3, "HD1": 3, "HD2": 4, "HD3": 5}[tag]
            return f'<h{level} class="reg-subhead">{self.children(el)}</h{level}>'
        if tag in ("HED", "BCAP", "TCAP"):
            return f'<p class="reg-label">{self.children(el)}</p>'
        if tag in CALLOUTS:
            return self.callout(el)
        if tag == "CITA":
            self.history.append(self.children(el).strip())
            return ""
        if tag == "FTNT":
            self.footnotes.append(f'<div class="reg-footnote">{self.children(el)}</div>')
            return ""
        if tag == "FTREF":
            return f'<span class="ftref">{self.children(el)}</span>'
        if tag == "DIV" and el.get("class") == "gpotbl_div":
            return f'<div class="table-wrap">{self.children(el)}</div>'
        if tag in TABLE_TAGS:
            return self.table_part(el)
        if tag == "img":
            urls = image_urls(el.get("src", ""))
            if not urls:
                return ""
            show, full = urls
            return (f'<a class="reg-figure" href="{html.escape(full)}" target="_blank" rel="noopener noreferrer"'
                    f' title="Open full-size figure"><img class="reg-img" loading="lazy" decoding="async"'
                    f' alt="Figure" src="{html.escape(show)}"></a>')
        if tag == "MATH":
            return f'<div class="reg-math">{self.children(el)}</div>'
        if tag == "STARS":
            return '<p class="reg-stars">* * * * *</p>'
        if tag == "FP-DASH":
            return f'<p class="reg-p reg-dash">{self.children(el)}<span class="dash-line"></span></p>'
        if tag == "XREF":
            return f'<p class="reg-amend">{self.children(el)}</p>'
        if tag == "AC":
            return ""
        if tag in ("DIV6", "DIV7", "DIV8", "DIV9"):
            return f'<section class="reg-nested">{self.children(el)}</section>'
        return f"<span>{self.children(el)}</span>"

    def callout(self, el: ET.Element) -> str:
        # An appendix embedded in a section is a document of its own, not a quoted extract:
        # render it plainly instead of inside an indented callout.
        if appendix_heading(el):
            return f'<section class="reg-appendix">{self.children(el)}</section>'
        cls, default_title = CALLOUTS[el.tag]
        has_head = len(el) and el[0].tag == "HED"
        title = "" if has_head or not default_title else f'<p class="reg-label">{default_title}</p>'
        return f'<aside class="reg-callout reg-{cls}">{title}{self.children(el)}</aside>'

    def table_part(self, el: ET.Element) -> str:
        t = TABLE_TAGS[el.tag]
        attrs = ""
        for name in ("colspan", "rowspan"):
            if el.get(name, "").isdigit():
                attrs += f' {name}="{el.get(name)}"'
        if el.get("class") in SAFE_CELL_CLASSES:
            attrs += f' class="{el.get("class")}"'
        if t == "table":
            attrs = ' class="reg-table"'
        return f"<{t}{attrs}>{self.children(el)}</{t}>"

    def paragraph(self, el: ET.Element) -> str:
        tag = el.tag
        classes = ["reg-p"]
        marker_html = ""
        body_el_text = el.text or ""
        start_index = 0
        level = 0

        m = _MARKERS.match(body_el_text)
        italic_marker = (
            body_el_text.strip() == "(" and len(el) and el[0].tag in ("I", "E")
            and (el[0].text or "").strip() and len((el[0].text or "").strip()) <= 4
            and (el[0].tail or "").startswith(")")
        )
        if tag in ("P", "FP") and m:
            markers = m.group(1)
            level = self.levels_map.get(id(el), 0)
            marker_html = f'<span class="pmark">{html.escape(markers.strip())}</span> '
            body_el_text = body_el_text[m.end():]
        elif tag in ("P", "FP") and italic_marker:
            token = el[0].text.strip()
            level = self.levels_map.get(id(el), 0)
            marker_html = f'<span class="pmark"><em>({html.escape(token)})</em></span> '
            body_el_text = el[0].tail[1:]
            start_index = 1
        elif tag in FLUSH_INDENT:
            level = FLUSH_INDENT[tag] + 1

        if level:
            classes.append(f"lvl-{level}")
        elif tag == "P" and el.get("class") == "title":
            classes.append("reg-centered")
        elif tag == "P" and el.get("class") == "headnote":
            classes.append("reg-headnote")
        elif tag == "FP":
            classes.append("reg-flush")

        body = [self.text(body_el_text)]
        for i, child in enumerate(el):
            if i < start_index:
                continue
            rendered = self.node(child)
            # "(a) <I>Definitions.</I> ..." -> bold run-in heading
            if i == start_index and marker_html and not body_el_text.strip() and child.tag in ("I", "E"):
                rendered = f'<strong class="runin">{self.children(child)}</strong>'
            body.append(rendered)
            body.append(self.text(child.tail))

        self.para_count += 1
        pid = f"p{self.para_count}"
        return f'<p class="{" ".join(classes)}" id="{pid}">{marker_html}{"".join(body).strip()}</p>'


def render_leaf_html(
    xml: str,
    known: Callable[[str], bool],
    title: int = 29,
    known_by_title: Callable[[int, str], bool] | None = None,
    installed_titles: Callable[[], list[int]] | None = None,
) -> str:
    """HTML for a section or appendix, with cross-references linked."""
    return section_doc(xml, known, title, known_by_title, installed_titles).full_html()


def section_doc(
    xml: str,
    known: Callable[[str], bool],
    title: int = 29,
    known_by_title: Callable[[int, str], bool] | None = None,
    installed_titles: Callable[[], list[int]] | None = None,
) -> SectionDoc:
    linkify = make_linkifier(known, title=title, known_by_title=known_by_title, installed_titles=installed_titles)
    return SectionDoc(xml, linkify)


def render_fragment_html(
    xml: str,
    known: Callable[[str], bool],
    title: int = 29,
    known_by_title: Callable[[int, str], bool] | None = None,
    installed_titles: Callable[[], list[int]] | None = None,
) -> str:
    """HTML for part/subpart front matter (authority, source, notes)."""
    if not xml:
        return ""
    linkify = make_linkifier(known, title=title, known_by_title=known_by_title, installed_titles=installed_titles)
    return Renderer(linkify).render_fragment(ET.fromstring(xml))
