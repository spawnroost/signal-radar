import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { createFetch, sendMessage } from '@radar/core';
import { schema } from '@radar/db';
import type { RouteDeps } from '../app.js';

/**
 * Telegram chat ids that receive payment alerts: `TELEGRAM_ADMIN_CHAT_ID`
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

/** Info-only Telegram message to the admin chats (no buttons). Never throws; a failure is logged. */
export async function notifyAdminInfo(deps: RouteDeps, text: string): Promise<void> {
  const { db, env } = deps;
  try {
    const token = env.TELEGRAM_BOT_TOKEN;
    if (!token) return;
    const chats = await adminChatIds(db, env);
    const fetchFn = deps.net?.fetch ?? createFetch(10_000);
    for (const chat of chats) {
      try {
        await sendMessage(fetchFn, token, chat, text);
      } catch (e) {
        console.error(`admin info alert failed: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    console.error(`admin info alert failed: ${(e as Error).message}`);
  }
}
