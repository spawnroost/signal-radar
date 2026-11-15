import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { and, eq, gt, ne } from 'drizzle-orm';
import { z } from 'zod';
import { answerCallbackQuery, createFetch, editMessageText, sendMessage } from '@radar/core';
import { approvePayment, rejectPayment, schema } from '@radar/db';
import type { AppVars, RouteDeps } from '../app.js';
import { adminChatIds, decidedAlertText, notifyUserDecision } from '../payments/notify.js';

const Update = z.object({
  message: z
    .object({
      text: z.string().optional(),
      chat: z.object({ id: z.union([z.number(), z.string()]), type: z.string() }),
    })
    .optional(),
  callback_query: z
    .object({
      id: z.string(),
      data: z.string().optional(),
      from: z.object({ id: z.union([z.number(), z.string()]) }),
      message: z
        .object({
          message_id: z.number(),
          chat: z.object({ id: z.union([z.number(), z.string()]) }),
        })
        .optional(),
    })
    .optional(),
});

const CALLBACK = /^upi:([ar]):([0-9a-f-]{36})$/;

const START = /^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/;
const STOP = /^\/stop(?:@\w+)?\s*$/;

const HELP =
  'Signal Radar sends your digest here. To connect, open Settings -> Notifications in the app and tap Connect Telegram.';
const BAD_LINK =
  'That link has expired or was already used. Open Settings -> Notifications in the app and tap Connect Telegram for a new one.';
const CONNECTED = 'Connected. Your Signal Radar digest will arrive here after each run.';

/** Constant-time string compare (hashing equalises the lengths). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function telegramRoutes(deps: RouteDeps) {
  const { db, env } = deps;
  const r = new Hono<AppVars>();
  const fetchFn = deps.net?.fetch ?? createFetch(10_000);

  type Callback = NonNullable<z.infer<typeof Update>['callback_query']>;

  /** Admin Approve / Reject button taps. Never throws; always answers the callback. */
  async function handleCallback(cb: Callback): Promise<void> {
    const token = env.TELEGRAM_BOT_TOKEN;
    if (!token) return;
    const answer = async (t: string) => {
      try {
        await answerCallbackQuery(fetchFn, token, cb.id, t);
      } catch (e) {
        console.error(`telegram answer failed: ${(e as Error).message}`);
      }
    };
    try {
      // Both the chat the tap came from and the person who tapped must be admins.
      const admins = await adminChatIds(db, env);
      const from = String(cb.from.id);
      const chat = cb.message ? String(cb.message.chat.id) : null;
      if (!cb.message || chat === null || from !== chat || !admins.includes(chat)) {
        await answer('Not allowed');
        return;
      }
      const m = CALLBACK.exec(cb.data ?? '');
      if (!m) {
        await answer('Unknown action');
        return;
      }
      const approve = m[1] === 'a';
      const paymentId = m[2]!;
      const decidedBy = `telegram:${chat}`;
      let until: Date | null = null;
      let done: boolean;
      if (approve) {
        until = await approvePayment(db, paymentId, decidedBy);
        done = until !== null;
      } else {
        done = await rejectPayment(db, paymentId, decidedBy);
      }
      if (!done) {
        await answer('Already decided');
        return;
      }
      const outcome = approve ? 'approved' : 'rejected';
      await answer(approve ? 'Approved' : 'Rejected');
      try {
        const [row] = await db
          .select({
            email: schema.user.email,
            days: schema.payment.days,
            amount: schema.payment.amount,
            utr: schema.payment.utr,
          })
          .from(schema.payment)
          .innerJoin(schema.user, eq(schema.user.id, schema.payment.userId))
          .where(eq(schema.payment.id, paymentId));
        if (row) {
          await editMessageText(
            fetchFn,
            token,
            chat,
            cb.message.message_id,
            decidedAlertText(row, outcome, decidedBy, until),
          );
        }
      } catch (e) {
        console.error(`telegram edit failed: ${(e as Error).message}`);
      }
      await notifyUserDecision(deps, paymentId, outcome, until);
    } catch (e) {
      console.error(`telegram callback failed: ${(e as Error).message}`);
      await answer('Something went wrong');
    }
  }

  r.post('/webhook', async (c) => {
    const secret = env.TELEGRAM_WEBHOOK_SECRET;
    if (!secret) return c.json({ error: 'not found' }, 404);
    const given = c.req.header('x-telegram-bot-api-secret-token') ?? '';
    if (!safeEqual(given, secret)) return c.json({ error: 'forbidden' }, 401);

    // Always answer 200 from here on so Telegram does not retry.
    const parsed = Update.safeParse(await c.req.json().catch(() => null));
    const cb = parsed.success ? parsed.data.callback_query : undefined;
    if (cb) {
      await handleCallback(cb);
      return c.json({ ok: true });
    }
    const msg = parsed.success ? parsed.data.message : undefined;
    const text = msg?.text?.trim();
    if (!msg || !text || msg.chat.type !== 'private') return c.json({ ok: true });
    const chatId = String(msg.chat.id);

    const reply = async (t: string) => {
      const token = env.TELEGRAM_BOT_TOKEN;
      if (!token) return;
      try {
        await sendMessage(fetchFn, token, chatId, t);
      } catch (e) {
        console.error(`telegram reply failed: ${(e as Error).message}`);
      }
    };

    const start = START.exec(text);
    if (start) {
      const token = start[1];
      if (!token) {
        await reply(HELP);
        return c.json({ ok: true });
      }
      const link = schema.telegramLink;
      const [row] = await db
        .delete(link)
        .where(and(eq(link.token, token), gt(link.expiresAt, new Date())))
        .returning({ userId: link.userId });
      if (!row) {
        await reply(BAD_LINK);
        return c.json({ ok: true });
      }
      const cfg = schema.userConfig;
      // One chat belongs to one account.
      await db
        .update(cfg)
        .set({ telegramChatId: null })
        .where(and(eq(cfg.telegramChatId, chatId), ne(cfg.userId, row.userId)));
      await db
        .insert(cfg)
        .values({ userId: row.userId, telegramChatId: chatId })
        .onConflictDoUpdate({ target: cfg.userId, set: { telegramChatId: chatId } });
      await reply(CONNECTED);
      return c.json({ ok: true });
    }

    if (STOP.test(text)) {
      await db
        .update(schema.userConfig)
        .set({ telegramChatId: null })
        .where(eq(schema.userConfig.telegramChatId, chatId));
      await reply('Disconnected.');
    }
    return c.json({ ok: true });
  });

  return r;
}
