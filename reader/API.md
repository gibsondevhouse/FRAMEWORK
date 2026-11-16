# FRAMEWORK CFR Reader — API Reference

The backend is a **FastAPI** app that serves the single-page reader and a JSON / SSE API over the locally installed CFR titles.

- **Base URL:** `http://127.0.0.1:8000`
- **Swagger UI:** http://127.0.0.1:8000/docs · **ReDoc:** http://127.0.0.1:8000/redoc · **OpenAPI:** http://127.0.0.1:8000/openapi.json

## Conventions

- **Title scoping.** Reader routes live under `/api/{title}/…` where `{title}` is a CFR title number (1–50) that is installed on this server; an uninstalled title returns `404`. The same routes without the prefix (`/api/meta`, `/api/section/{id}`, …) are legacy aliases for **Title 29**.
- **Section IDs** are normalised: `541.100`, `§ 541.100`, `29 CFR 541.100` and `541.100(a)(1)` all resolve to `541.100`.
- **Field naming.** In section and search payloads, `title` is the CFR **title number** and `title_label` (or `section_title`) is the section's **heading**. Keep both in mind when reading results.
- **Highlights** in search snippets are marked with the ASCII control characters `\x02` (start) and `\x03` (end).

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

`partial` is true when only some parts/sections of the title are installed.

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
All 50 titles with install state, plus the job queue.

```json
{
  "titles": [
    {"title": 29, "name": "Labor", "latest": "2026-11-06", "reserved": false,
     "installed": {"edition": "2026-11-06", "section_count": 7374, "whole": true, "parts": null, "sections": null}},
    {"title": 35, "name": "Reserved", "latest": null, "reserved": true, "installed": null}
  ],
  "jobs": {"current": null, "queued": [], "recent": []}
}
```

For a partial install `whole` is false and `parts` / `sections` count what was selected.

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

### `POST /api/library/{title}/update`
Re-download an installed title at the latest eCFR edition.

### `DELETE /api/library/{title}`
Remove an installed title. Refused (`409`) for the only installed title or one with a download in progress.

### `GET /api/library/jobs`
Queue snapshot. Each job carries `id`, `title`, `kind` (`title` | `part` | `section` | `update`), `label`, `state` (`queued` | `running` | `done` | `error`), `phase`, `done`, `total`, `error`.

```json
{
  "current": {"id": 3, "title": 40, "kind": "part", "label": "Part 261 · Title 40",
              "state": "running", "phase": "Downloading", "done": 2, "total": 5, "error": null},
  "queued": [],
  "recent": []
}
```

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
