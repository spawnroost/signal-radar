import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { call, dbAvailable, setup, signUp, WEB_ORIGIN, type Json } from './helpers.js';

const VPA = 'merchant@okbank';

describe.skipIf(!dbAvailable)('UPI link and submit', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let closed: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    ctx = await setup({ UPI_VPA: VPA });
    closed = { ...(await setup()) };
  });
  afterAll(async () => {
    await ctx?.close();
    await closed?.close();
  });
  beforeEach(async () => {
    await ctx.reset();
  });

  const submit = (u: Awaited<ReturnType<typeof signUp>>, json: unknown) =>
    call(ctx.app, '/api/upi/submit', { method: 'POST', user: u, json });

  it('reports upi on /passes only when UPI_VPA is set', async () => {
    const on = (await (
      await ctx.app.request('/api/billing/passes', { headers: { origin: WEB_ORIGIN } })
    ).json()) as Json;
    const off = (await (
      await closed.app.request('/api/billing/passes', { headers: { origin: WEB_ORIGIN } })
    ).json()) as Json;
    expect(on.upi).toBe(true);
    expect(off.upi).toBe(false);
  });

  it('is closed with 503 when UPI_VPA is unset', async () => {
    const u = await signUp(closed.app, 'a@example.com');
    expect((await call(closed.app, '/api/upi/link?passId=p30', { user: u })).status).toBe(503);
    expect((await call(closed.app, '/api/upi/mine', { user: u })).status).toBe(503);
    const res = await call(closed.app, '/api/upi/submit', {
      method: 'POST',
      user: u,
      json: { passId: 'p30', utr: '123456789012' },
    });
    expect(res.status).toBe(503);
  });

  it('requires sign-in', async () => {
    expect((await call(ctx.app, '/api/upi/link?passId=p30')).status).toBe(401);
    expect(
      (
        await call(ctx.app, '/api/upi/submit', {
          method: 'POST',
          json: { passId: 'p30', utr: '1' },
        })
      ).status,
    ).toBe(401);
    expect((await call(ctx.app, '/api/upi/mine')).status).toBe(401);
  });

  it('builds the pay link from the server-side pass price', async () => {
    const u = await signUp(ctx.app, 'a@example.com');
    const res = await call(ctx.app, '/api/upi/link?passId=p90', { user: u });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body.amount).toBe(249);
    expect(body.days).toBe(90);
    expect(body.vpa).toBe(VPA);
    expect(body.note).toMatch(/^SR-[A-Z0-9]{1,6}-p90$/);
    expect(body.link).toContain('pa=merchant%40okbank');
    expect(body.link).toContain('am=249.00');
    expect(body.link).toContain('cu=INR');
    expect((await call(ctx.app, '/api/upi/link?passId=nope', { user: u })).status).toBe(400);
    expect((await call(ctx.app, '/api/upi/link', { user: u })).status).toBe(400);
  });

  it('records a pending payment and lists it under /mine', async () => {
    const u = await signUp(ctx.app, 'a@example.com');
    const res = await submit(u, { passId: 'p30', utr: '1234 5678 9012', amount: 1 });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Json;
    expect(body.status).toBe('pending');
    const mine = (await (await call(ctx.app, '/api/upi/mine', { user: u })).json()) as Json;
    expect(mine.payments).toHaveLength(1);
    expect(mine.payments[0]).toMatchObject({
      id: body.id,
      passId: 'p30',
      days: 30,
      amount: 9900,
      status: 'pending',
      decidedAt: null,
    });
  });

  it('ignores any client-supplied amount or days', async () => {
    const u = await signUp(ctx.app, 'a@example.com');
    await submit(u, { passId: 'p365', utr: '111111111111', amount: 1, days: 1 });
    const mine = (await (await call(ctx.app, '/api/upi/mine', { user: u })).json()) as Json;
    expect(mine.payments[0]).toMatchObject({ amount: 79900, days: 365 });
  });

  it('maps errors to clear status codes', async () => {
    const u = await signUp(ctx.app, 'a@example.com');
    const v = await signUp(ctx.app, 'b@example.com');
    const bad = await submit(u, { passId: 'p30', utr: '12345' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as Json).error).toBe('UTR must be 12 digits');
    expect((await submit(u, { passId: 'p1', utr: '123456789012' })).status).toBe(400);
    expect((await submit(u, { utr: '123456789012' })).status).toBe(400);

    expect((await submit(u, { passId: 'p30', utr: '123456789012' })).status).toBe(201);
    const dup = await submit(v, { passId: 'p30', utr: '123456789012' });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as Json).error).toBe('That UTR was already used');
  });

  it('returns 429 once three payments are pending', async () => {
    const u = await signUp(ctx.app, 'a@example.com');
    for (const n of [1, 2, 3]) {
      expect((await submit(u, { passId: 'p30', utr: `10000000000${n}` })).status).toBe(201);
    }
    expect((await submit(u, { passId: 'p30', utr: '100000000004' })).status).toBe(429);
  });

  it('only lists the caller own payments', async () => {
    const u = await signUp(ctx.app, 'a@example.com');
    const v = await signUp(ctx.app, 'b@example.com');
    await submit(u, { passId: 'p30', utr: '123456789012' });
    const mine = (await (await call(ctx.app, '/api/upi/mine', { user: v })).json()) as Json;
    expect(mine.payments).toEqual([]);
  });
});
