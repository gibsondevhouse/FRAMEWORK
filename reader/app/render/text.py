"""Plain-text flattening of eCFR XML (for search and Claude), plus shared text helpers."""
from __future__ import annotations

import html
import re
import xml.etree.ElementTree as ET

BLOCK_TAGS = {
    "P", "FP", "FP-1", "FP-2", "FP1-2", "FP2-3", "FP-DASH", "P-2", "FL-2", "FRP",
    "HEAD", "HD1", "HD2", "HD3", "HED", "PSPACE", "CITA", "TR", "CAPTION", "BCAP", "TCAP",
    "NOTE", "EXTRACT", "EXAMPLE", "FTNT", "AUTH", "SOURCE", "SECAUTH", "APPRO", "EDNOTE",
    "EFFDNOT", "CROSSREF", "STARS", "DIV", "MATH",
}
CELL_TAGS = {"TD", "TH"}
_WS = re.compile(r"[ \t\r\n\u00a0]+")
_INLINE_HTML_TAG = re.compile(r"</?(?:span|em|strong|i|b|sup|sub|small|u)\b[^>]*>", re.IGNORECASE)


def clean_label(text: str | None) -> str:
    """Strip inline formatting tags leaked from eCFR structure JSON and normalize spaces."""
    if not text:
        return ""
    cleaned = _INLINE_HTML_TAG.sub("", html.unescape(text))
    return _WS.sub(" ", cleaned).strip()


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


def _esc(text: str | None) -> str:
    return html.escape(_WS.sub(" ", text), quote=False) if text else ""


def _plain(el: ET.Element) -> str:
    return " ".join("".join(el.itertext()).split())
