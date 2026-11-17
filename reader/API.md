# FRAMEWORK — API Reference

Welcome to the HTTP and streaming API behind **FRAMEWORK**, a local-first Regulatory Workstation. The backend is a **FastAPI** service that powers the browser interface and exposes a clean JSON / SSE API over whatever CFR titles you have installed locally.

- **Base URL:** `http://127.0.0.1:8000`
- **Interactive Docs:** [Swagger UI](http://127.0.0.1:8000/docs) · [ReDoc](http://127.0.0.1:8000/redoc) · [OpenAPI JSON](http://127.0.0.1:8000/openapi.json)

## A few conventions

- **Title scoping.** Most routes live under `/api/{title}/…`, where `{title}` is a CFR title number (1–50) installed on your machine. Asking for a title that isn't installed returns `404`. Routes without the prefix (`/api/meta`, `/api/section/{id}`, …) are kept as friendly aliases for **Title 29**.
- **Section IDs** are flexible: `541.100`, `§ 541.100`, `29 CFR 541.100`, and `541.100(a)(1)` all normalize cleanly to `541.100`.
- **Field naming.** In section and search payloads, `title` is the CFR **title number** and `title_label` (or `section_title`) is the section's **heading**.
- **Search highlights** in snippets are wrapped with the ASCII control characters `\x02` (start) and `\x03` (end) so you can style them however you like.

---

## Titles and metadata

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
    "ai_configured": true
  }
]
```

`partial` is true when only some parts/sections of the title are installed. Returns `[]` on a fresh server before any title is downloaded.

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
Same fields for one title (without `partial`).

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
What the reader keeps on disk: `{"titles": [{"title", "bytes"}], "legacy_bytes", "temp_files", "temp_bytes", "total_bytes"}`. A title's bytes are its database plus contents tree; `legacy_bytes` is Title 29's legacy copy (`title29.sqlite3`, `tree.json`); temp files are what an interrupted build left behind (any name containing `.tmp`).

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
Queue whole-title downloads for a suite or a list of titles: `{"suite": "ehs"}` or `{"titles": [12, 15]}`. Reserved titles and titles already installed whole at the latest edition are skipped; a whole title on an older edition gets an update job; a partial install is completed. Returns `{"queued": [jobs], "skipped": [{"title", "reason"}], "count"}`. `404` for an unknown suite, `400` for an empty request or a title outside 1–50.

### `POST /api/library/update-all`
Queue an update for every installed title (whole or partial, keeping its scope) whose edition is older than eCFR's latest. Returns `{"queued": [jobs], "count"}`; `count` is 0 when everything is current.

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
| `section` | string | Articles citing that Title 29 section, plus part-level references to its part. |
| `part` | string | Articles with any citation inside that Title 29 part. |
| `state` | string | Two-letter site state (enforcement only). |
| `min_penalty` | number | Enforcement rows with `penalty_usd >=` this. |
| `gravity` | string | `W`, `R` or `S` — enforcement rows whose `violation_types` contains it. |
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
The reader's activity button. Both take `?title=29` (default; other titles return empty
while OSHA is the only agency) and return `{"section_id"|"part", "count", "articles"}`
with at most 15 articles, newest first. A section matches exact citations plus
part-level references to its part; a part matches everything inside it.

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

`section_id` (optional) is the section open in the reader; its text is given to Claude as context. Claude may call three local tools, each taking an optional `title` (a number, or `'all'` for search): `search_regulations`, `read_section` (40,000 characters per call, continued with `offset`) and `list_part`. At most 10 tool rounds run per request.

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
