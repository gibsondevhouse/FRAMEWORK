# Stage 4 · Phase 2 · Part 2: "Update All Outdated" Automated Job

## 1. Objectives
Implement `POST /api/library/update-all` to scan all installed titles, identify those whose local edition is older than eCFR's `up_to_date_as_of`, and enqueue update jobs for each.

## 2. Technical Specification

### 2.1 Backend Endpoint (`reader/app/main.py`)
```python
@app.post("/api/library/update-all")
def update_all_outdated():
    installed_titles = config.installed_titles()
    updated_jobs = []
    
    for t in installed_titles:
        inst = library.installed(t)
        if not inst:
            continue
        try:
            info = library.ecfr_title(t)
            latest = info.get("up_to_date_as_of")
            if latest and inst.get("edition") and latest > inst["edition"]:
                job = library.queue.enqueue(t, "update", None, f"Title {t} (update to {latest})")
                updated_jobs.append(job)
        except Exception:
            continue

    return {"queued": updated_jobs, "count": len(updated_jobs)}
```

### 2.2 Telemetry Button Trigger (`reader/static/app.js`)
```javascript
dom.view.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act="update-all"]');
  if (!btn) return;
  btn.disabled = true;
  try {
    const res = await getJSON('/api/library/update-all', { method: 'POST' });
    showToast(res.count > 0 ? `Queued ${res.count} title updates` : 'All titles already up to date');
    await pollJobs();
  } catch (err) {
    showToast(err.message, 5000);
    btn.disabled = false;
  }
});
```

## 3. Acceptance Criteria
- [ ] Only titles with local edition strictly older than eCFR latest edition are queued.
- [ ] If all titles are current, returns 0 queued jobs with a friendly notice.
- [ ] Respects existing partial scope if a title was installed partially.
