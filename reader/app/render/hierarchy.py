"""Paragraph levels: (a) -> (1) -> (i) -> (A) -> (1 italic) -> (i italic)."""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET

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
