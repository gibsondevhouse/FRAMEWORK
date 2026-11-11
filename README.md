# Title 29 (Labor) Regulations Framework & Web Reader

This workspace contains an ingestion inventory and a modern, high-speed reading interface for **Title 29 of the Code of Federal Regulations (CFR)**.

---

## What's in this Workspace?

1. **Web Reader & Claude Assistant (`reader/`):**
   - A complete local web application built with **FastAPI**, **SQLite FTS5**, and **Claude API**.
   - Parses official government eCFR XML into readable, indented legal typography with linked cross-references.
   - Built-in full-text search across all 7,374 regulations and appendices.
   - Grounded AI research drawer powered by Claude 3.5 / 3.7.
   - See [reader/README.md](reader/README.md) for launch instructions.

2. **Official eCFR & GovInfo API Inventory (`docs/`):**
   - `docs/title-29/`: Complete XML rendition inventory of official GovInfo published editions across all 9 volumes (9,101 URLs).
   - `docs/title-29-api/`: Section-by-section eCFR Versioner, Ancestry, and History endpoint mappings (26,153 endpoints).
   - `docs/dev/`: Raw source dumps and aggregate URL catalogs.

---

## Quick Launch: Start the Reader

```powershell
# Navigate into the reader directory
cd reader

# Run the local server
..\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Open **[http://127.0.0.1:8000](http://127.0.0.1:8000)** in your browser.

