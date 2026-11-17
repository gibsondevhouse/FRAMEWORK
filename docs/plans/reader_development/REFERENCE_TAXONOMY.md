# Reader Development — Exhaustive Reference & Citation Taxonomy

*Recorded: 2026-11-16 · Corpus surveyed: `reader/data/title-29.sqlite3` (`2026-11-12` edition), `reader/data/title-3.sqlite3` (`2026-11-12` edition), `reader/data/osha_news.sqlite3`, and the `reader/` rendering/citation pipeline.*

This document catalogs every type of internal and external reference present in the CFR regulatory corpus and the `reader` application, alongside how each is currently handled (or missed/mislinked) by `reader`. It serves as the empirical baseline before designing usability improvements for the reader.

---

## 1. Corpus & Codebase Scope Audited

| Source | Scope | Volume |
| :--- | :--- | :--- |
| `reader/data/title-29.sqlite3` | Title 29 (Labor), edition `2026-11-12` | 7,376 rows in `sections` (7,262 `section`, 114 `appendix`) across 288 distinct parts; 1,028 rows in `front_matter` (421 non-empty XML) |
| `reader/data/title-3.sqlite3` | Title 3 (The President), edition `2026-11-12` | 27 rows in `sections` across 3 parts; 4 rows in `front_matter` (3 non-empty XML) |
| `reader/data/osha_news.sqlite3` | News & DOL enforcement store | 255 rows in `articles` (150 `dol_osha`, 76 FR notices, 18 FR rulemaking, 8 FR rules, 3 public inspection); 246 rows in `article_citations` |
| `reader/` codebase | Linkification, XML rendering, news, UI | `app/render/linkifier.py`, `app/render/html.py`, `app/render/units.py`, `app/render/hierarchy.py`, `app/store.py`, `app/news.py`, `app/chat.py`, `frontend/src/citations.ts`, `frontend/src/views/reader.js`, `frontend/src/views/reader_part.js`, `frontend/src/styles/07_reader.css` |

---

## 2. Executive Summary: Current Reader Handling vs. Corpus Reality

| Reference Family | Observed Count (T29 + T3) | Current `reader` Behavior | Primary Gap / Usability Issue |
| :--- | :--- | :--- | :--- |
| **Internal `§` / `§§` section refs** | 16,515 | Linked via `_XREF` (if in `known_ids`) | Misses semicolon lists (`1910.6`), space-separated `(a)` pinpoints, ranges (`§§ 4.7-4.9`, `1910.1001–1910.1052`) |
| **Relative paragraph / clause refs** | 10,914 | Plain text (unlinked) | `paragraph (a)`, `subparagraph (b)(1)` have no jump link or inline preview |
| **Word-based `section N.N` refs** | 535 (dotted CFR); ~8,919 incl. statutory | Linked via `_WORD_SEC` (when dotted & in `known_ids`) | Misses lists with spaces/appendices (`§ 1910.95 appendixes D and I`) |
| **Internal `Part N` refs** | 2,182 | Linked via `_WORD_PART` | Does **not** check `known_parts`; misses alphanumeric parts (`1912a`, `4022B`, `4041A`), plural lists (`parts 1910 and 1926`), and steals uncaptured cross-title `parts` |
| **Cross-title `N CFR ...` refs** | 2,412 (across 32 titles) | Linked via `_CROSS_TITLE` (internal if installed, else `ecfr.gov`) | Misses plural `parts`, hyphenated FAR/OFCCP parts (`41 CFR part 50-201`, `41 CFR 60-741`), bare lists (`29 CFR 1630.13, 1630.14`), chapters/subparts/appendices, spelled-out `part X of title Y CFR`, and `3 CFR Comp.` |
| **Subparts, Chapters, Subchapters, Titles** | 1,281 subparts; 203 chapters/subchapters; 52 titles | Plain text (unlinked) | No subpart/chapter/title jump links or tree scroll |
| **Appendices, Exhibits, Schedules, Attachments** | 1,285 appendices; 141 exhibits/schedules/annexes | Rendered when opened as `DIV9`/`EXTRACT`, but inline refs are plain text | References like `Appendix A to § 1910.1200` only link `§ 1910.1200`, not the appendix unit/row |
| **Tables, Figures, Equations, Notes** | 1,015 tables; 235 figures; 301 notes; 13 equations | Plain text (unlinked) | No jump-to-table/figure/note within a long section or part |
| **Footnotes (`<FTREF>` / `<FTNT>`)** | 900 pairs (sections) + 1 (`front_matter`) | `<span class="ftref">` at call site; `<div class="reg-footnote">` at unit bottom | No clickable anchor/back-link or hover tooltip; `render_fragment()` drops `front_matter` `<FTNT>` |
| **Federal Register (`FR`) citations** | 7,228 (`FR` cite) + 43 (`3 CFR Comp.`) + 39 prose + 25 `<XREF>` | Linked via `_FR` to `federalregister.gov/citation/{vol}-FR-{page}` | Drops pinpoint pages/ranges; `<XREF>` XML attrs (`ID`, `REFID`, `AMDINSN`) ignored; `<CITA>`/`<SOURCE>` hidden or static |
| **U.S. Code (`U.S.C.`)** | 3,044 + 123 spelled-out + 159 multi-letter | Linked via `_USC` to Cornell LII | Fails on all 159 multi-letter sections (`42 U.S.C. 2000ff`, `2000gg-2`), `5 U.S.C. appendix`, ranges (`651-678` -> 404), lists (`§§ 655, 657`), subsection pins |
| **Public Laws, Stat., R.S., IRC, Named Acts** | 345 Pub. L.; 489 Stat.; 1 R.S.; 71 IRC; 6,782 named acts; 3,229 `section X of Act` | Plain text (unlinked) | Zero statutory resolution or lookup |
| **Presidential & Executive Authorities** | 341 E.O.; 44 Reorg. Plans | Plain text (unlinked) | No links to Federal Register / National Archives E.O. records |
| **Agency Orders, Directives, Guidance, Forms, OMB** | 213 Sec. Orders; 7 directive/CPL; 409 forms; 88 OMB nos.; 11 circulars | `<APPRO>` rendered as callout; rest plain text | No structured form/OMB/directive badges or links |
| **Judicial & Admin Case Law** | 1,539 reporters; 6 WL/LEXIS; 17 NLRB/PTE/Rev. Rul. | Plain text (unlinked) | Case citations, dockets, and admin decisions unlinked |
| **Consensus Standards & IBR** | 1,058+ standard codes (`ANSI`, `NFPA`, `ASTM`, `ISO`, etc.) | Plain text (unlinked) | No link back to local IBR catalog (`§ 1910.6` / `§ 1926.6`) or SDO summary |
| **Chemical, Medical, Hazmat, Industry Codes** | 11+ explicit CAS (+ tables in `1910.119`), RTECS, UN/NA, NAICS/SIC, USP/ILO/NIOSH methods | Plain text (unlinked) | No chemical/method/classification metadata linking |
| **Web URLs, Bare Domains, Email, Phone, Addresses** | 504 URLs (82 hosts); 182 bare domains; 68 emails; 290 phones; 270 DC ZIPs | `_WEB_URL` links `http(s)://` and `www.` only | Bare domains (`dol.gov`), `mailto:`, `tel:`, and physical reading rooms unlinked; legacy dead URLs (`wdol.gov`, `epls.arnet.gov`) unmarked |
| **FR Graphics (`<img>`)** | 571 images | Mapped to `img.federalregister.gov/{ID}/{ID}_large.png` | External network dependency with fallback link on error |

---

## 3. Complete Taxonomy of Reference Types

### Category 1: Intra-Title CFR Structural References (Within the Active Title)

These refer to targets inside the same CFR title (`Title 29` or `Title 3` in the current corpus).

1. **Standard `§` / `§§` section citations (`16,515` hits)**
   - Single section: `§ 1910.120`, `§ 541.100`
   - Hyphenated sub-numbered sections (agency ethics / ERISA / PBGC): `§ 0.735-1`, `§ 2510.3-1`, `§ 2520.101-5`, `§ 2590.715-1251`, `§ 4022.27`
   - Letter-suffixed sections: `§ 4.1a`, `§ 4.1b`, `§ 776.0a`, `§ 1912a.1`
   - Reserved section ranges stored as a single SQLite `sections.id`: `§§ 4.7-4.9`, `§§ 21.105-21.106`, `§§ 102.104-102.109`
   - Inline multi-section lists with commas, `and`, `or`, `through`, `to`: `§§ 1910.34, 1910.35, 1910.36, and 1910.37`, `§§ 1910.1001 through 1910.1052`
   - **Semicolon-separated section lists** (`15` hits, mostly in IBR `§ 1910.6`): `§§ 1910.219(c)(5)(iii); 1910.261 (a)(3)(i), (c)(10), and (k)(21); and 1910.265(c)(2)`
   - **Hyphen / en-dash section ranges**: `§§ 1910.1001-1910.1052` (not stored as a single row ID)
2. **Word-based CFR section references (`535` dotted CFR hits)**
   - Singular/plural: `section 4.4(a)(3)`, `Section 5.29`, `sections 1910.120 and 1910.134`
   - Contrast with **non-CFR** `"section N"` (statute/act/contract sections, e.g., `section 8`, `section 501(c)(3)`, `section 4(c)` — ~8,384 occurrences that must *not* be linked as CFR sections).
3. **Paragraph, subparagraph, clause, and item pinpoints**
   - **Attached pinpoints**: `§ 1910.120(b)(1)(ii)(A)`, `§ 1910.110(b)(13)(ii)(b)(1)`
   - **Space-separated pinpoints** (`140` hits): `§ 4.6 (o)`, `§ 30.11 (d)`, `§ 93.100 (a)`, `§§ 18.803 (25)`, `§ 1910.261 (a)(3)(i), (c)(10), and (k)(21)`
   - **Topic-annotated / qualified pinpoints**: `§ 10.52 (debarment)`, `§ 1910.94(a)(4)(i) introductory text`, `§ 1910.120, PEL definition`
   - **Relative / standalone paragraph references (`10,914` hits)**: `paragraph (a)`, `paragraphs (b)(1) and (c)(2)`, `paragraph (a)(2)(i) of this section`, `subparagraph (ii)`, `clause (1)`, `item (A)`
4. **Part references (`2,182` `part N` hits)**
   - Singular & plural: `Part 1910`, `parts 1, 3, 5, and 7 of this chapter`, `parts 1910 and 1926`
   - Alphanumeric part IDs (exist in Title 29!): `Part 1912a`, `Part 4022B`, `Part 4041A`
   - Part with scope qualifier: `part 541 of title 29`, `this part`
   - **Legacy / transferred / removed parts still referenced in prose** (38+ non-CFR-prefixed hits in T29): e.g., `part 1500 of this title` (`779.502`, `780.4`), `part 800 of this chapter` (`779.6`, `779.501`), `part 522`, `part 524`, `part 526`, `part 545`, `part 695`, `part 791`, `part 792`, `part 656` (actually Title 20).
5. **Subparts, Subject Groups, Chapters, Subchapters, Subtitles, Titles**
   - `Subpart` / `Subparts` (`1,281` hits): `Subpart Z`, `subpart D of this part`, `Subparts A through E`, `subpart 23`
   - `Chapter` / `Subchapter` / `Subtitle` (`203` hits): `Chapter XVII`, `Subchapter II`, `this chapter`, `this subtitle`
   - `Title` (`52` hits): `Title 29`, `this title` (also appears in statute titles like `Title VII`, `Title I of ERISA`)
6. **Appendices, Supplements, Exhibits, Schedules, Attachments, Annexes**
   - Top-level `DIV9` appendices (`114` rows in T29): `Appendix A to Subpart D of Part 2`, `Appendix A to 29 CFR Part 10`, `Appendix A to Part 13`, `Appendix A to §§ 1605.2 and 1605.3`, `Appendix to Part 1440`
   - Embedded `<EXTRACT>` appendices inside sections (`58` sections in T29): `Appendix A to § 1910.1200`, `Appendix E to § 1910.120`, `Appendix A to § 1910.119`
   - Inline prose references (`1,285` hits): `appendix C to this subpart`, `§ 1910.66 app. D (b) through (d)`, `§ 1910.95 appendixes D and I`, `Appendix B to § 1910.1200`, `section 1636.5(f) of this appendix` (subsections inside an appendix)
   - Other attachments (`141` hits): `Exhibit`, `Schedule 4`, `Schedule 40`, `Supplement 1`, `Attachment A`, `Annex 4-B`
7. **Tables, Figures, Equations, Notes, Examples, and Footnotes**
   - `Table` (`1,015` hits): `Table Z-1`, `Table 1`, `Tables F-1`, `Table H-22, ftn. 3`, `§ 510.10 Table of wage rates`
   - `Figure` / `Fig.` (`235` hits): `Figure 1`, `Figure D-1`, `§ 5.30, figure 1 to paragraph (c)`
   - `Equation` / `Formula` (`13` hits): `Equation 1` (`1910.269`), `<MATH>` (`42` elements)
   - `Note` (`301` explicit `Note to ...` hits; `653` `<NOTE>` tags): `Note 1 to paragraph (g)`, `Note 2 to paragraph (l)`
   - `Example` (`279` `<EXAMPLE>` tags)
   - `Footnote` (`900` `<FTREF>`/`<FTNT>` pairs in sections, `1` in `front_matter`, `19` prose hits like `footnote 23`), plus internal note back-references (`55` `supra note N` hits, e.g., `supra note 152, at text accompanying nn.91-95` in `Appendix A to Part 1636`)
8. **Deictic / Relative & Legal-Shorthand Internal References**
   - Relative scope pointers (`25,436` hits): `this section`, `this paragraph`, `this subparagraph`, `this clause`, `this item`, `this subpart`, `this part`, `this appendix`, `this chapter`, `this title`, `this subtitle`, `preceding paragraph`, `following table`, `above`, `below`, `herein`, `thereof`, `thereto`
   - Latin / legal shorthand (`550` hits): `et seq.`, `id.`, `supra`, `infra`, `cf.`

---

### Category 2: Cross-Title CFR & Historical CFR References

Across Title 29 and Title 3, **32 distinct CFR titles** (`1, 3, 4, 5, 8, 10, 13, 14, 15, 17, 19, 20, 21, 23, 26, 27, 28, 29, 30, 31, 32, 33, 34, 36, 40, 41, 42, 45, 46, 48, 49, 50`) are referenced (**2,412** structured `N CFR ...` hits; **2,352** total `N CFR` mentions). Top cited titles in Title 29 are `29` (1,510), `20` (171), `40` (93), `45` (91), `31` (83), `49` (82), `26` (72), `5` (71), `3` (48), `41` (37), `42` (35).

1. **Standard `N CFR` section & part references**
   - With `§` / `§§`: `40 CFR § 261.3`, `49 CFR § 172.101`, `29 CFR §§ 102.60 and 102.61`
   - Bare section: `29 CFR 1635.3(c)`, `49 CFR 172.101`
   - Bare multi-section list without `§`: `29 CFR 1630.13, 1630.14`, `40 CFR 261.2 and 261.3`
   - Single part: `5 CFR part 2635`, `40 CFR Part 261`
   - Plural parts & ranges (`69` hits): `40 CFR parts 1500-1508`, `40 CFR parts 1501 and 1502`, `31 CFR parts 900-904`, `29 CFR parts 1910 and 1926`
   - Comma-chained part lists sharing one title prefix: `5 CFR part 2634, part 2635, part 2640`
2. **Hyphenated part & section schemes (`63` hits)**
   - Public Contracts / OFCCP / Defense / IRS / FPMR numbering: `41 CFR part 50-201`, `41 CFR 60-741`, `41 CFR 50-203`, `41 CFR part 60-30`, `41 CFR part 60-3`, `32 CFR 1-403`, `26 CFR 1.401(a)-1`, `FPMR 101-11.11`
3. **Hierarchical / compound cross-title citations (`203` hits)**
   - Chapter / Subchapter: `48 CFR chapter 1`, `50 CFR chapter I, part 17`, `50 CFR chapter II`
   - Part + Subpart: `20 CFR part 655, subpart B`, `20 CFR part 725, subpart B`, `29 CFR part 2, subpart D`, `48 CFR part 23, subpart 23`
   - Part + Appendix: `36 CFR part 1191, appendix B`
4. **Spelled-out Title / CFR inversions (`31` `title N ... CFR` + `44` `of title N` hits)**
   - `part 752 of title 5, Code of Federal Regulations` (`20.78`)
   - `subpart B of part 930 of title 5 of the CFR` (`579.2`, `580.1`)
   - `part 541 of title 29`
5. **Annual / Historical CFR Compilations (`43` hits)**
   - Presidential documents compiled in Title 3: `3 CFR, 1989 Comp., p. 215`, `3 CFR 1949-53 Comp.`, `3 CFR, 1964-1965 Comp.`, `3 CFR, 2014 Comp.`
   - Point-in-time historical editions: e.g., `29 CFR ... (1970 ed.)`

---

### Category 3: Federal Register (`FR`) & Rulemaking/Amendment Metadata

1. **Standard volume-page FR citations (`7,228` hits)**
   - Simple: `39 FR 23502`, `88 FR 57722`
   - Dated / pinpoint / multi-citation: `[48 FR 19533, Apr. 29, 1983, as amended at 50 FR 49823, Dec. 4, 1985; 88 FR 57722, Aug. 23, 2023]`, `55 FR 6737 and 6751, Feb. 26, 1990`
2. **Spelled-out Federal Register citations (`18` hits)**
   - `Federal Register, Vol. 55, p. ...`, `Federal Register 51 ...`
3. **eCFR XML Amendment `<XREF>` Nodes (`25` elements: `21` in sections, `4` in `front_matter`)**
   - Attributes carry machine-readable metadata (`ID`, `REFID`, `AMDINSN`):
     - `<XREF ID="20261109" REFID="16" AMDINSN="2">Link to an amendment published at 91 FR 70794, Nov. 9, 2026.</XREF>`
     - Delayed/stayed amendment chains (e.g., `part/104` `front_matter`): `This amendment was delayed until Apr. 30, 2012, at 76 FR 82133, Dec. 30, 2011.` / `This amendment was further delayed indefinitely...`
4. **CFR Editorial, Effective Date, Source, & Amendment History Tags**
   - `<CITA>` (`2,451` T29 sections + `4` T3): Section-level Federal Register amendment trail
   - `<SOURCE>` (`350` T29 + `3` T3 `front_matter`): Part/subpart original promulgation and redesignation history (`Redesignated at 61 FR 57287, Nov. 6, 1996`)
   - `<EFFDNOT>` (`12` total): Effective Date Notes documenting stays, suspensions, and future effective dates (`At 74 FR 26014, May 29, 2009, § 780.115 was redesignated... and suspended`)
   - `<EDNOTE>` (`20` total): Editorial Notes pointing to the **List of CFR Sections Affected (LSA)** (printed Finding Aids & `www.govinfo.gov`), unexecutable amendatory instructions, and Congressional Review Act (CRA) disapprovals (`82 FR 29236`)
   - `<CROSSREF>` (`1` in `part/93` `front_matter`): OMB cross-reference notice (`54 FR 52306`)
5. **Federal Register Graphics (`571` `<img>` tags)**
   - All 571 `<img>` elements in Title 29 use FR-derived paths `/graphics/{prefix}{DD}{mmm}{YY}[a].{NNN}.gif` (e.g., `/graphics/er23au23.002.gif`), which `html.py:image_urls()` maps to `https://img.federalregister.gov/{ID}/{ID}_large.png` and `_original_size.png`.
6. **Federal Register API / Newsroom References (`osha_news.sqlite3`)**
   - FR Document Numbers (`guid = "fr:2026-22023"`), Public Inspection filings (`federal_register_pi`), scheduled publication dates, comment deadlines, effective dates, FR `html_url`s, GovInfo FR `pdf_url`s (`https://www.govinfo.gov/content/pkg/FR-YYYY-MM-DD/pdf/{doc}.pdf`), and FR `docket_ids` (`Docket No. OSHA-2011-0028`).

---

### Category 4: Statutory, Legislative, & Constitutional Authorities

1. **United States Code (`U.S.C.` / `U.S.C.A.`)**
   - Standard (`3,044` hits): `29 U.S.C. 653`, `18 U.S.C. 207(a)`, `29 U.S.C. 213(a)(17)`
   - **Multi-letter section numbers (`159` hits)**: `42 U.S.C. 2000ff(4)` (GINA), `42 U.S.C. 2000gg-2(f)` (PWFA), `42 U.S.C. 2000bb` (RFRA), `42 U.S.C. 2000cc-5`
   - **Omitted period / variant punctuation**: `42 U.S.C 2000gg-2`, `U.S.C.A.`
   - **Appendices & statutory notes**: `5 U.S.C. appendix`, `5 U.S.C. app. 1`, `28 U.S.C. 2461 note`
   - **Ranges, lists, and `et seq.`**: `29 U.S.C. 651-678`, `40 U.S.C. 3141 et seq.`, `29 U.S.C. §§ 655, 657`
   - **Spelled-out inversions (`123` `title N U.S.C.` hits)**: `chapter 75 of title 5 U.S.C.`, `section 5332 of title 5`
2. **Public Laws (`345` hits)**
   - Formats: `Pub. L. 92-473`, `Public Law 115-35`, `P.L. 91-596`
3. **United States Statutes at Large (`489` hits) & Revised Statutes (`1` hit)**
   - Statutes at Large: `46 Stat. 1494`, `52 Stat. 1067`, `80 Stat. 309`, `121 Stat. 112`
   - Revised Statutes: `R.S. 161` (`part/3` `<AUTH>`)
4. **Named Federal Acts & Statute-Relative Sections (`6,782` named-act hits; `3,229` `section X of the ...` hits)**
   - Examples: `Occupational Safety and Health Act of 1970` (`OSH Act`, `section 5(a)(1)`), `Fair Labor Standards Act` (`FLSA`, `section 13(a)(1)`), `ERISA` (`235` `ERISA section ...` / `ERISA § ...` hits, e.g., `ERISA section 3(38)`, `ERISA § 502(a)`), `FMLA`, `ADA`, `ADEA`, `GINA`, `PWFA`, `Davis-Bacon Act`, `Service Contract Act`, `Walsh-Healey`, `NLRA` (`section 8(b)(7)(C)`, `Section 9(c)`), `LMRA`, `LMRDA`, `Rehabilitation Act` (`section 504`), `FOIA`, `APA`, `CRA`, `PRA`, `NEPA`, `HIPAA`, `ACA`, `COBRA`, `Clean Air Act`, `TSCA`, `RCRA`.
5. **Internal Revenue Code (`71` `Code/IRC section ...` hits; `4` explicit `IRC` hits)**
   - `Internal Revenue Code section 412(e)(3)`, `IRC section 436`, `Code section 401(a)`, `Code section 4975(f)(8)`, `section 501(c)(3) of the Internal Revenue Code`
6. **Congressional Reports, Bills, & Legislative History (`262` hits)**
   - House/Senate/Conference reports & record: `H. Rept. No. 948, 89th Cong., 1st sess., p. 4`, `S. Rept. 798`, `Conf. Rept.`, `Cong. Rec.`

---

### Category 5: Presidential & Executive Authorities

1. **Executive Orders (`341` hits)**
   - Formats: `E.O. 12674`, `Executive Order 11246`, `Executive Order 13658`, `Executive Order 14026`, `E.O. 14015` (often paired with `3 CFR, YYYY Comp.` and `FR` cites in `<AUTH>`)
2. **Reorganization Plans (`44` hits)**
   - Examples: `Reorganization Plan No. 14 of 1950`, `Reorganization Plan No. 6 of 1950`, `Reorganization Plan No. 1 of 1978`, `Reorganization Plan No. 4 of 1978`
3. **Presidential Proclamations & Memoranda**
   - References to presidential directives/proclamations in authority/text; Title 3 covers EOP agencies (`Parts 100–102`).

---

### Category 6: Agency Orders, Directives, Guidance, Forms, OMB, & Programs

1. **Department & Agency Orders (`213` hits)**
   - `Secretary's Order 01-2020`, `Secretary of Labor's Order 01-2014`, `Secretary's Order No. 16-75`, `Employment Standards Order No. 76-2`
2. **Agency Directives, Compliance Instructions, Bulletins, & Rulings**
   - OSHA Instructions / Compliance Directives (`7` hits): `OSHA Instruction DFO CPL 2.70`, `OSHA Instruction DFO CPL 2-2.37A`, `Compliance Directive 02-00-066`
   - DOL / WHD / EBSA / EEOC / IRS guidance (`17` structured hits + prose): `Field Assistance Bulletin No. 2023-02`, `Interpretive Bulletin` (`Part 2509`), `Prohibited Transaction Exemption 76-1`, `PTE 77-9`, `Advisory Opinion`, `Rev. Rul. 76-47`, `Rev. Rul. 81-100`, `Rev. Rul. 95-6`, `Rev. Proc. 2015-34`, EEOC `Enforcement Guidance` & `Compliance Manual`
3. **OMB Approvals, Control Numbers, & Circulars**
   - `<APPRO>` XML tags (`77` total: `74` in sections, `3` in `front_matter`)
   - Explicit OMB Control Numbers (`88` hits): `OMB control number 1245-0003`, `control number 1235-0018`, `1225-0013`
   - OMB Circulars & Interagency Controls (`11` circulars; `1` interagency control): `OMB Circular A-87`, `OMB Circular A-102`, `OMB Circular A-110`, `OMB Circular A-122`, `OMB Circular A-133`, `interagency report control number 1482-DOL-SA` (`§ 5.7`)
4. **Federal & Agency Forms (`409` hits)**
   - `Form SF-308`, `Standard Form 95`, `Standard Form 91`, `SF-194`, `Form WH-347`, `WH 1313`, `WH-1321`, `OSHA Form 300`, `Form 5500`, `Form LM-2`
5. **Wage Determinations & Occupational Systems (`332` hits)**
   - Davis-Bacon / Service Contract `Wage Determination` (`WD`), `SAM.gov` / legacy `wdol.gov`, `Dictionary of Occupational Titles` (`DOT`)

---

### Category 7: Judicial & Administrative Case Law

1. **Published Federal Court Reporters (`1,539` hits)**
   - Supreme Court: `323 U.S. 134 (1944)`, `317 U.S. 501, 507-509 (1943)`, `S. Ct.`, `L. Ed.`
   - Appellate & District Courts: `593 F.2d 1250 (D.C. Cir. 1978)`, `618 F.2d 1088 (4th Cir. 1980)`, `381 F. Supp. 657 (D NJ 1974)`, `466 F. Supp. 112 (D DC 1979)`, `F.3d`, `F.4th`, `F. Supp. 2d/3d`, `F.R.D.`
2. **Unpublished Electronic Citations & Court Dockets (`6` WL/LEXIS hits; `2` court dockets)**
   - Westlaw / Lexis: `2022 WL 128815, at *8-*9 (E.D. Mich. Jan. 12, 2022)`, `2003 LEXIS 450392`
   - Civil/Appellate Dockets: `No. 2:21-CV-10967`, `[Docket No. 06-2272 and consolidated cases]` (`§ 1910.1026`)
3. **Administrative Agency Adjudications**
   - NLRB Decisions (`118 NLRB No. 19`, `98 NLRB 268`, `192 NLRB No. 150`)
   - OSHRC / FMSHRC / ARB / BALCA dockets and decisions

---

### Category 8: Consensus Technical Standards & Incorporation by Reference (IBR)

Centralized in `§ 1910.6`, `§ 1910.509`, `§ 1915.5`, `§ 1917.3`, `§ 1918.3`, `§ 1926.6`, `Appendix D to Subpart L of Part 1910`, `Appendix A to Part 1926`, and cited inline across safety/health parts (`1,058+` standard designators).

1. **Standards Developing Organizations (SDOs) & Code Bodies**
   - Top observed prefixes: `ANSI` (345), `NFPA` (246), `ASTM` (221), `IEEE` (116), `ANSI/NFPA` (95), `ASME` (90), `NIOSH` (78), `SAE` (67), `PHS` (64), `ISO` (46), `UN` (36), `ILO` (25), `CGA` (19), `ANSI/IEEE` (17), `ANSI/ISEA` (16), `API` (16), `AWS` (16), `API-ASME` (15), `DOT` (13), `ANSI/ASME` (13), `ANSI/SIA` (9), `ASAE` (7), `BS` (7), `IME` (6), `ATS` (6), `IEC` (4), `IFC` / `ICC` (4), `ISO/IEC` (4), `UL` (3), `ACGIH` (3), `ACI` (3), `DIN` (2), `NEMA` (2), plus `AAI-RMA`, `CMAA`, `NSC`, `SSPC`, `GSA` (`Pub. GG-B-0067b`), `USAS`.
   - Format variants: hyphenated edition years (`ANSI Z87.1-2003`, `NFPA 101-2009`), reaffirmations (`ANSI Z535.1-2006 (R2011)`), joint standards (`ANSI/ISEA Z87.1-2010`, `ISO/IEC ...`), part/addenda suffixes (`ASME Boiler and Pressure Vessel Code, Sec. VIII, Paragraph UG-84`), and reseller references (`Accuris`, `GlobalSpec`, `Nimonik Document Center`, `Techstreet`, `ANSI Webstore`).
2. **Analytical Methods, Government Technical Publications, & Scientific Literature (`70` method/pub hits)**
   - `OSHA method ID-160`, `NIOSH Method 7400`, `NIOSH Method S311`, `ASTM Method D2161-66`
   - `DHHS (NIOSH) Publication No. 83-126`, `NIOSH Pub. No. 77-157`, `NTIS-PB267461`, `ISBN: 0-936712-66-X`
   - Peer-reviewed / clinical literature: `Am. J. Respir. Crit. Care Med.` (`§ 1910.6(i)(1)`), `ACOG Committee Opinion` (`Appendix A to Part 1636`)
3. **Nationally Recognized Testing Laboratories (`131` `NRTL` hits)**
   - `§ 1910.7` recognition program; also covered in `osha_news.sqlite3` FR notices (`Intertek`, `TUV SUD`, `Nemko`).

---

### Category 9: Chemical, Hazmat, Medical, & Industrial Identifiers

1. **CAS Registry Numbers**
   - Explicit inline (`11` hits): `CAS Registry No. 71-43-2`, `CAS No.: 1306-19-0`, `CAS 8052-42-4`
   - Bare tabular CAS IDs (hundreds of rows, e.g., `§ 1910.119 Appendix A` chemical table: `75-07-0`, `107-02-8`, `7664-41-7`)
2. **RTECS, DOT UN/NA Hazmat Numbers, & GHS**
   - `RTECS EY0175000` (`16` `RTECS` hits)
   - `NA 2570 (DOT)` (`§ 1910.1027`), `UN ST/SG/AC.10/11/Rev.6`, `United Nations Globally Harmonized System (GHS)`
3. **Medical, Toxicology, & Exposure Limits (`674` hits)**
   - `ILO International Classification of Radiographs of Pneumoconioses`, `B Reader`
   - `U.S. Pharmacopeia` (`USP`)
   - Exposure / toxicologic metrics: `PEL`, `REL`, `STEL`, `IDLH`, `TLV`, `BEI`, `LD50`, `LC50`
4. **Industry Classification Codes**
   - `SIC code 5810`, `SIC 5812` (`Appendix B to Part 510`)
   - `NAICS` codes in `osha_news.sqlite3` enforcement records (e.g., `812331`, `237110`)

---

### Category 10: Websites, Bare Domains, Portals, Contact Channels, & Physical Repositories

1. **Explicit `http(s)://` and `www.` URLs (`504` hits across `82` distinct hosts)**
   - **Federal agencies & portals**: `www.osha.gov`, `www.dol.gov`, `www.pbgc.gov`, `www.eeoc.gov`, `www.cdc.gov`, `www.archives.gov`, `www.fmshrc.gov`, `www.oshrc.gov`, `www.fmcs.gov`, `www.nlrb.gov`, `www.govinfo.gov`, `www.pay.gov`, `www.census.gov`, `publicportal.eeoc.gov`, `publicportalfoiapal.eeoc.gov`, `www.sam.gov`, `alpha.sam.gov`, `www.nmb.gov`, `www.foia.gov`, `ntp.niehs.nih.gov`, `www.gao.gov`, `www.irs.gov`, `www.fhwa.dot.gov`, `www.healthcare.gov`, `www.union-reports.dol.gov`, `www.opm.gov`, `www.olms.dol.gov`, `www.atf.gov`, `dockets.osha.gov`, `www.womenshealth.gov`, `www.epa.gov`, `www.csb.gov`, `www.usbr.gov`, `www.gsa.gov`, `www.usace.army.mil`, `www.sec.gov`, `www.efast.dol.gov`, `www.regulations.gov`, `www.treasury.gov`
   - **Legacy / retired federal URLs still in CFR text**: `www.wdol.gov` (`5` hits — migrated to `sam.gov`), `epls.arnet.gov` (`1` hit — migrated to `sam.gov`)
   - **State government URLs**: `www.dir.ca.gov`, `app.leg.wa.gov`, `www.dllr.state.md.us`
   - **SDOs & commercial resellers**: `webstore.ansi.org`, `www.ansi.org`, `www.astm.org`, `www.nfpa.org`, `www.iso.org`, `www.asme.org`, `www.acgih.org`, `www.safetyequipment.org`, `www.nsc.org`, `www.iec.ch`, `din.de`, `www.asabe.org`, `www.aws.org`, `www.bsigroup.com`, `www.ime.org`, `www.aem.org`, `www.sae.org`, `global.ihs.com`, `techstreet.com`, `www.document-center.com`, `store.accuristech.com`, `standards.globalspec.com`
   - **International / Medical / Academic / NGO**: `www.ilo.org`, `shop.un.org`, `www.acog.org`, `www.acoem.org`, `www.atsjournals.org`, `www.sand.org`, `www.nap.edu`, `www.soa.org`, `askjan.org`, `www.massnonprofitnet.org`, `www.merriam-webster.com`, `www.youtube.com`
   - **Formatting edge cases**: trailing colons (`www.ansi.org:`), trailing periods (`http://www.wdol.gov.`), trailing commas/parens
2. **Bare domains without `http://` or `www.` (`182` total domain hits without protocol; `4` unique bare non-`www` hosts)**
   - e.g., `dol.gov` (`1.3`), `nmb.gov` (`1208.2`), `reports.dol.gov` (`70.53`), `archives.gov` (`1910.6` / `510.21`)
3. **Email Addresses (`68` hits)**
   - e.g., `fr.inspection@nara.gov`, `FOIA@eeoc.gov`, `dba.reconsideration@dol.gov`, `CRCExternalComplaints@dol.gov`, `info@ansi.org`, `service@astm.org`, `store@techstreet.com`
4. **Telephone, Toll-Free, Fax, & TTY Numbers (`290` hits)**
   - e.g., `202-693-2350`, `(202) 693-6500`, `1-877-872-5627`, `877-889-5627` (TTY)
5. **Physical Addresses, Reading Rooms, & Libraries (`145` institutional hits; `270` `Washington, DC 20210` hits)**
   - `OSHA Docket Office` (`200 Constitution Avenue NW, Room N-3508`), `OSHA Technical Data Center`, `National Archives (NARA)`, `Office of the Federal Register`, `Federal Depository Library`, `OSHA Regional Offices`

---

### Category 11: State, Local, & International Legal References

1. **State Plan & State Statutory / Regulatory Citations**
   - `State Plan States` (`§ 1902.7`, `§ 1904.37`), `Cal/OSHA` (`www.dir.ca.gov`), `app.leg.wa.gov`, `www.dllr.state.md.us`, `Mass. Gen. Laws ch. ...`
   - State-plan violation codes in `osha_news.sqlite3` (e.g., `296-800-15030` — WA WAC code, counted as `unmapped_standards`)
2. **International Agreements, Conventions, & Foreign Standards (`58` hits)**
   - `USMCA` (`Part 810`), `ILO Convention` (`Appendix I to Part 1918`), `ADR 2019` (`§ 1910.6(dd)`), `DIN 51794:2003-05`, `BS`, `UN` Dangerous Goods

---

### Category 12: Application-Layer References Inside `reader`

1. **`app/render/linkifier.py` (`make_linkifier`)**:
   - Seven sequential passes over text nodes outside `<a>` tags:
     1. `_WEB_URL` -> `<a class="xref xref-web" target="_blank">`
     2. `_USC` -> `<a class="xref xref-usc" href="https://www.law.cornell.edu/uscode/text/{t}/{s}">`
     3. `_FR` -> `<a class="xref xref-fr" href="https://www.federalregister.gov/citation/{v}-FR-{p}">`
     4. `_CROSS_TITLE` -> `<a class="xref xref-cross">` (`#/title/{t}/...` if installed) or `<a class="xref xref-external">` (`https://www.ecfr.gov/current/title-{t}/...`)
     5. `_XREF` (`§` / `§§`) -> `<a class="xref" href="#/title/{t}/section/{s}?p=...">` (only when `known(s)`)
     6. `_WORD_SEC` (`section(s) ...`) -> same as `_XREF`
     7. `_WORD_PART` (`part(s) N`) -> `<a class="xref xref-part" href="#/title/{t}/part/{p}">`
2. **News & Enforcement (`app/news.py`, `frontend/src/citations.ts`, `frontend/src/components/news_activity.js`)**:
   - Extracts Title 29 parts (`_CFR_PARTS`) and sections (`_CROSS_TITLE`, `_XREF` restricted to `1900–1999`, mirrored in `NEWS_CITE_RE`).
   - Maps DOL `violation.standard` (`19101030 G02` -> `1910.1030`), flags General Duty Clause (`5A...`) and state-plan codes, links `activity_nr` to `https://www.osha.gov/ords/imis/establishment.inspection_detail?id={act_nr}`.
   - Bidirectional activity popover (`#news-pop`) on Title 29 section and part views.
3. **Reader Navigation, Deep Anchors, Chat, & Workspaces**:
   - Deep paragraph scroll/highlight via `?p=(f)(1)` (`reader.js:highlightParagraph` — matches `.reg-p .pmark`, opens the unit containing `(f)`).
   - Unit anchors `#u-{key}`, paragraph IDs `#p{n}`, full-part anchors `#sec-{id}` (`?from={sectionId}`).
   - External eCFR button (`data.ecfr_url` from `ecfr_path`).
   - Claude assistant (`chat.py`) inline Title-prefixed citations (`29 CFR § 1910.120`) and selection floating tool (`selection_tool.js`).
   - Workspace/Project section pins (`localStorage` dossiers).

---

## 4. Verified Bugs & Blind Spots in the Current Pipeline

Direct runs of `make_linkifier` against real corpus strings uncovered concrete bugs worth addressing alongside any reader UX improvements:

1. **Cross-title plural `parts` stolen into Title 29**: `_CROSS_TITLE` only matches singular `part \d+`, so `40 CFR parts 1500-1508` skips pass D and is hit by pass G (`_WORD_PART`), producing `<a href="#/title/29/part/1500">parts 1500</a>` (wrong title, wrong range).
2. **Chained cross-title `part` lists stolen into Title 29**: `5 CFR part 2634, part 2635, part 2640` links `part 2634` to Title 5 eCFR, then `_WORD_PART` links `part 2635` and `part 2640` to `#/title/29/part/2635` (broken Title 29 links).
3. **Hyphenated parts truncated**: `41 CFR part 50-201` matches `41 CFR part 50`, linking to the wrong part (`part-50`) and leaving `-201` outside the anchor; `41 CFR 60-741` is completely unlinked.
4. **Unvalidated `_WORD_PART` targets**: Unlike `_XREF`/`_WORD_SEC`, `_WORD_PART` never checks `known_parts`. Legacy references (`part 1500`, `part 800`, `part 526`), spelled-out cross-title parts (`part 752 of title 5, Code of Federal Regulations`), and plural lists (`29 CFR parts 1910 and 1926`) either create 404 links or leave secondary parts unlinked.
5. **Alphanumeric parts missed**: `Part 1912a`, `Part 4022B`, and `Part 4041A` are real parts in `title-29.sqlite3` but fail `\d{1,4}`.
6. **Multi-letter U.S.C. sections fail completely**: `_USC` uses `[0-9]+[a-z]?`, missing all 159 occurrences of `42 U.S.C. 2000ff`, `2000gg-2`, `2000bb`, `2000cc-5` (PWFA, GINA, RFRA, RLUIPA), as well as `5 U.S.C. appendix` and lists like `29 U.S.C. §§ 655, 657`. Ranges like `29 U.S.C. 651-678` produce a broken Cornell LII `/651-678` URL.
7. **CFR section syntax blind spots**: `_XREF` / `_NUM_IN_LIST` miss semicolon-separated lists (`§ 1910.6`), space-separated `(a)` pinpoints (`§ 4.6 (o)`), reserved-range section IDs (`§§ 4.7-4.9`, `§§ 102.104-102.109`), and bare cross-title lists (`40 CFR 261.2 and 261.3`, `29 CFR 1630.13, 1630.14`).
8. **Lost `<FTNT>` in `front_matter`**: `Renderer.render_fragment()` (`app/render/html.py`) never emits `self.footnotes`, silently dropping the `<FTNT>` present in `part/102/subpart/D`.
