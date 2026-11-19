import { FrBodyResponse, NewsArticle, state } from '../state';
import { getJSON } from '../api/client';
import { newsBylineHtml, newsKicker, newsPartHref, newsSectionHref, titleInstalled } from '../core/news_format';
import { updateChatContext } from '../components/chat';
import { clearTreeSelection } from '../components/sidebar';
import { setViewHead } from '../components/view_head';
import { emptyStateHtml, fmtDate, joinSep } from '../components/ui';
import { enterView, escapeHtml, icon, safeHttpUrl, sanitizeHtml, skeletonHtml } from '../dom';
import { dom } from '../state_init';

function articleTitleNum(a: NewsArticle | null | undefined): number {
  if (!a) return 29;
  if (typeof a.title_num === 'number' && a.title_num > 0) return a.title_num;
  const firstPart = a.cfr_parts?.[0]?.title;
  return typeof firstPart === 'number' && firstPart > 0 ? firstPart : 29;
}

function frDocChipsHtml(a: NewsArticle | null): string {
  if (!a) return '';
  const chips: string[] = [];
  const defaultTitle = articleTitleNum(a);
  for (const r of a.cfr_parts || []) {
    const dim = !titleInstalled(r.title);
    chips.push(
      `<a class="citation-chip${dim ? ' is-dim' : ''}" data-ref-tier="${dim ? 'uninstalled' : 'cfr'}" href="${newsPartHref(r.title, r.part)}">${r.title} CFR Part ${escapeHtml(String(r.part))}</a>`,
    );
  }
  for (const s of a.sections || []) {
    const dim = !titleInstalled(defaultTitle);
    chips.push(
      `<a class="citation-chip${dim ? ' is-dim' : ''}" data-ref-tier="${dim ? 'uninstalled' : 'cfr'}" href="${newsSectionHref(defaultTitle, s)}">§ ${escapeHtml(s)}</a>`,
    );
  }
  return chips.length ? `<div class="news-chips fr-doc-chips">${chips.join('')}</div>` : '';
}

export function renderFrDocument(data: FrBodyResponse): void {
  const art = data.article;
  const docNum = data.document_number;
  const title = art?.title || `Federal Register Document ${docNum}`;
  document.title = `${title} · Federal Register · FRAMEWORK`;

  const kicker = art ? newsKicker(art) : `FEDERAL REGISTER · ${docNum}`;
  const link = safeHttpUrl(art?.link);
  const pdf = safeHttpUrl(art?.pdf_url || '');
  const metaBits: string[] = [];
  if (art?.published_at) metaBits.push(`Published ${fmtDate(art.published_at)}`);
  if (art?.effective_on) metaBits.push(`Effective ${fmtDate(art.effective_on)}`);
  if (art?.comments_close_on) metaBits.push(`Comments close ${fmtDate(art.comments_close_on)}`);
  if (art?.docket_ids?.length) metaBits.push(`Docket ${art.docket_ids[0]}`);
  if (art?.agency) metaBits.push(art.agency.replace(/-/g, ' '));

  const actionsHtml = [
    `<a class="btn btn-sm" href="#/news">${icon('chevronLeft')} All news</a>`,
    link ? `<a class="btn btn-sm" target="_blank" rel="noopener noreferrer" href="${escapeHtml(link)}">${icon('external')} Federal Register</a>` : '',
    pdf ? `<a class="btn btn-sm" target="_blank" rel="noopener noreferrer" href="${escapeHtml(pdf)}">${icon('external')} PDF</a>` : '',
  ].filter(Boolean).join('');

  const bodySection = data.body_html
    ? `<div class="fr-doc-body reg-prose">${sanitizeHtml(data.body_html)}</div>`
    : `<div class="empty-state"><h2>Full preamble unavailable</h2><p>The Federal Register did not provide inline HTML for document <code>${escapeHtml(docNum)}</code>.${link ? ` <a target="_blank" rel="noopener noreferrer" href="${escapeHtml(link)}">Read on FederalRegister.gov</a>.` : ''}</p></div>`;

  dom.view.innerHTML = `<div class="fr-doc-page">
    <header class="fr-doc-head">
      <div class="news-kicker">${escapeHtml(kicker)}</div>
      <h1 class="fr-doc-title">${escapeHtml(title)}</h1>
      ${art ? newsBylineHtml(art) : ''}
      ${metaBits.length ? `<div class="fr-doc-meta">${joinSep(metaBits.map(b => escapeHtml(b)))}</div>` : ''}
      ${art?.action ? `<p class="fr-doc-action">${escapeHtml(art.action)}</p>` : ''}
      ${frDocChipsHtml(art)}
      <div class="fr-doc-actions">${actionsHtml}</div>
    </header>
    ${bodySection}
  </div>`;
  enterView();
}

export async function loadFrDocument(documentNumber: string): Promise<void> {
  const seq = state.routeSeq;
  state.currentSection = null;
  state.currentPart = null;
  clearTreeSelection();
  updateChatContext();
  setViewHead('');
  document.title = `Federal Register ${documentNumber} · FRAMEWORK`;
  dom.view.innerHTML = skeletonHtml('doc', `Loading ${documentNumber}…`);
  dom.main.scrollTop = 0;
  try {
    const data = await getJSON<FrBodyResponse>(
      `/api/news/fr/${encodeURIComponent(documentNumber)}`,
      { signal: state.routeAbort?.signal },
    );
    if (seq !== state.routeSeq) return;
    renderFrDocument(data);
  } catch (err) {
    if ((err as Error)?.name === 'AbortError' || seq !== state.routeSeq) return;
    const msg = err instanceof Error ? err.message : 'Could not load Federal Register document.';
    dom.view.innerHTML = emptyStateHtml({
      title: 'Document unavailable',
      body: msg,
      actionsHtml: '<a class="btn btn-sm" href="#/news">Back to News</a>',
    });
  }
}
