# Title 14 & CFR Appendix Collisions (`sections.id` Unique Constraint) & Multi-Corpus Extensibility

## 1. Symptom
When downloading **Title 14** (Aeronautics and Space) or **Title 47** (Telecommunication), the ingestion / indexing job fails during the indexing phase with:
```text
sqlite3.IntegrityError: UNIQUE constraint failed: sections.id
```

---

## 2. Root Cause Analysis Across CFR Titles

In `reader/app/build.py`, the SQLite `sections` table schema enforces `id TEXT PRIMARY KEY`:
```sql
CREATE TABLE sections (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,           -- 'section' or 'appendix'
    ord INTEGER NOT NULL,
    part TEXT,
    label TEXT NOT NULL,
    title TEXT NOT NULL,
    reserved INTEGER NOT NULL,
    path TEXT NOT NULL,
    ecfr_path TEXT,
    xml TEXT NOT NULL,
    text TEXT NOT NULL
);
```

### The Flawed Assumption
The schema assumes `id` is globally unique within each title. While numbered CFR sections (e.g. `§ 1910.120`) and most appendices (`Appendix A to Part 1910`) include the Part number in their identifier, **eCFR does not guarantee unique identifiers across Parts for non-standard leaf nodes**:

1. **Title 14 (Aeronautics and Space - FAA)**:
   Special Federal Aviation Regulations (**SFARs**) are categorized as `appendix` by eCFR. They apply to multiple parts simultaneously and share the exact same identifier string:
   - `Special Federal Aviation Regulation No. 97` (appears in Parts 71, 91, 95, 121, 125, 129, 135)
   - `Special Federal Aviation Regulation No. 50-2` (appears in Parts 91, 121, 135)
   - `Special Federal Aviation Regulation No. 60` (appears in Parts 91, 93)
   - `Special Federal Aviation Regulation No. 71` (appears in Parts 121, 135)
   - `Special Federal Aviation Regulation No. 89` (appears in Parts 125, 135)

2. **Title 47 (Telecommunication - FCC)**:
   - `Alphabetical Index` is categorized as `appendix` and appears across multiple parts: Part 73, Part 74, Part 76, and Part 78.

3. **Title 35**: Reserved / empty title (returns 404 from eCFR).

---

## 3. The Bigger Picture: Multi-Regulatory Corpus Challenges

As FRAMEWORK expands beyond eCFR (Federal Regulations) to other regulatory frameworks:
- **USC (United States Code)**: Statutes with Title, Section, Chapter, Notes, and Appendices (e.g., 29 U.S.C. § 654).
- **State Administrative Codes**: E.g., Cal/OSHA (Title 8 CCR), Washington DOSH (WAC 296), Michigan MIOSHA, NYCRR.
- **Industry Standards**: NFPA, ANSI, ASME, ISO (often cited by reference in CFR/state law).
- **Foreign / International Frameworks**: E.g., UK HSE Regulations, EU Directives, Canadian OHS.

### Idiosyncrasies & Collision Risks in Other Frameworks:
| Framework | Common Gotcha / Quirk | ID Collision Vector |
| :--- | :--- | :--- |
| **State Codes (e.g. Cal/OSHA)** | Separate tables, orders, indexes, and appendices embedded inside subchapters without unique identifiers. | Duplicate generic IDs like `"Table 1"`, `"Appendix A"`, `"Index"`. |
| **USC (Statutory Law)** | Historical cross-references, notes (`"Notes following Section X"`), uncodified public laws. | Multiple uncodified notes or repealed section placeholders sharing section numbers. |
| **Industry Consensus Standards** | Standard + revision year + annexed guidelines (`Annex A`, `Appendix B`). | Many standards use `"Section 1.1"`, `"Annex A"` without standard prefixing. |
| **Cross-Jurisdiction Merging** | Federated search across Federal CFR + State OSHA + Standards. | An ID like `1910.120` might collide with state parallel codes if corpus prefix is missing. |

---

## 4. Architectural Solutions to the Collision Issue

Below are three viable ways to solve the duplicate leaf ID issue:

### Solution A: Composite Primary Key `(part, id)` or `(kind, part, id)`
- **How it works**:
  Change the SQLite schema from `id TEXT PRIMARY KEY` to `PRIMARY KEY (part, id)` or `PRIMARY KEY (kind, part, id)` (with empty string for root/title-level leaves).
- **Pros**:
  - Direct relational reflection of the CFR tree structure (a section or appendix belongs to a part).
  - No synthetic string manipulation needed when inserting.
- **Cons & Gotchas**:
  - Breaks all existing routes, citation links, frontend anchors, and store methods that expect single-string queries: `/api/{title}/section/{section_id}`.
  - Would require updating `reader/app/store.py`, `citations/graph.py`, `routers/reader.py`, and frontend routing.

---

### Solution B: Synthetic Part-Qualified Leaf ID for Appendices (Recommended)
- **How it works**:
  If an appendix does not contain `"Part"` or `"Subpart"` in its identifier, or if a collision is detected during structure parsing, namespace the identifier:
  `{part}:{raw_id}` (e.g. `91:Special Federal Aviation Regulation No. 97`, `73:Alphabetical Index`), or uniformly namespace all appendices by part: `{part}:appendix:{id}`.
- **Pros**:
  - Keeps `id` as a single string primary key (`TEXT PRIMARY KEY`).
  - Zero schema migration or breaking changes to existing SQLite tables, FTS5 indexes, or frontend URLs.
  - Matches the natural URL structure: `/api/14/section/91:Special%20Federal%20Aviation...`.
  - The human-readable `label` (e.g., `Special Federal Aviation Regulation No. 97—Special Operating Rules...`) and `title` remain unchanged for UI display.
- **Cons & Gotchas**:
  - The XML ingest (`stream_parse_xml`) must associate the parsed `<DIV9>` appendix with its enclosing `<DIV5>` (Part) to match the synthetic ID generated during structure tree traversal.
  - When linkifying cross-references in text, appendix links must resolve against the citing part or provide a disambiguation picker.

---

### Solution C: Surrogate Auto-Increment Primary Key + Unique Path URI
- **How it works**:
  `ord` or a surrogate `sec_pk INTEGER PRIMARY KEY AUTOINCREMENT`. The lookup identifier becomes a normalized URI breadcrumb (e.g. `ecfr://title/14/part/91/appendix/sfar-97`).
- **Pros**:
  - Completely immune to duplicate names in any regulatory system (CFR, USC, state codes, ISO).
  - Ideal long-term architecture for a unified multi-corpus regulatory intelligence platform.
- **Cons & Gotchas**:
  - Significant refactor across all reader ingestion pipelines and client UI routing.

---

## 5. Strategic Roadmap: Adding Other Regulatory Frameworks

To integrate state regulations, USC, and standards without repeating CFR-specific assumptions:

### Phase 1: Uniform Regulatory Resource Identifiers (URRIs)
Adopt an unambiguous citation URI scheme across all ingestion pipelines:
```text
reg://[jurisdiction]/[corpus]/[collection]/[unit]
```
Examples:
- `reg://us/cfr/title/14/part/91/sfar/97`
- `reg://us/cfr/title/29/section/1910.120`
- `reg://us/usc/title/29/section/654`
- `reg://us-ca/ccr/title/8/section/5192` (Cal/OSHA HAZWOPER)
- `reg://standards/nfpa/70e/2024/article/130`

### Phase 2: Ingest Adapters (Provider Pattern)
Create an abstract `BaseRegulatoryIngest` adapter interface:
1. `ECFRIngestAdapter`: Fetches eCFR JSON structure + XML. Handles CFR quirks (loose subparts, SFAR appendices, reserved tokens).
2. `USCIngestAdapter`: Ingests from USLM (United States Legislative Markup) XML from uscode.house.gov.
3. `StateAdminCodeAdapter`: Scrapes or parses state legislative XML/JSON with customized part/article hierarchies.
4. `ConsensusStandardsAdapter`: PDF/XML parser with OCR and structured table extraction.

### Phase 3: Cross-Corpus Federated Search & Citations
1. **Scope-Aware Search**: Allow filtering by Federal (CFR), Statutory (USC), and State (e.g., Cal/OSHA vs Federal OSHA side-by-side).
2. **Concordance Mapping**: Automatically link federal CFR sections with their state-plan equivalents (e.g., 29 CFR 1910.120 <-> 8 CCR 5192).
3. **Citation Peeking**: Peeking a citation should work seamlessly whether citing 29 U.S.C. 654 (the General Duty Clause) or a 29 CFR standard.
