"""Canonical IDs: one address for every provision in the six federal frameworks (DM-101).

Each framework keeps its own store and names things its own way. This module gives every
unit one address and turns that address, purely, into the store row that holds it, the app
route that shows it and the citation a person would write, and back again. It reads no
file and opens no database; `python -m app.resolve` adds the store lookup.

Grammar
-------
    id         = "reg://federal/" corpus "/" collection "/" unit [ "#" paragraph ]

    corpus       collection                    unit
    ----------   ---------------------------   ------------------------------------------------
    cfr          title, 1-50                   a section id               1910.134
                                               "part:" part               part:1910
                                               "appendix:" appendix id    appendix:Appendix%20A%20to%20Part%201910
    usc          title, 1-54, or an appendix   a section id               655, 2000e-2, 44...46, 1167~2
                 title: 5a 11a 18a 28a 50a                                (appendix titles: App-rule1, pl95-521-s1)
    fr           "doc"                         a document number          2026-20001
                 volume, 1-999                 a page                     60123   (a citation, "91 FR 60123")
    constitution "us"                          a unit or a whole          preamble, art1-s8, art5, amdt14-s1,
                                               article / amendment        art1, amdt14
    plaw         Congress, 1-999               a law number               596, or pvt-3 for a private law
    agenda       "rin"                         a RIN                      1218-AD39   (its newest edition)
                 edition, YYYYMM               a RIN                      1218-AD39   (that edition's entry)

    paragraph  = one to ten "(x)" tokens of 1-8 letters or digits, on a CFR or U.S.C. section:
                 #(a)(1)(ii)
               | "cl" 1-99, a clause of a Constitution unit: #cl3

Rules that make an address strict
---------------------------------
* ASCII only, at most 512 characters, exactly three path parts after "reg://federal/".
  The only characters are A-Z a-z 0-9 . _ ~ ( ) - : % / # and each has one job: ":" follows
  the unit kind words "part" and "appendix", "#" starts the paragraph, "%" starts an escape.
* A unit is the store's own id. Anything outside A-Z a-z 0-9 . _ ~ ( ) - is written as
  %XX escapes of its UTF-8 bytes, upper-case hex. Only that spelling is accepted: an escape
  for a character that needs none, lower-case hex, bytes that are not UTF-8, text that is
  not NFC, and control or invisible format characters are all refused. So one unit has
  exactly one address, and `parse_id(str(ref)) == ref` always.
* Free text is allowed in one place only, a CFR appendix name (eCFR names them in prose, up
  to 224 characters on the development install). Every other unit has a fixed shape.
* Numbers carry no leading zeros. Corpus and collection names are lower case.
* U.S.C. titles 1-54: the OLRC prints the dash inside a section number as an en dash
  ("2000e–2") and the store keeps it. An address writes it as a hyphen ("2000e-2"), the
  way citations do; `to_store_key` gives the store's spelling back. Appendix-title ids are
  kept exactly as stored.
* The Constitution's shape is fixed, so its addresses are checked against it: seven articles
  and 27 amendments; Articles I-IV and the amendments that have numbered sections take
  "-s{n}" within range, the rest do not.

Destinations (SEC-101)
----------------------
`to_route` returns an app hash route ("#/…") built here from fixed prefixes with every
variable part percent-encoded. `to_url` returns an https address on one of `ALLOWED_HOSTS`
(eCFR, GovInfo, the Federal Register, reginfo.gov) built the same way, or None. Nothing in
this module returns any other scheme or host, whatever the input; `is_safe_destination`
states the rule and the tests hold every output to it.

Use
---
    ref = resolve("29 CFR 1910.134(a)(1)")     # an id or any supported citation string
    str(ref)            # reg://federal/cfr/29/1910.134#(a)(1)
    ref.id              # reg://federal/cfr/29/1910.134      (no paragraph: what a link row stores)
    to_store_key(ref)   # title-29.sqlite3 · sections · id = '1910.134'
    to_route(ref)       # #/title/29/section/1910.134?p=(a)(1)
    to_citation(ref)    # 29 CFR 1910.134(a)(1)
    from_store_key("usc", "2000e–2", collection=42)   # reg://federal/usc/42/2000e-2

`tests/shared/id_cases.json` is the table of valid, edge and hostile cases; a TypeScript
twin of this module must pass the same table.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from urllib.parse import quote

from .citations import parser as cite

PREFIX = "reg://federal/"
CORPORA = ("constitution", "usc", "plaw", "cfr", "fr", "agenda")
MAX_ID_LEN = 512
MAX_KEY_LEN = 240           # a decoded unit; the longest eCFR appendix name seen is 224
MAX_CITATION_LEN = 400      # nothing longer is looked at as a citation
ALLOWED_HOSTS = frozenset({"www.ecfr.gov", "www.govinfo.gov", "www.federalregister.gov", "www.reginfo.gov"})

USC_APPENDIX_BASE = 100     # the stores key the appendix titles as 100 + N (usc_client.APPENDIX)
USC_APPENDIX_TITLES = (5, 11, 18, 28, 50)

# Articles and amendments whose text is divided into numbered sections (the store's unit ids
# are `art1-s8`, `amdt14-s1`); every other article and amendment is one unit (`art5`, `amdt1`).
CONSTITUTION_SECTIONS = {
    "art1": 10, "art2": 4, "art3": 3, "art4": 4,
    "amdt13": 2, "amdt14": 5, "amdt15": 2, "amdt18": 3, "amdt20": 6, "amdt21": 3,
    "amdt22": 2, "amdt23": 2, "amdt24": 2, "amdt25": 4, "amdt26": 2,
}
CONSTITUTION_ARTICLES = 7
CONSTITUTION_AMENDMENTS = 27    # a new amendment is one edit here (and its sections above)


class IdError(ValueError):
    """Not a canonical id, a supported citation or a usable store key."""


@dataclass(frozen=True, slots=True)
class Ref:
    """One parsed address. `key` is the unit as the address spells it (see `to_store_key`
    for the store's spelling); `kind` says what the unit is."""
    corpus: str
    collection: str
    kind: str           # section | appendix | part | document | page | unit | group | law | rule
    key: str
    paragraph: str = ""

    @property
    def id(self) -> str:
        """The address without its paragraph: what identifies the unit."""
        return f"{PREFIX}{self.corpus}/{self.collection}/{_unit_text(self)}"

    def __str__(self) -> str:
        return self.id + (f"#{self.paragraph}" if self.paragraph else "")


@dataclass(frozen=True, slots=True)
class StoreKey:
    """Where a unit lives: a database file under the data folder, a table, and the column
    values that pick the row. `title` is the number the per-title store modules take (a
    U.S.C. appendix title is 100 + N). `span` is (low column, high column, value) for a
    Federal Register page, which lies inside a document's page range. `many` marks a
    group (a CFR part, an article) whose key matches several rows."""
    corpus: str
    database: str
    table: str
    where: tuple[tuple[str, str | int], ...]
    title: int | None = None
    span: tuple[str, str, int] | None = None
    newest_by: str | None = None
    many: bool = False

    def select(self) -> tuple[str, tuple]:
        """(sql, parameters) that reads the row or rows. Table and column names come only
        from the constants in this module; every value is bound."""
        columns = _SUMMARY_COLUMNS[(self.corpus, self.table)]
        clauses = [f"{col} = ?" for col, _ in self.where]
        params: list[str | int] = [v for _, v in self.where]
        if self.span:
            low, high, value = self.span
            clauses.append(f"{low} <= ? AND {high} >= ?")
            params += [value, value]
        order = f" ORDER BY {self.newest_by} DESC" if self.newest_by else ""
        limit = 200 if self.many else (1 if self.newest_by else 5)
        return (f"SELECT {', '.join(columns)} FROM {self.table} WHERE {' AND '.join(clauses)}{order} LIMIT {limit}",
                tuple(params))


# The columns `StoreKey.select` reads, per (corpus, table): enough to name the row.
_SUMMARY_COLUMNS: dict[tuple[str, str], tuple[str, ...]] = {
    ("cfr", "sections"): ("id", "kind", "part", "label", "title"),
    ("usc", "sections"): ("id", "label", "heading", "status"),
    ("fr", "documents"): ("document_number", "citation", "title", "publication_date"),
    ("constitution", "units"): ("id", "kind", "label"),
    ("plaw", "laws"): ("id", "citation", "title"),
    ("agenda", "entries"): ("rin", "edition", "title", "stage"),
}

# ---------------------------------------------------------------------------
# Shapes
# ---------------------------------------------------------------------------

_ID_SHAPE = re.compile(
    r"reg://federal/([a-z]{2,12})/([0-9a-z]{1,6})/([A-Za-z0-9._~()%:-]{1,480})(?:#([A-Za-z0-9()]{1,100}))?"
)
_INT = r"[1-9][0-9]{0,%d}"
_CFR_TITLE = re.compile(r"[1-9]|[1-4][0-9]|50")
_CFR_PART = re.compile(r"[0-9]{1,5}(?:-[0-9]{1,4})?[A-Za-z]?")
_CFR_SECTION_KEY = re.compile(r"[0-9][0-9A-Za-z.()-]{0,79}(?: - [0-9][0-9A-Za-z.()-]{0,39})?")
_CFR_QUALIFIED_APPENDIX = re.compile(r"([0-9]{1,5}(?:-[0-9]{1,4})?[A-Za-z]?):(.+)", re.S)
_USC_TITLE = re.compile(r"[1-9]|[1-4][0-9]|5[0-4]|(?:5|11|18|28|50)a")
_USC_KEY = re.compile(r"[0-9A-Za-z](?:[0-9A-Za-z.~\u2013-]{0,78}[0-9A-Za-z])?")
_USC_PLAIN = re.compile(r"[0-9]+[A-Za-z]*(?:-[0-9A-Za-z]+)*")
_USC_RANGE = re.compile(r"([0-9][0-9A-Za-z-]*)\.\.\.([0-9][0-9A-Za-z-]*)")
_USC_DUPLICATE = re.compile(r"([0-9][0-9A-Za-z-]*)~([1-9][0-9]?)")
_FR_DOC = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9._-]{0,38}[A-Za-z0-9])?")
_FR_VOLUME = re.compile(_INT % 2)
_FR_PAGE = re.compile(_INT % 5)
_CONST_UNIT = re.compile(r"preamble|(art|amdt)([1-9][0-9]?)(?:-s([1-9][0-9]?))?")
_CONGRESS = re.compile(_INT % 2)
_LAW_UNIT = re.compile(r"(pvt-)?(" + _INT % 3 + r")")
_LAW_STORE_ID = re.compile(r"(" + _INT % 2 + r")-(pvt-)?(" + _INT % 3 + r")")
_EDITION = re.compile(r"[12][0-9]{3}(?:0[0-9]|1[0-2])")
_RIN = re.compile(r"[0-9]{4}-[A-Z]{2}[0-9]{2}")
_PARAGRAPH = re.compile(r"(?:\([0-9A-Za-z]{1,8}\)){1,10}")
_CLAUSE = re.compile(r"cl([1-9][0-9]?)")

_UNRESERVED = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._~()-")
_HEX = "0123456789ABCDEF"
_DASHES = dict.fromkeys(range(0x2010, 0x2016), "-")           # the Unicode hyphens and dashes
_ROMAN = ((100, "C"), (90, "XC"), (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I"))


def _check_text(text: str, what: str, max_len: int = MAX_KEY_LEN) -> str:
    """A store key or decoded unit: printable, NFC, no control or invisible characters."""
    if not isinstance(text, str) or not text:
        raise IdError(f"{what} is empty")
    if len(text) > max_len:
        raise IdError(f"{what} is longer than {max_len} characters")
    if text != text.strip(" ") or not unicodedata.is_normalized("NFC", text):
        raise IdError(f"{what} has stray spaces or is not in normal form")
    for ch in text:
        category = unicodedata.category(ch)
        if category[0] == "C" or (category[0] == "Z" and ch != " "):
            raise IdError(f"{what} has a control, invisible or unusual space character")
    if not any(ch.isalnum() for ch in text):
        raise IdError(f"{what} has no letter or digit")
    return text


def _encode(text: str) -> str:
    out: list[str] = []
    for ch in text:
        if ch in _UNRESERVED:
            out.append(ch)
        else:
            out.extend(f"%{b:02X}" for b in ch.encode("utf-8"))
    return "".join(out)


def _decode(unit: str, what: str) -> str:
    """The inverse of `_encode`, accepting only what `_encode` would have written."""
    if "%" not in unit:
        text = unit
    else:
        raw = bytearray()
        i = 0
        while i < len(unit):
            ch = unit[i]
            if ch == "%":
                pair = unit[i + 1:i + 3]
                if len(pair) != 2 or pair[0] not in _HEX or pair[1] not in _HEX:
                    raise IdError(f"{what} has a malformed escape")
                raw.append(int(pair, 16))
                i += 3
            else:
                raw.append(ord(ch))
                i += 1
        try:
            text = raw.decode("utf-8", "strict")
        except UnicodeDecodeError:
            raise IdError(f"{what} has an escape that is not UTF-8") from None
    _check_text(text, what)
    if _encode(text) != unit:
        raise IdError(f"{what} is not in its one canonical spelling")
    return text


def _swap_dashes(text: str) -> str:
    """Hyphen and en dash trade places: the OLRC's section-number dash is U+2013."""
    return text.translate({0x2D: "\u2013", 0x2013: "-"})


def roman(value: str) -> int:
    """'XIV' → 14. Raises IdError unless it is a correctly formed Roman numeral below 400."""
    n = cite.roman_number(value) if isinstance(value, str) else None
    if n is None:
        raise IdError(f"not a Roman numeral: {str(value)[:20]!r}")
    return n


def to_roman(n: int) -> str:
    out = ""
    for v, r in _ROMAN:
        while n >= v:
            out, n = out + r, n - v
    return out


def _number(value, what: str, low: int, high: int) -> int:
    try:
        text = str(value).strip()
        n = int(text)
    except (TypeError, ValueError):
        raise IdError(f"{what} is not a number") from None
    if not text.isascii() or not text.isdigit() or not low <= n <= high:
        raise IdError(f"{what} must be {low}-{high}")
    return n


def _paragraph(value: str | None) -> str:
    p = (value or "").replace(" ", "")
    if p and not _PARAGRAPH.fullmatch(p):
        raise IdError("the paragraph must look like (a)(1)(ii)")
    return p


# ---------------------------------------------------------------------------
# Building an address
# ---------------------------------------------------------------------------

def cfr_section(title, section_id: str, paragraph: str | None = "") -> Ref:
    """29, "1910.134", "(a)(1)" → reg://federal/cfr/29/1910.134#(a)(1)"""
    key = _check_text(section_id, "the section id", 120)
    if not _CFR_SECTION_KEY.fullmatch(key):
        raise IdError("a CFR section id starts with a digit and holds only letters, digits, . ( ) -")
    return Ref("cfr", str(_number(title, "the CFR title", 1, 50)), "section", key, _paragraph(paragraph))


def cfr_appendix(title, appendix_id: str) -> Ref:
    """The store's appendix id, part-qualified or not: "Appendix A to Part 1910", "91:SFAR No. 50-2"."""
    return Ref("cfr", str(_number(title, "the CFR title", 1, 50)), "appendix", _check_text(appendix_id, "the appendix id"))


def cfr_part(title, part) -> Ref:
    key = str(part).strip()
    if not _CFR_PART.fullmatch(key):
        raise IdError("a CFR part is a number such as 1910, 1912a or 60-1")
    return Ref("cfr", str(_number(title, "the CFR title", 1, 50)), "part", key)


def usc_collection(title) -> str:
    """42 → "42"; 105 or "5a" → "5a" (an appendix title)."""
    text = str(title).strip().lower()
    if text.isascii() and text.isdigit():
        n = int(text)
        if n > USC_APPENDIX_BASE and n - USC_APPENDIX_BASE in USC_APPENDIX_TITLES:
            return f"{n - USC_APPENDIX_BASE}a"
        text = str(n)
    if not _USC_TITLE.fullmatch(text):
        raise IdError("a U.S. Code title is 1-54, or an appendix title: 5a, 11a, 18a, 28a, 50a")
    return text


def usc_title_code(collection: str) -> int:
    """"42" → 42; "5a" → 105: the number the U.S.C. store modules and routes use."""
    return USC_APPENDIX_BASE + int(collection[:-1]) if collection.endswith("a") else int(collection)


def usc_section(title, section: str, paragraph: str | None = "") -> Ref:
    """A section as cited, dashes as hyphens: (42, "2000e-2") → reg://federal/usc/42/2000e-2.
    For a store id (which carries the OLRC's en dash) use `from_store_key`."""
    return _usc_ref(usc_collection(title), str(section).translate(_DASHES), paragraph)


def _usc_ref(collection: str, key: str, paragraph: str | None) -> Ref:
    if not _USC_KEY.fullmatch(_check_text(key, "the section", 80)):
        raise IdError("a U.S.C. section holds only letters, digits, . ~ and dashes, and ends in a letter or digit")
    return Ref("usc", collection, "section", key, _paragraph(paragraph))


def fr_document(document_number: str) -> Ref:
    key = str(document_number).strip()
    if not _FR_DOC.fullmatch(key):
        raise IdError("a Federal Register document number looks like 2026-20001 or E9-12345")
    return Ref("fr", "doc", "document", key)


def fr_page(volume, page) -> Ref:
    """A page citation ("91 FR 60123"): an address for the citation, not a stored row."""
    return Ref("fr", str(_number(volume, "the volume", 1, 999)), "page", str(_number(page, "the page", 1, 999999)))


def constitution_unit(unit_id: str, clause=None) -> Ref:
    """"art1-s8", "amdt14-s1", "art5", "preamble"; or a whole article or amendment ("amdt14")."""
    key = str(unit_id).strip()
    m = _CONST_UNIT.fullmatch(key)
    if not m:
        raise IdError("a Constitution unit looks like preamble, art1-s8, art5 or amdt14-s1")
    kind = "unit"
    if m.group(1):
        head, number, section = m.group(1) + m.group(2), int(m.group(2)), m.group(3)
        if number > (CONSTITUTION_ARTICLES if m.group(1) == "art" else CONSTITUTION_AMENDMENTS):
            raise IdError(f"the Constitution has {CONSTITUTION_ARTICLES} articles and {CONSTITUTION_AMENDMENTS} amendments")
        sections = CONSTITUTION_SECTIONS.get(head, 0)
        if section and int(section) > sections:
            raise IdError(f"{head} has {'no numbered sections' if not sections else f'sections 1-{sections}'}")
        if not section and sections:
            kind = "group"
    paragraph = ""
    if clause not in (None, ""):
        if kind == "group" or key == "preamble":
            raise IdError("a clause needs a section, or an article or amendment that has none")
        paragraph = f"cl{_number(clause, 'the clause', 1, 99)}"
    return Ref("constitution", "us", kind, key, paragraph)


def public_law(congress, number, private: bool = False) -> Ref:
    key = ("pvt-" if private else "") + str(_number(number, "the law number", 1, 9999))
    return Ref("plaw", str(_number(congress, "the Congress", 1, 999)), "law", key)


def agenda_rule(rin: str, edition: str | None = None) -> Ref:
    """A Unified Agenda entry by RIN; without an edition, the newest one on disk."""
    key = str(rin).strip().upper().translate(_DASHES)
    if not _RIN.fullmatch(key):
        raise IdError("a RIN is four digits, a dash, two letters and two digits: 1218-AD39")
    collection = "rin" if edition in (None, "") else str(edition).strip()
    if collection != "rin" and not _EDITION.fullmatch(collection):
        raise IdError("an Agenda edition is YYYYMM")
    return Ref("agenda", collection, "rule", key)


def from_store_key(corpus: str, key: str, *, collection=None, kind: str | None = None,
                   paragraph: str | None = "") -> Ref:
    """A store row's own key → its address.

    cfr           key = `sections.id` (kind "section" or "appendix", as `sections.kind`; guessed
                  from the id when not given) or a part number (kind "part"); collection = title
    usc           key = `sections.id`; collection = the title number (105 or "5a" for 5a)
    fr            key = `documents.document_number`
    constitution  key = `units.id`
    plaw          key = `laws.id` ("113-1", "113-pvt-1")
    agenda        key = `entries.rin`; collection = `entries.edition`, or None for the newest
    """
    if corpus == "cfr":
        if kind == "part":
            return cfr_part(collection, key)
        if kind is None:
            kind = "section" if _CFR_SECTION_KEY.fullmatch(key or "") and "." in key else "appendix"
        if kind == "section":
            return cfr_section(collection, key, paragraph)
        if kind == "appendix":
            return cfr_appendix(collection, key)
        raise IdError(f"unknown CFR unit kind: {str(kind)[:20]!r}")
    if corpus == "usc":
        col = usc_collection(collection)
        text = _check_text(key, "the section id", 80)
        return _usc_ref(col, text if col.endswith("a") else _swap_dashes(text), paragraph)
    if corpus == "fr":
        if kind == "page":
            return fr_page(collection, key)
        return fr_document(key)
    if corpus == "constitution":
        clause = _CLAUSE.fullmatch(paragraph) if paragraph else None
        if paragraph and not clause:
            raise IdError("a Constitution paragraph is a clause: cl3")
        return constitution_unit(key, clause.group(1) if clause else None)
    if corpus == "plaw":
        m = _LAW_STORE_ID.fullmatch(str(key).strip())
        if not m:
            raise IdError("a Public Law id looks like 113-1 or 113-pvt-1")
        return public_law(m.group(1), m.group(3), private=bool(m.group(2)))
    if corpus == "agenda":
        return agenda_rule(key, collection)
    raise IdError(f"unknown corpus: {str(corpus)[:20]!r}")


def _unit_text(ref: Ref) -> str:
    if ref.corpus == "cfr" and ref.kind in ("part", "appendix"):
        return f"{ref.kind}:{_encode(ref.key)}"
    return _encode(ref.key)


# ---------------------------------------------------------------------------
# Reading an address
# ---------------------------------------------------------------------------

def parse_id(value: str) -> Ref:
    """A canonical id (with or without a paragraph) → `Ref`. Raises IdError for anything
    that is not in the one accepted spelling."""
    if not isinstance(value, str):
        raise IdError("an id is text")
    if len(value) > MAX_ID_LEN:
        raise IdError(f"an id is at most {MAX_ID_LEN} characters")
    m = _ID_SHAPE.fullmatch(value) if value.isascii() else None
    if not m:
        raise IdError("not a reg://federal/{corpus}/{collection}/{unit} id")
    corpus, collection, unit, fragment = m.group(1), m.group(2), m.group(3), m.group(4) or ""
    if corpus not in CORPORA:
        raise IdError(f"unknown corpus: {corpus!r}")
    ref = _parse_unit(corpus, collection, unit, fragment)
    if str(ref) != value:                      # one address per unit: no second spelling
        raise IdError("the id is not in its one canonical spelling")
    return ref


def _parse_unit(corpus: str, collection: str, unit: str, fragment: str) -> Ref:
    if corpus == "cfr":
        if not _CFR_TITLE.fullmatch(collection):
            raise IdError("a CFR title is 1-50")
        if unit.startswith("part:"):
            ref = cfr_part(collection, unit[5:])
        elif unit.startswith("appendix:"):
            ref = cfr_appendix(collection, _decode(unit[9:], "the appendix id"))
        elif ":" in unit:
            raise IdError("a CFR unit is a section id, part:{n} or appendix:{id}")
        else:
            return cfr_section(collection, _decode(unit, "the section id"), _only_paragraph(fragment))
    elif corpus == "usc":
        if not _USC_TITLE.fullmatch(collection) or ":" in unit:
            raise IdError("a U.S. Code title is 1-54 or 5a, 11a, 18a, 28a, 50a")
        return _usc_ref(collection, _decode(unit, "the section"), _only_paragraph(fragment))
    elif corpus == "fr":
        if collection == "doc":
            ref = fr_document(unit)
        elif _FR_VOLUME.fullmatch(collection) and _FR_PAGE.fullmatch(unit):
            ref = fr_page(collection, unit)
        else:
            raise IdError("a Federal Register id is fr/doc/{number} or fr/{volume}/{page}")
    elif corpus == "constitution":
        if collection != "us":
            raise IdError("the Constitution's collection is 'us'")
        clause = _CLAUSE.fullmatch(fragment) if fragment else None
        if fragment and not clause:
            raise IdError("a Constitution paragraph is a clause: cl3")
        return constitution_unit(unit, clause.group(1) if clause else None)
    elif corpus == "plaw":
        m = _LAW_UNIT.fullmatch(unit)
        if not _CONGRESS.fullmatch(collection) or not m:
            raise IdError("a Public Law id is plaw/{congress}/{number} or plaw/{congress}/pvt-{number}")
        ref = public_law(collection, m.group(2), private=bool(m.group(1)))
    else:
        if collection != "rin" and not _EDITION.fullmatch(collection):
            raise IdError("an Agenda collection is 'rin' or an edition, YYYYMM")
        if not _RIN.fullmatch(unit):
            raise IdError("a RIN is four digits, a dash, two letters and two digits")
        ref = agenda_rule(unit, None if collection == "rin" else collection)
    if fragment:
        raise IdError("this kind of unit takes no paragraph")
    return ref


def _only_paragraph(fragment: str) -> str:
    if fragment and not _PARAGRAPH.fullmatch(fragment):
        raise IdError("the paragraph must look like (a)(1)(ii)")
    return fragment


def is_valid_id(value) -> bool:
    try:
        parse_id(value)
    except IdError:
        return False
    return True


def _ref(value: Ref | str) -> Ref:
    return value if isinstance(value, Ref) else parse_id(value)


# ---------------------------------------------------------------------------
# Address → store row, route, citation, outside address
# ---------------------------------------------------------------------------

def to_store_key(value: Ref | str) -> StoreKey:
    ref = _ref(value)
    if ref.corpus == "cfr":
        title = int(ref.collection)
        column = "part" if ref.kind == "part" else "id"
        return StoreKey("cfr", f"title-{title}.sqlite3", "sections", ((column, ref.key),), title=title,
                        many=ref.kind == "part")
    if ref.corpus == "usc":
        code = usc_title_code(ref.collection)
        key = ref.key if ref.collection.endswith("a") else _swap_dashes(ref.key)
        return StoreKey("usc", f"usc-{code}.sqlite3", "sections", (("id", key),), title=code)
    if ref.corpus == "fr":
        if ref.kind == "page":
            return StoreKey("fr", "fr.sqlite3", "documents", (("volume", int(ref.collection)),),
                            span=("start_page", "end_page", int(ref.key)))
        return StoreKey("fr", "fr.sqlite3", "documents", (("document_number", ref.key),))
    if ref.corpus == "constitution":
        if ref.kind == "group":
            m = _CONST_UNIT.fullmatch(ref.key)
            column = "article" if m.group(1) == "art" else "amendment"
            return StoreKey("constitution", "constitution.sqlite3", "units", ((column, int(m.group(2))),), many=True)
        return StoreKey("constitution", "constitution.sqlite3", "units", (("id", ref.key),))
    if ref.corpus == "plaw":
        return StoreKey("plaw", "plaw.sqlite3", "laws", (("id", f"{ref.collection}-{ref.key}"),))
    if ref.collection == "rin":
        return StoreKey("agenda", "agenda.sqlite3", "entries", (("rin", ref.key),), newest_by="edition")
    return StoreKey("agenda", "agenda.sqlite3", "entries", (("rin", ref.key), ("edition", ref.collection)))


def _seg(text: str) -> str:
    """One route or URL part. Like the frontend's `encodeURIComponent`, but ! * ' are
    escaped too, so nothing built here can close a quoted attribute."""
    return quote(text, safe="-_.~()")


def to_route(value: Ref | str) -> str | None:
    """The app's hash route for the unit, or None for a Federal Register page citation
    (which names a place in a volume, not a stored document; see `app.resolve`)."""
    ref = _ref(value)
    para = f"?p={_seg(ref.paragraph)}" if ref.paragraph else ""
    if ref.corpus == "cfr":
        if ref.kind == "part":
            return f"#/title/{ref.collection}/part/{_seg(ref.key)}"
        return f"#/title/{ref.collection}/section/{_seg(ref.key)}{para}"
    if ref.corpus == "usc":
        store = to_store_key(ref)
        return f"#/usc/{store.title}/section/{_seg(str(store.where[0][1]))}{para}"
    if ref.corpus == "fr":
        return f"#/news/fr/{_seg(ref.key)}" if ref.kind == "document" else None
    if ref.corpus == "constitution":
        return f"#/constitution/{_seg(ref.key + '-s1' if ref.kind == 'group' else ref.key)}"
    if ref.corpus == "plaw":
        return f"#/law/{_seg(ref.collection + '-' + ref.key)}"
    edition = "" if ref.collection == "rin" else f"?edition={_seg(ref.collection)}"
    return f"#/news/agenda/{_seg(ref.key)}{edition}"


def _https(host: str, path: str, query: str = "") -> str:
    if host not in ALLOWED_HOSTS:              # every outside address is built here
        raise IdError("not an allow-listed host")
    return f"https://{host}{path}{'?' + query if query else ''}"


def to_url(value: Ref | str) -> str | None:
    """The unit at its official source, on an allow-listed host, or None when no address
    form has been verified for it (the Constitution, U.S.C. appendix titles, private laws,
    an Agenda rule without an edition)."""
    ref = _ref(value)
    if ref.corpus == "cfr":
        base = f"/current/title-{ref.collection}"
        if ref.kind == "section":
            ordinary = cite.CFR_SECTION_ID_RE.fullmatch(ref.key)
            return _https("www.ecfr.gov", f"{base}/section-{_seg(ref.key)}" if ordinary else base)
        if ref.kind == "part":
            return _https("www.ecfr.gov", f"{base}/part-{_seg(ref.key)}")
        qualified = _CFR_QUALIFIED_APPENDIX.fullmatch(ref.key)
        return _https("www.ecfr.gov", f"{base}/part-{_seg(qualified.group(1))}" if qualified else base)
    if ref.corpus == "usc":
        if ref.collection.endswith("a") or not _USC_PLAIN.fullmatch(ref.key):
            return None
        return _https("www.govinfo.gov", f"/link/uscode/{ref.collection}/{_seg(ref.key)}", "link-type=html")
    if ref.corpus == "fr":
        if ref.kind == "page":
            return _https("www.federalregister.gov", f"/citation/{ref.collection}-FR-{ref.key}")
        return _https("www.federalregister.gov", f"/d/{_seg(ref.key)}")
    if ref.corpus == "plaw":
        if ref.key.startswith("pvt-"):
            return None
        return _https("www.govinfo.gov", f"/link/plaw/{ref.collection}/public/{ref.key}", "link-type=details")
    if ref.corpus == "agenda" and ref.collection != "rin":
        return _https("www.reginfo.gov", "/public/do/eAgendaViewRule", f"pubId={ref.collection}&RIN={_seg(ref.key)}")
    return None


_SAFE_ROUTE = re.compile(r"#/[A-Za-z0-9/._~()%?=&-]{0,1500}")
_SAFE_URL = re.compile(r"https://([a-z.]{4,40})/[A-Za-z0-9/._~()%?=&-]{0,1500}")


def is_safe_destination(destination) -> bool:
    """True for an app hash route or an https address on `ALLOWED_HOSTS`, and nothing else."""
    if not isinstance(destination, str):
        return False
    if _SAFE_ROUTE.fullmatch(destination):
        return True
    m = _SAFE_URL.fullmatch(destination)
    return bool(m) and m.group(1) in ALLOWED_HOSTS


def edition_label(edition: str) -> str:
    """"202510" → "Fall 2025"; "202504" → "Spring 2025"; a yearly file "201200" → "2012"."""
    year, month = edition[:4], int(edition[4:])
    if month == 0:
        return year
    return {4: f"Spring {year}", 10: f"Fall {year}"}.get(month, f"{year}-{month:02d}")


def to_citation(value: Ref | str) -> str:
    """The citation a person would write: "29 CFR 1910.134(a)(1)", "42 U.S.C. § 2000e-2",
    "91 FR 60123", "U.S. Const. art. I, § 8, cl. 3", "Pub. L. 91-596", "RIN 1218-AD39"."""
    ref = _ref(value)
    if ref.corpus == "cfr":
        if ref.kind == "part":
            return f"{ref.collection} CFR part {ref.key}"
        if ref.kind == "appendix":
            q = _CFR_QUALIFIED_APPENDIX.fullmatch(ref.key)
            return f"{ref.collection} CFR part {q.group(1)}, {q.group(2)}" if q else f"{ref.collection} CFR {ref.key}"
        return f"{ref.collection} CFR {ref.key}{ref.paragraph}"
    if ref.corpus == "usc":
        if ref.collection.endswith("a"):
            return f"{ref.collection[:-1]} U.S.C. App. {ref.key}{ref.paragraph}"
        rng, dup = _USC_RANGE.fullmatch(ref.key), _USC_DUPLICATE.fullmatch(ref.key)
        if rng:
            return f"{ref.collection} U.S.C. §§ {rng.group(1)} to {rng.group(2)}"
        if dup:
            return f"{ref.collection} U.S.C. § {dup.group(1)}{ref.paragraph} (duplicate {dup.group(2)})"
        return f"{ref.collection} U.S.C. § {ref.key}{ref.paragraph}"
    if ref.corpus == "fr":
        return f"{ref.collection} FR {ref.key}" if ref.kind == "page" else f"FR Doc. {ref.key}"
    if ref.corpus == "constitution":
        if ref.key == "preamble":
            return "U.S. Const. pmbl."
        m = _CONST_UNIT.fullmatch(ref.key)
        out = f"U.S. Const. {'art.' if m.group(1) == 'art' else 'amend.'} {to_roman(int(m.group(2)))}"
        if m.group(3):
            out += f", § {m.group(3)}"
        return out + (f", cl. {ref.paragraph[2:]}" if ref.paragraph else "")
    if ref.corpus == "plaw":
        if ref.key.startswith("pvt-"):
            return f"Priv. L. {ref.collection}-{ref.key[4:]}"
        return f"Pub. L. {ref.collection}-{ref.key}"
    if ref.collection == "rin":
        return f"RIN {ref.key}"
    return f"RIN {ref.key} ({edition_label(ref.collection)} Unified Agenda)"


def describe(value: Ref | str) -> dict:
    """Everything this module knows about an address, as plain data (the CLI's JSON)."""
    ref = _ref(value)
    store = to_store_key(ref)
    return {
        "id": ref.id, "address": str(ref), "corpus": ref.corpus, "collection": ref.collection,
        "kind": ref.kind, "key": ref.key, "paragraph": ref.paragraph,
        "citation": to_citation(ref),
        "store": {"database": store.database, "table": store.table, "where": dict(store.where),
                  **({"page_within": list(store.span)} if store.span else {}),
                  **({"newest_by": store.newest_by} if store.newest_by else {}),
                  **({"many": True} if store.many else {})},
        "route": to_route(ref), "url": to_url(ref),
    }


# ---------------------------------------------------------------------------
# Citation string → address
# ---------------------------------------------------------------------------

def _clean_citation(text) -> str:
    if not isinstance(text, str):
        raise IdError("a citation is text")
    if len(text) > MAX_CITATION_LEN:
        raise IdError(f"a citation is at most {MAX_CITATION_LEN} characters")
    out: list[str] = []
    for ch in text:
        category = unicodedata.category(ch)
        if category == "Zs" or ch == "\t":        # pasted citations carry no-break and thin spaces
            ch = " "
        elif category[0] in "CZ":
            raise IdError("the text has a control or invisible character")
        out.append(ch)
    s = unicodedata.normalize("NFC", "".join(out)).strip(" ")
    if not s:
        raise IdError("nothing to resolve")
    return s


def parse_citation(text: str, default_title: int | None = None) -> Ref:
    """One citation, and nothing else in the string, → its address.

    Forms: "29 CFR 1910.134(a)(1)", "29 C.F.R. § 1910.134", "29 CFR part 1910", "29 CFR
    Appendix A to Part 1910", "§ 1910.134" or "part 1910" (with `default_title`), "42 U.S.C.
    2000e-2(a)", "5 U.S.C. App. 3", "91 FR 60123", "FR Doc. 2026-20001", "U.S. Const. art. I,
    § 8, cl. 3", "amend. XIV", "Pub. L. 91-596", "RIN 1218-AD39". A string that names more
    than one provision is refused; `find_citations` reads running text."""
    s = _clean_citation(text)
    error = IdError("not a citation this resolver knows")
    for candidate in dict.fromkeys((s, s.rstrip(".;, "))):     # as written, then without a sentence's end
        try:
            ref = _one_citation(candidate, default_title) if candidate else None
        except IdError as exc:
            error = exc
            continue
        if ref is not None:
            return ref
    raise error


def _one_citation(s: str, default_title: int | None) -> Ref | None:
    m = cite.CONST_RE.fullmatch(s) or (cite.CONST_RE.fullmatch(f"U.S. Const. {s}") if cite.CONST_BARE_RE.match(s) else None)
    if m:
        if m.group(1):
            return constitution_unit("preamble")
        number = m.group(3)
        n = int(number) if number.isdigit() else roman(number)
        head = ("art" if m.group(2).lower().startswith("art") else "amdt") + str(n)
        return constitution_unit(f"{head}-s{int(m.group(4))}" if m.group(4) else head, m.group(5))
    m = cite.PUBLIC_LAW_RE.fullmatch(s)
    if m:
        return public_law(m.group(2), m.group(3), private=(m.group(1) or "").lower().startswith("priv"))
    m = cite.RIN_CITE_RE.fullmatch(s)
    if m:
        edition = None
        if m.group(3):
            month = m.group(4) or {"spring": "04", "fall": "10"}.get((m.group(2) or "").lower(), "00")
            edition = m.group(3) + month
        return agenda_rule(m.group(1).replace(" ", ""), edition)
    m = cite.FR_DOC_RE.fullmatch(s)
    if m:
        return fr_document(m.group(1))
    if cite.FR_DOC_NUMBER_RE.fullmatch(s):
        return fr_document(s)
    m = cite.FR_CITE_RE.fullmatch(s)
    if m:
        return fr_page(m.group(1), m.group(2))
    m = cite.USC_APPENDIX_RE.fullmatch(s)
    if m:
        return _usc_ref(usc_collection(f"{int(m.group(1))}a"), m.group(2), m.group(3))
    m = cite.USC_RANGE_CITE_RE.fullmatch(s)
    if m:
        return usc_section(m.group(1), f"{m.group(2)}...{m.group(3)}")
    m = cite.USC_CITE_RE.fullmatch(s)
    if m:
        section = m.group(2) + (f"~{m.group(4)}" if m.group(4) else "")
        return usc_section(int(m.group(1)), section, m.group(3))
    m = cite.CFR_CITE_RE.fullmatch(s)
    if m:
        return _cfr_tail(int(m.group(1)), m.group(2).strip(" "), free_text=True)
    if default_title is not None:
        return _cfr_tail(default_title, s, free_text=False)
    return None


def _cfr_tail(title: int, rest: str, free_text: bool) -> Ref | None:
    """What follows "29 CFR": a section, "part N", "part N, {appendix name}" or an appendix name."""
    m = cite.CFR_PART_CITE_RE.fullmatch(rest)
    if m:
        if not m.group(2):
            return cfr_part(title, m.group(1))
        return cfr_appendix(title, f"{m.group(1)}:{m.group(2)}") if cite.CFR_APPENDIX_NAME_RE.fullmatch(m.group(2)) else None
    mark = cite.SECTION_MARK_RE.match(rest)
    body = rest[mark.end():] if mark else rest
    m = cite.CFR_SECTION_ID_RE.match(body)
    if m:
        tail = body[m.end():]
        if tail and not _PARAGRAPH.fullmatch(tail.replace(" ", "")):
            return None
        return cfr_section(title, m.group(0), tail)
    if free_text and not mark and cite.CFR_APPENDIX_NAME_RE.fullmatch(rest):
        return cfr_appendix(title, rest)
    return None


def from_span(span) -> Ref | None:
    """A `citations.parser.CitationSpan` → its address, or None for a kind with no address
    (a web link; and for now a Statutes at Large page, an executive order and a docket, which
    no store holds) or a target this grammar refuses."""
    try:
        if span.kind == "cfr_section":
            m = cite.CFR_SECTION_ID_RE.fullmatch(span.target)
            return cfr_section(span.title, span.target, span.paragraph if m else "") if m else None
        if span.kind == "cfr_part":
            return cfr_part(span.title, span.target)
        if span.kind == "usc":
            return usc_section(span.title, span.target, span.paragraph)
        if span.kind == "fr":
            volume, _, page = span.target.partition("-FR-")
            return fr_page(volume, page)
        if span.kind in ("public_law", "private_law"):
            congress, _, number = span.target.partition("-")
            return public_law(congress, number, private=span.kind == "private_law")
        if span.kind == "constitution":
            return constitution_unit(span.target, span.paragraph[2:] if span.paragraph else None)
        if span.kind == "rin":
            return agenda_rule(span.target)
    except IdError:
        return None
    return None


def find_citations(text: str, default_title: int | None = None) -> list[Ref]:
    """Every citation the one parser finds in running text that has an address (CFR, U.S.C.,
    Federal Register, Public Laws, the Constitution, RINs), in the parser's order, without
    repeats. A bare "§ 1910.134" counts only when `default_title` says which CFR title the
    text belongs to."""
    if not isinstance(text, str):
        raise IdError("text is required")
    out: dict[str, Ref] = {}
    for span in cite.extract_reference_spans(text[:200_000], default_title or 29):
        if default_title is None and span.raw.startswith("§"):
            continue
        ref = from_span(span)
        if ref is not None:
            out.setdefault(str(ref), ref)
    return list(out.values())


def resolve(text: str, default_title: int | None = None) -> Ref:
    """An id or a citation string → `Ref` (TL-08). Raises IdError when it is neither."""
    if isinstance(text, str) and text.lstrip(" ").startswith("reg:"):
        return parse_id(text.strip(" "))
    return parse_citation(text, default_title)
