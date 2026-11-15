import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  schema,
  approvePayment,
  createPayment,
  listPayments,
  rejectPayment,
  type Db,
} from '../src/index.js';
import { openTestDb, resetTestDb, testDbAvailable } from '../src/testing.js';

const available = await testDbAvailable();

const NOW = new Date('2026-11-15T10:00:00Z');
const DAY = 86_400_000;
const after = (d: Date, days: number) => new Date(d.getTime() + days * DAY);
const UTR = '123456789012';

describe.skipIf(!available)('UPI payments', () => {
  let db: Db;
  beforeAll(async () => {
    db = await openTestDb();
  });
  afterAll(async () => {
    await db?.$client.end({ timeout: 1 });
  });
  beforeEach(async () => {
    await resetTestDb(db);
    for (const id of ['ann', 'bob']) {
      await db.insert(schema.user).values({ id, name: id, email: `${id}@example.com` });
    }
  });

  const sub = async (userId = 'ann') =>
    (await db.select().from(schema.subscription).where(eq(schema.subscription.userId, userId)))[0];
  const submit = async (utr = UTR, passId = 'p30', userId = 'ann') => {
    const r = await createPayment(db, userId, passId, utr, `SR-${userId}-${passId}`, NOW);
    if (!r.ok) throw new Error(r.error);
    return r.id;
  };

  it('creates a pending payment with amount and days from the pass, UTR normalised', async () => {
    const r = await createPayment(db, 'ann', 'p90', '1234 5678 9012', 'SR-ANN-p90', NOW);
    expect(r.ok).toBe(true);
    const [row] = await listPayments(db, { userId: 'ann' });
    expect(row).toMatchObject({
      status: 'pending',
      provider: 'upi',
      passId: 'p90',
      days: 90,
      amount: 24900,
      utr: UTR,
      note: 'SR-ANN-p90',
      createdAt: NOW,
    });
  });

  it('refuses a bad UTR and an unknown pass', async () => {
    expect(await createPayment(db, 'ann', 'p30', '12345', 'n', NOW)).toEqual({
      ok: false,
      error: 'utr',
    });
    expect(await createPayment(db, 'ann', 'p30', 'abcdefghijkl', 'n', NOW)).toEqual({
      ok: false,
      error: 'utr',
    });
    expect(await createPayment(db, 'ann', 'p1', UTR, 'n', NOW)).toEqual({
      ok: false,
      error: 'passId',
    });
    expect(await listPayments(db)).toEqual([]);
  });

  it('refuses a UTR already used, even by another user or after a rejection', async () => {
    const id = await submit();
    expect(await createPayment(db, 'bob', 'p30', UTR, 'n', NOW)).toEqual({
      ok: false,
      error: 'utrUsed',
    });
    await rejectPayment(db, id, 'admin', NOW);
    expect(await createPayment(db, 'ann', 'p30', UTR, 'n', NOW)).toEqual({
      ok: false,
      error: 'utrUsed',
    });
  });

  it('caps pending payments per user at 3, and the cap is per user', async () => {
    await submit('111111111111');
    await submit('222222222222');
    await submit('333333333333');
    expect(await createPayment(db, 'ann', 'p30', '444444444444', 'n', NOW)).toEqual({
      ok: false,
      error: 'tooManyPending',
    });
    expect((await createPayment(db, 'bob', 'p30', '444444444444', 'n', NOW)).ok).toBe(true);
  });

  it('approve with no Pro starts from now and marks the subscription upi', async () => {
    const id = await submit();
    const end = await approvePayment(db, id, 'admin-1', NOW);
    expect(end).toEqual(after(NOW, 30));
    expect(await sub()).toMatchObject({
      plan: 'pro',
      status: 'active',
      provider: 'upi',
      currentPeriodEnd: end,
    });
    const [row] = await listPayments(db, { status: 'approved' });
    expect(row).toMatchObject({ decidedAt: NOW, decidedBy: 'admin-1' });
  });

  it('approve extends from the current expiry while Pro is running', async () => {
    const end0 = after(NOW, 10);
    await db
      .insert(schema.subscription)
      .values({ userId: 'ann', plan: 'pro', status: 'active', currentPeriodEnd: end0 });
    const id = await submit();
    expect(await approvePayment(db, id, 'admin', NOW)).toEqual(after(end0, 30));
  });

  it('approve after Pro lapsed starts from now', async () => {
    await db.insert(schema.subscription).values({
      userId: 'ann',
      plan: 'pro',
      status: 'canceled',
      currentPeriodEnd: after(NOW, -5),
    });
    const id = await submit();
    expect(await approvePayment(db, id, 'admin', NOW)).toEqual(after(NOW, 30));
  });

  it('a trialing user keeps the rest of the trial', async () => {
    const trialEnd = after(NOW, 5);
    await db
      .insert(schema.subscription)
      .values({ userId: 'ann', plan: 'pro', status: 'trialing', trialEndsAt: trialEnd });
    const id = await submit();
    const end = await approvePayment(db, id, 'admin', NOW);
    expect(end).toEqual(after(trialEnd, 30));
    expect(await sub()).toMatchObject({ status: 'active', currentPeriodEnd: end });
  });

  it('a second approve is a no-op: days are added once', async () => {
    const id = await submit();
    const end = await approvePayment(db, id, 'admin', NOW);
    expect(await approvePayment(db, id, 'admin', after(NOW, 1))).toBeNull();
    expect((await sub())?.currentPeriodEnd).toEqual(end);
  });

  it('concurrent approvals add days once', async () => {
    const id = await submit();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => approvePayment(db, id, 'admin', NOW)),
    );
    expect(results.filter((r) => r !== null)).toEqual([after(NOW, 30)]);
    expect((await sub())?.currentPeriodEnd).toEqual(after(NOW, 30));
  });

  it('concurrent approvals of different payments for one new user both add their days', async () => {
    const a = await submit('111111111111', 'p30');
    const b = await submit('222222222222', 'p90');
    await Promise.all([approvePayment(db, a, 'admin', NOW), approvePayment(db, b, 'admin', NOW)]);
    expect((await sub())?.currentPeriodEnd).toEqual(after(NOW, 120));
  });

  it('approve and reject racing: exactly one wins', async () => {
    const id = await submit();
    const [end, rejected] = await Promise.all([
      approvePayment(db, id, 'admin', NOW),
      rejectPayment(db, id, 'admin', NOW),
    ]);
    expect(Boolean(end) !== rejected).toBe(true);
    expect(Boolean((await sub())?.currentPeriodEnd)).toBe(Boolean(end));
  });

  it('reject grants nothing; approve after reject and reject twice are no-ops', async () => {
    const id = await submit();
    expect(await rejectPayment(db, id, 'admin', NOW)).toBe(true);
    expect(await sub()).toBeUndefined();
    expect(await approvePayment(db, id, 'admin', NOW)).toBeNull();
    expect(await rejectPayment(db, id, 'admin', NOW)).toBe(false);
    expect((await listPayments(db))[0]).toMatchObject({ status: 'rejected', decidedBy: 'admin' });
  });

  it('a rejected submission frees a pending slot', async () => {
    const ids = [
      await submit('111111111111'),
      await submit('222222222222'),
      await submit('333333333333'),
    ];
    await rejectPayment(db, ids[0]!, 'admin', NOW);
    expect((await createPayment(db, 'ann', 'p30', '444444444444', 'n', NOW)).ok).toBe(true);
  });

  it('unknown or malformed ids are no-ops', async () => {
    expect(await approvePayment(db, 'nope', 'admin', NOW)).toBeNull();
    expect(await rejectPayment(db, 'nope', 'admin', NOW)).toBe(false);
    expect(
      await approvePayment(db, '00000000-0000-4000-8000-000000000000', 'admin', NOW),
    ).toBeNull();
  });

  it('lists newest first, filtered by status and user', async () => {
    const a = await submit('111111111111');
    await createPayment(db, 'ann', 'p30', '222222222222', 'n', after(NOW, 1));
    await createPayment(db, 'bob', 'p30', '333333333333', 'n', after(NOW, 2));
    await rejectPayment(db, a, 'admin', NOW);
    expect((await listPayments(db)).map((p) => p.utr)).toEqual([
      '333333333333',
      '222222222222',
      '111111111111',
    ]);
    expect(await listPayments(db, { status: 'pending', userId: 'ann' })).toHaveLength(1);
    expect(await listPayments(db, { status: 'rejected' })).toHaveLength(1);
  });
});
