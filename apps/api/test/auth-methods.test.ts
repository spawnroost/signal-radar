import { describe, expect, it } from 'vitest';
import { authMethods } from '../src/auth.js';
import { createPasswordUser } from '../src/users.js';
import { parseEnv } from '../src/env.js';
import { dbAvailable, setup, WEB_ORIGIN, type Json } from './helpers.js';

const base = {
  BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-1234',
  BETTER_AUTH_URL: 'http://localhost:8787',
  WEB_ORIGIN,
};
const GOOGLE = { GOOGLE_CLIENT_ID: 'g-id', GOOGLE_CLIENT_SECRET: 'g-secret' };
const GITHUB = { GITHUB_CLIENT_ID: 'h-id', GITHUB_CLIENT_SECRET: 'h-secret' };
const methods = (extra: Record<string, string>) => authMethods(parseEnv({ ...base, ...extra }));

describe('authMethods', () => {
  it('uses email + password as the main sign-in, with sign-up open, when no provider is configured', () => {
    for (const NODE_ENV of ['production', 'development', 'test']) {
      expect(methods({ NODE_ENV })).toEqual({
        google: false,
        github: false,
        email: true,
        emailPrimary: true,
        emailSignup: true,
      });
    }
  });

  it('keeps email sign-in but closes sign-up in production once a provider is configured', () => {
    expect(methods({ NODE_ENV: 'production', ...GOOGLE })).toEqual({
      google: true,
      github: false,
      email: true,
      emailPrimary: false,
      emailSignup: false,
    });
    expect(methods({ NODE_ENV: 'production', ...GITHUB })).toMatchObject({
      github: true,
      email: true,
      emailSignup: false,
    });
    expect(methods({ NODE_ENV: 'production', ...GOOGLE, ...GITHUB })).toMatchObject({
      google: true,
      github: true,
      email: true,
      emailPrimary: false,
      emailSignup: false,
    });
  });

  it('keeps sign-up open beside providers in dev and test, but not as the main form', () => {
    expect(methods({ NODE_ENV: 'development', ...GOOGLE, ...GITHUB })).toEqual({
      google: true,
      github: true,
      email: true,
      emailPrimary: false,
      emailSignup: true,
    });
    expect(methods({ ...GITHUB })).toMatchObject({
      github: true,
      email: true,
      emailPrimary: false,
      emailSignup: true,
    });
  });

  it('needs both keys of a provider', () => {
    expect(methods({ GOOGLE_CLIENT_ID: 'x', GITHUB_CLIENT_SECRET: 'y' })).toMatchObject({
      google: false,
      github: false,
      emailPrimary: true,
    });
  });
});

describe.skipIf(!dbAvailable)('email sign-up by environment', () => {
  const signUpRaw = (app: Awaited<ReturnType<typeof setup>>['app'], email: string) =>
    app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: WEB_ORIGIN },
      body: JSON.stringify({ name: 'x', email, password: 'correct-horse-battery' }),
    });

  it('works in production when no provider is configured', async () => {
    const prod = await setup({ NODE_ENV: 'production' });
    try {
      await prod.reset();
      expect((await signUpRaw(prod.app, 'a@example.com')).status).toBe(200);
      const info = (await (await prod.app.request('/api/auth-methods')).json()) as Json;
      expect(info).toMatchObject({ email: true, emailPrimary: true });
    } finally {
      await prod.close();
    }
  });

  it('is refused in production once a provider is configured, but sign-in still works', async () => {
    const prod = await setup({ NODE_ENV: 'production', ...GITHUB });
    try {
      await prod.reset();
      const res = await signUpRaw(prod.app, 'b@example.com');
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      const info = (await (await prod.app.request('/api/auth-methods')).json()) as Json;
      expect(info).toEqual({
        google: false,
        github: true,
        email: true,
        emailPrimary: false,
        emailSignup: false,
      });

      // An account made out of band can sign in with its password.
      const env = parseEnv({ ...base, NODE_ENV: 'production', ...GITHUB });
      await createPasswordUser(prod.db, env, {
        email: 'Reviewer@Example.com',
        password: 'correct-horse-battery',
      });
      const signIn = await prod.app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: WEB_ORIGIN },
        body: JSON.stringify({ email: 'reviewer@example.com', password: 'correct-horse-battery' }),
      });
      expect(signIn.status).toBe(200);
      const cookie = (signIn.headers.getSetCookie() ?? []).map((c) => c.split(';')[0]).join('; ');
      const me = await prod.app.request('/api/me', { headers: { cookie } });
      expect(me.status).toBe(200);
      const body = (await me.json()) as Json;
      expect(JSON.stringify(body)).toContain('reviewer@example.com');
      // The same hooks as a normal sign-up: a Pro trial.
      expect(JSON.stringify(body)).toMatch(/trial/i);
    } finally {
      await prod.close();
    }
  });

  it('still works in test/dev beside a provider', async () => {
    const dev = await setup({ ...GOOGLE });
    try {
      await dev.reset();
      expect((await signUpRaw(dev.app, 'c@example.com')).status).toBe(200);
    } finally {
      await dev.close();
    }
  });
});

describe.skipIf(!dbAvailable)('createPasswordUser', () => {
  it('refuses an email that already exists and a short password', async () => {
    const t = await setup({ NODE_ENV: 'production', ...GOOGLE });
    try {
      await t.reset();
      const env = parseEnv({ ...base, NODE_ENV: 'production', ...GOOGLE });
      await createPasswordUser(t.db, env, {
        email: 'a@example.com',
        password: 'correct-horse-battery',
      });
      await expect(
        createPasswordUser(t.db, env, {
          email: 'A@example.com',
          password: 'another-long-password',
        }),
      ).rejects.toThrow(/already exists/);
      await expect(
        createPasswordUser(t.db, env, { email: 'b@example.com', password: 'short' }),
      ).rejects.toThrow(/at least/);
    } finally {
      await t.close();
    }
  });
});
