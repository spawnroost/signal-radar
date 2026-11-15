import { eq } from 'drizzle-orm';
import {
  createFetch,
  createPushSender,
  sendMessage,
  sendPush,
  type FetchFn,
  type PushSender,
} from '@radar/core';
import { findExpiringPro, markReminded, schema, type Db } from '@radar/db';

/** Days before the end of paid Pro that the reminder goes out. */
export const REMIND_DAYS = 3;

export interface RemindDeps {
  /** Public web origin; the message links to `<origin>/pricing`. */
  webOrigin: string;
  telegramToken?: string;
  fetch?: FetchFn;
  /** Web Push sender, or null when push is not configured. */
  push: PushSender | null;
  now?: Date;
  log?: (msg: string) => void;
}

export interface RemindResult {
  due: number;
  sent: number;
  skipped: number;
  failed: number;
}

export function reminderText(end: Date, webOrigin: string): string {
  return `Your Signal Radar Pro ends on ${end.toISOString().slice(0, 10)}. Add days at ${webOrigin.replace(/\/+$/, '')}/pricing`;
}

/**
 * Reminds paid Pro users whose period ends within REMIND_DAYS: Telegram if they linked a chat, else
 * web push. A user is marked reminded only after something was delivered, so a failure or a user with
 * no channel is retried (or skipped) on the next run. One user's failure never stops the rest.
 */
export async function remindExpiring(db: Db, deps: RemindDeps): Promise<RemindResult> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? new Date();
  const fetchFn = deps.fetch ?? createFetch(10_000);
  const rows = await findExpiringPro(db, now, REMIND_DAYS);
  const res: RemindResult = { due: rows.length, sent: 0, skipped: 0, failed: 0 };
  for (const row of rows) {
    try {
      const text = reminderText(row.currentPeriodEnd, deps.webOrigin);
      const [cfg] = await db
        .select({ chat: schema.userConfig.telegramChatId })
        .from(schema.userConfig)
        .where(eq(schema.userConfig.userId, row.userId));
      let delivered = false;
      if (cfg?.chat && deps.telegramToken) {
        await sendMessage(fetchFn, deps.telegramToken, cfg.chat, text);
        delivered = true;
      } else if (deps.push) {
        const subs = await db
          .select()
          .from(schema.pushSubscription)
          .where(eq(schema.pushSubscription.userId, row.userId));
        if (subs.length > 0) {
          const out = await sendPush(
            deps.push,
            subs.map((s) => ({ endpoint: s.endpoint, keys: s.keys })),
            { title: 'Pro ends soon', body: text, url: '/pricing', tag: 'expiry' },
          );
          if (out.gone.length > 0) {
            for (const endpoint of out.gone) {
              await db
                .delete(schema.pushSubscription)
                .where(eq(schema.pushSubscription.endpoint, endpoint));
            }
          }
          for (const e of out.errors) log(`remind push failed for ${row.email}: ${e}`);
          delivered = out.sent > 0;
        }
      }
      if (!delivered) {
        res.skipped++;
        continue;
      }
      await markReminded(db, row.userId, row.currentPeriodEnd);
      res.sent++;
    } catch (e) {
      res.failed++;
      log(`remind failed for ${row.email}: ${(e as Error).message}`);
    }
  }
  return res;
}

/** Real senders from the environment: Telegram token from TELEGRAM_BOT_TOKEN, push from the VAPID vars. */
export function remindDepsFromEnv(env: Record<string, string | undefined>): RemindDeps {
  const webOrigin = env.WEB_ORIGIN;
  if (!webOrigin) throw new Error('set WEB_ORIGIN');
  return {
    webOrigin,
    telegramToken: env.TELEGRAM_BOT_TOKEN || undefined,
    push: createPushSender(env),
    log: (m) => console.error(m),
  };
}
