import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createPayment, schema } from '@radar/db';
import { dbAvailable, setup, signUp } from './helpers.js';

const SECRET = 'hook-secret';
const ENV = {
  UPI_VPA: 'merchant@okbank',
  TELEGRAM_BOT_TOKEN: 'bot-token',
  TELEGRAM_WEBHOOK_SECRET: SECRET,
  ADMIN_EMAILS: 'admin@example.com',
};

interface Sent {
  method: string;
  body: Record<string, unknown>;
}

describe.skipIf(!dbAvailable)('Telegram approve / reject buttons', () => {
  let sent: Sent[];
  let pushed: { endpoint: string; payload: string }[];
  const netFetch = async (url: string, init?: RequestInit): Promise<Response> => {
    sent.push({
      method: url.split('/').pop()!,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return Response.json({ ok: true, result: { message_id: 1 } });
  };
  const push = async (sub: { endpoint: string }, payload: string) => {
    pushed.push({ endpoint: sub.endpoint, payload });
  };

  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    ctx = await setup(ENV, { fetch: netFetch }, { push });
  });
  afterAll(async () => {
    await ctx?.close();
  });
  beforeEach(async () => {
    sent = [];
    pushed = [];
    await ctx.reset();
  });

  const linkChat = (userId: string, chat: string) =>
    ctx.db
      .insert(schema.userConfig)
      .values({ userId, telegramChatId: chat })
      .onConflictDoUpdate({ target: schema.userConfig.userId, set: { telegramChatId: chat } });
  const hook = (json: unknown, secret: string | null = SECRET) =>
    ctx.app.request('/api/telegram/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret }),
      },
      body: JSON.stringify(json),
    });
  const tap = (
    data: string | undefined,
    o: { from?: number; chat?: number; noMessage?: boolean } = {},
  ) => ({
    update_id: 1,
    callback_query: {
      id: 'cb1',
      ...(data === undefined ? {} : { data }),
      from: { id: o.from ?? 4242 },
      ...(o.noMessage ? {} : { message: { message_id: 55, chat: { id: o.chat ?? 4242 } } }),
    },
  });
  const status = async (id: string) =>
    (await ctx.db.select().from(schema.payment).where(eq(schema.payment.id, id)))[0]!;
  const proEnd = async (userId: string) =>
    (
      await ctx.db.select().from(schema.subscription).where(eq(schema.subscription.userId, userId))
    )[0]?.currentPeriodEnd ?? null;
  const answers = () => sent.filter((s) => s.method === 'answerCallbackQuery');

  async function scene(opts: { payerChat?: string; payerPush?: boolean } = {}) {
    const admin = await signUp(ctx.app, 'admin@example.com');
    await linkChat(admin.id, '4242');
    const payer = await signUp(ctx.app, 'payer@example.com');
    if (opts.payerChat) await linkChat(payer.id, opts.payerChat);
    if (opts.payerPush) {
      await ctx.db.insert(schema.pushSubscription).values({
        userId: payer.id,
        endpoint: 'https://push.example/1',
        keys: { p256dh: 'p', auth: 'a' },
      });
    }
    const res = await createPayment(ctx.db, payer.id, 'p30', '123456789012', 'note');
    if (!res.ok) throw new Error('payment');
    return { admin, payer, id: res.id };
  }

  it('keeps the webhook secret check for callbacks', async () => {
    const { id } = await scene();
    expect((await hook(tap(`upi:a:${id}`), 'wrong')).status).toBe(401);
    expect((await hook(tap(`upi:a:${id}`), null)).status).toBe(401);
    expect((await status(id)).status).toBe('pending');
    expect(sent).toHaveLength(0);
  });

  it('approves from the admin chat: grants Pro, edits the message, notifies the user', async () => {
    const { id, payer } = await scene({ payerChat: '777' });
    const res = await hook(tap(`upi:a:${id}`));
    expect(res.status).toBe(200);
    const p = await status(id);
    expect(p.status).toBe('approved');
    expect(p.decidedBy).toBe('telegram:4242');
    expect(await proEnd(payer.id)).not.toBeNull();

    expect(answers()).toHaveLength(1);
    expect(answers()[0]!.body.text).toBe('Approved');
    const edit = sent.find((s) => s.method === 'editMessageText')!;
    expect(edit.body.chat_id).toBe('4242');
    expect(edit.body.message_id).toBe(55);
    expect(String(edit.body.text)).toContain('approved');
    expect(edit.body).not.toHaveProperty('reply_markup');
    const note = sent.find((s) => s.method === 'sendMessage')!;
    expect(note.body.chat_id).toBe('777');
    expect(String(note.body.text)).toContain('Your Pro was extended to');
    expect(pushed).toHaveLength(0);
  });

  it('rejects without granting and tells the user', async () => {
    const { id, payer } = await scene({ payerChat: '777' });
    await hook(tap(`upi:r:${id}`));
    const p = await status(id);
    expect(p.status).toBe('rejected');
    expect(p.decidedBy).toBe('telegram:4242');
    expect(await proEnd(payer.id)).toBeNull();
    expect(answers()[0]!.body.text).toBe('Rejected');
    expect(String(sent.find((s) => s.method === 'sendMessage')!.body.text)).toContain(
      'could not be verified',
    );
  });

  it('falls back to web push when the user has no Telegram', async () => {
    const { id } = await scene({ payerPush: true });
    await hook(tap(`upi:a:${id}`));
    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.endpoint).toBe('https://push.example/1');
    expect(sent.some((s) => s.method === 'sendMessage')).toBe(false);
  });

  it('a second tap says already decided and grants nothing more', async () => {
    const { id, payer } = await scene();
    await hook(tap(`upi:a:${id}`));
    const end = await proEnd(payer.id);
    sent = [];
    await hook(tap(`upi:a:${id}`));
    await hook(tap(`upi:r:${id}`));
    expect(answers().map((a) => a.body.text)).toEqual(['Already decided', 'Already decided']);
    expect(await proEnd(payer.id)).toEqual(end);
    expect((await status(id)).status).toBe('approved');
    expect(sent.filter((s) => s.method !== 'answerCallbackQuery')).toHaveLength(0);
  });

  it('refuses a tap from a non-admin chat or sender and changes nothing', async () => {
    const { id, payer } = await scene();
    const cases = [
      tap(`upi:a:${id}`, { from: 9, chat: 9 }), // someone else in their own chat
      tap(`upi:a:${id}`, { from: 9, chat: 4242 }), // someone else tapping in the admin chat
      tap(`upi:a:${id}`, { from: 4242, chat: -100 }), // admin id, but from another chat
      tap(`upi:a:${id}`, { noMessage: true }), // no message to check the chat of
    ];
    for (const c of cases) {
      sent = [];
      expect((await hook(c)).status).toBe(200);
      expect(answers().map((a) => a.body.text)).toEqual(['Not allowed']);
      expect(sent).toHaveLength(1);
    }
    expect((await status(id)).status).toBe('pending');
    expect(await proEnd(payer.id)).toBeNull();
  });

  it('refuses everyone when no admin chat is known', async () => {
    const payer = await signUp(ctx.app, 'payer@example.com');
    const res = await createPayment(ctx.db, payer.id, 'p30', '123456789012', 'note');
    if (!res.ok) throw new Error('payment');
    await hook(tap(`upi:a:${res.id}`));
    expect(answers().map((a) => a.body.text)).toEqual(['Not allowed']);
    expect((await status(res.id)).status).toBe('pending');
  });

  it('answers and ignores unknown or malformed data', async () => {
    const { id } = await scene();
    for (const data of [
      undefined,
      'nope',
      `upi:x:${id}`,
      'upi:a:not-a-uuid',
      `upi:a:${id}x`,
      `UPI:A:${id}`,
    ]) {
      sent = [];
      expect((await hook(tap(data))).status).toBe(200);
      expect(answers().map((a) => a.body.text)).toEqual(['Unknown action']);
    }
    sent = [];
    await hook(tap('upi:a:00000000-0000-0000-0000-000000000000'));
    expect(answers().map((a) => a.body.text)).toEqual(['Already decided']);
    expect((await status(id)).status).toBe('pending');
  });
});
