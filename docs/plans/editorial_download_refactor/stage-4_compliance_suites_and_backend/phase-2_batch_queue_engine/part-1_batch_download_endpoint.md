# Stage 4 · Phase 2 · Part 1: Batch Download API Endpoint

## 1. Objectives
Create a batch download endpoint `POST /api/library/batch-download` that accepts an array of title numbers or a suite ID and queues them atomically onto `library.queue`.

## 2. Technical Specification

### 2.1 Backend Route Handler (`reader/app/main.py`)
```python
class BatchDownloadRequest(pydantic.BaseModel):
    titles: list[int] | None = None
    suite: str | None = None

@app.post("/api/library/batch-download")
def batch_download(req: BatchDownloadRequest):
    titles_to_queue = []
    if req.suite:
        suite = library.COMPLIANCE_SUITES.get(req.suite)
        if not suite:
            raise HTTPException(status_code=404, detail=f"Suite {req.suite!r} not found")
        titles_to_queue = suite["titles"]
    elif req.titles:
        titles_to_queue = req.titles
    else:
        raise HTTPException(status_code=400, detail="Must provide titles list or suite id")

    queued_jobs = []
    for t in titles_to_queue:
        # Skip if already whole installed at latest edition
        inst = library.installed(t)
        latest_ed = library.ecfr_title(t)["up_to_date_as_of"]
        if inst and inst["whole"] and inst["edition"] == latest_ed:
            continue
        job = library.queue.enqueue(t, "title", None, f"Title {t}")
        queued_jobs.append(job)

    return {"queued": queued_jobs, "count": len(queued_jobs)}
```

### 2.2 Client-Side Trigger (`reader/static/app.js`)
```javascript
dom.view.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act="download-suite"]');
  if (!btn) return;
  const suiteId = btn.dataset.suite;
  btn.disabled = true;
  try {
    const res = await getJSON('/api/library/batch-download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suite: suiteId }),
    });
    showToast(`Queued ${res.count} titles for download`);
    await pollJobs();
  } catch (err) {
    showToast(err.message, 5000);
    btn.disabled = false;
  }
});
```

## 3. Acceptance Criteria
- [ ] Submitting a suite ID queues all non-installed titles in the suite.
- [ ] Already up-to-date titles in the suite are skipped automatically without errors.
- [ ] Queue reports all added job IDs immediately.
