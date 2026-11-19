import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createAuth } from '../src/auth.js';
import { isAdminEmail, parseEnv } from '../src/env.js';
import type { AppVars, RouteDeps } from '../src/app.js';
import { requireAdmin, requireAuth } from '../src/middleware.js';
import { call, dbAvailable, setup, signUp, WEB_ORIGIN, type Json } from './helpers.js';

const BASE = {
  BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-1234',
  BETTER_AUTH_URL: 'http://localhost:8787',
  WEB_ORIGIN,
  NODE_ENV: 'test',
};

describe('ADMIN_EMAILS matching', () => {
  const env = { ADMIN_EMAILS: ' Boss@Example.com , second@example.com ' };
  it('is trimmed and case-insensitive', () => {
    expect(isAdminEmail(env, 'boss@example.com')).toBe(true);
    expect(isAdminEmail(env, ' SECOND@EXAMPLE.COM ')).toBe(true);
    expect(isAdminEmail(env, 'other@example.com')).toBe(false);
  });
  it('matches nobody when unset, empty or no email', () => {
    expect(isAdminEmail({ ADMIN_EMAILS: undefined }, 'boss@example.com')).toBe(false);
    expect(isAdminEmail({ ADMIN_EMAILS: ' , ' }, '')).toBe(false);
    expect(isAdminEmail(env, null)).toBe(false);
  });
});

describe.skipIf(!dbAvailable)('requireAdmin', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let probe: Hono<AppVars>;
  beforeAll(async () => {
    ctx = await setup({ ADMIN_EMAILS: ' Admin@Example.com' });
    const env = parseEnv({ ...BASE, ADMIN_EMAILS: ' Admin@Example.com' });
    const deps: RouteDeps = { db: ctx.db, env, auth: createAuth(ctx.db, env) };
    probe = new Hono<AppVars>();
    probe.get('/probe', requireAuth(deps), requireAdmin(deps), (c) => c.json({ ok: true }));
    probe.onError((e, c) => {
      const status = 'status' in e ? (e.status as 401 | 403) : 500;
      return c.json({ error: e.message }, status);
    });
  });
  afterAll(async () => {
    await ctx?.close();
  });
  beforeEach(async () => {
    await ctx.reset();
  });

  const probeAs = (cookie?: string) =>
    probe.request('/probe', { headers: cookie ? { cookie, origin: WEB_ORIGIN } : {} });

  it('401 signed out, 403 for a non-admin, 200 for an admin', async () => {
    const admin = await signUp(ctx.app, 'admin@example.com');
    const user = await signUp(ctx.app, 'user@example.com');
    expect((await probeAs()).status).toBe(401);
    expect((await probeAs(user.cookie)).status).toBe(403);
    expect((await probeAs(admin.cookie)).status).toBe(200);
  });

  it('/api/me reports isAdmin', async () => {
    const admin = await signUp(ctx.app, 'ADMIN@example.com');
    const user = await signUp(ctx.app, 'user@example.com');
    const a = (await (await call(ctx.app, '/api/me', { user: admin })).json()) as Json;
    const u = (await (await call(ctx.app, '/api/me', { user })).json()) as Json;
    expect(a.isAdmin).toBe(true);
    expect(u.isAdmin).toBe(false);
  });
});
