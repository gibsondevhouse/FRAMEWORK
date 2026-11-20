import { getJSON } from '../api/client';
import { escapeHtml, plural, safeHttpUrl, skeletonHtml } from '../dom';
import {
  groupIntegrity, IntegrityGroup, IntegrityReport, IntegrityStatus, IntegrityTarget, provenanceRows, shortHash, statusWord,
} from '../core/integrity';

// --- Settings → Data integrity (#/settings/integrity, FT-07) ---
// The `python -m app.integrity` report on screen: one card per framework, one block per store
// with each check and where its data came from (source, fetch time, SHA-256). The first load is
// offline (no network); "Compare with official sources" re-runs it online. Statuses are words with
// their own class (`.int-st`), never `statPill`, which is reserved for sync state.

let report: IntegrityReport | null = null;
let loading = false;
let error = '';

const stWord = (s: IntegrityStatus): string =>
  `<span class="int-st int-st-${s.toLowerCase()}">${escapeHtml(statusWord(s))}</span>`;

function provenanceHtml(t: IntegrityTarget): string {
  const rows = provenanceRows(t.provenance);
  if (!rows.length) return '';
  return `<dl class="int-prov">${rows.map(r => {
    let v = escapeHtml(r.value);
    if (r.hash && r.value !== 'unknown') v = `<code title="${escapeHtml(r.value)}">${escapeHtml(shortHash(r.value))}</code>`;
    else if (r.key === 'source_url' && safeHttpUrl(r.value)) {
      v = `<a href="${escapeHtml(safeHttpUrl(r.value))}" target="_blank" rel="noopener">${escapeHtml(r.value)}</a>`;
    }
    return `<dt>${escapeHtml(r.label)}</dt><dd${r.value === 'unknown' ? ' class="is-unknown"' : ''}>${v}</dd>`;
  }).join('')}</dl>`;
}

function targetHtml(t: IntegrityTarget): string {
  const open = t.status === 'WARN' || t.status === 'FAIL';
  return `<details class="int-target"${open ? ' open' : ''}>
      <summary><span class="int-target-name">${escapeHtml(t.target)}</span>${stWord(t.status)}</summary>
      <ul class="int-checks">${t.checks.map(c => `<li>${stWord(c.status)}<span class="int-check">${escapeHtml(c.check.replace(/_/g, ' '))}</span><span class="int-detail">${escapeHtml(c.detail)}</span></li>`).join('')}</ul>
      ${provenanceHtml(t)}
    </details>`;
}

function groupHtml(g: IntegrityGroup): string {
  return `<section class="set-card set-card-wide int-card" aria-label="${escapeHtml(g.label)}">
      <div class="int-card-head"><h2 class="set-card-label">${escapeHtml(g.label)}</h2>${stWord(g.status)}<span class="int-count">${escapeHtml(plural(g.targets.length, 'store'))}</span></div>
      ${g.targets.map(targetHtml).join('')}
    </section>`;
}

/** The tab body. */
export function integrityHtml(): string {
  const busy = loading ? ' disabled aria-busy="true"' : '';
  const s = report?.summary || {};
  const counts = report
    ? [`${s.FAIL || 0} ${s.FAIL === 1 ? 'problem' : 'problems'}`, `${s.WARN || 0} to check`, `${s.OK || 0} OK`, `${s.INFO || 0} notes`].join(' · ')
    : '';
  const when = report?.checked_at ? new Date(report.checked_at).toLocaleString() : '';
  const bar = `<div class="int-bar">
      <p class="int-lead">Checks every installed store: that the database opens and is intact, that its counts match what was recorded, and where its text came from with the checksum taken when it was downloaded. ${report?.online ? 'This run also compared editions with the official sources.' : 'This run stayed offline.'}</p>
      <div class="int-acts">
        <button type="button" class="btn" data-int-act="offline"${busy}>Check again</button>
        <button type="button" class="btn" data-int-act="online"${busy}>Compare with official sources</button>
      </div>
      ${report ? `<p class="int-sum">${escapeHtml(counts)}${when ? ` · checked ${escapeHtml(when)}` : ''}</p>` : ''}
    </div>`;
  if (error) return `${bar}<div class="empty-state"><h2>The integrity check didn’t run</h2><p>${escapeHtml(error)}</p></div>`;
  if (!report) return `${bar}${skeletonHtml('list', 'Checking every store…')}`;
  const all = groupIntegrity(report);
  const groups = all.filter(g => g.installed);
  const absent = all.filter(g => !g.installed).map(g => g.label);
  const absentHtml = absent.length
    ? `<p class="int-absent">Not downloaded, so nothing to check: ${escapeHtml(absent.join(', '))}. Add them from the <a href="#/library">Library</a>.</p>`
    : '';
  if (!groups.length) return `${bar}<div class="empty-state"><h2>Nothing installed yet</h2><p>Download a framework in the <a href="#/library">Library</a> and its checks appear here.</p></div>`;
  return `${bar}<div class="settings-grid int-grid">${groups.map(groupHtml).join('')}</div>${absentHtml}`;
}

/** Run the report (offline unless `online`); resolves once `integrityHtml()` reflects it. */
export async function loadIntegrity(online = false): Promise<void> {
  loading = true;
  error = '';
  try {
    report = await getJSON<IntegrityReport>(`/api/integrity${online ? '' : '?offline=true'}`);
  } catch (err) {
    error = err instanceof Error ? err.message : 'The server didn’t answer.';
  } finally {
    loading = false;
  }
}

