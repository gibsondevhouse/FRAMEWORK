import { NewsActivityCtx, NewsArticle, state } from '../state';
import { getJSON } from '../api/client';
import { extLink, fmtMoney, frDocumentNumber, inspectionActivityNr } from '../core/news_format';
import { onView } from '../core/view_dispatch';
import { createPopover } from './popover';
import { fmtDate } from './ui';
import { escapeHtml, icon } from '../dom';
import { titleHref } from '../usage';

// --- In-reader activity: "N rules & citations" next to Pin, with a timeline popover ---

export const newsPop = document.getElementById('news-pop') as HTMLElement;
export const newsActivityCache = new Map<string, NewsActivityCtx['data']>();
state.newsActivityCtx = null;

export function newsActivityButtonHtml(): string {
  return `<button type="button" class="btn" id="btn-news-activity" aria-haspopup="dialog" aria-expanded="false" hidden>${icon('news')} <span>Activity</span></button>`;
}

export async function fetchNewsActivity(titleNum: number, kind: 'section' | 'part', id: string): Promise<NewsActivityCtx['data'] | null> {
  if (!titleNum || titleNum < 1 || titleNum > 50) return null;
  const key = `${titleNum}|${kind === 'part' ? 'part:' : ''}${id}`;
  let data = newsActivityCache.get(key);
  if (!data) {
    try {
      data = await getJSON<NewsActivityCtx['data']>(kind === 'part'
        ? `/api/news/part/${encodeURIComponent(id)}?title=${titleNum}`
        : `/api/news/section/${encodeURIComponent(id)}?title=${titleNum}`);
    } catch { return null; }
    newsActivityCache.set(key, data);
  }
  return data;
}

export async function fillNewsActivity(kind: 'section' | 'part', id: string, seq: number): Promise<void> {
  state.newsActivityCtx = null;
  const titleNum = state.currentTitle;
  if (!titleNum) return;
  const data = await fetchNewsActivity(titleNum, kind, id);
  if (!data || seq !== state.routeSeq) return;
  const btn = document.getElementById('btn-news-activity');
  if (!btn || !data.count) return;
  state.newsActivityCtx = { title: titleNum, kind, id, data };
  const label = btn.querySelector('span');
  if (label) {
    label.textContent = data.count === 1 ? '1 rule or citation' : `${data.count} rules & citations`;
  }
  btn.hidden = false;
}

export function newsTimelineHtml(ctx: NewsActivityCtx): string {
  const titleNum = ctx.title || state.currentTitle || 29;
  const label = ctx.kind === 'part' ? `Part ${ctx.id}` : `§ ${ctx.id}`;
  const articles = (ctx.data.articles || []) as NewsArticle[];
  const nodes = articles.map(a => {
    let meta = fmtDate(a.published_at);
    let second = '';
    if (a.category === 'rules') {
      meta += ` · Final rule${a.citation ? ' · ' + a.citation : ''}`;
    } else if (a.category === 'rulemaking') {
      meta += ' · Proposed rule' + (a.comments_close_on ? ` · comments close ${fmtDate(a.comments_close_on)}` : '');
    } else if (a.category === 'public_inspection') {
      meta += ' · Public inspection' + (a.scheduled_on ? ` · publishes ${fmtDate(a.scheduled_on)}` : '');
    } else if (a.category === 'enforcement') {
      meta += ' · Citation' + (a.penalty_usd ? ` · ${fmtMoney(a.penalty_usd)}` : '');
      second = [a.company, [a.city, a.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
    } else {
      meta += ' · Notice';
    }
    const title = a.category === 'enforcement' && second ? second : (a.title || '');
    const hay = `${meta} ${title} ${a.citation || ''}`.toLowerCase();
    const actNr = inspectionActivityNr(a);
    const frDoc = !actNr ? frDocumentNumber(a) : null;
    const titleHtml = actNr
      ? `<a href="#/news/inspection/${actNr}" data-pop-nav><span class="tl-title">${escapeHtml(title)}</span></a>`
      : frDoc
        ? `<a href="#/news/fr/${encodeURIComponent(frDoc)}" data-pop-nav><span class="tl-title">${escapeHtml(title)}</span></a>`
        : extLink(a.link, `<span class="tl-title">${escapeHtml(title)}</span>`);
    return `<li class="tl-node" data-kind="${escapeHtml(a.category)}" data-hay="${escapeHtml(hay)}">
      <span class="tl-dot" aria-hidden="true"></span>
      <div class="tl-meta">${escapeHtml(meta)}</div>
      ${titleHtml}
    </li>`;
  }).join('');
  const titleQuery = titleNum !== 29 ? `&cfr_title=${titleNum}` : '';
  const allHref = ctx.kind === 'part'
    ? `#/news?part=${encodeURIComponent(ctx.id)}${titleQuery}`
    : `#/news?section=${encodeURIComponent(ctx.id)}${titleQuery}`;
  const filterHtml = articles.length >= 6
    ? `<input type="search" class="pop-filter" id="news-pop-filter" placeholder="Filter ${articles.length} events…" aria-label="Filter activity events" autocomplete="off">`
    : '';
  const stats = ctx.data.stats;
  let statsHtml = '';
  if (stats && stats.citation_count > 0) {
    const bits = [
      `${stats.citation_count} ${stats.citation_count === 1 ? 'citation' : 'citations'}`,
      stats.avg_penalty ? `Avg ${fmtMoney(stats.avg_penalty)}` : '',
      stats.fta_count ? `${stats.fta_count} FTA` : '',
    ].filter(Boolean);
    const paras = (stats.top_paragraphs || []).slice(0, 3);
    const paraHtml = paras.length
      ? `<div class="news-pop-paras">Top cited: ${paras.map(p => {
          const cnt = p.share_pct != null ? `${p.share_pct}%` : `${p.count}`;
          const text = `${p.para} (${cnt})`;
          if (ctx.kind === 'section') {
            const href = titleHref(titleNum, 'section/' + encodeURIComponent(ctx.id) + '?p=' + encodeURIComponent(p.para));
            return `<a class="citation-chip" href="${href}" data-pop-nav>${escapeHtml(text)}</a>`;
          }
          return `<span class="citation-chip">${escapeHtml(text)}</span>`;
        }).join('')}</div>`
      : '';
    statsHtml = `<div class="news-pop-stats"><div class="news-pop-stats-line">${escapeHtml(bits.join(' · '))}</div>${paraHtml}</div>`;
  }
  const headText = titleNum === 29 ? `Federal Register & OSHA activity · ${label}` : `Federal Register activity · ${titleNum} CFR ${label}`;
  return `<div class="news-pop-head-row">
      <div class="news-pop-head">${escapeHtml(headText)}</div>
      <button type="button" class="icon-btn pop-close" data-pop-close aria-label="Close activity">${icon('close')}</button>
    </div>
    ${statsHtml}
    ${filterHtml}
    <ol class="reg-timeline">${nodes}</ol>
    <a class="news-pop-foot" href="${allHref}">${icon('news')} See all in News</a>`;
}

const newsCtrl = createPopover({
  el: newsPop,
  triggerSelector: '#btn-news-activity, #split-btn-news',
});

let activeNewsAnchor: Element | null = null;

export function openNewsActivityFor(btn: Element | null, ctx: NewsActivityCtx | null): void {
  if (!btn || !ctx) return;
  if (!newsPop.hidden && activeNewsAnchor === btn) {
    closeNewsActivity(true);
    return;
  }
  activeNewsAnchor = btn;
  newsPop.setAttribute('aria-label',
    `Federal Register and OSHA activity for ${ctx.kind === 'part' ? 'Part ' : '§ '}${ctx.id}`);
  newsCtrl.open(btn, newsTimelineHtml(ctx), {
    focusSelector: '#news-pop-filter, a, button',
    returnFocus: btn,
  });
}

export function openNewsActivity(): void {
  openNewsActivityFor(document.getElementById('btn-news-activity'), state.newsActivityCtx);
}

export function closeNewsActivity(returnFocus = true): void {
  newsCtrl.close(returnFocus);
}

newsPop.addEventListener('click', (e) => {
  const t = e.target as Element | null;
  if (t?.closest('[data-pop-close]')) closeNewsActivity(true);
  else if (t?.closest('[data-pop-nav]')) closeNewsActivity(false);
});

newsPop.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement | null;
  if (!t || t.id !== 'news-pop-filter') return;
  const q = t.value.trim().toLowerCase();
  for (const li of newsPop.querySelectorAll<HTMLElement>('.tl-node')) {
    const hay = li.dataset.hay || '';
    li.hidden = Boolean(q && !hay.includes(q));
  }
  newsCtrl.reposition(activeNewsAnchor?.isConnected ? activeNewsAnchor : document.getElementById('btn-news-activity'));
});

onView('click', (e) => {
  if ((e.target as Element | null)?.closest('#btn-news-activity')) openNewsActivity();
});

newsPop.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeNewsActivity(true); }
});
