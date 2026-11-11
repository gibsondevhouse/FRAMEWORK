# Title 29 CFR Reader & Assistant — API Reference

This document provides a complete guide to the REST and streaming APIs exposed by the Title 29 CFR Reader local backend.

---

## 1. Overview & Base URL

The backend is built with **FastAPI** and serves both the single-page reader frontend and structured JSON / SSE streaming APIs.

- **Default Base URL:** `http://127.0.0.1:8000`
- **Interactive Swagger UI:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- **ReDoc Documentation:** [http://127.0.0.1:8000/redoc](http://127.0.0.1:8000/redoc)
- **OpenAPI 3.0 Schema:** [http://127.0.0.1:8000/openapi.json](http://127.0.0.1:8000/openapi.json)

---

## 2. Endpoints Catalog

### `GET /api/meta`
Returns database metadata and system state.

#### Response Example
```json
{
  "edition": "2026-11-06",
  "built_at": "2026-11-09T20:37:13",
  "section_count": 7374,
  "ai_configured": true
}
```

---

### `GET /api/tree`
Returns the hierarchical Table of Contents across Title 29 (Agencies, Subtitles, Chapters, Subchapters, Parts, Subparts, and Section ranges).

#### Response
A JSON tree structure cached from `reader/data/tree.json`. Each node contains:
- `t`: Title or label (e.g. `"Part 1910 — Occupational Safety and Health Standards"`).
- `id`: Internal identifier (e.g. `"p-1910"`).
- `l`: Hierarchy level (`subtitle`, `chapter`, `subchapter`, `part`, `subpart`).
- `range`: Active section range (e.g. `"1910.1–1910.1450"`).
- `c`: Child nodes array.

---

### `GET /api/search`
High-speed full-text search across all 7,374 sections using SQLite FTS5 with BM25 relevance scoring.

#### Query Parameters
| Parameter | Type | Required | Description |
|:---|:---|:---|:---|
| `q` | `string` | **Yes** | Keyword(s), quoted phrase (`"confined space"`), or section ID (`1910.146`). |
| `part` | `string` | No | Scope search to a specific CFR part (e.g. `1910`, `541`, `825`). |
| `limit` | `integer` | No | Max results returned (default: `30`, min: `1`, max: `100`). |

#### Response Example
```json
{
  "query": "respirator",
  "total": 45,
  "ms": 8,
  "results": [
    {
      "id": "1910.134",
      "kind": "section",
      "part": "1910",
      "label": "§ 1910.134",
      "title": "Respiratory protection.",
      "snippet": "§ 1910.134 Respiratory protection. In the control of those occupational diseases caused by breathing air contaminated with harmful dusts, fogs, fumes, mists, gases, smokes, sprays, or ...",
      "exact": false
    }
  ]
}
```

*Note: Snippets contain ASCII control characters `\x02` (start highlight) and `\x03` (end highlight) around matched terms.*

---

### `GET /api/section/{section_id}`
Retrieves complete details for an individual regulation section or appendix.

#### Path Parameter
- `section_id` (`string`): The section identifier. Normalization handles flexible formats automatically:
  - `1910.120`
  - `§ 1910.120`
  - `29 CFR 1910.120`
  - `541.100(a)(1)` &rarr; normalizes to `541.100`

#### Response Example
```json
{
  "id": "541.100",
  "kind": "section",
  "part": "541",
  "label": "§ 541.100",
  "title": "General rule for executive employees.",
  "reserved": false,
  "path": [
    {"kind": "subtitle", "num": "B", "label": "Subtitle B"},
    {"kind": "chapter", "num": "V", "label": "Wage and Hour Division"},
    {"kind": "subchapter", "num": "A", "label": "Regulations"},
    {"kind": "part", "num": "541", "label": "Part 541"},
    {"kind": "subpart", "num": "B", "label": "Subpart B - Executive Employees"}
  ],
  "ecfr_url": "https://www.ecfr.gov/current/title-29/section-541.100",
  "html": "<div class=\"cfr-section\" data-section-id=\"541.100\">...</div>",
  "prev": {
    "id": "541.4",
    "label": "§ 541.4",
    "title": "Other laws and collective bargaining agreements."
  },
  "next": {
    "id": "541.101",
    "label": "§ 541.101",
    "title": "Reserved"
  }
}
```

---

### `GET /api/part/{part}`
Retrieves statutory authority and source notes (front-matter) for a CFR Part and its Subparts.

#### Path Parameter
- `part` (`string`): Part number, e.g. `1910` or `541`.

#### Response Example
```json
{
  "part": "<div class=\"cfr-front-matter\"><p class=\"authority\"><strong>Authority:</strong> 29 U.S.C. 653, 655, 657; ...</p></div>",
  "subparts": {
    "A": "<p class=\"source\"><strong>Source:</strong> 39 FR 23502, June 27, 1974, unless otherwise noted.</p>"
  }
}
```

---

### `GET /api/models`
Lists available Anthropic models accessible with the configured API key.

#### Response Example
```json
{
  "configured": true,
  "models": [
    "claude-3-5-sonnet-latest",
    "claude-3-5-haiku-latest",
    "claude-3-opus-latest"
  ],
  "default": "claude-3-5-sonnet-latest"
}
```

---

### `POST /api/chat`
Streams a multi-turn conversation with Claude, grounded in Title 29 via automated local database tool calling.

#### Headers
- `Content-Type: application/json`
- `Accept: text/event-stream`

#### Request Body
```json
{
  "messages": [
    {"role": "user", "content": "What criteria exempts an employee from overtime as an administrative worker?"}
  ],
  "section_id": "541.200",
  "model": "claude-3-5-sonnet-latest"
}
```

#### Streaming Response (Server-Sent Events)
Each line arrives as `data: {JSON}\n\n`. Event types include:
- `text`: Incremental markdown response tokens (`{"type": "text", "delta": "Under 29 CFR § 541.200..."}`).
- `tool`: When the model decides to search or read a regulation (`{"type": "tool", "name": "read_section", "input": {"section_id": "541.200"}}`).
- `tool_result`: The outcome of the database query (`{"type": "tool_result", "name": "read_section", "summary": "Read 2,840 chars"}`).
- `done`: Stream finished (`{"type": "done"}`).
- `error`: Error payload (`{"type": "error", "error": "Error description"}`).

---

## 3. Client Implementation Examples

### Python (`httpx`)
```python
import httpx

API = "http://127.0.0.1:8000"

# 1. Search regulations
res = httpx.get(f"{API}/api/search", params={"q": "scaffolding fall protection", "part": "1926", "limit": 2})
for match in res.json()["results"]:
    print(f"[{match['label']}] {match['title']}")

# 2. Fetch section HTML and raw text
sec = httpx.get(f"{API}/api/section/1926.451").json()
print("Direct eCFR Link:", sec["ecfr_url"])
```

### Node.js / TypeScript
```typescript
interface SearchResponse {
  query: string;
  total: number;
  ms: number;
  results: Array<{
    id: string;
    label: string;
    title: string;
    snippet: string;
  }>;
}

async function searchCFR(term: string): Promise<SearchResponse> {
  const res = await fetch(`http://127.0.0.1:8000/api/search?q=${encodeURIComponent(term)}&limit=5`);
  return res.json();
}
```

### Consuming the Chat SSE Stream (Python)
```python
import httpx
import json

payload = {
    "messages": [{"role": "user", "content": "What are required recordkeeping rules for workplace injuries?"}],
    "section_id": "1904.0",
    "model": "claude-3-5-sonnet-latest"
}

with httpx.stream("POST", "http://127.0.0.1:8000/api/chat", json=payload, timeout=60.0) as response:
    for line in response.iter_lines():
        if line.startswith("data: "):
            event = json.loads(line[6:])
            if event["type"] == "text":
                print(event["delta"], end="", flush=True)
            elif event["type"] == "tool":
                print(f"\n[Tool Calling: {event['name']} with {event['input']}]\n")
```

