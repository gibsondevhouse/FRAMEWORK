import { state } from '../state';
import { updateChatContext } from '../components/chat';
import { clearTreeSelection } from '../components/sidebar';
import { setViewHead } from '../components/view_head';
import { enterView, escapeHtml, icon } from '../dom';
import { dom } from '../state_init';
import { getJSON, statPill } from '../views/library';

// --- Help & Setup Guide (#/help) + .env Editor Modal ---
// Custom inline SVG provider emblems (tokens-only, offline-safe).
export const HELP_LOGOS = {
  dol: `<svg class="help-logo-svg" viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <path d="M32 8 52 16v14c0 13.5-8.6 22.8-20 26-11.4-3.2-20-12.5-20-26V16L32 8Z" stroke="currentColor" stroke-width="2.2" fill="currentColor" fill-opacity=".06"/>
    <path d="M32 18v24M21 24h22" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round"/>
    <path d="m21 24-4 9h8l-4-9Zm22 0-4 9h8l-4-9Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M25 44h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`,
  anthropic: `<svg class="help-logo-svg" viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <rect x="8" y="8" width="48" height="48" rx="14" stroke="currentColor" stroke-width="2.2" fill="currentColor" fill-opacity=".06"/>
    <path d="M25.5 44 33 20l7.5 24M28.2 36.5h9.6" stroke="var(--accent)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M18.5 44 26 20h3.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" opacity=".75"/>
  </svg>`,
  fr: `<svg class="help-logo-svg" viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <rect x="10" y="10" width="44" height="44" rx="10" stroke="currentColor" stroke-width="2.2" fill="currentColor" fill-opacity=".06"/>
    <circle cx="22" cy="42" r="3.2" fill="var(--accent)"/>
    <path d="M20 31.5a12.5 12.5 0 0 1 12.5 12.5M20 22a22 22 0 0 1 22 22" stroke="var(--accent)" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M36 18h10M36 24h10" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" opacity=".7"/>
  </svg>`,
  ecfr: `<svg class="help-logo-svg" viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <path d="M12 18c0-2.2 1.8-4 4-4h13c2.2 0 3 1.2 3 3v31c0-1.5-1.3-2.5-3-2.5H16c-2.2 0-4 1.8-4 4V18Z" stroke="currentColor" stroke-width="2.2" fill="currentColor" fill-opacity=".06"/>
    <path d="M52 18c0-2.2-1.8-4-4-4H35c-2.2 0-3 1.2-3 3v31c0-1.5 1.3-2.5 3-2.5h13c2.2 0 4 1.8 4 4V18Z" stroke="currentColor" stroke-width="2.2" fill="currentColor" fill-opacity=".06"/>
    <path d="M18 23h8M18 29h8M38 23h8M38 29h8" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`,
};


export const FR_RSS_FEEDS = [
  {
    label: 'OSHA Published Documents RSS',
    desc: 'Final Rules, Proposed Rules, and Notices from the Federal Register.',
    url: 'https://www.federalregister.gov/api/v1/documents.rss?conditions%5Bagencies%5D%5B%5D=occupational-safety-and-health-administration',
  },
  {
    label: 'OSHA Public Inspection RSS',
    desc: 'Pre-publication filings scheduled to appear in tomorrow’s Federal Register.',
    url: 'https://www.federalregister.gov/api/v1/public-inspection-documents.rss?conditions%5Bagencies%5D%5B%5D=occupational-safety-and-health-administration',
  },
];


export async function loadHelp() {
  const seq = state.routeSeq;
  state.currentSection = null;
  state.currentPart = null;
  clearTreeSelection();
  updateChatContext();
  setViewHead('');
  document.title = 'Connections & API Keys · FRAMEWORK';
  if (!state.navEnvStatus) {
    dom.view.innerHTML = '<div class="loading">Loading setup guide…</div>';
    enterView();
  }
  try {
    const [env, newsSt] = await Promise.all([
      getJSON('/api/settings/env'),
      getJSON('/api/news/status').catch(() => null),
    ]);
    if (seq !== state.routeSeq) return;
    state.navEnvStatus = env;
    if (newsSt) state.navNewsStatus = newsSt;
    renderHelp(env, { enter: true });
  } catch (e) {
    if (seq !== state.routeSeq) return;
    renderHelp(state.navEnvStatus || { env_exists: false, env_file: 'reader/.env', keys: {} }, { enter: true });
  }
}


// The page is framed around outcomes (which connections are on), not mechanisms: the
// .env explainer lives in a footer footnote, actionable key cards come first under a
// status strip, and cards share one left-aligned anatomy (no zig-zag).
export function renderHelp(env, opts = {}) {
  const keys = (env && env.keys) || {};
  const dol = keys.DOL_API_KEY || {};
  const ant = keys.ANTHROPIC_API_KEY || {};
  const syncOn = keys.NEWS_SYNC ? keys.NEWS_SYNC.value : true;
  const retDays = keys.NEWS_RETENTION_DAYS ? keys.NEWS_RETENTION_DAYS.value : 365;
  const titleCount = state.installedTitles.length;
  const titlesWord = `${titleCount} ${titleCount === 1 ? 'title' : 'titles'}`;

  // The status strip answers "what's running?" in one glance and jumps to each card.
  const chip = (target, state, label) => `
    <button type="button" class="help-status-chip" data-help-jump="${target}">
      <span class="stat-dot is-${state}" aria-hidden="true"></span>${escapeHtml(label)}</button>`;
  const statusStrip = `
    <nav class="help-status" aria-label="Connection status">
      ${chip('federal-register', syncOn ? 'synced' : 'stale', syncOn ? 'Federal Register · On' : 'Federal Register · Sync off')}
      ${chip('ecfr', 'synced', `CFR Library · ${titlesWord}`)}
      ${chip('dol', dol.configured ? 'synced' : 'uninstalled', `DOL enforcement · ${dol.configured ? 'On' : 'Off'}`)}
      ${chip('anthropic', ant.configured ? 'synced' : 'uninstalled', `Claude assistant · ${ant.configured ? 'On' : 'Off'}`)}
    </nav>`;

  const optionalCards = [
    {
      id: 'dol',
      logo: HELP_LOGOS.dol,
      provider: 'U.S. Department of Labor · Free key',
      title: 'OSHA Enforcement Data',
      pill: dol.configured ? statPill('synced', `On (${dol.masked || 'key saved'})`) : statPill('uninstalled', 'Off'),
      body: `
        <p><strong>What this key allows:</strong> Unlocks the <em>Enforcement &amp; Penalties</em> tab in <a href="#/news?cat=enforcement">News</a> and adds workplace inspection citations to the regulation timeline inside Title 29 sections.</p>
        <p>You’ll see cited companies, city/state locations, violation severity (Willful, Repeat, Serious), cited 29 CFR standards, and current penalty totals directly from <code>apiprod.dol.gov/v4</code>.</p>`,
      actions: `
        <button type="button" class="btn btn-accent" data-open-env="dol_api_key">${icon('key')} ${dol.configured ? 'Update DOL key' : 'Add DOL key'}</button>
        <a class="btn" href="https://dataportal.dol.gov/registration" target="_blank" rel="noopener">${icon('external')} Get a free DOL key</a>`,
    },
    {
      id: 'anthropic',
      logo: HELP_LOGOS.anthropic,
      provider: 'Anthropic · Paid key',
      title: 'Claude Regulatory Assistant',
      pill: ant.configured ? statPill('synced', `On (${ant.masked || 'key saved'})`) : statPill('uninstalled', 'Off'),
      body: `
        <p><strong>What this key allows:</strong> Turns on the <em>Ask Claude</em> side panel so you can ask plain-English compliance questions, summarize long sections, and trace requirements across your installed CFR titles.</p>
        <p>Reading regulations, full-text search, projects, and Federal Register news all work without it—this key is only for the AI assistant.</p>`,
      actions: `
        <button type="button" class="btn btn-accent" data-open-env="anthropic_api_key">${icon('key')} ${ant.configured ? 'Update Anthropic key' : 'Add Anthropic key'}</button>
        <a class="btn" href="https://console.anthropic.com" target="_blank" rel="noopener">${icon('external')} Get an Anthropic key</a>`,
    },
  ];

  const includedCards = [
    {
      id: 'federal-register',
      logo: HELP_LOGOS.fr,
      provider: 'Federal Register · No key needed',
      title: 'OSHA Rulemaking & Official RSS Feeds',
      pill: syncOn ? statPill('synced', `On · ${retDays}d history`) : statPill('stale', 'Sync off'),
      body: `
        <p><strong>What this source allows:</strong> Keeps the <a href="#/news">Newsroom</a> updated on business days with OSHA Final Rules, Proposed Rules, Notices, and Public Inspection filings—automatically, with no key or setup.</p>
        <div class="help-rss-list">${FR_RSS_FEEDS.map(f => `
          <div class="help-rss-row">
            <div class="help-rss-text"><strong>${escapeHtml(f.label)}</strong><span>${escapeHtml(f.desc)}</span></div>
            <div class="help-rss-btns">
              <button type="button" class="btn btn-sm" data-copy-url="${escapeHtml(f.url)}">${icon('copy')} Copy RSS URL</button>
              <a class="btn btn-sm" href="${escapeHtml(f.url)}" target="_blank" rel="noopener">${icon('rss')} Open</a>
            </div>
          </div>`).join('')}
        </div>
        <p class="help-fineprint">The same updates, as official Federal Register feeds for any external RSS reader. FRAMEWORK itself reads the richer JSON API and skips <code>osha.gov/rss</code>, which rejects automated readers.</p>`,
      actions: `
        <button type="button" class="btn" data-open-env="news_sync">${icon('key')} Sync settings</button>
        <a class="btn" href="#/news">${icon('news')} Open Newsroom</a>`,
    },
    {
      id: 'ecfr',
      logo: HELP_LOGOS.ecfr,
      provider: 'eCFR · No key needed',
      title: 'Federal Regulations Library (Titles 1–50)',
      pill: statPill('synced', `On · ${titlesWord} installed`),
      body: `
        <p><strong>What this source allows:</strong> Downloads full Code of Federal Regulations titles, parts, or individual sections directly from <code>ecfr.gov</code> into your local SQLite library for fast offline reading and search.</p>`,
      actions: `
        <a class="btn" href="#/library">${icon('book')} Browse CFR Library</a>`,
    },
  ];

  const cardHtml = (c) => `
    <article class="help-card" id="help-${c.id}">
      <div class="help-logo" aria-hidden="true">${c.logo}</div>
      <div class="help-body">
        <div class="help-card-top">
          <span class="help-provider">${escapeHtml(c.provider)}</span>
          ${c.pill}
        </div>
        <h3 class="help-card-title">${escapeHtml(c.title)}</h3>
        <div class="help-card-copy">${c.body}</div>
        <div class="help-actions">${c.actions}</div>
      </div>
    </article>`;

  dom.view.innerHTML = `
    <div class="help-front">
      <header class="help-head">
        <div>
          <div class="doc-kicker">FRAMEWORK Settings · Help</div>
          <h1 class="doc-title">Connections &amp; API Keys</h1>
          <p class="help-lead">Reading and search work offline out of the box. The optional keys below unlock more—each is saved locally and applies instantly, with no restart.</p>
        </div>
        <div class="help-head-actions">
          <button type="button" class="btn" data-open-env="">${icon('key')} Edit API keys</button>
        </div>
      </header>
      ${statusStrip}
      <section class="help-group" aria-labelledby="help-group-optional">
        <h2 class="help-group-label" id="help-group-optional">Optional keys</h2>
        ${optionalCards.map(cardHtml).join('')}
      </section>
      <section class="help-group" aria-labelledby="help-group-included">
        <h2 class="help-group-label" id="help-group-included">Included · already running</h2>
        ${includedCards.map(cardHtml).join('')}
      </section>
      <footer class="help-footnote">
        <p>Keys are stored in <code>reader/.env</code>, a private plain-text file on your computer—never shared or uploaded. ${env && env.env_exists ? 'Yours exists and is active.' : 'It’s created the first time you save a key here.'}</p>
        <details class="help-env-details">
          <summary>What is a .env file?</summary>
          <p>A <strong>.env</strong> file holds environment settings—API keys and preferences—as plain <code>KEY=value</code> lines. Normally, setting one up means copying example files in a terminal; here, <em>Edit API keys</em> creates and updates <code>reader/.env</code> for you, and changes take effect right away with no restart.</p>
          <button type="button" class="btn btn-sm" data-open-env="">${icon('key')} Open the editor</button>
        </details>
      </footer>
    </div>`;
  if (opts.enter) enterView();
}
