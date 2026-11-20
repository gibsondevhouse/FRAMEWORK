# FRAMEWORK — API Reference

Welcome to the HTTP and streaming API behind **FRAMEWORK**, a local-first, federal-only platform for federal codes and laws. The backend is a **FastAPI** service that powers the browser interface and exposes a clean JSON / SSE API over your installed federal corpora — the U.S. Constitution, U.S. Code (including appendix titles), Public Laws, CFR titles, Federal Register archive, Unified Agenda, and synced Newsroom feeds (plus optional DOL enforcement data).

- **Base URL:** `http://127.0.0.1:8000`
- **Interactive Docs:** [Swagger UI](http://127.0.0.1:8000/docs) · [ReDoc](http://127.0.0.1:8000/redoc) · [OpenAPI JSON](http://127.0.0.1:8000/openapi.json)

## A few conventions

- **Who may call it.** The server has no login and is meant for one person on their own machine. It answers only under a loopback name (`localhost`, `127.0.0.1`, `[::1]`); any other `Host` gets `400` unless you list it in `SERVER_ALLOWED_HOSTS` in `reader/.env`. A browser page on another origin gets `403` on every `/api/` route and on every `POST`, `PUT`, `PATCH` or `DELETE`, and no CORS headers are sent. Scripts and tools such as `curl` are unaffected.
- **Access token.** A request that is not made on the server's own computer (a non-loopback `Host`, a non-loopback client address, or a proxy forwarding header) gets `401` unless it carries the access token: `Authorization: Bearer <token>`, or HTTP Basic with any user name and the token as the password (`curl -u :TOKEN`; a browser shows its sign-in prompt). `python -m app.security` prints the token, `--rotate` replaces it. Requests made on the computer itself need no token. A reverse proxy on that same computer must add `X-Forwarded-For` (or another forwarding header) to what it relays, or the owner sets `SERVER_REQUIRE_TOKEN=1`, which asks every request for the token.
- **Security headers.** Every response carries `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and `Referrer-Policy: same-origin`. The policy lets a page of this app load scripts, styles and fonts only from the app itself and images only from the app, `data:` and `img.federalregister.gov`, and call only this API. The interactive docs pages (`/docs`, `/redoc`) load their UI from a CDN and are exempt from the loading rules.
- **Title scoping.** Most routes live under `/api/{title}/…`, where `{title}` is a CFR title number (1–50) installed on your machine. Asking for a title that isn't installed returns `404`. Routes without the prefix (`/api/meta`, `/api/section/{id}`, …) are kept as friendly aliases for **Title 29**.
- **Section IDs** are flexible: `541.100`, `§ 541.100`, `29 CFR 541.100`, and `541.100(a)(1)` all normalize cleanly to `541.100`.
- **Field naming.** In section and search payloads, `title` is the CFR **title number** and `title_label` (or `section_title`) is the section's **heading**.
- **Search highlights** in snippets are wrapped with the ASCII control characters `\x02` (start) and `\x03` (end) so you can style them however you like.

---

## Titles and metadata

### `GET /healthz`
Lightweight server liveness check returning `{"status": "ok", "installed_titles": [29, ...]}`.

### `GET /api/titles`
Every installed title.

```json
[
  {
    "title": 29,
    "name": "Labor",
    "edition": "2026-11-06",
    "built_at": "2026-11-09T20:37:13",
    "section_count": 7374,
    "partial": false,
    "ai_configured": true,
    "missing_sections": 0,
    "missing_sample": []
  }
]
```

`partial` is true when only some parts/sections of the title are installed. `missing_sections` counts the sections eCFR's table of contents listed that had no text in the download (`null` for a title built before this was recorded), with up to ten of their ids in `missing_sample`; the Title start page warns when it is above zero. Returns `[]` on a fresh server before any title is downloaded.

### `GET /api/titles/snapshot`
Local-only living snapshot of installed titles for the Home screen (`Cache-Control: no-store`; makes no external network requests).

```json
{
  "ai_configured": true,
  "titles": [
    {
      "title": 29,
      "name": "Labor",
      "edition": "2026-11-06",
      "built_at": "2026-11-09T20:37:13",
      "section_count": 7374,
      "partial": false,
      "unreadable": false,
      "desk": "Workplace & Labor",
      "summary": "Workplace safety (OSHA), wages and hours, family and medical leave, and employee benefit plans (ERISA).",
      "agencies": ["OSHA", "WHD", "EBSA", "NLRB"],
      "scope_parts": null,
      "scope_sections_count": 0,
      "news": {
        "count": 6,
        "latest_date": "2026-11-16",
        "latest_title": "Nationally Recognized Testing Laboratories: Expansion of Recognition"
      }
    }
  ]
}
```

Combines installed title metadata, editorial metadata from `app/title_blurbs.json`, partial/curated scope counts (`scope_parts`, `scope_sections_count`), and local cached news counts (`news`). If a single title's database is temporarily unreadable, it stays listed with `unreadable: true` rather than failing the snapshot.

### `GET /api/profiles`
Curated first-run profiles and static names for all 50 CFR titles (available before any title is installed or eCFR is reached).

```json
{
  "profiles": [
    {
      "id": "safety",
      "name": "Safety / OSHA",
      "description": "Workplace safety and health, mine safety, and hazardous materials transport.",
      "downloads": [{"title": 29}, {"title": 30}, {"title": 49, "part": "171"}]
    }
  ],
  "title_names": {"29": "Labor", "40": "Protection of Environment"}
}
```

### `GET /api/{title}/meta`
Same fields for one title (without `partial`), including `missing_sections` and `missing_sample`.

### `GET /api/{title}/tree`
The title's navigation tree, served verbatim from `data/tree-{title}.json`. Nodes use compact keys: `t` (kind: `subtitle`, `chapter`, `subchapter`, `part`, `subpart`, `section`, `appendix`), `id`, `l` (label), `d` (description/heading), `r` (reserved), `range` (section range), `c` (children).

---

## Search

### `GET /api/search`
### `GET /api/{title}/search`

| Parameter | Type | Description |
|:---|:---|:---|
| `q` | string, required | Keywords, a quoted phrase (`"confined space"`), or a section number (`1910.146`). |
| `title` | string | Unprefixed route only: a title number, or `all` to search every installed title. Defaults to 29. |
| `part` | string | Restrict to one part, e.g. `1910`. |
| `limit` | int | Max results (default 30). |

An exact section-number match is returned first with `exact: true`; the rest are FTS5 matches ranked by BM25 (weighted toward label and heading). With `title=all`, results from every title are merged, exact matches first.

```json
{
  "query": "respirator",
  "title": 29,
  "total": 45,
  "ms": 8,
  "results": [
    {
      "id": "1910.134",
      "title": 29,
      "kind": "section",
      "part": "1910",
      "label": "§ 1910.134",
      "title_label": "Respiratory protection.",
      "snippet": "… breathing air contaminated with harmful \u0002dusts\u0003 …",
      "score": -12.4,
      "exact": false
    }
  ]
}
```

---

## Sections and parts

### `GET /api/{title}/section/{section_id}`

Optional `?unit=KEY` returns a single reading unit of a long section (`?unit=` with no value returns the first). Without `unit`, `html` is the whole section.

```json
{
  "id": "1910.1200",
  "title": 29,
  "kind": "section",
  "part": "1910",
  "label": "§ 1910.1200",
  "section_title": "Hazard communication.",
  "title_label": "Hazard communication.",
  "reserved": false,
  "path": [
    {"kind": "subtitle", "num": "B", "label": "Subtitle B"},
    {"kind": "chapter", "num": "XVII", "label": "Occupational Safety and Health Administration"},
    {"kind": "part", "num": "1910", "label": "Part 1910"},
    {"kind": "subpart", "num": "Z", "label": "Subpart Z - Toxic and Hazardous Substances"}
  ],
  "ecfr_url": "https://www.ecfr.gov/current/title-29/section-1910.1200",
  "html": "<section class=\"reg-unit\" id=\"u-a\">…</section>",
  "mode": "units",
  "outline": [
    {"key": "a", "label": "(a)", "title": "Purpose", "kind": "clause",
     "group": null, "group_label": null, "group_title": null, "chars": 2140},
    {"key": "appendix-a-a-1", "label": "A.1", "title": "Acute Toxicity", "kind": "chapter",
     "group": "appendix-a", "group_label": "Appendix A", "group_title": "Health Hazard Criteria", "chars": 9800}
  ],
  "unit": "a",
  "unit_prev": null,
  "unit_next": {"key": "b", "label": "(b)", "title": "Scope and application", "...": "..."},
  "prev": {"id": "1910.1096", "label": "§ 1910.1096", "title": "Ionizing radiation."},
  "next": {"id": "1910.1201", "label": "§ 1910.1201", "title": "Retention of DOT markings, placards and labels."}
}
```

- `mode` is `"units"` for sections read a unit at a time (long text, or an embedded appendix) and `"page"` for short sections shown whole.
- `outline` lists every unit: top-level clauses `(a)`, `(b)`, … and appendix chapters; `group` ties a chapter to its appendix.
- `unit`, `unit_prev`, `unit_next` are set only when a unit was requested.
- `prev` / `next` are the neighbouring sections in reading order.

### `GET /api/{title}/part/{part}`
Front matter for a part and its subparts (authority, source notes) as HTML.

```json
{
  "part": "<div class=\"cfr-front-matter\">…</div>",
  "subparts": {"A": "<p class=\"source\">…</p>"}
}
```

### `GET /api/{title}/part/{part}/full`
Every section of a part in reading order, each with its rendered HTML.

```json
{
  "title": 29,
  "part": "1904",
  "sections": [
    {"id": "1904.0", "kind": "section", "label": "§ 1904.0", "title": "Purpose.", "reserved": false, "html": "…"}
  ]
}
```

---

## References and citation graph

Both routes are computed from a single pass over every section's text of the title, cached in
memory until that title is installed, updated or removed, and never call out to the network.
They power the Title start page's **References & Authorities** hub and the reader's
**Cited by** button and IBR peeks.

### `GET /api/{title}/references`
The title's web references, grouped by host, plus its incorporation-by-reference (IBR)
standards and most-cited sections.

```json
{
  "title": 29,
  "total": 227,
  "category_counts": {"standards": 61, "portals": 48, "agencies": 90, "technical": 28},
  "items": [
    {"url": "https://webstore.ansi.org", "display": "webstore.ansi.org", "host": "webstore.ansi.org",
     "category": "standards", "legacy": null, "cite_count": 3,
     "cited_in": [{"id": "1910.6", "part": "1910", "label": "§ 1910.6", "title": "Incorporation by reference."}]}
  ],
  "host_total": 82,
  "host_category_counts": {"standards": 24, "portals": 19, "agencies": 29, "technical": 10},
  "hosts": [
    {"host": "wdol.gov", "category": "portals",
     "legacy": {"replacement_url": "https://sam.gov/content/wage-determinations",
                "replacement_label": "SAM.gov Wage Determinations",
                "note": "Retired URL — Wage Determinations Online migrated to SAM.gov."},
     "url": "https://www.wdol.gov", "display": "www.wdol.gov", "url_count": 2,
     "urls": [{"url": "https://www.wdol.gov", "display": "www.wdol.gov", "cite_count": 3}],
     "cite_count": 3, "cited_in": [{"id": "4.1", "part": "4", "label": "§ 4.1", "title": "…"}]}
  ],
  "ibr_total": 312,
  "ibr_standards": [
    {"code": "ANSI Z89.1-2009", "base_code": "ANSI Z89.1", "org": "ANSI",
     "org_name": "American National Standards Institute", "org_url": "https://www.ansi.org",
     "section_id": "1910.6", "part": "1910", "label": "§ 1910.6", "para": "(e)",
     "excerpt": "…IBR approved for § 1910.135…", "urls": ["https://webstore.ansi.org"],
     "section_count": 1, "approved_in": [{"id": "1910.6", "part": "1910", "label": "§ 1910.6", "para": "(e)"}]}
  ],
  "most_cited_total": 540,
  "most_cited": [{"id": "1910.1200", "part": "1910", "label": "§ 1910.1200", "title": "Hazard communication.", "cited_by_count": 41}]
}
```

- `items` is one row per distinct URL (sorted by `cite_count`); `hosts` rolls them up per host with
  that host's most-cited URL first. `cited_in` is capped at 8 citing sections per row and `urls` at 8.
- `category` is `standards` (ANSI, ASTM, NFPA, ISO, … stores), `portals` (SAM.gov, GovInfo,
  Regulations.gov, eCFR, …), `agencies` (other `.gov` hosts) or `technical` (everything else).
- `legacy` is set for retired hosts (wdol.gov, epls.arnet.gov, alpha.sam.gov, thomas.loc.gov, …)
  with the modern replacement to show instead.
- `ibr_standards` are parsed from the title's incorporation-by-reference sections (§ 1910.6, § 1926.6
  and the like), one row per full designator, sorted by how many IBR sections list it; `approved_in`
  (capped at 6) names those catalog sections and the paragraph. `most_cited` is capped at 12 rows;
  the `*_total` fields are the uncapped counts.

### `GET /api/{title}/citations/{section_id}`
Reverse citations and IBR matches for one section. `section_id` accepts the same forms as the
section route (`1910.134`, `§ 1910.134`, `1910.134(c)`). `404` for an unknown section.

```json
{
  "title": 29,
  "section_id": "1910.134",
  "cited_by_count": 17,
  "cited_by": [{"id": "1910.120", "part": "1910", "label": "§ 1910.120", "title": "Hazardous waste operations and emergency response."}],
  "ibr": [
    {"code": "ANSI Z88.2-1992", "match_text": "ANSI Z88.2-1992", "org": "ANSI",
     "org_name": "American National Standards Institute", "org_url": "https://www.ansi.org",
     "exact": true,
     "approved_in": {"code": "ANSI Z88.2-1992", "base_code": "ANSI Z88.2", "org": "ANSI",
                     "section_id": "1910.6", "part": "1910", "label": "§ 1910.6", "para": "(e)",
                     "excerpt": "…ANSI Z88.2-1992, Practices for Respiratory Protection; IBR approved for § 1910.134…",
                     "urls": ["https://webstore.ansi.org"]}}
  ]
}
```

- `cited_by` lists the sections of the same title whose text cites this one (`§`, "section",
  bare-number, "paragraph (x) of §" and same-title `N CFR` forms), in reading order; a section never
  cites itself.
- `ibr[].exact` is `true` when the full designator (with edition year) is in the IBR catalog, `false`
  when only the base code matched (the catalog lists another edition); `approved_in` is the matching
  catalog row (preferring one in the same part) or `null` when the standard is mentioned but not
  incorporated by reference anywhere in the title.

---

## Federal Register corpus

A local copy of Federal Register documents, in `data/fr.sqlite3`. By default it holds every document (every agency, every type) for the source registry's window; the registry's filters can narrow it to agencies, document types or documents citing certain CFR titles (see **Sources**) (built with `python -m app.fr_build`, or `POST /api/fr/build`). Every response is `Cache-Control: no-store`. GETs never touch the network and return empty results (`installed: false`) before the corpus is built.

### `GET /api/fr/status`
`{installed, doc_count, body_count, titles, coverage[{title,start,end,fetched,chunks}], meta, due, default_titles, default_years}`.

### `GET /api/fr/search`
Params: `q`, `type` (`Rule`, `Proposed Rule`, `Notice`, `Presidential Document`), `agency` (FR slug), `title`, `part`, `since`, `until` (ISO dates), `limit` (≤100), `offset`. A document number (`2026-22306`) or an FR citation (`91 FR 69100`, matched inside each document's page range) is an exact hit (`exact: true`) first; otherwise FTS5 (bm25 title 3 / abstract 1.5 / action 1 / body 1) with `\x02`/`\x03` snippet sentinels, or newest first without `q`. Returns `{installed, total, results[{document_number, type, title, abstract, action, publication_date, effective_on, comments_close_on, citation, html_url, agencies, cfr_references, snippet}]}`.

### `GET /api/fr/document/{document_number}`
The full record: metadata, `agencies`, `cfr_references`, `docket_ids`, `regulation_id_numbers`, `cfr_links[{title, part, section, sources}]` (`reference` = the API's cfr_references, `text` = citations in title/abstract/action, `body` = citations in the fetched full text), `provenance{source, source_url, raw_sha256, fetched_at, first_seen_at, content_changed_at}` and `body` (`{format, sha256, byte_len, source_url, fetched_at}` or `null`; `?body=true` adds `content` and `text`). 404 when not in the corpus.

### `POST /api/fr/document/{document_number}/body`
Downloads the document's full text (`full_text_xml_url`, else `body_html_url`, federalregister.gov only), stores it with the SHA-256 of the bytes as served and indexes it. 404 not in corpus, 422 no full-text URL, 503 upstream failure.

### `GET /api/fr/by-cfr/{title}/{part}` · `GET /api/fr/by-cfr/{title}/{part}/{section}`
Documents linked to a CFR part, or to a section (its exact links plus part-level links of its part). `limit` ≤200, `offset`. 422 when the section isn't in the part.

### `POST /api/fr/build` · `POST /api/fr/update`
Queue a full corpus build (`{titles?, years?}`; without `titles` the scope comes from the source registry — every document by default, `titles: [0]` in the job — with its agency/type filters; an unsaved setup still honours `FR_CORPUS_TITLES`) or an incremental update on the library queue (jobs appear in `GET /api/library/jobs` with `title: 0`, `kind: fr-build | fr-update`).

`GET /api/search?include=fr` adds the corpus to search as a separate `fr` block (`{installed, total, results}`); the CFR result shape is unchanged.

## U.S. Code

Installed U.S. Code titles, built from the OLRC's USLM XML (`python -m app.usc_build --title N`, or `POST /api/usc/download`) into `data/usc-{N}.sqlite3`. Responses are `Cache-Control: no-store`.

### `GET /api/usc/titles`
Installed titles, local only: `{titles[{title, name, title_name, release_point, current_through, built_at, section_count, note_count, positive_law, xml_sha256, zip_sha256, source_url}]}`.

### `GET /api/usc/catalog`
All 54 U.S. Code titles for the Library, offline (never calls the OLRC); pass `?appendix=true` to also include the appendix titles (`5a`, `11a`, `18a`, `28a`, and reserved `50a`): `{release: {release_point, current_through} | null, desks, titles[{title, name, reserved, positive_law, desk, cfr, installed: {release_point, built_at, section_count, note_count, bytes, stale} | null}]}`. Names, desks and implementing CFR titles (`cfr`) come from `app/usc_titles.json`; `release` and `stale` reflect the last release the server fetched (`null` until `GET /api/usc/release` has run).

### `GET /api/usc/release`
Asks the OLRC for the current release point (cached 30 min; `?refresh=true` bypasses): `{release_point, current_through, available_titles, titles[… + stale]}`. 503 when the OLRC doesn't answer.

### `GET /api/usc/{title}/meta` · `GET /api/usc/{title}/tree`
Title summary (one row of `/api/usc/titles`; `title_name` repeats `name`, and `current_through` is the OLRC's "current through" date for the release point, or `null` when the build did not record one), and the contents tree (`t/id/l/d/c`, sections carry `s` = status). 404 when not installed.

### `GET /api/usc/{title}/notes`
Notes attached to the title itself or to one chapter, subchapter, part … rather than to a section (DM-113). `?node=` is the division's path of tree ids from the title down (`ch21`, `ch21/schI`); leave it empty for the title's own notes. Returns `{node, notes[{category, topic, heading, html, text}]}`, shaped like a section's notes; an unknown path gives an empty list. 404 when the title is not installed.

### `GET /api/usc/{title}/section/{section_id}`
Accepts `655`, `§ 655` or `29 U.S.C. 655(b)`. Returns `id, identifier, label, heading, status` (`repealed`, `omitted`, `transferred`, … or `null`), `chapter, path, ord, text, source_credit, html` (allowlist-rendered body as the CFR reader's flat paragraphs — `<p class="reg-p lvl-N" id="pN">` with a `span.pmark` number; U.S.C. references link to the local copy when installed, else Cornell LII), `notes[{category: editorial | statutory | executive, topic, heading, html, text}]` (kept apart from the section text, QUIRK-006), `prev`, `next`, `citation`.

Also `mode` (`units` for a long section, read one top-level subdivision at a time, else `page`) and `outline` (every unit: `key`, `label`, `title`, `kind`, `chars`); `?unit=KEY` (`?unit=` for the first) on a units-mode section returns only that unit's `html` plus `unit`, `unit_prev`, `unit_next` (404 for an unknown key), exactly like the CFR section endpoint.

### `GET /api/usc/{title}/citations/{section_id}`
What on this computer cites the section: `usc` (U.S. Code sections linking to it), `cfr` (CFR sections citing it, with the `paragraphs` they name), `authority` (CFR parts whose Authority line cites it), and `count`. Only installed titles are searched; 404 for an unknown section.

### `GET /api/usc/search`
`q`, optional `title`, `limit`; `notes=true` (with `title`) also searches the notes. Exact section number first, then FTS5 (bm25 label 8 / heading 6 / text 1).

### `POST /api/usc/download` · `POST /api/usc/update-all` · `DELETE /api/usc/{title}`
Queue one title (`{title}`) or every installed title that is behind the current release point on the library queue (jobs appear with `title: 1000 + N`, `kind: usc-title | usc-update`); remove a title (409 while it has a job).

### `GET /usc/{title}/{section_id}`
A standalone HTML page for one section: the href of local U.S.C. citation links (inside the app a click opens the in-app reader at `#/usc/{title}/section/{id}` instead) and a printable fallback. It links the app's own stylesheet, so it looks like the reader.

`GET /api/search?include=usc` (or `include=fr,usc`) adds a `usc` block (`{installed, total, results}`). `include` takes any comma-separated mix of `fr`, `usc`, `constitution`, `plaw` and `agenda`; each adds its own block of the same shape, capped at 20 results, with `total` the full match count. The search page requests all five.

## U.S. Constitution

`data/constitution.sqlite3`, built from the Constitution file of the House Rules and Manual in GovInfo bulk data (`bulkdata/HMAN/{congress}/HMAN-{congress}.zip`, newest edition; official GPO USLM, no key). `python -m app.constitution [--force] [--status] [--keep-source]`. The House Parliamentarian's annotations are kept as separate `notes`, never in the text. Unit ids: `preamble`, `art1-s2`, `art5` (an article without sections), `amdt1`, `amdt14-s1`. Every response is `no-store`; GETs never touch the network.

- `GET /api/constitution` → `{installed, unit_count, note_count, meta{edition, source_url, zip_sha256, xml_sha256, fetched_at, built_at, …}, outline[{id, kind, article, amendment, section, label, chars, note_count}]}`
- `GET /api/constitution/unit/{id}` → `{id, ord, kind, article, amendment, section, label, text, note_count, notes[], prev, next}` (404 unknown/not installed)
- `GET /api/constitution/search?q=&notes=false&limit=20` → `{installed, total, results[{id, label, snippet, kind: text|annotation}]}` (`\x02`/`\x03` snippet sentinels)
- `POST /api/constitution/build` → `{job}` (queue key 2000; the scheduled `constitution-update` job rebuilds only when GovInfo lists a newer Manual)
- `POST /api/constitution/update` → `{job}` (a `constitution-update` job: rebuilds only when GovInfo lists a newer Manual; downloads it when nothing is installed)
- `DELETE /api/constitution` → `{removed: "constitution"}` (409 while its job is queued or running, 404 when not installed)

## Public Laws

`data/plaw.sqlite3`, from GovInfo bulk data `bulkdata/PLAW/{congress}/{public|private}/PLAW-{congress}-{type}.zip` (USLM, 113th Congress on; no key). `python -m app.plaw [--congress 118-119] [--types public,private] [--force] | --update | --status`. Builds are resumable per (congress, type) chunk and replace the live file atomically; `update()` re-reads the newest congress (and, for an "all congresses" scope, any newer one). Law ids: `118-2` (public), `118-pvt-5` (private).

- `GET /api/plaw?congress=&type=&limit=&offset=` → `{installed, total, results[{id, congress, law_type, number, citation, statute, title, approved_date, bill}], status}`; `status` carries `installed`, `law_count`, `usc_link_count`, `meta` (with the `scope` JSON), `congresses[{congress, law_type, laws}]`, and `first_congress` (113) / `current_congress` (from today's date) for the Library's Congress tiles
- `GET /api/plaw/law/{id}?xml=false&text=true` → the law plus `text`, `usc[{title, section, kind: reference|codified|note}]` and `provenance{source_url, sha256, byte_len, fetched_at}` (`xml=true` adds the USLM; `text=false` leaves out the plain text)
- `GET /api/plaw/law/{id}/text?unit=` → the law as reading units: `{id, mode: units|page, outline[{key, label, title, kind, group, group_label, group_title, chars}], chars, unit, unit_prev, unit_next, html}`. Units are `preamble` (long title and enacting clause) and `s1`, `s2` … (every `SEC.` in reading order, labelled with its division/title as `group_label`); margin notes render as `p.plaw-sidenote`. A long law (2+ units past 25,000 characters) is `units`: with `unit` (`''` = the first) only that unit's `html`; otherwise, and for a short law, `html` is the whole law with each unit in `section.reg-unit#u-{key}`. 404 for an unknown law or unit
- `GET /api/plaw/usc/{title}/{section}` → laws that cite, amend or place provisions at that U.S. Code section (`kinds`)
- `GET /api/plaw/search?q=` → `Pub. L. 118-31` / `118-31` is an exact hit; else FTS over title and text
- `POST /api/plaw/build` `{congresses?, types?}` · `POST /api/plaw/update` → `{job}` (queue key 3000)
- `DELETE /api/plaw` → `{removed: "plaw"}`; 409 while a Public Laws job is queued or running, 404 when not installed

## Unified Agenda

`data/agenda.sqlite3`, from reginfo.gov's XML editions (`XMLViewFileAction?f=REGINFO_RIN_DATA_{YYYYMM}.xml`, listed on `eAgendaXmlReport`; no key). `python -m app.agenda [--years 2] [--agencies 2000,1200] [--stages final,proposed] [--force] | --update | --status`. One row per (RIN, edition); agency contact names, phones and e-mails are not stored. Builds are resumable per edition; `update()` adds newer editions.

- `GET /api/agenda?edition=YYYYMM&agency=NNNN&stage=final&q=&limit=&offset=` → `{installed, edition (default newest), total, results[{rin, edition, agency_code, agency, agency_acronym, parent_code, parent, parent_acronym, title, stage, priority, major, rin_status}], status}`; `agency` matches the parent or sub-agency code, `stage` a key (`prerule`, `proposed`, `final`, `long_term`, `completed`) or its label, `q` a RIN (`1218-ad39`) or words (FTS over title and abstract)
- `GET /api/agenda/facets?edition=` → `{installed, edition, agencies[{code, acronym, name, entries}] (most first), stages[{key, label, entries}] (in stage order, empty stages left out)}` for the Newsroom's filters
- `GET /api/agenda/rin/{rin}?edition=` → the entry (`abstract`, `cfr[]`, `authority[]`, `timetable[{action, date, fr_citation}]`, `related[]`, `history[{edition, stage, rin_status}]`) plus `fr_documents[]` — Federal Register corpus documents whose `regulation_id_numbers` include the RIN or whose citation matches a timetable FR citation
- `GET /api/agenda/search?q=` → a RIN (`1218-AD39`) is an exact hit; else FTS over title and abstract
- `POST /api/agenda/build` `{years, agencies?, stages?}` · `POST /api/agenda/update` → `{job}` (queue key 4000)
- `DELETE /api/agenda` → `{removed: "agenda"}`; 409 while an Agenda job is queued or running, 404 when not installed

`GET /api/integrity` (and `python -m app.integrity --corpus constitution|plaw|agenda`) covers the three: database `quick_check`, counts vs meta, completeness (7 articles and 27 amendments), every law file re-hashed against its SHA-256, congress/type and edition coverage, recorded provenance, and (online) whether GovInfo / reginfo.gov has something newer.

## Integrity

### `GET /api/integrity`
Params: `corpus` (`cfr` | `fr` | `usc` | `constitution` | `plaw` | `agenda`), `title` (cfr/usc), `offline` (skip eCFR / OLRC / GovInfo / reginfo.gov), `govinfo_date`. Returns `{status, summary{OK,WARN,FAIL,INFO}, items[{corpus, target, check, status, detail, …}], checked_at, online}`, the same report as `python -m app.integrity --json`. Checks database health, counts, recorded hashes and versions (`unknown` for stores built before they were recorded), cached source re-hashes, FR record/body hashes, FR coverage gaps and freshness, staleness against eCFR / the OLRC / GovInfo / reginfo.gov, Constitution completeness, Public Laws per-file hashes and congress coverage, Unified Agenda edition coverage, and (with `GOVINFO_API_KEY`) a GovInfo cross-check of one day's FR documents.

## Sources (registry, selection, templates)

The federal source registry (`app/sources/`) is what a Settings checklist drives: every source the reader can collect, its plain-English filters, schedules and status, the active selection, built-in presets and the user's saved templates. One person per install: the selection and templates live in `data/sources.sqlite3` and travel only as an export file. Every response is `Cache-Control: no-store`; GETs and `preview` never write and never touch the network.

### Source declaration (`GET /api/sources` → `sources[]`)

```json
{
  "id": "fr", "label": "Federal Register archive", "short": "FR", "category": "Rulemaking",
  "description": "The government's daily journal: …", "provider": "FederalRegister.gov API",
  "available": true,
  "needs_key": false, "key_present": null, "key_label": null, "key_env": null, "get_key_url": null,
  "optional_key": {"key_present": false, "key_label": "api.data.gov key (GovInfo)", "key_env": "GOVINFO_API_KEY",
                   "get_key_url": "https://api.data.gov/signup/", "purpose": "…"},
  "actions": ["install", "update", "remove"],
  "schedule_options": [{"value": "auto", "label": "As soon as it's published", "description": "…"},
                       {"value": "weekly", "label": "Once a week", "description": "…"},
                       {"value": "manual", "label": "Only when I ask", "description": "…"}],
  "default_schedule": "auto",
  "filters": [
    {"id": "agencies", "type": "multi", "label": "Agencies", "description": "…", "allow_all": true,
     "allow_custom": true, "options": [{"value": "agriculture-department", "label": "Department of Agriculture",
                                        "description": "…"}]},
    {"id": "doc_types", "type": "multi", "label": "Document types", "allow_all": true, "options": […]},
    {"id": "cfr_titles", "type": "multi", "label": "Only documents that change these CFR titles",
     "allow_all": true, "allow_installed": true, "options": […]},
    {"id": "years", "type": "number", "label": "How far back", "min": 1, "max": 30, "unit": "years"}
  ],
  "default_scope": {"agencies": "all", "doc_types": "all", "cfr_titles": "all", "years": 5},
  "enabled": true, "schedule": "auto", "scope": {…},
  "status": {"installed": true, "documents": 4953, "bytes": 34852864, "last_refresh": "2026-11-19T…",
             "window_start": "2021-11-19", "window_end": "2026-11-19", "last_error": null,
             "pending_build": null, "jobs": [], "integrity": null}
}
```

- **Sources** (`categories`: Statutes, Regulations, Rulemaking, Enforcement, News): `usc` (titles 1–54 plus the appendix titles 5a, 11a, 18a, 28a as option values 105, 111, 118, 128; 50a = 150 is eliminated and listed as reserved), `cfr`, `fr` (the archive), `news` (the News page feed), `dol_enforcement` (needs `DOL_API_KEY`), `constitution`, `public_laws` (filters `congresses` 113…current or `"all"`, `law_types` public/private) and `unified_agenda` (filters `agencies` = reginfo.gov parent agency codes such as `"2000"`, `stages` prerule/proposed/final/long_term/completed, `years`). None of the last three needs a key (GovInfo **bulk data** and reginfo.gov are keyless). Status adds per-source counts (`units`/`annotations`, `laws`/`usc_links`/`congresses`, `entries`/`editions`).
- **Filter types**: `multi` takes a list of option values, or `"all"` when `allow_all`, or `"installed"` (the CFR titles on this computer) when `allow_installed`; `allow_custom` accepts any lowercase slug. `toggle` is a bool, `number` an int clamped to `min`..`max`, `choice` one option value. Title options carry `estimate {bytes, seconds, approximate: true}` (null for reserved titles) and `desk`.
- **Keys**: only presence (`key_present`), never a value. `needs_key` means the source can't update without one; `optional_key` adds a feature.
- **Status**: what is on disk (`installed`, `items`, `bytes`), `last_refresh`, queued/running `jobs`, and `integrity` — the last offline `app.integrity` result (`{status, summary, checked_at, problems}`) for cfr/usc/fr/constitution/plaw/agenda, `null` until `GET /api/sources?check=true` runs one.

### `GET /api/sources`
`{categories, sources[], selection, saved, default_preset}`. `?check=true` runs the offline integrity check first.

### Selection
`{"version": 1, "sources": {id: {"enabled": bool, "schedule": str, "scope": {filter_id: value}}}}`. Any input is normalized against the registry: unknown sources and fields, anything named like a key/token/secret/password, reserved titles and invalid values are dropped (an invalid value keeps the previous one); placeholders stay disabled. Sources missing from a PUT keep their current entry.

Until a selection is saved, the effective one is **derived from the current setup** (installed CFR and U.S.C. titles; the FR corpus's recorded scope, else every document; `NEWS_AGENCIES`; CFR updates manual), so existing installs behave exactly as before. A saved selection wins over the `.env` fallbacks (`NEWS_AGENCIES`, `FR_CORPUS_TITLES`, `NEWS_RETENTION_DAYS`).

What the flags do: unchecking a source (or a title) **stops its updates and keeps its data**. `news` gates the FR and public-inspection feeds, `dol_enforcement` the DOL sync, `fr` the archive's scheduled refresh, `usc` the daily release check (selected titles only), `cfr` an edition check that is `manual` by default and becomes daily/weekly when chosen (selected installed titles only). A `manual` schedule still allows the explicit Refresh/Update buttons.

- `GET /api/sources/selection` → `{selection, saved}`
- `PUT /api/sources/selection` `{selection}` → saves it (flags, schedules and filters apply at once); downloads and deletes nothing.
- `DELETE /api/sources/selection` → forget it; back to the derived setup.
- `POST /api/sources/selection/preview` `{selection, remove_unselected?}` → the plan (below), no side effects.
- `POST /api/sources/selection/apply` `{selection, confirm?, remove_unselected?}` → saves and queues the plan's jobs on the library queue (CFR `title`, U.S.C. `usc-title`, FR `fr-build` with `{titles, years, filters}`).

### Plan (preview / apply response)

```json
{
  "summary": "Adds 2 CFR titles and 1 U.S. Code title (~21 MB, under 2 minutes); stops DOL enforcement records updates; keeps 1 item on disk without updates; nothing deleted.",
  "needs_confirm": false,
  "estimate": {"bytes": 22020096, "seconds": 61, "approximate": true, "bytes_label": "21 MB", "time_label": "under 2 minutes"},
  "actions": [{"source": "cfr", "action": "install", "target": 3, "label": "Download CFR Title 3",
               "estimate": {"bytes": …, "seconds": …, "approximate": true}}],
  "changes": [{"source": "dol_enforcement", "change": "stop_updates", "label": "Stop updating the …"}],
  "keeps": ["CFR Title 29"],
  "selection": {…}, "current_saved": false
}
```

`actions[].action`: `install`, `complete` (a partly installed CFR title), `rebuild` (the FR archive's, Public Laws' or Unified Agenda's scope changed), `remove` (only with `remove_unselected: true`). Jobs: CFR `title`, U.S.C. `usc-title`, FR `fr-build`, `constitution-build` (queue key 2000), `plaw-build` `{congresses, types}` (3000), `agenda-build` `{years, agencies?, stages?}` (4000). `changes[].change`: `start_updates`, `stop_updates`, `schedule`, `scope`, `needs_key` (with `get_key_url`). `needs_confirm` is true when the plan downloads more than ~50 MB, takes more than ~2 minutes, or deletes anything; `apply` without `confirm: true` then returns the plan with `applied: false` and changes nothing. A confirmed apply adds `applied: true, queued[], removed[], skipped[{…, reason}]`. Estimates are approximate (CFR from eCFR's measured XML sizes × 3.5 on disk; FR ~7 KB and ~27,000 documents a year; U.S.C. rough per-title sizes).

### Templates and presets
A template is `{id, name, description, builtin, selection, created_at?, updated_at?}`; built-in presets also carry `default`, `needs_keys` and `group`, and have ids `preset:…`: `preset:recommended` (the default: the Constitution, every U.S.C. and CFR title, public laws from every congress, 2 years of every FR document and of the Unified Agenda, news from every agency, no keys), `preset:everything` (5 years, private laws too, and DOL enforcement), `preset:minimal` (nothing refreshes or downloads), one per Library bundle (`preset:bundle-ehs|trade|govcon`) and one per Library desk (`preset:desk-…`), each narrowing CFR, U.S.C., FR and news to that desk's titles.

- `GET /api/sources/templates` → `{templates: [presets…, saved…]}`
- `POST /api/sources/templates` `{name, description?, selection?}` (no `selection` = the current one) → the template
- `GET|PUT|DELETE /api/sources/templates/{id}` (PUT `{name?, description?, selection?}` renames or edits; presets answer 403)
- `POST /api/sources/templates/{id}/preview` `{remove_unselected?}` · `POST /api/sources/templates/{id}/apply` `{confirm?, remove_unselected?}` → the plan, as above (apply adds `template: {id, name}`)
- `GET /api/sources/templates/export` → `{format: "framework-source-templates", version: 1, templates[{name, description, selection, created_at}]}` (saved templates only)
- `POST /api/sources/templates/import` (an export file) → `{imported[], count}`; names that exist get " (imported)"; 422 for anything else. Selections are normalized on save and import, so a template can never carry a key or secret.

## Library (download from eCFR)

### `GET /api/library`
All 50 titles with install state and editorial fields, the topic desks, the compliance suites, when eCFR's title list was last checked (`checked_at`, epoch seconds), and the job queue.

```json
{
  "titles": [
    {"title": 29, "name": "Labor", "latest": "2026-11-12", "amended": "2026-11-10", "reserved": false,
     "summary": "Workplace safety (OSHA), wages and hours, …", "desk": "Workplace & Labor", "featured": true,
     "agencies": ["OSHA", "WHD", "EBSA", "NLRB"], "size_mb": 27.7, "sections": 7200,
     "installed": {"edition": "2026-11-12", "section_count": 7376, "bytes": 100306944, "whole": true, "parts": null, "sections": null}},
    {"title": 35, "name": "Reserved", "latest": null, "reserved": true, "installed": null}
  ],
  "desks": ["Workplace & Labor", "…"],
  "suites": {
    "ehs": {"id": "ehs", "name": "Environment, Health & Safety", "badge": "Core compliance", "featured": true,
            "titles": [29, 40, 49], "summary": "…", "size_mb": 212.4, "sections": 40935}
  },
  "checked_at": 1794787200.0,
  "jobs": {"current": null, "queued": [], "recent": []}
}
```

For a partial install `whole` is false and `parts` / `sections` count what was selected. `bytes` is the database on disk. `size_mb` (eCFR's full-text size) and `sections` are estimates measured from the 2026-11-12 edition and kept in `app/title_blurbs.json`; a suite's are the sums of its titles'.

### `GET /api/library/storage`
What the reader keeps on disk: `{"titles": [{"title", "bytes"}], "legacy_bytes", "usc": [{"title", "bytes"}], "temp_files", "temp_bytes", "total_bytes"}`. `usc` lists installed U.S. Code titles (database plus tree) and counts toward `total_bytes`. A title's bytes are its database plus contents tree; `legacy_bytes` is Title 29's legacy copy (`title29.sqlite3`, `tree.json`); temp files are what an interrupted build left behind (any name containing `.tmp`).

### `POST /api/library/storage/prune`
Delete the leftover temporary files. Returns `{"removed", "freed_bytes"}`. `409` while a download is queued or running.

### `GET /api/library/wire`
The five most recently amended titles, newest first, with what eCFR changed on that date (from its version history): `count` sections and appendices, `kind` (`amended`, or `revised` when the issue only made editorial changes), `removed`, the `parts` touched and the `first` change. A title whose history can't be fetched has `count: null`. Cached per title and date.

```json
[{"title": 40, "amended": "2026-11-12", "count": 7, "kind": "amended", "removed": 0,
  "parts": ["141", "147"], "first": {"id": "141.2", "name": "§ 141.2 Definitions."}}]
```

### `GET /api/library/{title}`
The title's parts grouped by chapter, each with `installed` (`"all"`, `"some"`, or `null` for none), `installed_sections` and `leaves` (downloadable sections in the part).

### `GET /api/library/{title}/part/{part}`
The part's sections and appendices grouped by subpart, each flagged `installed`.

### `POST /api/library/download`
Queue a download. Body:

```json
{"title": 40, "part": "261", "section": "261.3", "kind": "section"}
```

- `title` only → the whole title.
- `title` + `part` → that part.
- `title` + `section` (+ `part`) → one section; `kind: "appendix"` for an appendix, which also needs its `part`.

Returns the queued job. Downloading more of an installed title merges the scopes and rebuilds at the latest edition; a request that is already installed at the current edition is a no-op.

### `POST /api/library/batch-download`
Queue whole-title downloads for a suite or a list of titles: `{"suite": "ehs"}` or `{"titles": [12, 15]}`. Reserved titles and titles already installed whole at the latest edition are skipped; a whole title on an older edition gets an update job; a partial install is completed. A suite with `usc_titles` also queues those U.S. Code titles (missing ones installed, ones behind the cached release updated; skipped entries carry `code: "usc"`). Returns `{"queued": [jobs], "skipped": [{"title", "reason"}], "count"}`. `404` for an unknown suite, `400` for an empty request or a title outside 1–50.

### `POST /api/library/update-all`
Queue an update for every installed title (whole or partial, keeping its scope) whose edition is older than eCFR's latest. Returns `{"queued": [jobs], "count"}`; `count` is 0 when everything is current.

### `POST /api/library/reload`
Release cached SQLite handles and render/structure caches so externally built or updated titles (`python -m app.build`) become visible without restarting the server. Returns `{"reloaded": [titles]}`.

### `POST /api/library/{title}/update`
Re-download an installed title at the latest eCFR edition.

### `DELETE /api/library/{title}`
Remove an installed title. Refused (`409`) for the only installed title or one with a download in progress.

### `POST /api/library/jobs/{id}/cancel`
Cancel a job. A queued job is dropped at once (`state: "cancelled"`); a running one gets `cancelling: true` and stops at its next progress report, and its partial files are deleted. A job in its `Installing` phase is not interrupted. `404` if the job already finished.

### `POST /api/library/jobs/clear`
Cancel every queued job (not the running one). Returns `{"cancelled": [jobs], "count"}`.

### `GET /api/library/jobs`
Queue snapshot. Each job carries `id`, `title`, `kind` (`title` | `part` | `section` | `update`), `label`, `state` (`queued` | `running` | `done` | `error` | `cancelled`), `phase`, `done`, `total`, `error`. Phases in order: `Waiting`, `Checking eCFR`, `Downloading contents`, `Downloading text`, `Reading text`, `Indexing`, `Installing`. While a whole title's text streams, `done`/`total` are bytes (eCFR's Content-Length when it sends one, else the XML written against the title's `size` from its structure); for a partial build they count files; while reading and indexing they count sections.

```json
{
  "current": {"id": 3, "title": 40, "kind": "part", "label": "Part 261 · Title 40",
              "state": "running", "phase": "Downloading", "done": 2, "total": 5, "error": null},
  "queued": [],
  "recent": []
}
```

---

## News (OSHA regulatory intelligence)

The `#/news` page's backend: OSHA rulemaking from the **Federal Register API v1** (no
credentials) and enforcement from the **DOL Open Data API v4** (optional free
`DOL_API_KEY` from [dataportal.dol.gov/registration](https://dataportal.dol.gov/registration),
sent as an `X-API-KEY` header). Articles live in `data/osha_news.sqlite3`, synced by a
schedule-gated background worker (`NEWS_SYNC=0` turns it off). Every response is
`Cache-Control: no-store`; an empty or missing database returns empty results, never an
error. **No GET endpoint ever triggers a sync** — refresh is an explicit POST.

### `GET /api/news`
The feed, search and filters in one endpoint.

| Parameter | Type | Description |
|:---|:---|:---|
| `category` | string | `all` (default) · `rules` · `rulemaking` · `enforcement` · `public_inspection` · `notices`. |
| `q` | string | Full-text query over title, description and company. A section number (`§ 1910.1030`) or FR citation (`91 FR 55744`) matches by id instead of FTS. Results carry `snippet` with `\x02`/`\x03` highlights. |
| `section` | string | Articles citing that section, plus part-level references to its part (scoped by `cfr_title`, default `29`). |
| `part` | string | Articles with any citation inside that part (scoped by `cfr_title`, default `29`). |
| `cfr_title` | int | Filter to articles citing CFR title `1..50` (and scope `section`/`part`/`q` section lookups). |
| `state` | string | Two-letter site state (enforcement only). |
| `min_penalty` | number | Enforcement rows with `penalty_usd >=` this. |
| `gravity` | string | `W`, `R`, `S`, `O`, or `U` — enforcement rows whose `violation_types` contains it. |
| `limit` / `offset` | int | Default 30, max 100. |

Returns `{"articles": [...], "total", "offset"}`. Each article carries `guid`
(`fr:{document_number}` or `dol-insp:{activity_nr}`), `source`, `category`, `doc_type`,
`title`, `link`, `pdf_url`, `citation`, `action`, `effective_on`, `comments_close_on`,
`scheduled_on`, `published_at`, `description`, `docket_ids`, `company`/`city`/`state`/`naics`,
`penalty_usd`, `violation_types`, `general_duty`, `unmapped_standards`, `cfr_parts`
(`[{"title": 29, "part": "1910"}]`), `sections` (`["1910.1030"]`), `takeaways` (three
fixed `{key, label, text}` bullets built server-side from the record's own fields — no
language model), and `snippet` (search only). JSON columns come back as arrays.

### `GET /api/news/status`
Read-only freshness report: `dol_configured`, `sync_enabled`, `agencies`, `syncing`,
`due` (any enabled source is stale and not backing off), per-source rows (`enabled`,
`last_ok_at`, `last_count`, `last_error`, `last_error_at`, `fail_count`, `stale`,
`retry_after`, `next_due_at`) and per-category `counts`. Sources go stale on a schedule
(Mon–Fri, America/New_York): Federal Register at **06:15 ET**, Public Inspection at
**09:00 / 11:30 / 16:30 ET**, DOL every **24 h**.

### `GET /api/news/facets`
States present among enforcement rows: `{"states": [{"code": "TX", "count": 12}]}`.

### `POST /api/news/refresh`
Body `{"force": false}` (default) or `{"force": true}`. `force: false` queues only the
sources that are due (refresh-on-open); `force: true` queues every enabled source,
ignoring staleness and backoff. Returns at once — `202 {"queued": [...]}` or
`200 {"queued": []}` — while the sync runs on the worker thread. `409` while a sync is
already running, `503` when `NEWS_SYNC` is off.

### `GET /api/news/section/{section_id}` · `GET /api/news/part/{part}`
The reader's activity button. Both take `?title=29` (default; works for any CFR title `1..50`) and return `{"section_id"|"part", "count", "articles", "stats"}`
with at most 15 articles, newest first, plus aggregated Federal Title 29 enforcement telemetry
(`case_count`, `citation_count`, `avg_penalty`, `fta_count`, and `top_paragraphs` — empty for non-29 titles). A section
matches exact citations plus part-level references to its part; a part matches everything inside it.

### `GET /api/news/fr/{document_number}`
On-demand full-text Federal Register document reader (`#/news/fr/{document_number}`). Fetches
`body_html_url` from `federalregister.gov` on cache miss, allowlist-sanitizes and CFR-linkifies
the HTML, caches it in `fr_bodies`, and returns `{"document_number", "article", "body_html", "fetched_at", "cached"}`.
`body_html` is `null` when the Federal Register offers no inline HTML for a document we already hold; `404` when it
offers none and we hold nothing locally. `422` for a malformed document number, `503` when the Federal Register
cannot be reached or does not recognise the number.

### `GET /api/news/enforcement/summary`
Local enforcement analytics aggregated over cached DOL OSHA inspections (`total_cases`,
`total_penalty_usd`, `avg_penalty_usd`, `max_penalty_usd`, `total_initial_usd`, `total_current_usd`,
`avg_reduction_pct`, `contested_cases`, `fta_cases`, `fta_total_usd`, `open_abate_cases`,
`gravity_counts`, `top_sections`, `top_states`, `largest_case`). Makes no external HTTP calls.

### `GET /api/news/enforcement/naics/{code}`
Cached industry enforcement benchmark (`case_count`, `total_penalty_usd`, `gdc_count`,
`fatality_count`, `top_sections`) for a 2–6 digit NAICS code or prefix. Optional `?federal_only=true`.

### `GET /api/news/inspection/{activity_nr}`
Local inspection case file (`article`, `detail`, `violations` with parsed section &
paragraph links, `events`, `gdc`, `accidents` (each with `injuries[{degree, degree_code, fall_distance_ft, fall_height_ft, fatality_cause_code}]`, one per injured person; cases fetched before this field existed gain it when enriched again with `?force=true`), `related` bidirectional inspection links,
`enrich_ver`, `needs_enrichment`, `dol_configured`).
Returns `404` when absent locally and `DOL_API_KEY` is unconfigured.

### `POST /api/news/inspection/{activity_nr}/enrich`
Requires `DOL_API_KEY`. Fetches live inspection details, individual violations, citation
event history (`violation_event`), General Duty Clause narratives (`violation_gen_duty_std`),
accident investigation abstracts (`accident*`), and bidirectional `related_activity` links from
`apiprod.dol.gov/v4`, caches them in `osha_news.sqlite3`, and returns the full case file.
Skips redundant upstream calls when `case_mod_date` is unchanged and `enrich_ver >= 1` unless `?force=true`.

### `GET /api/news/dol/search`
Requires `DOL_API_KEY` (`503` if missing, `429` during rate-limit cooldown). Explicit-submit live
lookup against `OSHA/inspection` or `OSHA/violation` (`q`, `mode=employer|naics|standard|hazsub`,
optional `state`, `since`, `min_penalty`, `sort_by=open_date|penalty`, `offset`, `limit<=25`)
backed by a 10-minute server TTL cache (`cached: true`).

---

## Settings (reader/.env)

### `GET /api/settings/env`
Status of `reader/.env` without exposing secrets: `{"env_exists", "env_file", "keys": {"DOL_API_KEY": {"configured", "masked"}, "ANTHROPIC_API_KEY": {…}}, …}`. Masked previews show only the key's tail (e.g. `sk-ant-••••1234`). `Cache-Control: no-store`.

### `POST /api/settings/env`
Create or update `reader/.env` and apply the change live (no restart). Body fields, all optional: `dol_api_key`, `clear_dol_api_key`, `anthropic_api_key`, `clear_anthropic_api_key`, `anthropic_model`, `news_sync` (bool), `news_retention_days` (1–3650). Values containing newlines are rejected with `400`. Returns `{"status": <the GET payload>, "news_sync_queued": [sources]}` — setting a DOL key queues a news sync when one isn't already running.

---

## Claude assistant

### `GET /api/{title}/models`
Models the configured key can access.

```json
{"configured": true, "models": [{"id": "…", "name": "…"}], "default": "…"}
```

With no `ANTHROPIC_API_KEY`: `{"configured": false, "models": [], "default": null}`.

### `POST /api/{title}/chat`
Streams a grounded conversation. Requires `ANTHROPIC_API_KEY` in `reader/.env` (`400` otherwise). The last message must be from the user.

Request:

```json
{
  "messages": [{"role": "user", "content": "What must a hazard communication program include?"}],
  "section_id": "1910.1200",
  "model": "<model id from /api/{title}/models>"
}
```

`section_id` (optional) is the CFR section open in the reader; its text is given to Claude as context. `open` (optional) does the same for a page of another framework: `{"corpus": "usc" | "constitution" | "plaw" | "fr" | "agenda", "key": "<the store's own id>", "collection": "<U.S.C. title, or Agenda edition YYYYMM>"}`, for example `{"corpus": "usc", "collection": "42", "key": "2000e–2"}` or `{"corpus": "constitution", "key": "amdt14-s1"}`. It is turned into a canonical id (`app/ids.py`); a value that is not one is ignored, and an unknown `corpus` is a `422`. When both are sent, `section_id` wins.

Claude may call six local, read-only tools: `search_federal` (every installed framework, each hit with its canonical id), `read_provision` (any unit by citation or id: a U.S.C. section, a Constitution unit, a Public Law, a CFR section or part, a Federal Register document or an Agenda rule; 40,000 characters per call, continued with `offset`), and for CFR-only work `search_regulations`, `read_section`, `list_part` (each taking an optional `title`, or `'all'` for search) and `search_enforcement` (reads locally cached `osha_news.sqlite3` only). No tool makes a network request or writes anything. Every tool result reaches Claude inside a `<retrieved>` fence that the text cannot close, and the system prompt tells Claude never to follow instructions found in retrieved text. At most 10 tool rounds run per request.

Response is **Server-Sent Events**: lines of `data: {json}\n\n` with these `type`s:

| `type` | Payload | Meaning |
|:---|:---|:---|
| `text` | `{"type": "text", "text": "…"}` | A chunk of the reply (Markdown). |
| `tool` | `{"type": "tool", "name": "read_section", "input": {…}}` | Claude is calling a tool. |
| `tool_result` | `{"type": "tool_result", "name": "read_section", "summary": "…"}` | Short description of what the tool returned. |
| `done` | `{"type": "done", "usage": {…}}` | Stream finished; `usage` is the final API usage object. |
| `error` | `{"type": "error", "message": "…"}` | A user-facing error; the stream ends. |

---

## Client examples

### Python (`httpx`)

```python
import httpx, json

API = "http://127.0.0.1:8000"

# Search every installed title
r = httpx.get(f"{API}/api/search", params={"q": "fall protection", "title": "all", "limit": 5})
for hit in r.json()["results"]:
    print(f"{hit['title']} CFR {hit['label']}  {hit['title_label']}")

# One unit of a long section
sec = httpx.get(f"{API}/api/29/section/1910.1200", params={"unit": "a"}).json()
print(sec["mode"], sec["unit"], len(sec["outline"]), "units")

# Chat stream
payload = {"messages": [{"role": "user", "content": "Summarise § 1904.7."}],
           "section_id": "1904.7", "model": "<model id>"}
with httpx.stream("POST", f"{API}/api/29/chat", json=payload, timeout=120) as resp:
    for line in resp.iter_lines():
        if line.startswith("data: "):
            ev = json.loads(line[6:])
            if ev["type"] == "text":
                print(ev["text"], end="", flush=True)
            elif ev["type"] == "tool":
                print(f"\n[{ev['name']} {ev['input']}]")
```

### JavaScript

```js
const res = await fetch("http://127.0.0.1:8000/api/40/search?q=" + encodeURIComponent("hazardous waste"));
const { results } = await res.json();
for (const r of results) console.log(r.label, r.title_label);
```
