import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@radar/db';
import { call, dbAvailable, setup, signUp, WEB_ORIGIN, type Json } from './helpers.js';

const KEY = Buffer.from('dodo-test-signing-key-0123456789').toString('base64');
const SECRET = `whsec_${KEY}`;
const ENV = {
  DODO_PAYMENTS_API_KEY: 'sk_test_abc',
  DODO_PAYMENTS_WEBHOOK_KEY: SECRET,
  DODO_PRODUCT_30: 'pdt_30',
  DODO_PRODUCT_90: 'pdt_90',
  DODO_PRODUCT_365: 'pdt_365',
  TELEGRAM_BOT_TOKEN: 'bot-token',
  TELEGRAM_ADMIN_CHAT_ID: '999',
};

interface Sent {
  url: string;
  init?: RequestInit;
}

function signed(body: string, opts: { id?: string; ts?: number; secret?: string } = {}) {
  const id = opts.id ?? 'msg_1';
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const key = Buffer.from((opts.secret ?? SECRET).slice(6), 'base64');
  const sig = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
  return { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` };
}

describe.skipIf(!dbAvailable)('Dodo payments', () => {
  let sent: Sent[];
  let session: () => Response;
  const netFetch = async (url: string, init?: RequestInit): Promise<Response> => {
    sent.push({ url, init });
    if (url.includes('api.telegram.org')) return Response.json({ ok: true, result: {} });
    return session();
  };

  let ctx: Awaited<ReturnType<typeof setup>>;
  let closed: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    ctx = await setup(ENV, { fetch: netFetch });
    closed = await setup({}, { fetch: netFetch });
  });
  afterAll(async () => {
    await ctx?.close();
    await closed?.close();
  });
  beforeEach(async () => {
    sent = [];
    session = () => Response.json({ session_id: 'cks_1', checkout_url: 'https://pay.test/c/1' });
    await ctx.reset();
  });

  const checkout = (u: Awaited<ReturnType<typeof signUp>>, passId = 'p90', currency = 'USD') =>
    call(ctx.app, '/api/billing/dodo/checkout', {
      method: 'POST',
      user: u,
      json: { passId, currency },
    });
  const hook = (event: unknown, headers?: Record<string, string>) => {
    const body = JSON.stringify(event);
    return ctx.app.request('/api/billing/dodo/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(headers ?? signed(body)) },
      body,
    });
  };
  const succeeded = (ref: string, over: Record<string, unknown> = {}) => ({
    type: 'payment.succeeded',
    data: {
      payment_id: 'pay_1',
      currency: 'USD',
      metadata: { payment_ref: ref },
      product_cart: [{ product_id: 'pdt_90', quantity: 1 }],
      ...over,
    },
  });
  const rows = () => ctx.db.select().from(schema.payment);
  const subEnd = async (userId: string) =>
    (await ctx.db.select().from(schema.subscription)).find((s) => s.userId === userId)
      ?.currentPeriodEnd;
  const pending = async (u: Awaited<ReturnType<typeof signUp>>) => {
    await checkout(u);
    return (await rows())[0]!.id;
  };

  it('answers 503 when Dodo is not configured', async () => {
    const u = await signUp(closed.app, 'a@example.com');
    const res = await call(closed.app, '/api/billing/dodo/checkout', {
      method: 'POST',
      user: u,
      json: { passId: 'p30', currency: 'INR' },
    });
    expect(res.status).toBe(503);
    const wh = await closed.app.request('/api/billing/dodo/webhook', {
      method: 'POST',
      body: '{}',
    });
    expect(wh.status).toBe(503);
  });

  it('creates a checkout session and returns its url', async () => {
    const u = await signUp(ctx.app, 'a@example.com');
    const res = await checkout(u, 'p90', 'USD');
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).checkoutUrl).toBe('https://pay.test/c/1');
    const [row] = await rows();
    expect(row).toMatchObject({ provider: 'dodo', status: 'pending', passId: 'p90', amount: 700 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('https://test.dodopayments.com/checkouts');
    const headers = sent[0]!.init!.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk_test_abc');
    expect(JSON.parse(String(sent[0]!.init!.body))).toEqual({
      product_cart: [{ product_id: 'pdt_90', quantity: 1 }],
      customer: { email: 'a@example.com', name: 'a' },
      billing_currency: 'USD',
      return_url: `${WEB_ORIGIN}/billing/return?ref=${row!.id}`,
      cancel_url: `${WEB_ORIGIN}/pricing`,
      metadata: { payment_ref: row!.id, user_id: u.id },
    });
  });

  it('requires sign-in and a valid body', async () => {
    const res = await call(ctx.app, '/api/billing/dodo/checkout', {
      method: 'POST',
      json: { passId: 'p30', currency: 'INR' },
    });
    expect(res.status).toBe(401);
    const u = await signUp(ctx.app, 'a@example.com');
    expect((await checkout(u, 'p7')).status).toBe(400);
  });

  it('marks the row failed and answers 502 when Dodo errors', async () => {
    session = () => new Response('boom', { status: 500 });
    const u = await signUp(ctx.app, 'a@example.com');
    const res = await checkout(u);
    expect(res.status).toBe(502);
    expect((await rows())[0]!.status).toBe('failed');
  });

  it('shows a payment status only to its owner', async () => {
    const a = await signUp(ctx.app, 'a@example.com');
    const b = await signUp(ctx.app, 'b@example.com');
    const id = await pending(a);
    const own = await call(ctx.app, `/api/billing/dodo/status/${id}`, { user: a });
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({ status: 'pending', currentPeriodEnd: null });
    expect((await call(ctx.app, `/api/billing/dodo/status/${id}`, { user: b })).status).toBe(404);
    expect((await call(ctx.app, '/api/billing/dodo/status/not-a-uuid', { user: a })).status).toBe(
      404,
    );
    expect((await call(ctx.app, `/api/billing/dodo/status/${id}`)).status).toBe(401);
  });

  it('rejects bad and stale webhook signatures', async () => {
    const a = await signUp(ctx.app, 'a@example.com');
    const id = await pending(a);
    const body = JSON.stringify(succeeded(id));
    const bad = await hook(
      succeeded(id),
      signed(body, { secret: `whsec_${Buffer.from('other').toString('base64')}` }),
    );
    expect(bad.status).toBe(401);
    const stale = await hook(
      succeeded(id),
      signed(body, { ts: Math.floor(Date.now() / 1000) - 600 }),
    );
    expect(stale.status).toBe(401);
    const none = await ctx.app.request('/api/billing/dodo/webhook', { method: 'POST', body });
    expect(none.status).toBe(401);
    expect((await rows())[0]!.status).toBe('pending');
  });

  it('accepts any of several signatures', async () => {
    const a = await signUp(ctx.app, 'a@example.com');
    const id = await pending(a);
    const body = JSON.stringify(succeeded(id));
    const h = signed(body);
    const res = await hook(succeeded(id), {
      ...h,
      'webhook-signature': `v1,${Buffer.from('junk').toString('base64')} ${h['webhook-signature']}`,
    });
    expect(res.status).toBe(200);
    expect((await rows())[0]!.status).toBe('approved');
  });

  it('grants once on double delivery and alerts the admin', async () => {
    const a = await signUp(ctx.app, 'a@example.com');
    const id = await pending(a);
    sent = [];
    expect((await hook(succeeded(id))).status).toBe(200);
    const first = await subEnd(a.id);
    expect(first).toBeTruthy();
    const [row] = await rows();
    expect(row).toMatchObject({ status: 'approved', providerRef: 'pay_1' });
    expect((await hook(succeeded(id))).status).toBe(200);
    expect((await subEnd(a.id))!.getTime()).toBe(first!.getTime());
    const alerts = sent.filter((s) => s.url.includes('api.telegram.org'));
    expect(alerts).toHaveLength(1);
    expect(String(alerts[0]!.init!.body)).toContain('a@example.com');
    const status = await call(ctx.app, `/api/billing/dodo/status/${id}`, { user: a });
    expect(((await status.json()) as Json).currentPeriodEnd).toBeTruthy();
  });

  it('ignores a payment for the wrong product and unknown refs or events', async () => {
    const a = await signUp(ctx.app, 'a@example.com');
    const id = await pending(a);
    const wrong = await hook(
      succeeded(id, { product_cart: [{ product_id: 'pdt_30', quantity: 1 }] }),
    );
    expect(await wrong.json()).toEqual({ ok: true, ignored: true });
    expect((await rows())[0]!.status).toBe('pending');
    expect(await subEnd(a.id)).toBeFalsy();
    const unknown = await hook(succeeded('00000000-0000-4000-8000-000000000000'));
    expect(await unknown.json()).toEqual({ ok: true, ignored: true });
    const other = await hook({ type: 'subscription.active', data: {} });
    expect(await other.json()).toEqual({ ok: true, ignored: true });
  });

  it('marks failed payments and refunds', async () => {
    const a = await signUp(ctx.app, 'a@example.com');
    const id = await pending(a);
    await hook({
      type: 'payment.failed',
      data: { payment_id: 'pay_1', metadata: { payment_ref: id } },
    });
    expect((await rows())[0]!.status).toBe('failed');

    // A retry in the same checkout can still succeed, then be refunded.
    await hook(succeeded(id));
    expect((await rows())[0]!.status).toBe('approved');
    sent = [];
    await hook({ type: 'refund.succeeded', data: { payment_id: 'pay_1', refund_id: 'ref_1' } });
    expect((await rows())[0]!.status).toBe('refunded');
    expect(sent.filter((s) => s.url.includes('api.telegram.org'))).toHaveLength(1);
  });

  it('alerts the admin once on a dispute', async () => {
    const a = await signUp(ctx.app, 'a@example.com');
    const id = await pending(a);
    await hook(succeeded(id));
    sent = [];
    const ev = { type: 'dispute.opened', data: { payment_id: 'pay_1', dispute_id: 'dsp_1' } };
    const body = JSON.stringify(ev);
    const h = signed(body, { id: 'msg_dispute' });
    expect((await hook(ev, h)).status).toBe(200);
    expect((await hook(ev, h)).status).toBe(200);
    expect(sent.filter((s) => s.url.includes('api.telegram.org'))).toHaveLength(1);
  });
});
