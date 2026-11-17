# Stage 1 · Phase 2 · Part 1: CFR Reference & DOL Standard Code Linkifier

## 1. Objectives
Normalise citations from three formats into FRAMEWORK's canonical ids:
1. **DOL `violation.standard`** (fixed-width): `"19101030 G02   IIA"` → `1910.1030`, `"19260501 B13"` → `1926.501`.
2. **Federal Register `cfr_references`**: `{"title": 29, "part": "42"}` → a part-level reference (already structured; no parsing).
3. **Prose** in FR abstracts, PI subjects and titles: `"29 CFR 1910.1200(a)(1)"` → `1910.1200`, `"29 CFR part 1904"` → part `1904`.

## 2. DOL standard codes (`news.normalize_dol_standard`)
The `standard` column is the 4-digit part followed by the zero-padded 4-digit section, then the paragraph code (observed live: `"19101030 G02   IIA"`).

```python
DOL_STANDARD_RE = re.compile(r"^(19\d{2})(\d{4})(?=\s|$|[A-Z])")


def normalize_dol_standard(raw: str | None) -> str | None:
    """'19101030 G02   IIA' -> '1910.1030'; '19100134 A01' -> '1910.134'. None if not a 29 CFR 19xx code."""
    m = DOL_STANDARD_RE.match((raw or "").strip())
    if not m:
        return None
    return f"{m.group(1)}.{int(m.group(2))}"


def is_general_duty(raw: str | None) -> bool:
    """Section 5(a)(1) citations carry a non-CFR code. Believed to be '5A0001'; confirm live (see below)."""
    return (raw or "").strip().upper().startswith("5A")
```
Codes that are neither a 19xx CFR section nor General Duty are counted, not linked. This is mostly **state-plan standards**: state-plan inspections cite state codes. They go into the item's `unmapped_standards` count, so a card can say "2 state-plan standards" honestly instead of dropping them.

> To verify with a real key while building: the exact General Duty code in `violation.standard`, and a sample of state-plan codes (e.g. a CA or WA inspection) to confirm they don't match `DOL_STANDARD_RE` by accident.

## 3. Prose citations (`news.extract_citations`)
Don't write a new loose regex. `render.py` already parses CFR citations for the reader, including lists, ranges and paragraph suffixes (`_CROSS_TITLE`, `_XREF`, `_NUM_IN_LIST`, `_WORD_PART`). Reuse those patterns: import them, or promote them to public names in `render.py` and keep the old names as aliases.

Rules, chosen to avoid false positives (a bare `1999.5` in prose must never become a citation):
- `29 CFR 1910.1200(a)(1)`, `29 C.F.R. §§ 1910.1001 and 1926.1101` → sections, any Title 29 part. Paragraph suffixes are stripped.
- `29 CFR part 1904` / `parts 1910 and 1926` → part-level references.
- A bare `§ 1910.134` (no title) → a Title 29 section **only if the part is 1900–1999** (OSHA's range). Other bare `§` numbers are ignored.
- Bare numbers with neither `CFR` nor `§` are ignored.
- Citations to other titles (`40 CFR 261.3`) are ignored while OSHA is the only agency. Note them in a comment for the multi-agency plan.

```python
def extract_citations(text: str) -> tuple[list[str], list[dict]]:
    """Return (sorted section ids, part refs [{'title': 29, 'part': '1904'}]) found in prose."""
```
The worker merges these with the FR `cfr_references` (deduplicated by `(title, part)`) before upserting.

## 4. Frontend linkifier (`reader/static/app.js`, News section)
Card text is plain text from the server, linkified on the client with the **same** rules as section 3 (a `29 CFR` prefix, or a bare `§` with part 19xx):

```javascript
// "29 CFR 1910.1200(a)", "§ 1926.651" -> links. Bare numbers are left alone.
const NEWS_CITE_RE = /\b29\s*C\.?F\.?R\.?\s*(?:§§?\s*)?(\d{1,4}\.\d+)(?:\([a-z0-9]{1,4}\))*|§§?\s*(19\d{2}\.\d+)(?:\([a-z0-9]{1,4}\))*/gi;

function linkifyNewsText(text) {
  return escapeHtml(text || '').replace(NEWS_CITE_RE, (m, a, b) => {
    const id = a || b;
    return `<a class="citation-link" href="${sectionHref(29, id)}">${m}</a>`;
  });
}
```
Escaping first is safe: the pattern contains no characters that `escapeHtml` changes (`§` and digits pass through).

**`sectionHref(title, id)` / `partHref(title, part)`**: return `#/title/{t}/section/{id}` when the title is installed, otherwise `#/library/{t}`, with `title="Title {t} isn't installed. Open the library"`. This is what Projects does for sections of uninstalled titles. The installed list is the one `refreshTitles()` already keeps. A section missing from a *partial* install falls through to the reader's normal not-found page, and that is acceptable.

## 5. Acceptance Criteria
- [ ] `normalize_dol_standard("19101030 G02   IIA") == "1910.1030"`, `("19100134 A01") == "1910.134"`, `("19260651 C02") == "1926.651"`, `("") is None`, `("5A0001") is None`.
- [ ] `is_general_duty("5A0001")` is true (once the live code is confirmed).
- [ ] Prose: `"29 CFR 1926.651 and § 1910.1200(a)(1)"` → `["1910.1200", "1926.651"]`; `"29 CFR part 1904"` → part `1904`; `"costs of $1999.5 million"` and `"§ 541.100"` → nothing.
- [ ] Python and JS agree on every example above (the tests list them once and check both).
- [ ] Links to an uninstalled title go to the library, never to a broken reader page.
