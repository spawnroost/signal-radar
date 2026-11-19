import { Hono } from 'hono';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import { listPayments, schema } from '@radar/db';
import type { AppVars, RouteDeps } from '../app.js';
import { parseQuery } from '../http.js';
import { requireAdmin, requireAuth } from '../middleware.js';

const ListQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'failed', 'refunded', 'all']).default('all'),
});

/** Admin-only, read-only payment list across every provider. */
export function adminRoutes(deps: RouteDeps) {
  const { db } = deps;
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

  return r;
}
