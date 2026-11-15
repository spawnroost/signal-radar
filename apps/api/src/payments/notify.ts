import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { createFetch, sendMessageWithButtons } from '@radar/core';
import { schema, setPaymentTelegramMessage } from '@radar/db';
import type { RouteDeps } from '../app.js';

/** Callback data for the admin buttons: `upi:a:<uuid>` approves, `upi:r:<uuid>` rejects (42 bytes). */
export const approveData = (paymentId: string) => `upi:a:${paymentId}`;
export const rejectData = (paymentId: string) => `upi:r:${paymentId}`;

/**
 * Telegram chat ids that receive payment alerts and may tap the buttons: `TELEGRAM_ADMIN_CHAT_ID`
 * when set, else the chats linked by the users listed in `ADMIN_EMAILS`.
 */
export async function adminChatIds(
  db: RouteDeps['db'],
  env: Pick<RouteDeps['env'], 'ADMIN_EMAILS' | 'TELEGRAM_ADMIN_CHAT_ID'>,
): Promise<string[]> {
  if (env.TELEGRAM_ADMIN_CHAT_ID) return [env.TELEGRAM_ADMIN_CHAT_ID];
  const emails = (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length === 0) return [];
  const rows = await db
    .select({ chat: schema.userConfig.telegramChatId })
    .from(schema.userConfig)
    .innerJoin(schema.user, eq(schema.user.id, schema.userConfig.userId))
    .where(
      and(
        isNotNull(schema.userConfig.telegramChatId),
        sql`lower(${schema.user.email}) in (${sql.join(
          emails.map((e) => sql`${e}`),
          sql`, `,
        )})`,
      ),
    )
    .orderBy(schema.user.email);
  return [...new Set(rows.map((r) => r.chat).filter((c): c is string => Boolean(c)))];
}

/**
 * Alerts the admin on Telegram (Approve / Reject buttons) about a pending payment and stores the
 * message id on the payment row. Never throws: a Telegram failure is logged and the user's submit
 * carries on.
 */
export async function notifyAdminPending(deps: RouteDeps, paymentId: string): Promise<void> {
  const { db, env } = deps;
  try {
    const token = env.TELEGRAM_BOT_TOKEN;
    if (!token) return;
    const chats = await adminChatIds(db, env);
    if (chats.length === 0) return;
    const [row] = await db
      .select({ p: schema.payment, email: schema.user.email })
      .from(schema.payment)
      .innerJoin(schema.user, eq(schema.user.id, schema.payment.userId))
      .where(eq(schema.payment.id, paymentId));
    if (!row || row.p.status !== 'pending') return;
    const { p } = row;
    const rupees = p.amount / 100;
    const text = [
      'UPI payment pending',
      `User: ${row.email}`,
      `Pass: ${p.days} days, Rs ${rupees}`,
      `UTR: ${p.utr ?? '-'}`,
      `Note: ${p.note}`,
      '',
      `Confirm the Rs ${rupees} credit with this UTR in your UPI app before approving.`,
      `${env.WEB_ORIGIN.replace(/\/+$/, '')}/admin`,
    ].join('\n');
    const buttons = [
      { text: 'Approve', data: approveData(p.id) },
      { text: 'Reject', data: rejectData(p.id) },
    ];
    const fetchFn = deps.net?.fetch ?? createFetch(10_000);
    let stored = false;
    for (const chat of chats) {
      try {
        const messageId = await sendMessageWithButtons(fetchFn, token, chat, text, buttons);
        if (!stored) {
          await setPaymentTelegramMessage(db, p.id, messageId);
          stored = true;
        }
      } catch (e) {
        console.error(`payment alert failed: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    console.error(`payment alert failed: ${(e as Error).message}`);
  }
}
