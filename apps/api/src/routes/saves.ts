import { Hono } from 'hono';
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  assertPublicUrlSyntax,
  canonicalUrl,
  cleanUrl,
  extractReadable,
  fetchPublicText,
  readMinutes,
  titleFromUrl,
  UnsafeUrlError,
  type ReadablePage,
} from '@radar/core';
import { schema, type SavedItemRow } from '@radar/db';
import type { AppVars, RouteDeps } from '../app.js';
import { badRequest, parseBody, parseQuery } from '../http.js';
import { requireAuth } from '../middleware.js';

const PAGE_SIZE = 30;
export const SAVE_FETCH_TIMEOUT_MS = 10_000;
export const SAVE_FETCH_MAX_BYTES = 3_000_000;
const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 32;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SaveBody = z.object({ url: z.string().trim().min(1).max(2000) });
const ListQuery = z.object({
  state: z.enum(['unread', 'archived']).default('unread'),
  tag: z.string().trim().min(1).max(MAX_TAG_LENGTH).optional(),
  cursor: z.string().optional(),
});
const TagsQuery = z.object({ state: z.enum(['unread', 'archived']).default('unread') });
const PatchBody = z
  .object({
    archived: z.boolean().optional(),
    favorite: z.boolean().optional(),
    tags: z.array(z.string().trim().max(60)).max(30).optional(),
  })
  .refine((b) => b.archived !== undefined || b.favorite !== undefined || b.tags !== undefined, {
    message: 'nothing to change',
  });

/** Lower-case, trimmed, de-duplicated tags, capped in number and length. */
export function normalizeTags(tags: string[]): string[] {
  const out = new Set<string>();
  for (const t of tags) {
    const tag = t.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH).trim();
    if (tag) out.add(tag);
  }
  return [...out].slice(0, MAX_TAGS);
}

/** The save as the web app sees it. The list leaves the (large) content out. */
function present(row: SavedItemRow, withContent: boolean) {
  const { content, archivedAt, ...rest } = row;
  delete (rest as { urlNormalized?: string }).urlNormalized;
  return {
    ...rest,
    archived: archivedAt !== null,
    archivedAt,
    readMinutes: readMinutes(row.wordCount),
    ...(withContent ? { content } : {}),
  };
}

/** Cursor = base64url("<created_at iso micros>|<id>"); keyset pagination, newest first. */
function decodeCursor(raw: string): { ts: string; id: string } {
  const [ts, id] = Buffer.from(raw, 'base64url').toString().split('|');
  if (!ts || !id || !UUID.test(id) || Number.isNaN(Date.parse(ts))) {
    return badRequest('invalid cursor');
  }
  return { ts, id };
}

export function savesRoutes(deps: RouteDeps) {
  const { db } = deps;
  const s = schema.savedItem;
  const r = new Hono<AppVars>();
  r.use('*', requireAuth(deps));

  const mine = (userId: string, id: string) => and(eq(s.id, id), eq(s.userId, userId));

  r.get('/', async (c) => {
    const userId = c.get('user').id;
    const { state, tag, cursor } = parseQuery(c, ListQuery);
    const after = cursor ? decodeCursor(cursor) : undefined;
    const rows = await db
      .select({
        item: s,
        ts: sql<string>`to_char(${s.createdAt} at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(s)
      .where(
        and(
          eq(s.userId, userId),
          state === 'archived' ? isNotNull(s.archivedAt) : isNull(s.archivedAt),
          tag ? sql`${tag} = any(${s.tags})` : undefined,
          after
            ? sql`(${s.createdAt}, ${s.id}) < (${after.ts}::timestamptz, ${after.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(s.createdAt), desc(s.id))
      .limit(PAGE_SIZE + 1);
    const page = rows.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    const nextCursor =
      rows.length > PAGE_SIZE && last
        ? Buffer.from(`${last.ts}|${last.item.id}`).toString('base64url')
        : null;
    return c.json({ items: page.map((p) => present(p.item, false)), nextCursor });
  });

  // Tags in use, for the filter row.
  r.get('/tags', async (c) => {
    const userId = c.get('user').id;
    const { state } = parseQuery(c, TagsQuery);
    const rows = await db.execute<{ tag: string; n: number }>(sql`
      select t.tag as tag, count(*)::int as n
      from ${s}, unnest(${s.tags}) as t(tag)
      where ${s.userId} = ${userId}
        and ${state === 'archived' ? sql`${s.archivedAt} is not null` : sql`${s.archivedAt} is null`}
      group by t.tag
      order by n desc, t.tag asc
      limit 100`);
    return c.json({ tags: [...rows].map((t) => ({ tag: t.tag, count: t.n })) });
  });

  r.post('/', async (c) => {
    const userId = c.get('user').id;
    const body = await parseBody(c, SaveBody);
    let url: string;
    let normalized: string;
    try {
      url = cleanUrl(assertPublicUrlSyntax(body.url).href);
      normalized = canonicalUrl(url);
    } catch (e) {
      return badRequest(e instanceof Error ? e.message : 'invalid url');
    }

    const existing = async () => {
      const [row] = await db
        .select()
        .from(s)
        .where(and(eq(s.userId, userId), eq(s.urlNormalized, normalized)));
      return row;
    };
    const dupe = await existing();
    if (dupe) return c.json({ item: present(dupe, false), created: false }, 200);

    // A page that cannot be read is still saved, titled by its address.
    let page: ReadablePage | null = null;
    try {
      const { text, url: finalUrl } = await fetchPublicText(url, {
        headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
        timeoutMs: SAVE_FETCH_TIMEOUT_MS,
        maxBytes: SAVE_FETCH_MAX_BYTES,
        ...(deps.net?.fetch ? { fetch: deps.net.fetch } : {}),
        ...(deps.net?.resolve ? { resolve: deps.net.resolve } : {}),
      });
      page = extractReadable(text, finalUrl);
    } catch (e) {
      if (e instanceof UnsafeUrlError) return badRequest(e.message);
      console.warn(`save: could not read ${url}: ${(e as Error).message}`);
    }

    const [row] = await db
      .insert(s)
      .values({
        userId,
        url,
        urlNormalized: normalized,
        title: page?.title || titleFromUrl(url),
        siteName: page?.siteName ?? null,
        excerpt: page?.excerpt ?? null,
        imageUrl: page?.imageUrl ?? null,
        content: page?.contentHtml ?? null,
        wordCount: page?.wordCount ?? 0,
      })
      .onConflictDoNothing({ target: [s.userId, s.urlNormalized] })
      .returning();
    if (row) return c.json({ item: present(row, false), created: true }, 201);
    // Lost a race with a concurrent save of the same page.
    const raced = await existing();
    if (!raced) return c.json({ error: 'could not save that link' }, 500);
    return c.json({ item: present(raced, false), created: false }, 200);
  });

  r.get('/:id', async (c) => {
    const id = c.req.param('id') ?? '';
    if (!UUID.test(id)) return c.json({ error: 'not found' }, 404);
    const [row] = await db
      .select()
      .from(s)
      .where(mine(c.get('user').id, id));
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json({ item: present(row, true) });
  });

  r.patch('/:id', async (c) => {
    const userId = c.get('user').id;
    const id = c.req.param('id') ?? '';
    if (!UUID.test(id)) return c.json({ error: 'not found' }, 404);
    const body = await parseBody(c, PatchBody);
    const [row] = await db
      .update(s)
      .set({
        ...(body.archived !== undefined ? { archivedAt: body.archived ? new Date() : null } : {}),
        ...(body.favorite !== undefined ? { favorite: body.favorite } : {}),
        ...(body.tags !== undefined ? { tags: normalizeTags(body.tags) } : {}),
      })
      .where(mine(userId, id))
      .returning();
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json({ item: present(row, false) });
  });

  r.delete('/:id', async (c) => {
    const id = c.req.param('id') ?? '';
    if (!UUID.test(id)) return c.json({ error: 'not found' }, 404);
    const [row] = await db
      .delete(s)
      .where(mine(c.get('user').id, id))
      .returning({ id: s.id });
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json({ ok: true });
  });

  return r;
}
