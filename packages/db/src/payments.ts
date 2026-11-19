import { and, desc, eq, gt, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { Db } from './index.js';
import * as schema from './schema.js';
import { extendSubscription, type Tx } from './store.js';

/** Most payments a user may have waiting for approval at once. */
export const MAX_PENDING_PER_USER = 3;

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

export interface ExpiringPro {
  userId: string;
  email: string;
  currentPeriodEnd: Date;
}

/**
 * Paid Pro users whose period ends within `days` of `now` and who have not been reminded for that
 * period end yet. Trials (`trialing`) and lapsed or free rows are excluded. A renewal moves
 * `current_period_end`, which differs from `expiry_reminder_for`, so the next period is reminded again.
 */
export async function findExpiringPro(db: Db, now: Date, days: number): Promise<ExpiringPro[]> {
  const until = new Date(now.getTime() + days * 86_400_000);
  const s = schema.subscription;
  const rows = await db
    .select({ userId: s.userId, email: schema.user.email, currentPeriodEnd: s.currentPeriodEnd })
    .from(s)
    .innerJoin(schema.user, eq(schema.user.id, s.userId))
    .where(
      and(
        eq(s.plan, 'pro'),
        inArray(s.status, ['active', 'canceled']),
        gt(s.currentPeriodEnd, now),
        lte(s.currentPeriodEnd, until),
        or(isNull(s.expiryReminderFor), ne(s.expiryReminderFor, s.currentPeriodEnd)),
      ),
    )
    .orderBy(s.currentPeriodEnd, s.userId);
  return rows.flatMap((r) =>
    r.currentPeriodEnd
      ? [{ userId: r.userId, email: r.email, currentPeriodEnd: r.currentPeriodEnd }]
      : [],
  );
}

/**
 * Records that the reminder for `periodEnd` was delivered. A no-op when the period end has moved
 * since it was read (a renewal landed meanwhile), so the new period keeps its own reminder.
 */
export async function markReminded(db: Db, userId: string, periodEnd: Date): Promise<boolean> {
  const s = schema.subscription;
  const rows = await db
    .update(s)
    .set({ expiryReminderFor: sql`${s.currentPeriodEnd}` })
    .where(
      and(
        eq(s.userId, userId),
        sql`date_trunc('milliseconds', ${s.currentPeriodEnd}) = ${periodEnd.toISOString()}::timestamptz`,
      ),
    )
    .returning({ id: s.id });
  return rows.length > 0;
}
