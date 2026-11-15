import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { createFetch, editMessageText } from '@radar/core';
import { approvePayment, listPayments, rejectPayment, schema } from '@radar/db';
import type { AppVars, RouteDeps } from '../app.js';
import { parseQuery } from '../http.js';
import { requireAdmin, requireAuth } from '../middleware.js';
import { adminChatIds, decidedAlertText, notifyUserDecision } from '../payments/notify.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ListQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending'),
});

/** Admin-only payment review: list payments and approve or reject a pending one. */
export function adminRoutes(deps: RouteDeps) {
  const { db, env } = deps;
  const r = new Hono<AppVars>();
  r.use('*', requireAuth(deps));
  r.use('*', requireAdmin(deps));

  r.get('/payments', async (c) => {
    const { status } = parseQuery(c, ListQuery);
    const rows = await listPayments(db, status === 'all' ? {} : { status });
    const ids = [...new Set(rows.map((p) => p.userId))];
    const users = ids.length
      ? await db
          .select({ id: schema.user.id, email: schema.user.email })
          .from(schema.user)
          .where(inArray(schema.user.id, ids))
      : [];
    const emails = new Map(users.map((u) => [u.id, u.email]));
    return c.json({
      payments: rows.map((p) => ({
        id: p.id,
        userId: p.userId,
        email: emails.get(p.userId) ?? null,
        passId: p.passId,
        days: p.days,
        amount: p.amount,
        provider: p.provider,
        utr: p.utr,
        note: p.note,
        status: p.status,
        createdAt: p.createdAt,
        decidedAt: p.decidedAt,
        decidedBy: p.decidedBy,
      })),
    });
  });

  /** 404 for an unknown payment, 409 when it was already decided. */
  async function notDecidable(id: string): Promise<never> {
    const [row] = UUID_RE.test(id)
      ? await db
          .select({ id: schema.payment.id })
          .from(schema.payment)
          .where(eq(schema.payment.id, id))
      : [];
    if (!row) throw new HTTPException(404, { message: 'payment not found' });
    throw new HTTPException(409, { message: 'payment already decided' });
  }

  /** Edits the admin's Telegram alert so its buttons go away. Never throws. */
  async function updateAlert(
    id: string,
    outcome: 'approved' | 'rejected',
    decidedBy: string,
    until: Date | null,
  ): Promise<void> {
    try {
      const token = env.TELEGRAM_BOT_TOKEN;
      if (!token) return;
      const [row] = await db
        .select({
          email: schema.user.email,
          days: schema.payment.days,
          amount: schema.payment.amount,
          utr: schema.payment.utr,
          messageId: schema.payment.telegramMessageId,
        })
        .from(schema.payment)
        .innerJoin(schema.user, eq(schema.user.id, schema.payment.userId))
        .where(eq(schema.payment.id, id));
      if (!row || row.messageId === null) return;
      const [chat] = await adminChatIds(db, env);
      if (!chat) return;
      await editMessageText(
        deps.net?.fetch ?? createFetch(10_000),
        token,
        chat,
        row.messageId,
        decidedAlertText(row, outcome, decidedBy, until),
      );
    } catch (e) {
      console.error(`admin alert edit failed: ${(e as Error).message}`);
    }
  }

  r.post('/payments/:id/approve', async (c) => {
    const id = c.req.param('id');
    const adminId = c.get('user').id;
    const until = await approvePayment(db, id, adminId);
    if (!until) return notDecidable(id);
    await updateAlert(id, 'approved', adminId, until);
    await notifyUserDecision(deps, id, 'approved', until);
    return c.json({ id, status: 'approved' as const, currentPeriodEnd: until });
  });

  r.post('/payments/:id/reject', async (c) => {
    const id = c.req.param('id');
    const adminId = c.get('user').id;
    if (!(await rejectPayment(db, id, adminId))) return notDecidable(id);
    await updateAlert(id, 'rejected', adminId, null);
    await notifyUserDecision(deps, id, 'rejected');
    return c.json({ id, status: 'rejected' as const });
  });

  return r;
}
