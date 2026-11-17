# Stage 3 · Phase 2 · Part 3: Pipeline Phase Descriptors & Step Indicators

## 1. Objectives
Map internal Python build stages from `reader/app/build.py` into clear, user-friendly enterprise step descriptions and indicators inside the Transfer Dock.

## 2. Technical Specification

### 2.1 Pipeline Phase Mapping
```javascript
const PIPELINE_PHASES = [
  { key: 'structure', label: 'Resolving eCFR hierarchy' },
  { key: 'download', label: 'Streaming raw XML payload' },
  { key: 'parse', label: 'Extracting sections & appendices' },
  { key: 'fts', label: 'Compiling FTS5 search index' },
  { key: 'finalize', label: 'Atomic database swap' }
];

function mapFriendlyPhase(phase) {
  if (!phase) return 'Processing regulatory data…';
  const p = phase.toLowerCase();
  if (p.includes('structure')) return 'Fetching latest eCFR tree…';
  if (p.includes('downloading')) return 'Streaming regulatory XML…';
  if (p.includes('parsing') || p.includes('building')) return 'Parsing sections & structure…';
  if (p.includes('indexing') || p.includes('fts')) return 'Indexing SQLite FTS5 search corpus…';
  return phase;
}
```

### 2.2 Dock Footer Queue & Cancel Actions
```html
<div class="dock-footer">
  <span class="dock-phase-text">${mapFriendlyPhase(j.phase)}</span>
  <div class="dock-footer-actions">
    ${jobs.queued.length ? `<span class="dock-queue-badge">+${jobs.queued.length} queued</span>` : ''}
    <button type="button" class="dock-cancel-btn" data-act="cancel-job" data-id="${j.id}">Cancel</button>
  </div>
</div>
```

## 3. Acceptance Criteria
- [ ] Phases clearly explain background processing (e.g., FTS5 index building vs. XML download).
- [ ] Users can cancel the current job or clear the queue.
