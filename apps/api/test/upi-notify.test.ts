import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@radar/db';
import { call, dbAvailable, setup, signUp, type Json } from './helpers.js';

const ENV = {
  UPI_VPA: 'merchant@okbank',
  TELEGRAM_BOT_TOKEN: 'bot-token',
  ADMIN_EMAILS: 'Admin@Example.com',
};

interface Sent {
  url: string;
  body: Record<string, unknown>;
}

describe.skipIf(!dbAvailable)('admin Telegram alert on UPI submit', () => {
  let sent: Sent[];
  let failWith: number | null;
  const netFetch = async (url: string, init?: RequestInit): Promise<Response> => {
    sent.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    if (failWith) return new Response('nope', { status: failWith });
    return Response.json({ ok: true, result: { message_id: 777 } });
  };

  let ctx: Awaited<ReturnType<typeof setup>>;
  let override: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    ctx = await setup(ENV, { fetch: netFetch });
    override = await setup({ ...ENV, TELEGRAM_ADMIN_CHAT_ID: '999' }, { fetch: netFetch });
  });
  afterAll(async () => {
    await ctx?.close();
    await override?.close();
  });
  beforeEach(async () => {
    sent = [];
    failWith = null;
    await ctx.reset();
  });

  const linkChat = (userId: string, chat: string) =>
    ctx.db
      .insert(schema.userConfig)
      .values({ userId, telegramChatId: chat })
      .onConflictDoUpdate({ target: schema.userConfig.userId, set: { telegramChatId: chat } });
  const submit = (app: typeof ctx.app, u: Awaited<ReturnType<typeof signUp>>, utr: string) =>
    call(app, '/api/upi/submit', { method: 'POST', user: u, json: { passId: 'p30', utr } });
  const stored = async (id: string) =>
    (await ctx.db.select().from(schema.payment)).find((p) => p.id === id)?.telegramMessageId;

  it("alerts the admin's linked chat with buttons and stores the message id", async () => {
    const admin = await signUp(ctx.app, 'admin@example.com');
    await linkChat(admin.id, '4242');
    const u = await signUp(ctx.app, 'payer@example.com');
    const res = await submit(ctx.app, u, '123456789012');
    expect(res.status).toBe(201);
    const id = ((await res.json()) as Json).id as string;

    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('https://api.telegram.org/botbot-token/sendMessage');
    const b = sent[0]!.body as {
      chat_id: string;
      text: string;
      reply_markup: { inline_keyboard: { text: string; callback_data: string }[][] };
    };
    expect(b.chat_id).toBe('4242');
    expect(b.text).toContain('payer@example.com');
    expect(b.text).toContain('30 days, Rs 99');
    expect(b.text).toContain('123456789012');
    expect(b.text).toContain('in your UPI app before approving');
    expect(b.text).toContain('/admin');
    expect(b.reply_markup.inline_keyboard[0]).toEqual([
      { text: 'Approve', callback_data: `upi:a:${id}` },
      { text: 'Reject', callback_data: `upi:r:${id}` },
    ]);
    expect(await stored(id)).toBe(777);
  });

  it('TELEGRAM_ADMIN_CHAT_ID overrides the linked chat', async () => {
    const u = await signUp(override.app, 'payer@example.com');
    await submit(override.app, u, '123456789012');
    expect(sent.map((s) => s.body.chat_id)).toEqual(['999']);
  });

  it('sends nothing when no admin chat is known or the user is not an admin', async () => {
    const u = await signUp(ctx.app, 'payer@example.com');
    await linkChat(u.id, '1');
    expect((await submit(ctx.app, u, '123456789012')).status).toBe(201);
    expect(sent).toHaveLength(0);
  });

  it('still returns 201 when Telegram fails', async () => {
    const admin = await signUp(ctx.app, 'admin@example.com');
    await linkChat(admin.id, '4242');
    const u = await signUp(ctx.app, 'payer@example.com');
    failWith = 500;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await submit(ctx.app, u, '123456789012');
    expect(res.status).toBe(201);
    const id = ((await res.json()) as Json).id as string;
    expect(sent).toHaveLength(1);
    expect(await stored(id)).toBeNull();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
    const mine = (await (await call(ctx.app, '/api/upi/mine', { user: u })).json()) as Json;
    expect(mine.payments).toHaveLength(1);
  });
});
