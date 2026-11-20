/**
 * What Claude should know is open when the reader is on a non-CFR page (TL-09).
 *
 * `openItemFromHash` reads the current hash route and returns the unit on screen as the
 * store keys it: `{corpus, key, collection?}`. The server (`chat.open_ref`) turns that into
 * a canonical id and ignores anything that is not one, so this module never needs the full
 * ID grammar. A CFR section is not handled here: it still travels as `section_id`.
 *
 * Pure (no DOM, no state) so it is unit-tested in `tests/unit.test.ts`.
 */
import { uscCite } from './usc_label';

export type OpenCorpus = 'usc' | 'constitution' | 'plaw' | 'fr' | 'agenda';

export interface OpenItem {
  corpus: OpenCorpus;
  key: string;
  collection?: string;
  /** A short label for the chat panel's context chip. */
  label: string;
}

const MAX_KEY = 240;

function dec(s: string): string | null {
  try { return decodeURIComponent(s); } catch { return null; }
}

function clean(s: string | null): string | null {
  if (!s) return null;
  const t = s.trim();
  return t && t.length <= MAX_KEY ? t : null;
}

export function openItemFromHash(hash: string): OpenItem | null {
  const raw = (hash || '').replace(/^#/, '');
  const qi = raw.indexOf('?');
  const path = qi >= 0 ? raw.slice(0, qi) : raw;
  const params = new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : '');

  let m = /^\/usc\/(\d{1,3})\/section\/([^/?]+)/.exec(path);
  if (m) {
    const key = clean(dec(m[2]));
    const title = parseInt(m[1], 10);
    if (!key) return null;
    return { corpus: 'usc', key, collection: String(title), label: `${uscCite(title)} § ${key}` };
  }
  m = /^\/constitution\/([^/]+)\/?$/.exec(path);
  if (m) {
    const key = clean(dec(m[1]));
    if (!key) return null;
    return { corpus: 'constitution', key, label: `U.S. Constitution · ${key}` };
  }
  m = /^\/law\/([^/]+)/.exec(path);
  if (m) {
    const key = clean(dec(m[1]));
    if (!key) return null;
    const pvt = /^(\d+)-pvt-(\d+)$/.exec(key);
    return { corpus: 'plaw', key, label: pvt ? `Private Law ${pvt[1]}-${pvt[2]}` : `Pub. L. ${key}` };
  }
  m = /^\/news\/fr\/([^/]+)\/?$/.exec(path);
  if (m) {
    const key = clean(dec(m[1]));
    if (!key) return null;
    return { corpus: 'fr', key, label: `FR Doc. ${key}` };
  }
  m = /^\/news\/agenda\/([0-9A-Za-z-]{4,20})\/?$/.exec(path);
  if (m) {
    const edition = params.get('edition');
    const item: OpenItem = { corpus: 'agenda', key: m[1].toUpperCase(), label: `RIN ${m[1].toUpperCase()}` };
    if (edition && /^\d{6}$/.test(edition)) item.collection = edition;
    return item;
  }
  return null;
}
