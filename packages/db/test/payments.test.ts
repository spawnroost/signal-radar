import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema, grantPayment, listPayments, type Db } from '../src/index.js';
import { openTestDb, resetTestDb, testDbAvailable } from '../src/testing.js';

const available = await testDbAvailable();

const NOW = new Date('2026-11-15T10:00:00Z');
const DAY = 86_400_000;
const after = (d: Date, days: number) => new Date(d.getTime() + days * DAY);

describe.skipIf(!available)('payments', () => {
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
  /** A pending row, as checkout or an older payment would have left it. */
  const seed = async (opts: { userId?: string; days?: number; createdAt?: Date } = {}) => {
    const days = opts.days ?? 30;
    const [row] = await db
      .insert(schema.payment)
      .values({
        userId: opts.userId ?? 'ann',
        passId: days === 90 ? 'p90' : 'p30',
        days,
        amount: 14900,
        provider: 'dodo',
        providerRef: `pay_${Math.random().toString(36).slice(2)}`,
        note: 'SR-ANN-p30-INR',
        createdAt: opts.createdAt ?? NOW,
      })
      .returning({ id: schema.payment.id });
    return row!.id;
  };
  const grant = (id: string, by = 'dodo', now = NOW) =>
    db.transaction((tx) => grantPayment(tx, id, by, now));

  it('grant with no Pro starts from now and marks the subscription with the provider', async () => {
    const id = await seed();
    const end = await grant(id);
    expect(end).toEqual(after(NOW, 30));
    expect(await sub()).toMatchObject({
      plan: 'pro',
      status: 'active',
      provider: 'dodo',
      currentPeriodEnd: end,
    });
    const [row] = await listPayments(db, { status: 'approved' });
    expect(row).toMatchObject({ decidedAt: NOW, decidedBy: 'dodo' });
  });

  it('grant extends from the current expiry while Pro is running', async () => {
    const end0 = after(NOW, 10);
    await db
      .insert(schema.subscription)
      .values({ userId: 'ann', plan: 'pro', status: 'active', currentPeriodEnd: end0 });
    expect(await grant(await seed())).toEqual(after(end0, 30));
  });

  it('grant after Pro lapsed starts from now', async () => {
    await db.insert(schema.subscription).values({
      userId: 'ann',
      plan: 'pro',
      status: 'canceled',
      currentPeriodEnd: after(NOW, -5),
    });
    expect(await grant(await seed())).toEqual(after(NOW, 30));
  });

  it('a trialing user keeps the rest of the trial', async () => {
    const trialEnd = after(NOW, 5);
    await db
      .insert(schema.subscription)
      .values({ userId: 'ann', plan: 'pro', status: 'trialing', trialEndsAt: trialEnd });
    const end = await grant(await seed());
    expect(end).toEqual(after(trialEnd, 30));
    expect(await sub()).toMatchObject({ status: 'active', currentPeriodEnd: end });
  });

  it('a second grant is a no-op: days are added once', async () => {
    const id = await seed();
    const end = await grant(id);
    expect(await grant(id, 'dodo', after(NOW, 1))).toBeNull();
    expect((await sub())?.currentPeriodEnd).toEqual(end);
  });

  it('concurrent grants add days once', async () => {
    const id = await seed();
    const results = await Promise.all(Array.from({ length: 5 }, () => grant(id)));
    expect(results.filter((r) => r !== null)).toEqual([after(NOW, 30)]);
    expect((await sub())?.currentPeriodEnd).toEqual(after(NOW, 30));
  });

  it('concurrent grants of different payments for one new user both add their days', async () => {
    const a = await seed({ days: 30 });
    const b = await seed({ days: 90 });
    await Promise.all([grant(a), grant(b)]);
    expect((await sub())?.currentPeriodEnd).toEqual(after(NOW, 120));
  });

  it('an unknown id grants nothing', async () => {
    expect(await grant('00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(await sub()).toBeUndefined();
  });

  it('lists newest first, filtered by status and user', async () => {
    const a = await seed();
    await seed({ createdAt: after(NOW, 1) });
    await seed({ userId: 'bob', createdAt: after(NOW, 2) });
    await grant(a);
    const all = await listPayments(db);
    expect(all.map((p) => p.userId)).toEqual(['bob', 'ann', 'ann']);
    expect(await listPayments(db, { status: 'pending', userId: 'ann' })).toHaveLength(1);
    expect(await listPayments(db, { status: 'approved' })).toHaveLength(1);
  });
});
