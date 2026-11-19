import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  schema,
  MAX_PENDING_PER_USER,
  createDodoPayment,
  listPayments,
  markDodoFailed,
  markDodoPaid,
  markDodoRefunded,
  type Db,
} from '../src/index.js';
import { openTestDb, resetTestDb, testDbAvailable } from '../src/testing.js';

const available = await testDbAvailable();

const NOW = new Date('2026-11-18T10:00:00Z');
const DAY = 86_400_000;
const HOUR = 3_600_000;
const after = (d: Date, ms: number) => new Date(d.getTime() + ms);

describe.skipIf(!available)('Dodo payments', () => {
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
  const row = async (id: string) =>
    (await db.select().from(schema.payment).where(eq(schema.payment.id, id)))[0]!;
  const create = async (passId = 'p30', currency: 'INR' | 'USD' = 'INR', at = NOW) => {
    const r = await createDodoPayment(db, 'ann', passId, currency, at);
    if (!r.ok) throw new Error(r.error);
    return r.id;
  };

  it('creates a pending dodo payment priced in the chosen currency', async () => {
    await create('p90', 'INR');
    await create('p90', 'USD');
    const rows = await listPayments(db, { userId: 'ann' });
    const inr = rows.find((r) => r.note.endsWith('-INR'))!;
    const usd = rows.find((r) => r.note.endsWith('-USD'))!;
    expect(inr).toMatchObject({
      status: 'pending',
      provider: 'dodo',
      passId: 'p90',
      days: 90,
      amount: 34900,
      utr: null,
      providerRef: null,
      note: 'SR-ANN-p90-INR',
      createdAt: NOW,
    });
    expect(usd).toMatchObject({ amount: 700, note: 'SR-ANN-p90-USD' });
  });

  it('refuses an unknown pass', async () => {
    expect(await createDodoPayment(db, 'ann', 'p7', 'INR', NOW)).toEqual({
      ok: false,
      error: 'passId',
    });
  });

  it('caps pending payments per user', async () => {
    for (let i = 0; i < MAX_PENDING_PER_USER; i++) await create();
    expect(await createDodoPayment(db, 'ann', 'p30', 'INR', NOW)).toEqual({
      ok: false,
      error: 'tooManyPending',
    });
    expect((await createDodoPayment(db, 'bob', 'p30', 'INR', NOW)).ok).toBe(true);
  });

  it('marks dodo checkouts older than an hour failed before counting', async () => {
    const old = [];
    for (let i = 0; i < MAX_PENDING_PER_USER; i++) old.push(await create());
    const later = after(NOW, HOUR + 1000);
    const r = await createDodoPayment(db, 'ann', 'p30', 'INR', later);
    expect(r.ok).toBe(true);
    for (const id of old) expect((await row(id)).status).toBe('failed');
  });

  it('keeps checkouts younger than an hour pending', async () => {
    const id = await create();
    await createDodoPayment(db, 'ann', 'p30', 'INR', after(NOW, HOUR - 1000));
    expect((await row(id)).status).toBe('pending');
  });

  it('grants the pass days once and ignores a repeat delivery', async () => {
    const id = await create('p30');
    const end = await markDodoPaid(db, id, 'pay_1', NOW);
    expect(end).toEqual(after(NOW, 30 * DAY));
    expect(await row(id)).toMatchObject({
      status: 'approved',
      providerRef: 'pay_1',
      decidedBy: 'dodo',
    });
    expect(await markDodoPaid(db, id, 'pay_1', after(NOW, DAY))).toBeNull();
    expect((await sub())!.currentPeriodEnd).toEqual(after(NOW, 30 * DAY));
    expect((await sub())!).toMatchObject({ plan: 'pro', provider: 'dodo' });
  });

  it('still grants a late success after the checkout expired', async () => {
    const id = await create('p30');
    await createDodoPayment(db, 'ann', 'p30', 'INR', after(NOW, 2 * HOUR));
    expect((await row(id)).status).toBe('failed');
    const paidAt = after(NOW, 3 * HOUR);
    expect(await markDodoPaid(db, id, 'pay_late', paidAt)).toEqual(after(paidAt, 30 * DAY));
    expect((await row(id)).status).toBe('approved');
    expect(await markDodoPaid(db, id, 'pay_late', paidAt)).toBeNull();
  });

  it('ignores unknown, malformed and non-dodo ids', async () => {
    expect(await markDodoPaid(db, 'nope', 'pay_1', NOW)).toBeNull();
    expect(await markDodoPaid(db, '00000000-0000-4000-8000-000000000000', 'pay_1', NOW)).toBeNull();
    const [upi] = await db
      .insert(schema.payment)
      .values({
        userId: 'ann',
        passId: 'p30',
        days: 30,
        amount: 14900,
        utr: '123456789012',
        note: 'n',
      })
      .returning();
    expect(await markDodoPaid(db, upi!.id, 'pay_1', NOW)).toBeNull();
    expect(await markDodoFailed(db, upi!.id)).toBe(false);
    expect((await row(upi!.id)).status).toBe('pending');
    expect(await sub()).toBeUndefined();
  });

  it('marks a pending payment failed once, and a failed one cannot fail again', async () => {
    const id = await create();
    expect(await markDodoFailed(db, id, NOW)).toBe(true);
    expect((await row(id)).status).toBe('failed');
    expect(await markDodoFailed(db, id, NOW)).toBe(false);
    expect(await markDodoFailed(db, 'nope')).toBe(false);
    expect(await sub()).toBeUndefined();
  });

  it('does not fail an approved payment', async () => {
    const id = await create();
    await markDodoPaid(db, id, 'pay_1', NOW);
    expect(await markDodoFailed(db, id, NOW)).toBe(false);
    expect((await row(id)).status).toBe('approved');
  });

  it('marks an approved payment refunded without touching Pro time', async () => {
    const id = await create('p30');
    expect(await markDodoRefunded(db, id)).toBe(false);
    await markDodoPaid(db, id, 'pay_1', NOW);
    expect(await markDodoRefunded(db, id)).toBe(true);
    expect((await row(id)).status).toBe('refunded');
    expect(await markDodoRefunded(db, id)).toBe(false);
    expect((await sub())!.currentPeriodEnd).toEqual(after(NOW, 30 * DAY));
    expect(await markDodoRefunded(db, 'nope')).toBe(false);
  });
});
