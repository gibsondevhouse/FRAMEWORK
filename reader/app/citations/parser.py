"""Canonical grammar and typed span extraction for CFR, U.S.C., FR, Web URLs, and internal targets."""
from __future__ import annotations

import re
from dataclasses import dataclass

# Core section & paragraph tokens (exported for linkifier & news compatibility)
SEC_NUM = r"\d{1,4}\.\d+(?:-\d+(?!\.))?[a-z]?"
SEC_TOKEN = r"(?:\d{2}-)?" + SEC_NUM
PARA_OPT = r"(?:\([a-zA-Z0-9]{1,4}\)|(?:\s\((?:[a-z0-9]{1,3}|[A-Z])\))(?:\([a-zA-Z0-9]{1,4}\))*)*"
LIST_SEP = r"(?:\s*[,;]\s*(?:(?:and|or)\s+)?|\s+(?:and|or|through|to)\s+)"

PART_NUM = r"\d{1,4}(?:-\d+)?[a-zA-Z]?"
PART_SEP = r"(?:\s*,\s*(?:(?:and|or)\s+)?(?:parts?\s+)?|\s+(?:and|or|through|to)\s+(?-i:parts?\s+)?)"

# Legacy-compatible patterns (groups preserved for news.py)
XREF_RE = re.compile(rf"(§§?\s*)({SEC_NUM}(?:\([a-zA-Z0-9]{{1,4}}\))*(?:(?:{LIST_SEP}){SEC_NUM}(?:\([a-zA-Z0-9]{{1,4}}\))*)?)")
WORD_SEC_RE = re.compile(
    rf"\b(sections?\s+)({SEC_NUM}(?:\([a-zA-Z0-9]{{1,4}}\))*(?:(?:{LIST_SEP}){SEC_NUM}(?:\([a-zA-Z0-9]{{1,4}}\))*)?)",
    re.IGNORECASE,
)
NUM_IN_LIST_RE = re.compile(rf"({SEC_TOKEN})({PARA_OPT})")
SECTION_ITEM_RE = re.compile(rf"({SEC_TOKEN}(?:-{SEC_NUM})?)({PARA_OPT})")

# Preserves exact group(1..5) layout expected by app.news.extract_citations
CROSS_TITLE_RE = re.compile(
    rf"\b(\d{{1,2}})\s*C\.?F\.?R\.?\s*(?:(part\s+\d+)|(§§?\s*)({SEC_NUM}(?:\([a-zA-Z0-9]{{1,4}}\))*(?:(?:{LIST_SEP}){SEC_NUM}(?:\([a-zA-Z0-9]{{1,4}}\))*)*)|({SEC_NUM}(?:\([a-zA-Z0-9]{{1,4}}\))*))(?:\b|(?<=\)))",
    re.IGNORECASE,
)

# Extended patterns for rich reader linkification (guarding next item against stealing new Title N CFR/U.S.C.)
_SEC_ITEM_EXPR = rf"{SEC_TOKEN}(?:-{SEC_NUM})?{PARA_OPT}"
_PART_FOLLOW_ITEM = rf"{PART_NUM}(?!\s*C\.?F\.?R\.?)"
XREF_EXT_RE = re.compile(
    rf"(§§?\s*)({_SEC_ITEM_EXPR}(?:{LIST_SEP}(?!\d{{1,2}}\s*C\.?F\.?R\.?){_SEC_ITEM_EXPR})*)",
    re.IGNORECASE,
)
WORD_SEC_EXT_RE = re.compile(
    rf"\b(sections?\s+)({_SEC_ITEM_EXPR}(?:{LIST_SEP}(?!\d{{1,2}}\s*C\.?F\.?R\.?){_SEC_ITEM_EXPR})*)",
    re.IGNORECASE,
)
CROSS_TITLE_PARTS_RE = re.compile(
    rf"\b(\d{{1,2}})\s*C\.?F\.?R\.?\s*(parts?\s+)({PART_NUM}(?:{PART_SEP}{_PART_FOLLOW_ITEM})*)\b",
    re.IGNORECASE,
)
CROSS_TITLE_EXT_RE = re.compile(
    rf"\b(\d{{1,2}})\s*C\.?F\.?R\.?\s*(?:(§§?\s*)({_SEC_ITEM_EXPR}(?:{LIST_SEP}(?!\d{{1,2}}\s*C\.?F\.?R\.?){_SEC_ITEM_EXPR})*)|({SEC_TOKEN}{PARA_OPT}(?:\s*(?:,\s*(?:and\s+|or\s+)?|\s+(?:and|or|through|to)\s+)(?!\d{{1,2}}\s*C\.?F\.?R\.?){SEC_TOKEN}{PARA_OPT})*)|(\d{{2}}-\d{{3,4}}(?!\.)))(?:\b|(?<=\)))",
    re.IGNORECASE,
)

WEB_URL_RE = re.compile(r'\b((?:https?://|www\.)[^\s<>"]+)', re.IGNORECASE)

# U.S. Code: supports multi-letter sections (42 U.S.C. 2000ff, 2000gg-2), lists (§§ 655, 657), ranges (651-678)
_USC_SEC = r"[0-9]+[a-z]*(?:-[0-9]+[a-z]*)?"
_USC_SEP = r"(?:\s*,\s*(?:(?:and|or)\s+)?|\s+(?:and|or|through|to)\s+)"
USC_RE = re.compile(
    rf"\b(\d{{1,2}})\s*U\.?S\.?C\.?(?:A\.?)?\s*(?:(§§?\s*|sections?\s*|sec\.?\s*)?)({_USC_SEC}(?:\([a-zA-Z0-9]{{1,4}}\))*(?:{_USC_SEP}(?!\d{{1,2}}\s*U\.?S\.?C\.?){_USC_SEC}(?:\([a-zA-Z0-9]{{1,4}}\))*)*)\b",
    re.IGNORECASE,
)

FR_RE = re.compile(r"\b(\d{1,3})\s*FR\s*([0-9]+)\b", re.IGNORECASE)
WORD_PART_RE = re.compile(rf"\b(parts?\s+)({PART_NUM}(?:{PART_SEP}{_PART_FOLLOW_ITEM})*)\b", re.IGNORECASE)
CONTEXT_BARE_SEC_RE = re.compile(
    r"(?<!\$)\b(comply(?:ing)?\s+with\s+|in\s+accordance\s+with\s+|pursuant\s+to\s+|under\s+|see\s+)(\d{3,4}\.\d+[a-z]?)((?:\([a-zA-Z0-9]{1,4}\))*)(?:\b|(?<=\)))(?!\s*(?:%|percent|mg|µg|ug|g\b|kg|lb|lbs|mm|cm|m\b|km|ft|in\b|yd|mi|ppm|ppb|psi|kPa|dB|Hz|kHz|V\b|kV|mA|A\b|W\b|kW|hours?|hrs?|days?|years?|yrs?|months?))",
    re.IGNORECASE,
)

_P_TUPLE = r"(?:\([a-zA-Z0-9]{1,4}\))+"
_P_SEP = r"(?:\s*,\s*(?:(?:and|or)\s+)?|\s+(?:and|or|through|to)\s+)"
PARA_OF_SEC_RE = re.compile(
    rf"\b(paragraphs?\s+)({_P_TUPLE}(?:{_P_SEP}{_P_TUPLE})*)(\s+(?:of|to|in|under)\s+(?:§§?\s*|sections?\s+))({SEC_NUM})\b",
    re.IGNORECASE,
)
PARA_SELF_RE = re.compile(
    rf"\b(paragraphs?\s+)({_P_TUPLE}(?:{_P_SEP}{_P_TUPLE})*)(\s+of\s+this\s+(?:section|standard)\b|(?=(?:\s*[,;:.]|\s+(?:above|below|unless|where|shall|must|may|is|are)\b)))",
    re.IGNORECASE,
)


# --- Whole-citation forms for the canonical-ID resolver (app.ids, DM-101) ------------------
# Additive: nothing above changes and the reader links nothing new. `app.ids` applies these
# with `fullmatch` to one short, length-capped string. Every quantifier is bounded and no two
# adjacent pieces can match the same text, so matching time is linear in the input.
DASH = r"[-\u2010-\u2015]"   # hyphen-minus plus the Unicode hyphens and dashes the sources print

# A complete eCFR section identifier, including the forms the prose patterns stop short of:
# "2584.8477(e)-1", "1.401(a)(4)-1", "60-1.1", "240.10b-5", "100.30-100.32". Parentheses
# belong to the identifier only when a "-suffix" follows; otherwise they are a paragraph.
CFR_SECTION_ID_RE = re.compile(
    r"\d{1,5}(?:-\d{1,4})?[A-Za-z]?\.\d[0-9A-Za-z]{0,11}"
    r"(?:(?:\([0-9A-Za-z]{1,4}\)){1,4}(?=-)|[-.][0-9A-Za-z]{1,12}){0,6}"
)
# "5 U.S.C. App. § 3", "28 U.S.C. App. App-rule1": an appendix title (5a, 11a, 18a, 28a).
USC_APPENDIX_RE = re.compile(
    r"\b(\d{1,2})\s?U\.?\s?S\.?\s?C\.?\s{0,2}App(?:endix|\.)?\s{0,2}(?:§{1,2}\s{0,2})?"
    r"([0-9A-Za-z][0-9A-Za-z.~-]{0,79})((?:\([0-9A-Za-z]{1,8}\)){0,10})",
    re.IGNORECASE,
)
# "91 FR 60123", "91 Fed. Reg. 60123" (FR_RE above stays the reader's pattern).
FR_CITE_RE = re.compile(r"\b(\d{1,3})\s{0,2}(?:FR|F\.\s?R\.|Fed\.?\s{0,2}Reg\.?)\s{0,2}(\d{1,6})\b", re.IGNORECASE)
# "FR Doc. 2026-20001", "FR Doc. No. E9-12345".
FR_DOC_RE = re.compile(
    r"\bFR\s{0,2}Doc(?:ument)?\.?\s{0,2}(?:No\.?\s{0,2})?([A-Za-z0-9](?:[A-Za-z0-9._-]{0,38}[A-Za-z0-9])?)",
    re.IGNORECASE,
)
# "Pub. L. 91-596", "Public Law 91–596", "Pub. L. No. 118-5", "P.L. 104-4", "Priv. L. 113-1".
# Groups: 1 = Pub… / Priv… (None for the "P.L." form), 2 = Congress, 3 = law number.
PUBLIC_LAW_RE = re.compile(
    rf"\b(?:(Pub(?:lic)?|Priv(?:ate)?)\.?\s{{0,2}}L(?:aws?)?\.?|(?-i:P\.?\s?L\.?))\s{{0,2}}(?:Nos?\.?\s{{0,2}})?"
    rf"(\d{{1,3}})\s?{DASH}\s?(\d{{1,4}})\b",
    re.IGNORECASE,
)
# "U.S. Const. art. I, § 8, cl. 3", "U.S. Const. amend. XIV, § 1", "U.S. Const. pmbl.".
# Groups: 1 = preamble, 2 = art… / amend… / amdt…, 3 = its number (Roman or Arabic),
# 4 = section, 5 = clause.
CONST_RE = re.compile(
    r"\bU\.?\s?S\.?\s{0,2}Const(?:itution|\.)?,?\s{0,2}"
    r"(?:(pmbl\.?|preamble)"
    r"|(art(?:icle|\.)?|amend(?:ment|\.)?|amdt\.?)\s{0,2}([IVXLC]{1,7}|\d{1,2})\b"
    r"(?:,?\s{0,2}(?:§|sec(?:tion|\.)?)\s{0,2}(\d{1,2})\b)?"
    r"(?:,?\s{0,2}cl(?:ause|\.)?\s{0,2}(\d{1,2})\b)?)",
    re.IGNORECASE,
)
# A Regulation Identifier Number: four digits (the agency), two letters, two digits.
RIN_RE = re.compile(rf"(?<![0-9A-Za-z])(\d{{4}})\s?{DASH}\s?([A-Z]{{2}}\d{{2}})(?![0-9A-Za-z])")

# The same forms as one whole string, the way a person types a citation into a box. Applied
# with `fullmatch`; `app.ids` checks every captured piece again before it builds an id.
SECTION_MARK_RE = re.compile(r"(?:§{1,2}|sections?|sec\.?)\s{0,2}", re.IGNORECASE)
# "29 CFR …": group 2 is what follows (a section, "part 1910", or an appendix name).
CFR_CITE_RE = re.compile(r"(\d{1,2})\s?C\.?\s?F\.?\s?R\.?\s{0,2}(.{1,300})", re.IGNORECASE | re.DOTALL)
# "part 1910", or "part 91, Special Federal Aviation Regulation No. 50-2" (a part's appendix).
CFR_PART_CITE_RE = re.compile(
    r"parts?\s{1,2}(\d{1,5}(?:-\d{1,4})?[A-Za-z]?)(?:,\s{0,2}(\S.{0,239}))?", re.IGNORECASE | re.DOTALL)
# An appendix named in a citation: starts with a letter, is not "part …" or "section …", and
# holds only the punctuation eCFR's appendix names use (no markup, quotes or backslashes).
CFR_APPENDIX_NAME_RE = re.compile(
    r"(?!(?:parts?|subparts?|sections?|sec\.?)\b)[^\W\d_][\w .,:;()\[\]/§&'\u2010-\u2015-]{0,239}",
    re.IGNORECASE,
)
# "42 U.S.C. § 2000e-2(a)", one section. Groups: title, section, paragraph, and the n of
# "(duplicate n)" for a second section published under the same number.
USC_CITE_RE = re.compile(
    r"(\d{1,2})\s?U\.?\s?S\.?\s?C\.?(?:A\.?)?\s{0,2}(?:§{1,2}\s{0,2}|sections?\s{1,2}|sec\.?\s{0,2})?"
    r"([0-9][0-9A-Za-z.~\u2010-\u2015-]{0,79}?)((?:\([0-9A-Za-z]{1,8}\)){0,10})(?:\s\(duplicate\s([1-9][0-9]?)\))?",
    re.IGNORECASE,
)
# "2 U.S.C. §§ 44 to 46": a run of sections the OLRC publishes as one unit.
USC_RANGE_CITE_RE = re.compile(
    r"(\d{1,2})\s?U\.?\s?S\.?\s?C\.?\s{0,2}§§\s{0,2}([0-9][0-9A-Za-z\u2010-\u2015-]{0,39})\sto\s"
    r"([0-9][0-9A-Za-z\u2010-\u2015-]{0,39})",
    re.IGNORECASE,
)
# A Federal Register document number on its own: "2026-20001", "E9-12345", "C1-2021-26268".
FR_DOC_NUMBER_RE = re.compile(r"(?:[A-Z][0-9]-)?[0-9]{4}-[0-9]{4,6}|[A-Z][0-9]-[0-9]{3,6}")
# "RIN 1218-AD39", optionally "(Fall 2025 Unified Agenda)" or "(2024-07 Unified Agenda)".
RIN_CITE_RE = re.compile(
    rf"(?:RIN:?\s{{0,2}})?([0-9]{{4}}\s?{DASH}\s?[A-Z]{{2}}[0-9]{{2}})"
    r"(?:\s\((?:(Spring|Fall)\s)?([12][0-9]{3})(?:-(0[0-9]|1[0-2]))?\sUnified\sAgenda\))?",
    re.IGNORECASE,
)
# What a Constitution citation starts with when "U.S. Const." is left off ("amend. XIV").
CONST_BARE_RE = re.compile(r"(?:pmbl|preamble|art|amend|amdt)", re.IGNORECASE)


def expand_paragraph_list(expr: str) -> list[tuple[str, str]]:
    """Split '(h)(3)(i) and (ii)' into [('(h)(3)(i)', '(h)(3)(i)'), ('(ii)', '(h)(3)(ii)')]."""
    out: list[tuple[str, str]] = []
    base_tokens: list[str] = []
    for m in re.finditer(_P_TUPLE, expr):
        raw = m.group(0)
        toks = re.findall(r"\([a-zA-Z0-9]{1,4}\)", raw)
        if not base_tokens or len(toks) >= len(base_tokens):
            full_toks = toks
            base_tokens = toks
        else:
            # Inherit leading hierarchy from the first tuple: (h)(3)(i) and (ii) -> (h)(3)(ii)
            full_toks = base_tokens[: len(base_tokens) - len(toks)] + toks
        out.append((raw, "".join(full_toks)))
    return out


@dataclass(frozen=True, slots=True)
class CitationSpan:
    kind: str  # "web" | "usc" | "fr" | "cfr_part" | "cfr_section"
    raw: str
    title: int | None = None
    target: str = ""
    paragraph: str = ""
    url: str = ""
    start: int = 0
    end: int = 0


def clean_url_tail(raw_url: str) -> tuple[str, str]:
    """Separate a matched URL from trailing sentence punctuation, entities, and unmatched ')'."""
    url = raw_url
    tail = ""
    while True:
        changed = False
        for ent in ("&gt;", "&lt;", "&quot;"):
            if url.endswith(ent):
                url = url[:-len(ent)]
                tail = ent + tail
                changed = True
                break
        if changed:
            continue
        if url and url[-1] in ".,;:?!'\"":
            tail = url[-1] + tail
            url = url[:-1]
            changed = True
        elif url.endswith(")") and url.count(")") > url.count("("):
            tail = ")" + tail
            url = url[:-1]
            changed = True
        if not changed:
            break
    return url, tail


def normalize_part_token(token: str) -> str:
    return token.strip()


def split_part_range(token: str, plural_prefix: bool, is_known_part=None) -> list[str]:
    """Resolve hyphenated token like '50-201' (one part) vs '1500-1508' (two part endpoints)."""
    if "-" not in token:
        return [token]
    if is_known_part and is_known_part(token):
        return [token]
    left, right = token.split("-", 1)
    if left.isdigit() and right.isdigit():
        li, ri = int(left), int(right)
        # Heuristic: plural 'parts 1500-1508' or numeric progression of >=3 digits where ri > li is a range.
        if (plural_prefix and ri > li) or (len(left) >= 3 and len(left) == len(right) and ri > li):
            return [left, right]
    return [token]


def parse_usc_targets(sec_expr: str) -> list[tuple[str, str, str]]:
    """Split a U.S.C. section expression into [(section_id, suffix_parens, raw_piece), ...].

    Handles:
      - '2000ff(4)' -> [('2000ff', '(4)', '2000ff(4)')]
      - '2000gg-2(f)' -> [('2000gg-2', '(f)', '2000gg-2(f)')]
      - '651-678' (range of >=2-digit numeric sections where end > start) -> splits cleanly
    """
    out: list[tuple[str, str, str]] = []
    for m in re.finditer(rf"({_USC_SEC})((?:\([a-zA-Z0-9]{{1,4}}\))*)", sec_expr):
        core, parens, raw = m.group(1), m.group(2), m.group(0)
        if "-" in core and not parens:
            a, b = core.split("-", 1)
            if a.isdigit() and b.isdigit() and len(a) >= 2 and int(b) > int(a):
                out.append((a, "", a))
                out.append((b, "", b))
                continue
        out.append((core, parens, raw))
    return out


def extract_reference_spans(text: str, current_title: int = 29) -> list[CitationSpan]:
    """Extract typed reference spans (Web URLs, U.S.C., FR, Cross-Title Parts/Sections) from plain text."""
    spans: list[CitationSpan] = []
    if not text:
        return spans
    low = text.lower()

    if "http" in low or "www." in low:
        for m in WEB_URL_RE.finditer(text):
            clean, _ = clean_url_tail(m.group(1))
            if clean:
                href = f"https://{clean}" if clean.lower().startswith("www.") else clean
                spans.append(CitationSpan(
                    kind="web", raw=clean, url=href,
                    start=m.start(1), end=m.start(1) + len(clean),
                ))

    if "u.s.c" in low or "usc" in low:
        for m in USC_RE.finditer(text):
            u_title = int(m.group(1))
            for core, parens, raw in parse_usc_targets(m.group(3)):
                spans.append(CitationSpan(
                    kind="usc", raw=f"{u_title} U.S.C. {raw}", title=u_title,
                    target=core, paragraph=parens,
                    url=f"https://www.law.cornell.edu/uscode/text/{u_title}/{core}",
                    start=m.start(), end=m.end(),
                ))

    if " fr " in low:
        for m in FR_RE.finditer(text):
            vol, page = m.group(1), m.group(2)
            spans.append(CitationSpan(
                kind="fr", raw=m.group(0), target=f"{vol}-FR-{page}",
                url=f"https://www.federalregister.gov/citation/{vol}-FR-{page}",
                start=m.start(), end=m.end(),
            ))

    if "cfr" in low or "c.f.r" in low:
        for m in CROSS_TITLE_PARTS_RE.finditer(text):
            t_num = int(m.group(1))
            plural_pfx = m.group(2).strip().lower().endswith("s")
            for pm in re.finditer(rf"({PART_NUM})", m.group(3)):
                for part_tok in split_part_range(pm.group(1), plural_pfx):
                    spans.append(CitationSpan(
                        kind="cfr_part", raw=f"{t_num} CFR part {part_tok}",
                        title=t_num, target=part_tok,
                        start=m.start(), end=m.end(),
                    ))
        for m in CROSS_TITLE_EXT_RE.finditer(text):
            t_num = int(m.group(1))
            if m.group(5):
                spans.append(CitationSpan(
                    kind="cfr_part", raw=m.group(0), title=t_num, target=m.group(5),
                    start=m.start(), end=m.end(),
                ))
            else:
                src = m.group(3) or m.group(4) or ""
                for im in SECTION_ITEM_RE.finditer(src):
                    raw_id, para = im.group(1), im.group(2).strip()
                    spans.append(CitationSpan(
                        kind="cfr_section", raw=f"{t_num} CFR {raw_id}{para}",
                        title=t_num, target=raw_id, paragraph=para,
                        start=m.start(), end=m.end(),
                    ))

    if "§" in text:
        for m in XREF_RE.finditer(text):
            for im in SECTION_ITEM_RE.finditer(m.group(2)):
                raw_id, para = im.group(1), im.group(2).strip()
                spans.append(CitationSpan(
                    kind="cfr_section", raw=f"§ {raw_id}{para}",
                    title=current_title, target=raw_id, paragraph=para,
                    start=m.start(), end=m.end(),
                ))

    return spans
