import { state } from '../state';
import { createPopover } from './popover';
import { escapeHtml, icon } from '../dom';
import { dom } from '../state_init';
import { fmtDate, getJSON } from '../views/library';
import { extLink, fmtMoney } from '../views/news';

// --- In-reader activity: "N rules & citations" next to Pin, with a timeline popover ---

export const newsPop = document.getElementById('news-pop');

export const newsActivityCache = new Map();
   // "29|1910.1030" or "29|part:1910" -> response
state.newsActivityCtx = null;
            // { kind, id, data } for the open page

export function newsActivityButtonHtml() {
  return `<button type="button" class="btn" id="btn-news-activity" aria-haspopup="dialog" aria-expanded="false" hidden>${icon('news')} <span>Activity</span></button>`;
}


export async function fillNewsActivity(kind, id, seq) {
  state.newsActivityCtx = null;
  if (state.currentTitle !== 29) return;      // only Title 29 has news while OSHA is the only agency
  const key = `29|${kind === 'part' ? 'part:' : ''}${id}`;
  let data = newsActivityCache.get(key);
  if (!data) {
    try {
      data = await getJSON(kind === 'part'
        ? `/api/news/part/${encodeURIComponent(id)}?title=29`
        : `/api/news/section/${encodeURIComponent(id)}?title=29`);
    } catch (e) { return; }             // silent: the reader works without news
    newsActivityCache.set(key, data);
  }
  if (seq !== state.routeSeq) return;         // the reader moved on
  const btn = document.getElementById('btn-news-activity');
  if (!btn || !data.count) return;
  state.newsActivityCtx = { kind, id, data };
  btn.querySelector('span').textContent =
    data.count === 1 ? '1 rule or citation' : `${data.count} rules & citations`;
  btn.hidden = false;
}


export function newsTimelineHtml(ctx) {
  const label = ctx.kind === 'part' ? `Part ${ctx.id}` : `§ ${ctx.id}`;
  const articles = ctx.data.articles || [];
  // Node kinds: rules, rulemaking, notices, public_inspection, enforcement. There are
  // no interpretation nodes: OSHA letters of interpretation live only on osha.gov,
  // which FRAMEWORK does not scrape (decision 4).
  const nodes = articles.map(a => {
    let meta = fmtDate(a.published_at), second = '';
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
    const title = a.category === 'enforcement' && second ? second : a.title;
    const hay = `${meta} ${title} ${a.citation || ''}`.toLowerCase();
    return `<li class="tl-node" data-kind="${escapeHtml(a.category)}" data-hay="${escapeHtml(hay)}">
      <span class="tl-dot" aria-hidden="true"></span>
      <div class="tl-meta">${escapeHtml(meta)}</div>
      ${extLink(a.link, `<span class="tl-title">${escapeHtml(title)}</span>`)}
    </li>`;
  }).join('');
  const allHref = ctx.kind === 'part'
    ? `#/news?part=${encodeURIComponent(ctx.id)}` : `#/news?section=${encodeURIComponent(ctx.id)}`;
  const filterHtml = articles.length >= 6
    ? `<input type="search" class="pop-filter" id="news-pop-filter" placeholder="Filter ${articles.length} events…" aria-label="Filter activity events" autocomplete="off">`
    : '';
  return `<div class="news-pop-head-row">
      <div class="news-pop-head">Federal Register &amp; OSHA activity · ${escapeHtml(label)}</div>
      <button type="button" class="icon-btn pop-close" data-pop-close aria-label="Close activity">${icon('close')}</button>
    </div>
    ${filterHtml}
    <ol class="reg-timeline">${nodes}</ol>
    <a class="news-pop-foot" href="${allHref}">${icon('news')} See all in News</a>`;
}


const newsCtrl = createPopover({
  el: newsPop,
  triggerSelector: '#btn-news-activity',
});

export function openNewsActivity() {
  const btn = document.getElementById('btn-news-activity');
  if (!btn || !state.newsActivityCtx) return;
  newsPop.setAttribute('aria-label',
    `Federal Register and OSHA activity for ${state.newsActivityCtx.kind === 'part' ? 'Part ' : '§ '}${state.newsActivityCtx.id}`);
  newsCtrl.open(btn, newsTimelineHtml(state.newsActivityCtx), {
    focusSelector: '#news-pop-filter, a, button',
    returnFocus: btn,
  });
}

export function closeNewsActivity(returnFocus = true) {
  newsCtrl.close(returnFocus);
}

newsPop.addEventListener('click', (e) => {
  if (e.target.closest('[data-pop-close]')) closeNewsActivity(true);
});

newsPop.addEventListener('input', (e) => {
  if (e.target.id !== 'news-pop-filter') return;
  const q = e.target.value.trim().toLowerCase();
  for (const li of newsPop.querySelectorAll('.tl-node')) {
    const hay = li.dataset.hay || '';
    li.hidden = Boolean(q && !hay.includes(q));
  }
  newsCtrl.reposition(document.getElementById('btn-news-activity'));
});

dom.view.addEventListener('click', (e) => {
  if (e.target.closest('#btn-news-activity')) newsPop.hidden ? openNewsActivity() : closeNewsActivity();
});

newsPop.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeNewsActivity(true); }
});
