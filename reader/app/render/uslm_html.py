"""Render stored (namespace-free) USLM XML to safe HTML.

Allowlist renderer: every element maps to a fixed tag + class, text is escaped, and the
only attribute ever emitted from source data is an `href` built here from a USLM
`/us/usc/t{N}/s{X}` reference. Everything else (`/us/pl/…`, `/us/stat/…`) renders as
plain text in a `span.usc-ref`.

`usc_href(title, section)` is shared with the CFR linkifier: the local copy
(`/usc/{t}/{s}`) when that title is installed and the section exists, else Cornell LII.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from html import escape
from urllib.parse import quote

_USC_REF = re.compile(r"^/us/usc/t(\d+)/s([0-9A-Za-z.\-–]+)")
_LEVEL_TAGS = ("subsection", "paragraph", "subparagraph", "clause", "subclause", "item", "subitem", "subsubitem")
_BLOCK = {"content": "div", "chapeau": "p", "continuation": "p", "p": "p", "sourceCredit": "p",
          "quotedContent": "blockquote", "note": "section", "notes": "div", "level": "div"}
_INLINE = {"b": "b", "i": "i", "sup": "sup", "sub": "sub", "inline": "span", "date": "span",
           "span": "span", "term": "dfn", "shortTitle": "span", "del": "del", "ins": "ins", "em": "em",
           "strong": "strong", "br": "br"}
_TABLE = {"table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col"}
_SKIP = {"toc", "layout", "meta"}
_SPAN_ATTRS = ("colspan", "rowspan")


def usc_href(title: int | str, section: str) -> tuple[str, bool]:
    """(href, is_local) for a U.S.C. section."""
    from .. import usc_store
    sec = section.replace("–", "-")
    if usc_store.has_section(int(title), sec):
        return f"/usc/{int(title)}/{quote(sec, safe='-.')}", True
    return f"https://www.law.cornell.edu/uscode/text/{int(title)}/{quote(sec, safe='-.')}", False


def _ref(el: ET.Element, inner: str) -> str:
    m = _USC_REF.match(el.get("href") or "")
    if not m:
        return f'<span class="usc-ref">{inner}</span>'
    href, local = usc_href(m.group(1), m.group(2))
    cls = "xref xref-usc xref-usc-local" if local else "xref xref-usc"
    return f'<a class="{cls}" target="_blank" rel="noopener noreferrer" href="{escape(href, quote=True)}">{inner}</a>'


def _children(el: ET.Element) -> str:
    out = [escape(el.text or "", quote=False)]
    for c in el:
        out.append(render_element(c))
        out.append(escape(c.tail or "", quote=False))
    return "".join(out)


def render_element(el: ET.Element) -> str:
    tag = el.tag.rsplit("}", 1)[-1]
    if tag in _SKIP:
        return ""
    if tag == "ref":
        return _ref(el, _children(el))
    if tag in ("num", "heading"):
        return f'<span class="usc-{tag}">{_children(el)}</span> '
    if tag in _LEVEL_TAGS:
        return f'<div class="usc-level usc-{tag}">{_children(el)}</div>'
    if tag in _BLOCK:
        cls = "usc-note-" + escape(el.get("topic") or "", quote=True) if tag == "note" else f"usc-{tag}"
        return f'<{_BLOCK[tag]} class="{cls}">{_children(el)}</{_BLOCK[tag]}>'
    if tag in _INLINE:
        t = _INLINE[tag]
        if t == "br":
            return "<br>"
        return f"<{t}>{_children(el)}</{t}>"
    if tag in _TABLE:
        attrs = "".join(f' {a}="{escape(el.get(a), quote=True)}"' for a in _SPAN_ATTRS
                        if el.get(a) and el.get(a).isdigit())
        if tag == "col":
            return "<col>"
        return f"<{tag}{attrs}>{_children(el)}</{tag}>"
    return f'<span class="usc-{escape(tag, quote=True)}">{_children(el)}</span>'


def _local(el: ET.Element) -> str:
    return el.tag.rsplit("}", 1)[-1]


def _block_html(el: ET.Element) -> str:
    """A block that interrupts the paragraph flow (table, quoted text, source credit…)."""
    if _local(el) == "table":
        return f'<div class="table-wrap">{render_element(el).replace("<table", "<table class=\"reg-table\"", 1)}</div>'
    return render_element(el)


class _FlatBody:
    """Flattens a section's nested USLM levels into the CFR reader's paragraph stream.

    Every level (subsection (a) → paragraph (1) → subparagraph (A) → clause (i) …) becomes one
    `<p class="reg-p lvl-N" id="pN">` with its number in `span.pmark` and its heading as a
    `strong.runin`, exactly the shape `render/html.Renderer.paragraph` gives CFR text — so the
    reader's measure, indents, hierarchy guides, deep links and Cite/Clip tools apply as-is.
    Quoted (amending) text and tables stay blocks; nothing inside quotedContent is flattened.
    """

    def __init__(self) -> None:
        self.out: list[str] = []
        self.n = 0
        self.run: list[str] = []
        self.mark = ""
        self.heading = ""
        self.carry = ""   # a bare number ("(5)" with no text) folds into its first child: "(5)(A)"
        self.lift = 0     # …and that paragraph keeps the outermost folded level's indent

    def flush(self, depth: int, extra: str = "") -> None:
        inner = "".join(self.run).strip()
        if self.heading:
            inner = f'<strong class="runin">{self.heading}</strong> {inner}'.rstrip()
        if inner or self.mark:
            self.n += 1
            depth -= self.lift
            cls = "reg-p" + (f" lvl-{min(depth, 6)}" if depth else "") + extra
            mark = f'<span class="pmark">{self.mark}</span> ' if self.mark else ""
            self.out.append(f'<p class="{cls}" id="p{self.n}">{(mark + inner).rstrip()}</p>')
        self.run, self.mark, self.heading, self.lift = [], "", "", 0

    def flow(self, el: ET.Element, depth: int) -> None:
        """Inline text of a content/chapeau/continuation; its own <p>s become paragraphs."""
        self.run.append(escape(el.text or "", quote=False))
        for c in el:
            tag = _local(c)
            if tag in _SKIP:
                pass
            elif tag == "p":
                if "".join(self.run).strip():
                    self.flush(depth)
                self.flow(c, depth)
                self.flush(depth)
            elif tag in _LEVEL_TAGS:
                self.flush(depth)
                self.level(c, depth + 1)
            elif tag in _INLINE or tag == "ref":
                self.run.append(render_element(c))
            else:
                self.flush(depth)
                self.out.append(_block_html(c))
            self.run.append(escape(c.tail or "", quote=False))

    def level(self, el: ET.Element, depth: int, *, root: bool = False) -> None:
        for c in el:
            tag = _local(c)
            if tag in _SKIP or (tag in ("notes", "note") and root):
                continue
            if tag in ("num", "heading"):
                if not root:
                    text = _children(c).strip()
                    if tag == "num":
                        self.mark, self.carry = self.carry + text, ""
                    else:
                        self.heading = text
            elif tag in _LEVEL_TAGS:
                if self.mark and not self.heading and not "".join(self.run).strip():
                    self.carry, self.mark, self.run = self.mark, "", []
                    self.lift += 1
                else:
                    self.flush(depth)
                self.level(c, depth + 1)
            elif tag in ("content", "chapeau"):
                self.flow(c, depth)
            elif tag == "continuation":
                self.flush(depth)
                self.flow(c, depth)
                self.flush(depth, " reg-continuation")
            elif tag == "p":
                self.flow(c, depth)
                self.flush(depth)
            else:
                self.flush(depth)
                self.out.append(_block_html(c))
        self.flush(depth)


def render_body(xml: str) -> str:
    """A stored section's body (everything but its own num and heading) as flat CFR-style paragraphs."""
    flat = _FlatBody()
    flat.level(ET.fromstring(xml), 0, root=True)
    return "".join(flat.out)


def render_fragment(xml: str) -> str:
    return render_element(ET.fromstring(xml))
