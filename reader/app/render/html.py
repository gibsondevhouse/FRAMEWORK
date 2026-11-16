"""HTML rendering: the Renderer, figures, and the leaf/fragment entry points."""
from __future__ import annotations

import html
import re
import xml.etree.ElementTree as ET
from typing import Callable

from .hierarchy import _MARKERS, compute_levels
from .linkifier import make_linkifier
from .text import _esc
from .units import appendix_heading, section_doc

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
