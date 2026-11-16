"""Cross-reference & citation links: CFR, U.S.C., FR, web URLs."""
from __future__ import annotations

import re
from typing import Callable
from urllib.parse import quote

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
