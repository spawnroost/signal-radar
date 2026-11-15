import type { FetchFn } from '../http.js';
import type { Enriched } from '../score/types.js';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s: string) => esc(s).replace(/"/g, '&quot;');

/** HTML message for the Telegram Bot API (limit 4096 chars; the top items stay well under it). */
export function formatDigest(items: Enriched[], created: number, footer?: string): string {
  const lines = [`<b>Signal Radar</b>: ${created} new, top ${items.length}`];
  items.forEach((it, i) => {
    const score = it.ai ? String(Math.round(it.ai.score)) : it.score.toFixed(0);
    const title = it.ai?.title ?? it.title;
    lines.push('', `${i + 1}. <b>${esc(title)}</b> (${score})`);
    if (it.ai) lines.push(esc(it.ai.hook));
    lines.push(`<a href="${attr(it.url)}">${esc(new URL(it.url).hostname)}</a>`);
  });
  const body = lines.join('\n').slice(0, 3800);
  return footer ? `${body}\n\n<i>${esc(footer)}</i>` : body;
}

/** A Bot API failure. Carries the HTTP status but never the URL (it holds the bot token). */
export class TelegramError extends Error {
  constructor(readonly status: number) {
    super(`telegram HTTP ${status}`);
    this.name = 'TelegramError';
  }
}

async function callApi(
  fetchFn: FetchFn,
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const res = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new TelegramError(res.status);
  return res;
}

async function postMessage(
  fetchFn: FetchFn,
  token: string,
  body: Record<string, unknown>,
): Promise<void> {
  await callApi(fetchFn, token, 'sendMessage', body);
}

/** Plain-text reply to a chat. Throws `TelegramError` on an API error. */
export async function sendMessage(
  fetchFn: FetchFn,
  token: string,
  chatId: string | number,
  text: string,
): Promise<void> {
  await postMessage(fetchFn, token, {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true },
  });
}

/** Telegram rejects callback_data over 64 bytes. */
export const MAX_CALLBACK_BYTES = 64;

/** One inline button: label plus the callback data sent back when it is tapped. */
export interface TelegramButton {
  text: string;
  data: string;
}

/**
 * Plain-text message with one row of inline buttons. Returns the sent `message_id` (so it can be
 * edited later). Throws a `TelegramError` on an API error or a reply without a message id, and a
 * `RangeError` before calling the API when a button's data exceeds 64 bytes.
 */
export async function sendMessageWithButtons(
  fetchFn: FetchFn,
  token: string,
  chatId: string | number,
  text: string,
  buttons: TelegramButton[],
): Promise<number> {
  for (const b of buttons) {
    if (new TextEncoder().encode(b.data).length > MAX_CALLBACK_BYTES) {
      throw new RangeError(`callback data over ${MAX_CALLBACK_BYTES} bytes`);
    }
  }
  const res = await callApi(fetchFn, token, 'sendMessage', {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true },
    reply_markup: {
      inline_keyboard: [buttons.map((b) => ({ text: b.text, callback_data: b.data }))],
    },
  });
  const json = (await res.json().catch(() => null)) as {
    result?: { message_id?: unknown };
  } | null;
  const id = json?.result?.message_id;
  if (typeof id !== 'number') throw new TelegramError(res.status);
  return id;
}

/** Acknowledge a button tap (stops the client spinner) with a short toast. */
export async function answerCallbackQuery(
  fetchFn: FetchFn,
  token: string,
  callbackQueryId: string,
  text: string,
): Promise<void> {
  await callApi(fetchFn, token, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
  });
}

/** Replace a message's text. No `reply_markup` is sent, so its buttons are removed. */
export async function editMessageText(
  fetchFn: FetchFn,
  token: string,
  chatId: string | number,
  messageId: number,
  text: string,
): Promise<void> {
  await callApi(fetchFn, token, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    link_preview_options: { is_disabled: true },
  });
}

/**
 * Send the digest. Returns false (without calling the API) when the token or chat id is unset;
 * throws a `TelegramError` on an API error so the caller can warn (403 = the user blocked the bot).
 */
export async function sendDigest(
  fetchFn: FetchFn,
  env: Record<string, string | undefined>,
  items: Enriched[],
  created: number,
  footer?: string,
): Promise<boolean> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId || items.length === 0) return false;
  await postMessage(fetchFn, token, {
    chat_id: chatId,
    text: formatDigest(items, created, footer),
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  });
  return true;
}
