import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@radar/db';
import { call, dbAvailable, setup, signUp, type Json } from './helpers.js';

const PARA =
  'The city council voted on Tuesday to approve a new bike lane network covering forty kilometres, funded by a transport levy that will run for six years. ';
const ARTICLE = `<html><head><title>Bike lanes approved</title>
<meta property="og:site_name" content="Metro Daily">
<meta property="og:image" content="/img/lead.jpg">
<meta property="og:description" content="Forty kilometres of new lanes.">
</head><body><nav>Home About</nav>
<article><h1>Bike lanes approved</h1>
<script>alert(1)</script>
${`<p>${PARA}<a href="javascript:alert(2)" onclick="alert(3)">bad</a> <a href="/more">more</a></p>`.repeat(6)}
<img src="/pic.png" alt="a lane" onerror="alert(4)">
<iframe src="https://evil.example"></iframe>
</article></body></html>`;

let fetches: string[] = [];
const netFetch = async (url: string): Promise<Response> => {
  fetches.push(url);
  const host = new URL(url).hostname;
  if (host === 'article.example') return new Response(ARTICLE);
  if (host === 'gone.example') return new Response('', { status: 404 });
  if (host === 'junk.example') return new Response('not html at all');
  throw new Error(`unexpected fetch ${url}`);
};
const netResolve = async (host: string) =>
  host === 'private.example' ? ['10.0.0.1'] : ['93.184.216.34'];

describe.skipIf(!dbAvailable)('saves (/api/saves)', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    ctx = await setup({}, { fetch: netFetch, resolve: netResolve });
  });
  afterAll(async () => {
    await ctx?.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    fetches = [];
  });

  const save = (u: Awaited<ReturnType<typeof signUp>> | undefined, url: string) =>
    call(ctx.app, '/api/saves', { method: 'POST', ...(u ? { user: u } : {}), json: { url } });

  it('requires a signed-in user on every route', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expect((await save(undefined, 'https://article.example/a')).status).toBe(401);
    expect((await call(ctx.app, '/api/saves')).status).toBe(401);
    expect((await call(ctx.app, '/api/saves/tags')).status).toBe(401);
    expect((await call(ctx.app, `/api/saves/${id}`)).status).toBe(401);
    expect(
      (await call(ctx.app, `/api/saves/${id}`, { method: 'PATCH', json: { favorite: true } }))
        .status,
    ).toBe(401);
    expect((await call(ctx.app, `/api/saves/${id}`, { method: 'DELETE' })).status).toBe(401);
  });

  it('saves a page: extracts the article, sanitizes it and keeps the list light', async () => {
    const u = await signUp(ctx.app, 'a@example.com');
    const res = await save(u, 'https://article.example/post?utm_source=x');
    expect(res.status).toBe(201);
    const { item, created } = (await res.json()) as Json;
    expect(created).toBe(true);
    expect(item).toMatchObject({
      url: 'https://article.example/post',
      title: 'Bike lanes approved',
      siteName: 'Metro Daily',
      imageUrl: 'https://article.example/img/lead.jpg',
      archived: false,
      favorite: false,
      tags: [],
    });
    expect(item.wordCount).toBeGreaterThan(100);
    expect(item.readMinutes).toBeGreaterThanOrEqual(1);
    expect(item.content).toBeUndefined();

    const full = (
      (await (await call(ctx.app, `/api/saves/${item.id}`, { user: u })).json()) as Json
    ).item;
    expect(full.content).toContain('forty kilometres');
    expect(full.content).not.toMatch(/<script|<iframe|onclick|onerror|javascript:|alert\(/i);
    expect(full.content).toContain('href="https://article.example/more"');
    expect(full.content).toContain('rel="noopener noreferrer nofollow"');
    expect(full.content).toContain('src="https://article.example/pic.png"');
  });

  it('dedupes per user on the normalized URL and keeps users apart', async () => {
    const a = await signUp(ctx.app, 'a@example.com');
    const b = await signUp(ctx.app, 'b@example.com');
    const first = (await (await save(a, 'https://article.example/post')).json()) as Json;
    const res = await save(a, 'http://www.article.example/post/?utm_campaign=y#top');
    expect(res.status).toBe(200);
    const again = (await res.json()) as Json;
    expect(again.created).toBe(false);
    expect(again.item.id).toBe(first.item.id);
    expect(fetches).toHaveLength(1);

    expect((await save(b, 'https://article.example/post')).status).toBe(201);
    const mineA = (await (await call(ctx.app, '/api/saves', { user: a })).json()) as Json;
    expect(mineA.items).toHaveLength(1);
    // another user's save is invisible and untouchable
    expect((await call(ctx.app, `/api/saves/${first.item.id}`, { user: b })).status).toBe(404);
    expect(
      (await call(ctx.app, `/api/saves/${first.item.id}`, { method: 'DELETE', user: b })).status,
    ).toBe(404);
  });

  it('still saves a page that cannot be read, titled by its address', async () => {
    const u = await signUp(ctx.app, 'a@example.com');
    const gone = (await (await save(u, 'https://gone.example/a/b/')).json()) as Json;
    expect(gone.item).toMatchObject({ title: 'gone.example/a/b', wordCount: 0, readMinutes: 0 });
    const junk = (await (await save(u, 'https://junk.example/x')).json()) as Json;
    expect(junk.item.title).toBe('junk.example/x');
    const full = (await (
      await call(ctx.app, `/api/saves/${junk.item.id}`, { user: u })
    ).json()) as Json;
    expect(full.item.content).toBeNull();
  });

  it('refuses unsafe URLs and never fetches them (SSRF guard)', async () => {
    const u = await signUp(ctx.app, 'a@example.com');
    for (const url of [
      'http://localhost/admin',
      'http://127.0.0.1/',
      'http://10.0.0.5/x',
      'http://[::1]/',
      'http://169.254.169.254/latest/meta-data/',
      'http://intranet/',
      'ftp://article.example/file',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'https://user:pw@article.example/',
      'https://private.example/secret', // resolves to 10.0.0.1
      'not a url',
    ]) {
      const res = await save(u, url);
      expect(res.status, url).toBe(400);
    }
    expect(fetches).toEqual([]);
    const list = (await (await call(ctx.app, '/api/saves', { user: u })).json()) as Json;
    expect(list.items).toEqual([]);
  });

  it('lists unread and archived, filters by tag, and paginates', async () => {
    const u = await signUp(ctx.app, 'a@example.com');
    const ids: string[] = [];
    for (let i = 0; i < 32; i++) {
      const res = (await (await save(u, `https://gone.example/p${i}`)).json()) as Json;
      ids.push(res.item.id);
    }
    const p1 = (await (await call(ctx.app, '/api/saves', { user: u })).json()) as Json;
    expect(p1.items).toHaveLength(30);
    expect(p1.items[0].id).toBe(ids[31]); // newest first
    expect(p1.nextCursor).toBeTruthy();
    const p2 = (await (
      await call(ctx.app, `/api/saves?cursor=${p1.nextCursor}`, { user: u })
    ).json()) as Json;
    expect(p2.items.map((i: Json) => i.id)).toEqual([ids[1], ids[0]]);
    expect(p2.nextCursor).toBeNull();
    expect((await call(ctx.app, '/api/saves?cursor=bogus', { user: u })).status).toBe(400);

    await call(ctx.app, `/api/saves/${ids[0]}`, {
      method: 'PATCH',
      user: u,
      json: { archived: true, tags: ['Python', ' python ', 'AI tools'] },
    });
    const archived = (await (
      await call(ctx.app, '/api/saves?state=archived', { user: u })
    ).json()) as Json;
    expect(archived.items.map((i: Json) => i.id)).toEqual([ids[0]]);
    expect(archived.items[0]).toMatchObject({ archived: true, tags: ['python', 'ai tools'] });

    const tagged = (await (
      await call(ctx.app, '/api/saves?state=archived&tag=python', { user: u })
    ).json()) as Json;
    expect(tagged.items).toHaveLength(1);
    const none = (await (await call(ctx.app, '/api/saves?tag=python', { user: u })).json()) as Json;
    expect(none.items).toHaveLength(0);

    const tags = (await (
      await call(ctx.app, '/api/saves/tags?state=archived', { user: u })
    ).json()) as Json;
    expect(tags.tags).toEqual([
      { tag: 'ai tools', count: 1 },
      { tag: 'python', count: 1 },
    ]);
  });

  it('patches archive, favorite and tags, and rejects empty or bad input', async () => {
    const u = await signUp(ctx.app, 'a@example.com');
    const { item } = (await (await save(u, 'https://gone.example/x')).json()) as Json;
    const patch = (json: unknown, id = item.id) =>
      call(ctx.app, `/api/saves/${id}`, { method: 'PATCH', user: u, json });

    const fav = (await (await patch({ favorite: true })).json()) as Json;
    expect(fav.item).toMatchObject({ favorite: true, archived: false });
    const arch = (await (await patch({ archived: true })).json()) as Json;
    expect(arch.item.archived).toBe(true);
    expect(arch.item.archivedAt).toBeTruthy();
    const back = (await (await patch({ archived: false })).json()) as Json;
    expect(back.item).toMatchObject({ archived: false, archivedAt: null, favorite: true });
    const many = Array.from({ length: 15 }, (_, i) => `t${i}`);
    expect(((await (await patch({ tags: many })).json()) as Json).item.tags).toHaveLength(10);

    expect((await patch({})).status).toBe(400);
    expect((await patch({ archived: 'yes' })).status).toBe(400);
    expect((await patch({ favorite: true }, 'not-a-uuid')).status).toBe(404);
    expect((await patch({ favorite: true }, '00000000-0000-4000-8000-000000000000')).status).toBe(
      404,
    );
  });

  it('deletes a save, and saves vanish with their user', async () => {
    const u = await signUp(ctx.app, 'a@example.com');
    const { item } = (await (await save(u, 'https://gone.example/x')).json()) as Json;
    const del = await call(ctx.app, `/api/saves/${item.id}`, { method: 'DELETE', user: u });
    expect(del.status).toBe(200);
    expect((await call(ctx.app, `/api/saves/${item.id}`, { user: u })).status).toBe(404);
    expect(
      (await call(ctx.app, `/api/saves/${item.id}`, { method: 'DELETE', user: u })).status,
    ).toBe(404);

    await save(u, 'https://gone.example/y');
    await ctx.db.delete(schema.user).where(eq(schema.user.id, u.id));
    expect(await ctx.db.select().from(schema.savedItem)).toEqual([]);
  });

  it('validates the body', async () => {
    const u = await signUp(ctx.app, 'a@example.com');
    expect((await call(ctx.app, '/api/saves', { method: 'POST', user: u, json: {} })).status).toBe(
      400,
    );
    expect((await save(u, '   ')).status).toBe(400);
  });
});
