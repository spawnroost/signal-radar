import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@radar/db';
import { call, dbAvailable, setup, signUp, type Json } from './helpers.js';

const ENV = { ADMIN_EMAILS: 'admin@example.com' };

describe.skipIf(!dbAvailable)('admin payments endpoint', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    ctx = await setup(ENV);
  });
  afterAll(async () => {
    await ctx?.close();
  });
  beforeEach(async () => {
    await ctx.reset();
  });

  async function scene() {
    const admin = await signUp(ctx.app, 'admin@example.com');
    const payer = await signUp(ctx.app, 'payer@example.com');
    const [dodo] = await ctx.db
      .insert(schema.payment)
      .values({
        userId: payer.id,
        passId: 'p30',
        days: 30,
        amount: 300,
        provider: 'dodo',
        providerRef: 'pay_1',
        note: 'SR-PAYER-p30-USD',
        status: 'approved',
        createdAt: new Date('2026-11-18T10:00:00Z'),
      })
      .returning({ id: schema.payment.id });
    const [legacy] = await ctx.db
      .insert(schema.payment)
      .values({
        userId: payer.id,
        passId: 'p90',
        days: 90,
        amount: 34900,
        provider: 'upi',
        utr: '123456789012',
        note: 'SR-PAYER-p90',
        status: 'rejected',
        createdAt: new Date('2026-11-10T10:00:00Z'),
      })
      .returning({ id: schema.payment.id });
    return { admin, payer, dodoId: dodo!.id, legacyId: legacy!.id };
  }

  it('401 signed out, 403 for a non-admin', async () => {
    const { payer } = await scene();
    expect((await call(ctx.app, '/api/admin/payments')).status).toBe(401);
    expect((await call(ctx.app, '/api/admin/payments', { user: payer })).status).toBe(403);
  });

  it('lists every provider newest first, with the email, and filters by status', async () => {
    const { admin, dodoId, legacyId } = await scene();
    const all = (await (
      await call(ctx.app, '/api/admin/payments', { user: admin })
    ).json()) as Json;
    expect(all.payments.map((p: Json) => p.id)).toEqual([dodoId, legacyId]);
    expect(all.payments[0]).toMatchObject({
      email: 'payer@example.com',
      provider: 'dodo',
      amount: 300,
      note: 'SR-PAYER-p30-USD',
      status: 'approved',
    });
    expect(all.payments[1]).toMatchObject({ provider: 'upi', utr: '123456789012' });
    const rej = (await (
      await call(ctx.app, '/api/admin/payments?status=rejected', { user: admin })
    ).json()) as Json;
    expect(rej.payments.map((p: Json) => p.id)).toEqual([legacyId]);
    expect((await call(ctx.app, '/api/admin/payments?status=bogus', { user: admin })).status).toBe(
      400,
    );
  });

  it('has no approve or reject routes', async () => {
    const { admin, dodoId } = await scene();
    for (const verb of ['approve', 'reject']) {
      const res = await call(ctx.app, `/api/admin/payments/${dodoId}/${verb}`, {
        method: 'POST',
        user: admin,
      });
      expect(res.status).toBe(404);
    }
  });
});
