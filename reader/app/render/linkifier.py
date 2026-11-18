"""Cross-reference & citation links: CFR, U.S.C., FR, web URLs."""
from __future__ import annotations

import re
from html import escape
from typing import Callable
from urllib.parse import quote

from ..citations.parser import (
    CONTEXT_BARE_SEC_RE,
    CROSS_TITLE_EXT_RE,
    CROSS_TITLE_PARTS_RE,
    CROSS_TITLE_RE,
    FR_RE,
    NUM_IN_LIST_RE,
    PARA_OF_SEC_RE,
    PARA_SELF_RE,
    PART_NUM,
    SEC_TOKEN,
    SECTION_ITEM_RE,
    USC_RE,
    WEB_URL_RE,
    WORD_PART_RE,
    WORD_SEC_EXT_RE,
    WORD_SEC_RE,
    XREF_EXT_RE,
    XREF_RE,
    clean_url_tail,
    expand_paragraph_list,
    parse_usc_targets,
    split_part_range,
)

# Re-export grammar symbols kept for compatibility (app.render, app.news)
_XREF = XREF_RE
_WORD_SEC = WORD_SEC_RE
_NUM_IN_LIST = NUM_IN_LIST_RE
_CROSS_TITLE = CROSS_TITLE_RE
_WEB_URL = WEB_URL_RE
_USC = USC_RE
_FR = FR_RE
_WORD_PART = WORD_PART_RE

_TAG_SPLIT = re.compile(r"(<[^>]+>)")
_ANCHOR_SPLIT = re.compile(r"(<a\b[^>]*>.*?</a>)", re.IGNORECASE | re.DOTALL)

# Canonical semantic CSS classes emitted by the linkifier and styled in 07_reader.css
SEMANTIC_XREF_CLASSES = (
    "xref",
    "xref-part",
    "xref-local",
    "xref-cross",
    "xref-external",
    "xref-usc",
    "xref-fr",
    "xref-web",
    "xref-state",
    "xref-county",
)


def _outside_anchors(text: str, fn: Callable[[str], str]) -> str:
    """Apply `fn` to the parts of `text` that are not already inside an `<a>…</a>`."""
    if "<a" not in text:
        return fn(text)
    return "".join(piece if piece.lower().startswith("<a") else fn(piece)
                   for piece in _ANCHOR_SPLIT.split(text) if piece)


def _norm_para(para: str) -> str:
    return para.strip()


def make_linkifier(
    known: Callable[[str], bool],
    title: int = 29,
    known_by_title: Callable[[int, str], bool] | None = None,
    installed_titles: Callable[[], list[int]] | None = None,
    known_parts: Callable[[str], bool] | None = None,
    section_id: str | None = None,
) -> Callable[[str], str]:
    """Build a linkifier function converting internal/cross-title citations, U.S.C., FR, and web URLs into links."""

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

    def is_part_known_local(part_id: str) -> bool:
        if known_parts is not None:
            return known_parts(part_id)
        return True

    def ecfr_part_anchor(t_num: int, part_id: str, label: str, is_cross: bool = False) -> str:
        installed = is_title_installed(t_num)
        if installed:
            href = f"#/title/{t_num}/part/{quote(part_id, safe='.-')}"
            cls = "xref xref-cross" if (is_cross or t_num != title) else "xref xref-part"
            return f'<a class="{cls}" href="{href}">{label}</a>'
        href = f"https://www.ecfr.gov/current/title-{t_num}/part-{quote(part_id, safe='.-')}"
        part_esc = escape(part_id, quote=True)
        return (f'<a class="xref xref-external" data-cfr-title="{t_num}" data-cfr-part="{part_esc}"'
                f' target="_blank" rel="noopener noreferrer" title="Title {t_num} not installed - click to download or view on eCFR"'
                f' href="{href}">{label}</a>')

    def cfr_section_anchor(t_num: int, sec_id: str, para: str, display: str, require_known: bool = True) -> str | None:
        clean_para = _norm_para(para)
        installed = is_title_installed(t_num)
        is_current = t_num == title
        if is_current:
            if not known(sec_id):
                return None
            href = f"#/title/{title}/section/{quote(sec_id, safe='.-')}" + (f"?p={quote(clean_para)}" if clean_para else "")
            return f'<a class="xref" href="{href}">{display}</a>'
        if installed and is_section_known(t_num, sec_id):
            href = f"#/title/{t_num}/section/{quote(sec_id, safe='.-')}" + (f"?p={quote(clean_para)}" if clean_para else "")
            return f'<a class="xref xref-cross" href="{href}">{display}</a>'
        href = f"https://www.ecfr.gov/current/title-{t_num}/section-{quote(sec_id, safe='.-')}"
        sec_esc = escape(sec_id, quote=True)
        part_guess = sec_id.split(".", 1)[0] if "." in sec_id else ""
        part_attr = f' data-cfr-part="{escape(part_guess, quote=True)}"' if part_guess else ""
        para_attr = f' data-cfr-para="{escape(clean_para, quote=True)}"' if clean_para else ""
        title_attr = f"Title {t_num} not installed - click to download or view on eCFR" if not installed else f"Section {sec_id} not in installed copy of Title {t_num} - click to download or view on eCFR"
        return (f'<a class="xref xref-external" data-cfr-title="{t_num}" data-cfr-section="{sec_esc}"{part_attr}{para_attr}'
                f' target="_blank" rel="noopener noreferrer" title="{escape(title_attr, quote=True)}" href="{href}">{display}</a>')

    _RANGE_PAIR_RE = re.compile(rf"({SEC_TOKEN})-({SEC_TOKEN})")

    def link_section_item(t_num: int, raw_id: str, para: str, display_prefix: str = "") -> str:
        """Link a single section item or a hyphenated range like '4.7-4.9' or '50-201.1-50-201.5'."""
        if "-" in raw_id and not (is_title_installed(t_num) and is_section_known(t_num, raw_id)):
            rm = _RANGE_PAIR_RE.fullmatch(raw_id)
            if rm:
                left, right = rm.group(1), rm.group(2)
                a_left = cfr_section_anchor(t_num, left, "", f"{display_prefix}{left}")
                a_right = cfr_section_anchor(t_num, right, para, f"{right}{para}")
                if a_left or a_right:
                    return f"{a_left or display_prefix + left}-{a_right or right + para}"
        display = f"{display_prefix}{raw_id}{para}"
        return cfr_section_anchor(t_num, raw_id, para, display) or display

    def link_cross_parts(m: re.Match) -> str:
        t_num = int(m.group(1))
        prefix_kw = m.group(2)
        parts_expr = m.group(3)
        plural_pfx = prefix_kw.strip().lower().endswith("s")
        tokens = list(re.finditer(rf"({PART_NUM})", parts_expr))
        # Preserve original single-link shape for "40 CFR part 262"
        if len(tokens) == 1 and "-" not in tokens[0].group(1) and not plural_pfx:
            return ecfr_part_anchor(t_num, tokens[0].group(1), m.group(0), is_cross=True)

        def repl_part(pm: re.Match) -> str:
            tok = pm.group(1)
            expanded = split_part_range(tok, plural_pfx)
            if len(expanded) == 2:
                return f"{ecfr_part_anchor(t_num, expanded[0], expanded[0], is_cross=True)}-{ecfr_part_anchor(t_num, expanded[1], expanded[1], is_cross=True)}"
            return ecfr_part_anchor(t_num, expanded[0], tok, is_cross=True)

        linked = re.sub(rf"({PART_NUM})", repl_part, parts_expr)
        return f"{m.group(0)[:len(m.group(0)) - len(parts_expr)]}{linked}"

    def link_cross_sections(m: re.Match) -> str:
        t_num = int(m.group(1))
        sec_prefix = m.group(2)
        sec_list = m.group(3)
        bare_list = m.group(4)
        bare_hyphen_part = m.group(5)

        if bare_hyphen_part:
            return ecfr_part_anchor(t_num, bare_hyphen_part, m.group(0), is_cross=True)

        lead = m.group(0)[:len(m.group(0)) - len(sec_list or bare_list or "")]
        if sec_list:
            linked = SECTION_ITEM_RE.sub(lambda im: link_section_item(t_num, im.group(1), im.group(2)), sec_list)
            return f"{lead}{linked}"

        if bare_list:
            items = list(SECTION_ITEM_RE.finditer(bare_list))
            if len(items) == 1 and items[0].start() == 0 and items[0].end() == len(bare_list):
                im = items[0]
                return link_section_item(t_num, im.group(1), im.group(2), display_prefix=lead)
            linked = SECTION_ITEM_RE.sub(lambda im: link_section_item(t_num, im.group(1), im.group(2)), bare_list)
            return f"{lead}{linked}"

        return m.group(0)

    def link_internal_list(m: re.Match) -> str:
        prefix, body = m.group(1), m.group(2)
        return prefix + SECTION_ITEM_RE.sub(lambda im: link_section_item(title, im.group(1), im.group(2)), body)

    def link_internal_parts(m: re.Match) -> str:
        prefix, body = m.group(1), m.group(2)
        plural_pfx = prefix.strip().lower().endswith("s")

        def repl_part(pm: re.Match) -> str:
            tok = pm.group(1)
            expanded = split_part_range(tok, plural_pfx, is_known_part=is_part_known_local if known_parts else None)
            if len(expanded) == 2:
                a1 = ecfr_part_anchor(title, expanded[0], expanded[0]) if is_part_known_local(expanded[0]) else expanded[0]
                a2 = ecfr_part_anchor(title, expanded[1], expanded[1]) if is_part_known_local(expanded[1]) else expanded[1]
                return f"{a1}-{a2}"
            pid = expanded[0]
            if not is_part_known_local(pid):
                return tok
            return ecfr_part_anchor(title, pid, tok)

        tokens = list(re.finditer(rf"({PART_NUM})", body))
        if len(tokens) == 1 and not plural_pfx:
            tok = tokens[0].group(1)
            expanded = split_part_range(tok, False, is_known_part=is_part_known_local if known_parts else None)
            if len(expanded) == 1 and is_part_known_local(expanded[0]):
                return ecfr_part_anchor(title, expanded[0], m.group(0))
            if len(expanded) == 1 and not is_part_known_local(expanded[0]):
                return m.group(0)
        return prefix + re.sub(rf"({PART_NUM})", repl_part, body)

    def transform_text_chunk(text: str, allow_self_para: bool = True) -> str:
        """Run all link transformations sequentially outside existing <a>...</a> tags."""
        if not text:
            return ""
        low = text.lower()

        # A. Web URLs: https://... or www.... (trimming trailing punctuation cleanly)
        if "http" in low or "www." in low:
            def replace_url(m: re.Match) -> str:
                clean, tail = clean_url_tail(m.group(1))
                if not clean:
                    return m.group(0)
                href = f"https://{clean}" if clean.lower().startswith("www.") else clean
                return f'<a class="xref xref-web" target="_blank" rel="noopener noreferrer" href="{href}">{clean}</a>{tail}'
            text = _outside_anchors(text, lambda t: WEB_URL_RE.sub(replace_url, t))
            low = text.lower()

        # B. U.S. Code: e.g. 29 U.S.C. 653, 42 U.S.C. 2000ff(4), 29 U.S.C. §§ 655, 657
        if "u.s.c" in low or "usc" in low:
            def replace_usc(m: re.Match) -> str:
                u_title, opt_kw, expr = m.group(1), m.group(2) or "", m.group(3)
                targets = parse_usc_targets(expr)
                if len(targets) == 1 and expr.strip() == targets[0][2]:
                    core, _, _ = targets[0]
                    href = f"https://www.law.cornell.edu/uscode/text/{u_title}/{core}"
                    return f'<a class="xref xref-usc" target="_blank" rel="noopener noreferrer" title="View {u_title} U.S.C. {core} at Cornell LII" href="{href}">{m.group(0)}</a>'

                def repl_usc_item(um: re.Match) -> str:
                    raw = um.group(0)
                    parsed = parse_usc_targets(raw)
                    if len(parsed) == 2:
                        (c1, _, _), (c2, _, _) = parsed
                        return (
                            f'<a class="xref xref-usc" target="_blank" rel="noopener noreferrer" title="View {u_title} U.S.C. {c1} at Cornell LII" href="https://www.law.cornell.edu/uscode/text/{u_title}/{c1}">{c1}</a>-'
                            f'<a class="xref xref-usc" target="_blank" rel="noopener noreferrer" title="View {u_title} U.S.C. {c2} at Cornell LII" href="https://www.law.cornell.edu/uscode/text/{u_title}/{c2}">{c2}</a>'
                        )
                    core = parsed[0][0]
                    href = f"https://www.law.cornell.edu/uscode/text/{u_title}/{core}"
                    return f'<a class="xref xref-usc" target="_blank" rel="noopener noreferrer" title="View {u_title} U.S.C. {core} at Cornell LII" href="{href}">{raw}</a>'

                prefix = m.group(0)[:len(m.group(0)) - len(expr)]
                linked = re.sub(r"[0-9]+[a-z]*(?:-[0-9]+[a-z]*)*(?:\([a-zA-Z0-9]{1,4}\))*", repl_usc_item, expr)
                return f"{prefix}{linked}"
            text = _outside_anchors(text, lambda t: USC_RE.sub(replace_usc, t))
            low = text.lower()

        # C. Federal Register: e.g. 39 FR 23502
        if " fr " in low:
            def replace_fr(m: re.Match) -> str:
                vol, page = m.group(1), m.group(2)
                href = f"https://www.federalregister.gov/citation/{vol}-FR-{page}"
                return f'<a class="xref xref-fr" target="_blank" rel="noopener noreferrer" title="View Federal Register citation {vol} FR {page}" href="{href}">{m.group(0)}</a>'
            text = _outside_anchors(text, lambda t: FR_RE.sub(replace_fr, t))
            low = text.lower()

        # D. Cross-Title CFR Parts & Sections (plural chains + bare lists + hyphenated parts)
        if "cfr" in low or "c.f.r" in low:
            text = _outside_anchors(text, lambda t: CROSS_TITLE_PARTS_RE.sub(link_cross_parts, t))
            text = _outside_anchors(text, lambda t: CROSS_TITLE_EXT_RE.sub(link_cross_sections, t))
            low = text.lower()

        def _map_tuples(p_expr: str, anchor_fn: Callable[[str, str], str | None]) -> str:
            items = expand_paragraph_list(p_expr)
            out: list[str] = []
            last = 0
            for idx, pm in enumerate(re.finditer(r"(?:\([a-zA-Z0-9]{1,4}\))+", p_expr)):
                out.append(p_expr[last:pm.start()])
                raw_tok, full_tok = items[idx]
                out.append(anchor_fn(raw_tok, full_tok) or raw_tok)
                last = pm.end()
            out.append(p_expr[last:])
            return "".join(out)

        # D2. Paragraph-of-Section references: e.g. "paragraph (a)(3) of § 1910.401"
        if "paragraph" in low:
            def replace_para_of_sec(m: re.Match) -> str:
                pfx, p_expr, connector, sec_id = m.group(1), m.group(2), m.group(3), m.group(4)
                if not known(sec_id):
                    return m.group(0)
                linked_p = _map_tuples(p_expr, lambda raw_tok, full_tok: cfr_section_anchor(title, sec_id, full_tok, raw_tok))
                return f"{pfx}{linked_p}{connector}{sec_id}"
            text = _outside_anchors(text, lambda t: PARA_OF_SEC_RE.sub(replace_para_of_sec, t))

        # E. Internal bare § / §§ citations for current title
        if "§" in text:
            text = _outside_anchors(text, lambda t: XREF_EXT_RE.sub(link_internal_list, t))

        # F. Word-based section citations: e.g. "section 1910.120"
        if "section" in low:
            text = _outside_anchors(text, lambda t: WORD_SEC_EXT_RE.sub(link_internal_list, t))

        # F2. Contextual un-prefixed section citations: e.g. "comply with 1910.134"
        if "." in text:
            def replace_bare_sec(m: re.Match) -> str:
                lead, sec_id, para = m.group(1), m.group(2), m.group(3)
                anchored = cfr_section_anchor(title, sec_id, para, f"{sec_id}{para}")
                return f"{lead}{anchored}" if anchored else m.group(0)
            text = _outside_anchors(text, lambda t: CONTEXT_BARE_SEC_RE.sub(replace_bare_sec, t))

        # G. Validated Internal Part citations: e.g. "Part 1910", "Parts 1910 and 1926"
        if "part" in low:
            text = _outside_anchors(text, lambda t: WORD_PART_RE.sub(link_internal_parts, t))

        # H. Self-referential paragraphs: e.g. "paragraph (c)(1) of this section"
        if allow_self_para and section_id and known(section_id) and "paragraph" in low:
            def replace_para_self(m: re.Match) -> str:
                pfx, p_expr, sfx = m.group(1), m.group(2), m.group(3)
                def _local_anchor(raw_tok: str, full_tok: str) -> str:
                    href = f"#/title/{title}/section/{quote(section_id, safe='.-')}?p={quote(full_tok)}"
                    return f'<a class="xref xref-local" data-local-para="{full_tok}" href="{href}">{raw_tok}</a>'
                return f"{pfx}{_map_tuples(p_expr, _local_anchor)}{sfx}"
            text = _outside_anchors(text, lambda t: PARA_SELF_RE.sub(replace_para_self, t))

        return text

    def _run_linkify(escaped: str, allow_self_para: bool = True) -> str:
        if not escaped:
            return escaped

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
                    out.append(transform_text_chunk(piece, allow_self_para=allow_self_para))

        return "".join(out)

    def linkify(escaped: str) -> str:
        return _run_linkify(escaped, allow_self_para=True)

    linkify.without_self = lambda escaped: _run_linkify(escaped, allow_self_para=False)  # type: ignore[attr-defined]
    return linkify
