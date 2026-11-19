import { and, count, eq, lt } from 'drizzle-orm';
import { PASSES, shortUserId, type Currency, type PassId } from '@radar/core';
import type { Db } from './index.js';
import * as schema from './schema.js';
import { MAX_PENDING_PER_USER, grantPayment } from './payments.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A checkout nobody finished within this long is marked failed (a late success webhook still grants). */
const PENDING_TTL_MS = 60 * 60 * 1000;

export type CreateDodoPaymentResult =
  { ok: true; id: string } | { ok: false; error: 'passId' | 'tooManyPending' };

/**
 * Inserts a pending Dodo payment. Amount (minor units: paise or cents) and days come from PASSES,
 * never from the caller. The note is `SR-<short user id>-<pass id>-<currency>`. This user's Dodo
 * checkouts pending for over an hour are marked failed first, then the pending cap is applied.
 */
export async function createDodoPayment(
  db: Db,
  userId: string,
  passId: string,
  currency: Currency,
  now = new Date(),
): Promise<CreateDodoPaymentResult> {
  const pass = PASSES.find((p) => p.id === passId);
  if (!pass || (currency !== 'INR' && currency !== 'USD')) return { ok: false, error: 'passId' };

  return db.transaction(async (tx): Promise<CreateDodoPaymentResult> => {
    // Serialise this user's checkouts so the pending cap cannot be raced past.
    await tx
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .for('update');
    await tx
      .update(schema.payment)
      .set({ status: 'failed', decidedAt: now, decidedBy: 'dodo:expired' })
      .where(
        and(
          eq(schema.payment.userId, userId),
          eq(schema.payment.provider, 'dodo'),
          eq(schema.payment.status, 'pending'),
          lt(schema.payment.createdAt, new Date(now.getTime() - PENDING_TTL_MS)),
        ),
      );
    const [pending] = await tx
      .select({ n: count() })
      .from(schema.payment)
      .where(and(eq(schema.payment.userId, userId), eq(schema.payment.status, 'pending')));
    if ((pending?.n ?? 0) >= MAX_PENDING_PER_USER) return { ok: false, error: 'tooManyPending' };
    const [row] = await tx
      .insert(schema.payment)
      .values({
        userId,
        passId: pass.id as PassId,
        days: pass.days,
        amount: currency === 'INR' ? pass.inr : pass.usd,
        provider: 'dodo',
        note: `SR-${shortUserId(userId)}-${pass.id}-${currency}`,
        createdAt: now,
      })
      .returning({ id: schema.payment.id });
    return { ok: true, id: row!.id };
  });
}

/**
 * Records Dodo's payment id and grants Pro, once. Works on a `pending` row, and on one expiry marked
 * `failed` (a late success webhook must still grant). Returns the new `currentPeriodEnd`, or null when
 * the row is unknown, not a Dodo row, or already decided (so a repeat delivery is a no-op).
 */
export async function markDodoPaid(
  db: Db,
  ourId: string,
  dodoPaymentId: string,
  now = new Date(),
): Promise<Date | null> {
  if (!UUID_RE.test(ourId)) return null;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ provider: schema.payment.provider, status: schema.payment.status })
      .from(schema.payment)
      .where(eq(schema.payment.id, ourId))
      .for('update');
    if (!row || row.provider !== 'dodo') return null;
    if (row.status !== 'pending' && row.status !== 'failed') return null;
    await tx
      .update(schema.payment)
      .set({ providerRef: dodoPaymentId, status: 'pending', decidedAt: null, decidedBy: null })
      .where(eq(schema.payment.id, ourId));
    return grantPayment(tx, ourId, 'dodo', now);
  });
}

/** Marks a pending Dodo payment failed. False when it is not a pending Dodo row. */
export async function markDodoFailed(db: Db, ourId: string, now = new Date()): Promise<boolean> {
  if (!UUID_RE.test(ourId)) return false;
  const rows = await db
    .update(schema.payment)
    .set({ status: 'failed', decidedAt: now, decidedBy: 'dodo' })
    .where(
      and(
        eq(schema.payment.id, ourId),
        eq(schema.payment.provider, 'dodo'),
        eq(schema.payment.status, 'pending'),
      ),
    )
    .returning({ id: schema.payment.id });
  return rows.length > 0;
}

/** Marks an approved Dodo payment refunded. Pro time is left as is (the admin decides). */
export async function markDodoRefunded(db: Db, ourId: string): Promise<boolean> {
  if (!UUID_RE.test(ourId)) return false;
  const rows = await db
    .update(schema.payment)
    .set({ status: 'refunded' })
    .where(
      and(
        eq(schema.payment.id, ourId),
        eq(schema.payment.provider, 'dodo'),
        eq(schema.payment.status, 'approved'),
      ),
    )
    .returning({ id: schema.payment.id });
  return rows.length > 0;
}
