import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createPayment, schema } from '@radar/db';
import { call, dbAvailable, setup, signUp, type Json } from './helpers.js';

const ENV = {
  UPI_VPA: 'merchant@okbank',
  TELEGRAM_BOT_TOKEN: 'bot-token',
  ADMIN_EMAILS: 'admin@example.com',
};

describe.skipIf(!dbAvailable)('admin payments endpoints', () => {
  let sent: { method: string; body: Record<string, unknown> }[];
  const netFetch = async (url: string, init?: RequestInit): Promise<Response> => {
    sent.push({
      method: url.split('/').pop()!,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return Response.json({ ok: true, result: { message_id: 1 } });
  };
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    ctx = await setup(ENV, { fetch: netFetch }, { push: null });
  });
  afterAll(async () => {
    await ctx?.close();
  });
  beforeEach(async () => {
    sent = [];
    await ctx.reset();
  });

  async function scene() {
    const admin = await signUp(ctx.app, 'admin@example.com');
    const payer = await signUp(ctx.app, 'payer@example.com');
    const res = await createPayment(ctx.db, payer.id, 'p30', '123456789012', 'note');
    if (!res.ok) throw new Error('payment');
    return { admin, payer, id: res.id };
  }
  const act = (u: Awaited<ReturnType<typeof signUp>>, id: string, verb: 'approve' | 'reject') =>
    call(ctx.app, `/api/admin/payments/${id}/${verb}`, { method: 'POST', user: u });

  it('401 signed out, 403 for a non-admin', async () => {
    const { payer, id } = await scene();
    expect((await call(ctx.app, '/api/admin/payments')).status).toBe(401);
    expect(
      (await call(ctx.app, `/api/admin/payments/${id}/approve`, { method: 'POST' })).status,
    ).toBe(401);
    expect((await call(ctx.app, '/api/admin/payments', { user: payer })).status).toBe(403);
    expect((await act(payer, id, 'approve')).status).toBe(403);
    expect((await act(payer, id, 'reject')).status).toBe(403);
    const [row] = await ctx.db.select().from(schema.payment).where(eq(schema.payment.id, id));
    expect(row!.status).toBe('pending');
  });

  it('lists pending by default, with the user email, and filters by status', async () => {
    const { admin, payer, id } = await scene();
    const second = await createPayment(ctx.db, payer.id, 'p90', '999999999999', 'n2');
    if (!second.ok) throw new Error('payment');
    await act(admin, second.id, 'reject');

    const def = (await (
      await call(ctx.app, '/api/admin/payments', { user: admin })
    ).json()) as Json;
    expect(def.payments.map((p: Json) => p.id)).toEqual([id]);
    expect(def.payments[0]).toMatchObject({
      email: 'payer@example.com',
      passId: 'p30',
      days: 30,
      amount: 9900,
      utr: '123456789012',
      status: 'pending',
    });
    const all = (await (
      await call(ctx.app, '/api/admin/payments?status=all', { user: admin })
    ).json()) as Json;
    expect(all.payments).toHaveLength(2);
    const rej = (await (
      await call(ctx.app, '/api/admin/payments?status=rejected', { user: admin })
    ).json()) as Json;
    expect(rej.payments.map((p: Json) => p.id)).toEqual([second.id]);
    expect((await call(ctx.app, '/api/admin/payments?status=bogus', { user: admin })).status).toBe(
      400,
    );
  });

  it('approve grants Pro, records the admin, edits the Telegram alert', async () => {
    const { admin, payer, id } = await scene();
    await ctx.db
      .update(schema.payment)
      .set({ telegramMessageId: 55 })
      .where(eq(schema.payment.id, id));
    await ctx.db
      .update(schema.userConfig)
      .set({ telegramChatId: '4242' })
      .where(eq(schema.userConfig.userId, admin.id));

    const res = await act(admin, id, 'approve');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body).toMatchObject({ id, status: 'approved' });
    expect(new Date(body.currentPeriodEnd).getTime()).toBeGreaterThan(Date.now());

    const [row] = await ctx.db.select().from(schema.payment).where(eq(schema.payment.id, id));
    expect(row).toMatchObject({ status: 'approved', decidedBy: admin.id });
    const me = (await (await call(ctx.app, '/api/me', { user: payer })).json()) as Json;
    expect(me.subscription.isPro).toBe(true);
    expect(me.subscription.currentPeriodEnd).toBe(body.currentPeriodEnd);

    const edit = sent.find((s) => s.method === 'editMessageText');
    expect(edit?.body).toMatchObject({ chat_id: '4242', message_id: 55 });
    expect(String(edit?.body.text)).toContain('UPI payment approved');
    expect(edit?.body.reply_markup).toBeUndefined();
  });

  it('a second approve (or reject after approve) is 409 and changes nothing', async () => {
    const { admin, id } = await scene();
    expect((await act(admin, id, 'approve')).status).toBe(200);
    const [before] = await ctx.db.select().from(schema.subscription);
    expect((await act(admin, id, 'approve')).status).toBe(409);
    expect((await act(admin, id, 'reject')).status).toBe(409);
    const [after] = await ctx.db.select().from(schema.subscription);
    expect(after!.currentPeriodEnd).toEqual(before!.currentPeriodEnd);
  });

  it('reject grants nothing and a later approve is 409', async () => {
    const { admin, payer, id } = await scene();
    const res = await act(admin, id, 'reject');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id, status: 'rejected' });
    const [row] = await ctx.db.select().from(schema.payment).where(eq(schema.payment.id, id));
    expect(row).toMatchObject({ status: 'rejected', decidedBy: admin.id });
    const me = (await (await call(ctx.app, '/api/me', { user: payer })).json()) as Json;
    expect(me.subscription.currentPeriodEnd).toBeNull();
    expect((await act(admin, id, 'approve')).status).toBe(409);
  });

  it('404 for an unknown or malformed id', async () => {
    const { admin } = await scene();
    expect((await act(admin, '00000000-0000-4000-8000-000000000000', 'approve')).status).toBe(404);
    expect((await act(admin, 'not-a-uuid', 'reject')).status).toBe(404);
  });

  it('a Telegram failure does not fail the decision', async () => {
    const failing = await setup(
      ENV,
      {
        fetch: async () => {
          throw new Error('network down');
        },
      },
      { push: null },
    );
    try {
      const admin = await signUp(failing.app, 'admin@example.com');
      const payer = await signUp(failing.app, 'payer@example.com');
      await failing.db
        .update(schema.userConfig)
        .set({ telegramChatId: '4242' })
        .where(eq(schema.userConfig.userId, admin.id));
      const res = await createPayment(failing.db, payer.id, 'p30', '123456789012', 'note');
      if (!res.ok) throw new Error('payment');
      await failing.db
        .update(schema.payment)
        .set({ telegramMessageId: 9 })
        .where(eq(schema.payment.id, res.id));
      const out = await call(failing.app, `/api/admin/payments/${res.id}/approve`, {
        method: 'POST',
        user: admin,
      });
      expect(out.status).toBe(200);
    } finally {
      await failing.close();
    }
  });
});
