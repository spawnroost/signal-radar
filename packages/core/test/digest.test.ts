import { describe, expect, it } from 'vitest';
import {
  answerCallbackQuery,
  editMessageText,
  formatDigest,
  sendDigest,
  sendMessageWithButtons,
} from '../src/digest/telegram.js';
import type { Enriched } from '../src/score/types.js';
import { res } from './helpers.js';

const item: Enriched = {
  id: 'a',
  url: 'https://example.com/a?x=1&y="2"',
  title: 'Raw <title>',
  snippet: '',
  source: 'HN',
  sourceKind: 'hn',
  momentum: { perHour: 1 },
  tags: [],
  media: { type: 'article' },
  keywordScore: 1,
  score: 10,
  niches: [],
  ai: {
    score: 88.4,
    why: 'w',
    summary: 's',
    hook: 'Hook <b>',
    angle: 'a',
    title: 'Nice & title',
    format: 'short',
    effort: 'S',
  },
};

describe('telegram digest', () => {
  it('formats title, score, hook and link with HTML escaped', () => {
    const t = formatDigest([item], 3);
    expect(t).toContain('3 new');
    expect(t).toContain('<b>Nice &amp; title</b> (88)');
    expect(t).toContain('Hook &lt;b&gt;');
    expect(t).toContain('href="https://example.com/a?x=1&amp;y=&quot;2&quot;"');
  });

  it('adds an escaped footer only when given one', () => {
    expect(formatDigest([item], 3)).not.toContain('<i>');
    expect(formatDigest([item], 3, 'Pro & more')).toMatch(/\n\n<i>Pro &amp; more<\/i>$/);
  });

  it('skips quietly without credentials', async () => {
    let called = false;
    const f = async () => {
      called = true;
      return res('{}');
    };
    expect(await sendDigest(f, {}, [item], 1)).toBe(false);
    expect(await sendDigest(f, { TELEGRAM_BOT_TOKEN: 't' }, [item], 1)).toBe(false);
    expect(called).toBe(false);
  });

  it('posts to the Bot API and hides the token in errors', async () => {
    let seen: { url: string; body: Record<string, unknown> } | undefined;
    const ok = async (url: string, init?: RequestInit) => {
      seen = { url, body: JSON.parse(init?.body as string) as Record<string, unknown> };
      return res('{"ok":true}');
    };
    const env = { TELEGRAM_BOT_TOKEN: 'SECRET', TELEGRAM_CHAT_ID: '42' };
    expect(await sendDigest(ok, env, [item], 1)).toBe(true);
    expect(seen?.url).toBe('https://api.telegram.org/botSECRET/sendMessage');
    expect(seen?.body).toMatchObject({ chat_id: '42', parse_mode: 'HTML' });

    await expect(sendDigest(async () => res('no', 401), env, [item], 1)).rejects.toThrow(
      /^telegram HTTP 401$/,
    );
  });
});

describe('telegram inline buttons', () => {
  const capture = (reply: () => Response) => {
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    const fn = async (url: string, init?: RequestInit) => {
      seen.push({ url, body: JSON.parse(init?.body as string) as Record<string, unknown> });
      return reply();
    };
    return { seen, fn };
  };
  const id = '123e4567-e89b-12d3-a456-426614174000';
  const buttons = [
    { text: 'Approve', data: `upi:a:${id}` },
    { text: 'Reject', data: `upi:r:${id}` },
  ];

  it('sends buttons and returns the message id', async () => {
    const { seen, fn } = capture(() => res('{"ok":true,"result":{"message_id":77}}'));
    expect(await sendMessageWithButtons(fn, 'SECRET', 42, 'hi', buttons)).toBe(77);
    expect(seen[0]?.url).toBe('https://api.telegram.org/botSECRET/sendMessage');
    expect(seen[0]?.body).toMatchObject({
      chat_id: 42,
      text: 'hi',
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Approve', callback_data: `upi:a:${id}` },
            { text: 'Reject', callback_data: `upi:r:${id}` },
          ],
        ],
      },
    });
    expect(new TextEncoder().encode(buttons[0]?.data ?? '').length).toBeLessThanOrEqual(64);
  });

  it('rejects oversized callback data without calling the API', async () => {
    const { seen, fn } = capture(() => res('{}'));
    await expect(
      sendMessageWithButtons(fn, 't', 1, 'x', [{ text: 'a', data: 'x'.repeat(65) }]),
    ).rejects.toThrow(RangeError);
    expect(seen).toHaveLength(0);
  });

  it('throws on an API error or a reply without a message id, hiding the token', async () => {
    await expect(
      sendMessageWithButtons(async () => res('no', 403), 'SECRET', 1, 'x', buttons),
    ).rejects.toThrow(/^telegram HTTP 403$/);
    await expect(
      sendMessageWithButtons(async () => res('{"ok":true}'), 'SECRET', 1, 'x', buttons),
    ).rejects.toThrow(/^telegram HTTP 200$/);
  });

  it('answers a callback query', async () => {
    const { seen, fn } = capture(() => res('{"ok":true}'));
    await answerCallbackQuery(fn, 'SECRET', 'cb1', 'Approved');
    expect(seen[0]?.url).toBe('https://api.telegram.org/botSECRET/answerCallbackQuery');
    expect(seen[0]?.body).toEqual({ callback_query_id: 'cb1', text: 'Approved' });
    await expect(
      answerCallbackQuery(async () => res('no', 400), 'SECRET', 'cb1', 'x'),
    ).rejects.toThrow(/^telegram HTTP 400$/);
  });

  it('edits a message and drops the buttons', async () => {
    const { seen, fn } = capture(() => res('{"ok":true}'));
    await editMessageText(fn, 'SECRET', 42, 77, 'done');
    expect(seen[0]?.url).toBe('https://api.telegram.org/botSECRET/editMessageText');
    expect(seen[0]?.body).toMatchObject({ chat_id: 42, message_id: 77, text: 'done' });
    expect(seen[0]?.body).not.toHaveProperty('reply_markup');
    await expect(editMessageText(async () => res('no', 400), 'SECRET', 1, 2, 'x')).rejects.toThrow(
      /^telegram HTTP 400$/,
    );
  });
});
