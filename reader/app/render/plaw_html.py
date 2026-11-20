"""Render a Public Law's USLM XML (GovInfo PLAW) as reading units of safe HTML.

A law is read a section at a time, like the U.S. Code: every `<section>` of the law
(SEC. 1., SEC. 2. …) is one unit, wherever it sits (inside a division, title or subtitle;
those become each unit's group label). Text before the first section (the long title and
the enacting clause) is its own "Preamble" unit. Inside a section the levels flatten into
the reader's paragraph stream through `uslm_html._FlatBody`, so indents, Cite marks and
the allowlist rendering (escaped text, hrefs built only from `/us/usc/…` references) are
the U.S. Code's own. Margin notes (`sidenote`, e.g. "42 USC 6921 note.") render as small
`.plaw-sidenote` lines; they are where GPO records the codification.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from html import escape

from .uslm_html import _FlatBody, _children, _plain

_GROUPS = ("division", "title", "subtitle", "part", "subpart", "chapter", "subchapter")


def _strip_ns(root: ET.Element) -> ET.Element:
    for el in root.iter():
        if isinstance(el.tag, str) and "}" in el.tag:
            el.tag = el.tag.rsplit("}", 1)[1]
        for k in [k for k in el.attrib if "}" in k]:
            el.attrib[k.rsplit("}", 1)[1]] = el.attrib.pop(k)
    return root


def _sidenotes_to_blocks(root: ET.Element) -> None:
    """Rename sidenotes so the flattener emits them as their own small block."""
    for el in list(root.iter("sidenote")):
        text = " ".join("".join(el.itertext()).split())
        for c in list(el):
            el.remove(c)
        el.tag, el.text = "plawSidenote", text


def _child_text(el: ET.Element, tag: str) -> str:
    c = el.find(tag)
    return _plain(_children(c)) if c is not None else ""


def _section_html(sec: ET.Element) -> str:
    flat = _FlatBody()
    flat.level(sec, 0, root=True)
    html = "".join(flat.out)
    # Sidenotes hold plain text only (see _sidenotes_to_blocks), so this span never nests.
    return re.sub(r'<span class="usc-plawSidenote">([^<]*)</span>', r'<p class="plaw-sidenote">\1</p>', html)


def _plain_block(el: ET.Element) -> list[str]:
    """A preamble element as paragraphs: its text, then each margin note on its own line."""
    notes = []
    for parent in el.iter():
        for c in list(parent):
            if c.tag == "plawSidenote":
                notes.append(_plain(_children(c)))
                tail = c.tail or ""
                parent.remove(c)
                if tail:
                    parent.text = (parent.text or "") + tail
    out = []
    text = _plain(_children(el))
    if text:
        out.append(f'<p class="reg-p plaw-preamble">{escape(text, quote=False)}</p>')
    out += [f'<p class="plaw-sidenote">{escape(n, quote=False)}</p>' for n in notes if n]
    return out


def law_units(xml: str | bytes) -> list[dict]:
    """[{key, label, title, kind, group, group_label, group_title, chars, html}] in reading order."""
    root = _strip_ns(ET.fromstring(xml))
    _sidenotes_to_blocks(root)
    main = root.find(".//main")
    if main is None:
        main = root
    units: list[dict] = []
    pre: list[str] = []

    def add(key: str, label: str, title: str, html: str, groups: list[tuple[str, str]]) -> None:
        g_label = " · ".join(f"{n} {h}".strip() if h else n for n, h in groups)
        units.append({"key": key, "label": label, "title": title, "kind": "clause",
                      "group": groups[-1][0] if groups else None, "group_label": g_label or None,
                      "group_title": groups[-1][1] if groups else None,
                      "chars": len(_plain(html)), "html": html})

    def walk(el: ET.Element, groups: list[tuple[str, str]]) -> None:
        for c in el:
            tag = c.tag
            if tag == "section":
                num = _child_text(c, "num").rstrip(".")
                heading = _child_text(c, "heading").rstrip(".")
                n = len([u for u in units if u["key"].startswith("s")]) + 1
                add(f"s{n}", num or f"Sec. {n}", heading, _section_html(c), groups)
            elif tag in _GROUPS:
                walk(c, groups + [(_child_text(c, "num"), _child_text(c, "heading"))])
            elif tag in ("num", "heading", "toc", "layout", "meta"):
                continue
            elif not units:
                pre.extend(_plain_block(c))

    walk(main, [])
    if pre:
        units.insert(0, {"key": "preamble", "label": "Preamble", "title": "Title and enacting clause", "kind": "clause",
                         "group": None, "group_label": None, "group_title": None,
                         "chars": sum(len(p) for p in pre), "html": "".join(pre)})
    if not units:
        text = _plain(_children(main))
        units.append({"key": "text", "label": "", "title": "Text", "kind": "clause", "group": None,
                      "group_label": None, "group_title": None, "chars": len(text),
                      "html": f'<p class="reg-p">{escape(text, quote=False)}</p>'})
    return units
