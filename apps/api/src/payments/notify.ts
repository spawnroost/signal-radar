import { and, eq, isNotNull, sql } from 'drizzle-orm';
import {
  createFetch,
  createPushSender,
  sendMessage,
  sendMessageWithButtons,
  sendPush,
} from '@radar/core';
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

const day = (d: Date) => d.toISOString().slice(0, 10);

/** The admin alert as it reads once decided (no buttons). `until` is the new Pro end for an approval. */
export function decidedAlertText(
  row: { email: string; days: number; amount: number; utr: string | null },
  outcome: 'approved' | 'rejected',
  decidedBy: string,
  until?: Date | null,
): string {
  return [
    `UPI payment ${outcome}`,
    `User: ${row.email}`,
    `Pass: ${row.days} days, Rs ${row.amount / 100}`,
    `UTR: ${row.utr ?? '-'}`,
    outcome === 'approved' && until ? `Pro until ${day(until)}` : '',
    `By ${decidedBy}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Tells the payer the outcome: Telegram if they linked a chat, else web push if they have
 * subscriptions. Never throws; a failure here must not undo the decision.
 */
export async function notifyUserDecision(
  deps: RouteDeps,
  paymentId: string,
  outcome: 'approved' | 'rejected',
  until?: Date | null,
): Promise<void> {
  const { db, env } = deps;
  try {
    const [row] = await db
      .select({ userId: schema.payment.userId })
      .from(schema.payment)
      .where(eq(schema.payment.id, paymentId));
    if (!row) return;
    const text =
      outcome === 'approved' && until
        ? `Your payment was approved. Your Pro was extended to ${day(until)}.`
        : 'Your payment could not be verified. You can submit it again with the correct UTR.';
    const [cfg] = await db
      .select({ chat: schema.userConfig.telegramChatId })
      .from(schema.userConfig)
      .where(eq(schema.userConfig.userId, row.userId));
    if (cfg?.chat && env.TELEGRAM_BOT_TOKEN) {
      await sendMessage(
        deps.net?.fetch ?? createFetch(10_000),
        env.TELEGRAM_BOT_TOKEN,
        cfg.chat,
        text,
      );
      return;
    }
    const sender = deps.push === undefined ? createPushSender(env) : deps.push;
    if (!sender) return;
    const subs = await db
      .select()
      .from(schema.pushSubscription)
      .where(eq(schema.pushSubscription.userId, row.userId));
    if (subs.length === 0) return;
    const res = await sendPush(
      sender,
      subs.map((s) => ({ endpoint: s.endpoint, keys: s.keys })),
      {
        title: outcome === 'approved' ? 'Payment approved' : 'Payment not verified',
        body: text,
        url: '/',
        tag: 'payment',
      },
    );
    for (const e of res.errors) console.error(`payment push failed: ${e}`);
  } catch (e) {
    console.error(`payment user notify failed: ${(e as Error).message}`);
  }
}
