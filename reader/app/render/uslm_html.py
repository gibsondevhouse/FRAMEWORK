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


def render_body(xml: str) -> str:
    """A stored section's body: everything but its own num and heading."""
    root = ET.fromstring(xml)
    out = [escape(root.text or "", quote=False).strip()]
    for c in root:
        if c.tag not in ("num", "heading"):
            out.append(render_element(c))
        out.append(escape(c.tail or "", quote=False))
    return "".join(out).strip()


def render_fragment(xml: str) -> str:
    return render_element(ET.fromstring(xml))
