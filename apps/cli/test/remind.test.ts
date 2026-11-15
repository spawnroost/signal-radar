import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openTestDb, resetTestDb, testDbAvailable } from '@radar/db/testing';
import { findExpiringPro, markReminded, schema, type Db } from '@radar/db';
import { remindExpiring, reminderText, type RemindDeps } from '../src/remind.js';

const available = await testDbAvailable();

const NOW = new Date('2026-11-15T10:00:00Z');
const DAY = 86_400_000;
const in_ = (days: number) => new Date(NOW.getTime() + days * DAY);

describe.skipIf(!available)('expiry reminder', () => {
  let db: Db;
  beforeAll(async () => {
    db = await openTestDb();
  });
  afterAll(async () => {
    await db?.$client.end({ timeout: 1 });
  });
  beforeEach(async () => {
    await resetTestDb(db);
  });

  const addUser = async (
    id: string,
    sub: Partial<typeof schema.subscription.$inferInsert> | null,
    opts: { chat?: string; push?: boolean } = {},
  ) => {
    await db.insert(schema.user).values({ id, name: id, email: `${id}@example.com` });
    if (sub) {
      await db
        .insert(schema.subscription)
        .values({ userId: id, plan: 'pro', status: 'active', ...sub });
    }
    if (opts.chat) {
      await db.insert(schema.userConfig).values({ userId: id, telegramChatId: opts.chat });
    }
    if (opts.push) {
      await db.insert(schema.pushSubscription).values({
        userId: id,
        endpoint: `https://push.example/${id}`,
        keys: { p256dh: 'p', auth: 'a' },
      });
    }
  };

  const renew = (id: string, end: Date) =>
    db
      .update(schema.subscription)
      .set({ currentPeriodEnd: end })
      .where(eq(schema.subscription.userId, id));
  const reminded = async (id: string) =>
    (await db.select().from(schema.subscription).where(eq(schema.subscription.userId, id)))[0]
      ?.expiryReminderFor ?? null;

  describe('findExpiringPro', () => {
    it('picks only paid Pro ending inside the window', async () => {
      await addUser('in', { currentPeriodEnd: in_(2) });
      await addUser('edge', { currentPeriodEnd: in_(3) });
      await addUser('canceled', { status: 'canceled', currentPeriodEnd: in_(1) });
      await addUser('far', { currentPeriodEnd: in_(10) });
      await addUser('expired', { currentPeriodEnd: in_(-1) });
      await addUser('trial', { status: 'trialing', currentPeriodEnd: in_(1) });
      await addUser('free', { plan: 'free', status: 'none', currentPeriodEnd: in_(1) });
      await addUser('nosub', null);
      const rows = await findExpiringPro(db, NOW, 3);
      expect(rows.map((r) => r.userId)).toEqual(['canceled', 'in', 'edge']);
      expect(rows[0]).toMatchObject({ email: 'canceled@example.com' });
    });

    it('skips a reminded period but re-arms when the end date moves', async () => {
      await addUser('ann', { currentPeriodEnd: in_(2) });
      expect(await markReminded(db, 'ann', in_(2))).toBe(true);
      expect(await findExpiringPro(db, NOW, 3)).toEqual([]);
      await renew('ann', in_(2.5));
      expect(await findExpiringPro(db, NOW, 3)).toHaveLength(1);
    });

    it('markReminded is a no-op if the end moved since it was read', async () => {
      await addUser('ann', { currentPeriodEnd: in_(2) });
      await renew('ann', in_(30));
      expect(await markReminded(db, 'ann', in_(2))).toBe(false);
      expect(await reminded('ann')).toBeNull();
    });
  });

  describe('remindExpiring', () => {
    const setup = () => {
      const telegram: { chat: string; text: string }[] = [];
      const pushed: { endpoint: string; body: string }[] = [];
      const deps: RemindDeps = {
        webOrigin: 'https://radar.example.com/',
        telegramToken: 'tok',
        now: NOW,
        fetch: async (_url, init) => {
          const body = JSON.parse(String(init?.body)) as { chat_id: string; text: string };
          if (body.chat_id === 'bad') return new Response('{}', { status: 500 });
          telegram.push({ chat: body.chat_id, text: body.text });
          return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
        },
        push: async (sub, payload) => {
          if (sub.endpoint.endsWith('/gone'))
            throw Object.assign(new Error('gone'), { statusCode: 410 });
          pushed.push({ endpoint: sub.endpoint, body: payload });
        },
      };
      return { deps, telegram, pushed };
    };

    it('uses Telegram when linked, else push, and skips users with neither', async () => {
      await addUser('tg', { currentPeriodEnd: in_(2) }, { chat: '42', push: true });
      await addUser('pw', { currentPeriodEnd: in_(2) }, { push: true });
      await addUser('none', { currentPeriodEnd: in_(2) });
      const { deps, telegram, pushed } = setup();
      const res = await remindExpiring(db, deps);
      expect(res).toEqual({ due: 3, sent: 2, skipped: 1, failed: 0 });
      expect(telegram).toEqual([{ chat: '42', text: reminderText(in_(2), deps.webOrigin) }]);
      expect(telegram[0]?.text).toBe(
        'Your Signal Radar Pro ends on 2026-11-17. Add days at https://radar.example.com/pricing',
      );
      expect(pushed.map((p) => p.endpoint)).toEqual(['https://push.example/pw']);
      expect(await reminded('tg')).toEqual(in_(2));
      expect(await reminded('pw')).toEqual(in_(2));
      expect(await reminded('none')).toBeNull();
    });

    it('is idempotent: a second run sends nothing', async () => {
      await addUser('tg', { currentPeriodEnd: in_(2) }, { chat: '42' });
      const { deps, telegram } = setup();
      await remindExpiring(db, deps);
      const again = await remindExpiring(db, deps);
      expect(again).toEqual({ due: 0, sent: 0, skipped: 0, failed: 0 });
      expect(telegram).toHaveLength(1);
    });

    it('a failed send is not marked and does not stop the others', async () => {
      await addUser('a', { currentPeriodEnd: in_(1) }, { chat: 'bad' });
      await addUser('b', { currentPeriodEnd: in_(2) }, { chat: '7' });
      const { deps, telegram } = setup();
      const logs: string[] = [];
      deps.log = (m) => logs.push(m);
      const res = await remindExpiring(db, deps);
      expect(res).toMatchObject({ due: 2, sent: 1, failed: 1 });
      expect(telegram.map((t) => t.chat)).toEqual(['7']);
      expect(await reminded('a')).toBeNull();
      expect(await reminded('b')).toEqual(in_(2));
      expect(logs.join()).not.toContain('tok');
      // retried next run
      const retry = await remindExpiring(db, deps);
      expect(retry).toMatchObject({ due: 1, failed: 1 });
    });

    it('drops gone push endpoints and does not mark when nothing was delivered', async () => {
      await addUser('pw', { currentPeriodEnd: in_(2) }, {});
      await db.insert(schema.pushSubscription).values({
        userId: 'pw',
        endpoint: 'https://push.example/gone',
        keys: { p256dh: 'p', auth: 'a' },
      });
      const { deps } = setup();
      const res = await remindExpiring(db, deps);
      expect(res).toMatchObject({ sent: 0, skipped: 1 });
      expect(await reminded('pw')).toBeNull();
      expect(await db.select().from(schema.pushSubscription)).toHaveLength(0);
    });

    it('does not remind trials or expired Pro', async () => {
      await addUser('t', { status: 'trialing', currentPeriodEnd: in_(1) }, { chat: '1' });
      await addUser('e', { currentPeriodEnd: in_(-1) }, { chat: '2' });
      const { deps, telegram } = setup();
      expect((await remindExpiring(db, deps)).due).toBe(0);
      expect(telegram).toEqual([]);
    });
  });
});
