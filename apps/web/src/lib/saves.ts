import { api } from './api';
import { formatAge, META_SEP } from './format';

export type SaveState = 'unread' | 'archived';

export interface SavedItem {
  id: string;
  url: string;
  title: string;
  siteName: string | null;
  excerpt: string | null;
  imageUrl: string | null;
  wordCount: number;
  readMinutes: number;
  tags: string[];
  archived: boolean;
  favorite: boolean;
  createdAt: string;
  /** Sanitized HTML from the server; only on the single-save call. null when the page could not be read. */
  content?: string | null;
}

export interface SavesPage {
  items: SavedItem[];
  nextCursor: string | null;
}

export function fetchSaves(
  state: SaveState,
  tag: string | null,
  cursor?: string | null,
): Promise<SavesPage> {
  const q = new URLSearchParams({ state });
  if (tag) q.set('tag', tag);
  if (cursor) q.set('cursor', cursor);
  return api<SavesPage>(`/api/saves?${q}`);
}

export async function fetchSaveTags(state: SaveState): Promise<{ tag: string; count: number }[]> {
  return (await api<{ tags: { tag: string; count: number }[] }>(`/api/saves/tags?state=${state}`))
    .tags;
}

/** `POST /api/saves`: 201 is a new save, 200 means it was already saved. */
export async function saveLink(url: string): Promise<{ item: SavedItem; created: boolean }> {
  return api<{ item: SavedItem; created: boolean }>('/api/saves', {
    method: 'POST',
    json: { url },
  });
}

export async function fetchSave(id: string): Promise<SavedItem> {
  return (await api<{ item: SavedItem }>(`/api/saves/${id}`)).item;
}

export async function patchSave(
  id: string,
  body: { archived?: boolean; favorite?: boolean; tags?: string[] },
): Promise<SavedItem> {
  return (await api<{ item: SavedItem }>(`/api/saves/${id}`, { method: 'PATCH', json: body })).item;
}

export async function deleteSave(id: string): Promise<void> {
  await api(`/api/saves/${id}`, { method: 'DELETE' });
}

/** "Metro Daily · 4 min read · 2d": whatever is known, in that order. */
export function saveMeta(item: SavedItem, now: number = Date.now()): string {
  return [
    item.siteName,
    item.readMinutes > 0 ? `${item.readMinutes} min read` : null,
    formatAge(item.createdAt, now),
  ]
    .filter((p): p is string => !!p)
    .join(META_SEP);
}

/** Turns what was typed or shared into a web address; adds https:// when there is no scheme. */
export function toSaveUrl(input: string): string | null {
  const text = input.trim();
  if (!text || /\s/.test(text)) return null;
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.includes('.') ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The link in a share sheet or bookmarklet request: `url` first, else the first web address in
 * `text` (Android apps often put the link there, after a sentence), else in `title`.
 */
export function sharedUrl(params: URLSearchParams): string | null {
  for (const key of ['url', 'text', 'title']) {
    const value = params.get(key);
    if (!value) continue;
    const direct = key === 'url' ? toSaveUrl(value) : null;
    if (direct) return direct;
    const found = /https?:\/\/[^\s<>"']+/i.exec(value)?.[0];
    const url = found ? toSaveUrl(found.replace(/[.,;:!?)\]]+$/, '')) : null;
    if (url) return url;
  }
  return null;
}

/** The bookmarklet: opens Signal Radar's save page with the current page's address. */
export function bookmarklet(origin: string): string {
  const base = JSON.stringify(`${origin}/save?url=`);
  return `javascript:(function(){window.open(${base}+encodeURIComponent(location.href),'_blank');})();`;
}

const PENDING_KEY = 'signal-radar:pending-save';

/** A link shared while signed out, kept so it is saved after sign-in (even through sign-up). */
export function rememberPendingSave(storage: Pick<Storage, 'setItem'>, url: string): void {
  try {
    storage.setItem(PENDING_KEY, url);
  } catch {
    /* private mode: the sign-in redirect still brings the reader back to the link */
  }
}

export function peekPendingSave(storage: Pick<Storage, 'getItem'>): string | null {
  try {
    return storage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

export function clearPendingSave(storage: Pick<Storage, 'removeItem'>): void {
  try {
    storage.removeItem(PENDING_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Tags from a typed line: split on commas, trimmed, no empties, no repeats (the server lower-cases). */
export function parseTagInput(input: string, existing: string[] = []): string[] {
  const have = new Set(existing.map((t) => t.toLowerCase()));
  const out: string[] = [];
  for (const raw of input.split(',')) {
    const t = raw.replace(/\s+/g, ' ').trim().toLowerCase();
    if (t && !have.has(t)) {
      have.add(t);
      out.push(t);
    }
  }
  return out;
}
