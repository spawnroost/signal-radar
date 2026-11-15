import { and, count, desc, eq } from 'drizzle-orm';
import { PASSES, isValidUtr, normalizeUtr, type PassId } from '@radar/core';
import type { Db } from './index.js';
import * as schema from './schema.js';
import { extendSubscription, type Tx } from './store.js';

/** Most payments a user may have waiting for approval at once. */
export const MAX_PENDING_PER_USER = 3;

export type CreatePaymentResult =
  { ok: true; id: string } | { ok: false; error: 'passId' | 'utr' | 'utrUsed' | 'tooManyPending' };

/** Postgres unique-violation constraint name, or null for any other error. Drizzle wraps the driver error. */
function uniqueConstraint(e: unknown): string | null {
  type PgErr = { code?: string; constraint?: string; constraint_name?: string; detail?: string };
  const err = e as PgErr & { cause?: PgErr };
  const code = err?.code ?? err?.cause?.code;
  if (code !== '23505') return null;
  // postgres.js reports `constraint_name`; node-postgres reports `constraint`. Fall back to the detail text.
  const pg = err.constraint_name || err.constraint ? err : (err.cause ?? err);
  return pg.constraint_name ?? pg.constraint ?? pg.detail ?? '';
}

/**
 * Inserts a pending UPI payment. Amount and days come from PASSES, never from the caller.
 * A UTR already used by anyone gives `utrUsed`; more than MAX_PENDING_PER_USER waiting gives `tooManyPending`.
 */
export async function createPayment(
  db: Db,
  userId: string,
  passId: string,
  rawUtr: string,
  note: string,
  now = new Date(),
): Promise<CreatePaymentResult> {
  const pass = PASSES.find((p) => p.id === passId);
  if (!pass) return { ok: false, error: 'passId' };
  const utr = normalizeUtr(rawUtr);
  if (!isValidUtr(utr)) return { ok: false, error: 'utr' };

  try {
    return await db.transaction(async (tx): Promise<CreatePaymentResult> => {
      // Serialise this user's submissions so the pending cap cannot be raced past.
      await tx
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.id, userId))
        .for('update');
      const [pending] = await tx
        .select({ n: count() })
        .from(schema.payment)
        .where(and(eq(schema.payment.userId, userId), eq(schema.payment.status, 'pending')));
      if ((pending?.n ?? 0) >= MAX_PENDING_PER_USER) {
        return { ok: false, error: 'tooManyPending' };
      }
      const [row] = await tx
        .insert(schema.payment)
        .values({
          userId,
          passId: pass.id as PassId,
          days: pass.days,
          amount: pass.inr,
          provider: 'upi',
          utr,
          note,
          createdAt: now,
        })
        .returning({ id: schema.payment.id });
      return { ok: true, id: row!.id };
    });
  } catch (e) {
    const constraint = uniqueConstraint(e);
    if (constraint === null) throw e;
    if (constraint.includes('utr')) return { ok: false, error: 'utrUsed' };
    throw e;
  }
}

/**
 * The one grant for a purchase: locks the payment row, moves only a `pending` payment to
 * `approved` and extends Pro by its days (provider copied from the row). Returns the new
 * `currentPeriodEnd`, or null when the payment is missing or already decided. Run inside a transaction.
 */
export async function grantPayment(
  tx: Tx,
  paymentId: string,
  decidedBy: string,
  now = new Date(),
): Promise<Date | null> {
  const [row] = await tx
    .select()
    .from(schema.payment)
    .where(eq(schema.payment.id, paymentId))
    .for('update');
  if (!row || row.status !== 'pending') return null;
  await tx
    .update(schema.payment)
    .set({ status: 'approved', decidedAt: now, decidedBy })
    .where(eq(schema.payment.id, row.id));
  return extendSubscription(tx, row.userId, row.days, row.provider, now, true);
}

/** Approves a pending payment and grants Pro atomically. Null when it is not pending (or unknown). */
export async function approvePayment(
  db: Db,
  id: string,
  decidedBy: string,
  now = new Date(),
): Promise<Date | null> {
  if (!UUID_RE.test(id)) return null;
  return db.transaction((tx) => grantPayment(tx, id, decidedBy, now));
}

/** Rejects a pending payment; grants nothing. False when it is not pending (or unknown). */
export async function rejectPayment(
  db: Db,
  id: string,
  decidedBy: string,
  now = new Date(),
): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const rows = await db
    .update(schema.payment)
    .set({ status: 'rejected', decidedAt: now, decidedBy })
    .where(and(eq(schema.payment.id, id), eq(schema.payment.status, 'pending')))
    .returning({ id: schema.payment.id });
  return rows.length > 0;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listPayments(
  db: Db,
  filter: { status?: schema.PaymentStatus; userId?: string; limit?: number } = {},
): Promise<schema.UpiPaymentRow[]> {
  const conds = [
    filter.status ? eq(schema.payment.status, filter.status) : undefined,
    filter.userId ? eq(schema.payment.userId, filter.userId) : undefined,
  ].filter((c) => c !== undefined);
  return db
    .select()
    .from(schema.payment)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.payment.createdAt))
    .limit(filter.limit ?? 200);
}
