import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { PASSES, upiNote, upiPayLink } from '@radar/core';
import { createPayment, listPayments } from '@radar/db';
import type { AppVars, RouteDeps } from '../app.js';
import { parseBody, parseQuery } from '../http.js';
import { requireAuth } from '../middleware.js';
import { notifyAdminPending } from '../payments/notify.js';
import { createLimiter } from './search.js';

export const UPI_SUBMITS_PER_MINUTE = 10;
const UPI_UNAVAILABLE = "UPI payments aren't set up";

const PassId = z.enum(['p30', 'p90', 'p365']);
const LinkQuery = z.object({ passId: PassId });
const SubmitBody = z.object({ passId: PassId, utr: z.string().max(64) });

/** Direct UPI payments: build the pay link, record the UTR the user paid with, list their payments. */
export function upiRoutes(deps: RouteDeps) {
  const { db, env } = deps;
  const r = new Hono<AppVars>();
  const allowSubmit = createLimiter(UPI_SUBMITS_PER_MINUTE);

  // Closed (503) until UPI_VPA is set, before auth, so nothing leaks about the account.
  r.use('*', async (_c, next) => {
    if (!env.UPI_VPA) throw new HTTPException(503, { message: UPI_UNAVAILABLE });
    await next();
  });
  r.use('*', requireAuth(deps));

  r.get('/link', (c) => {
    const { passId } = parseQuery(c, LinkQuery);
    const pass = PASSES.find((p) => p.id === passId);
    if (!pass || !env.UPI_VPA) throw new HTTPException(400, { message: 'unknown pass' });
    const note = upiNote(c.get('user').id, pass.id);
    const link = upiPayLink({
      vpa: env.UPI_VPA,
      name: env.UPI_PAYEE_NAME,
      amountPaise: pass.inr,
      note,
    });
    return c.json({
      link,
      vpa: env.UPI_VPA,
      name: env.UPI_PAYEE_NAME,
      amount: pass.inr / 100,
      days: pass.days,
      note,
    });
  });

  r.post('/submit', async (c) => {
    const user = c.get('user');
    if (!allowSubmit(user.id)) {
      return c.json({ error: 'Too many attempts. Wait a moment and try again.' }, 429);
    }
    const { passId, utr } = await parseBody(c, SubmitBody);
    const result = await createPayment(db, user.id, passId, utr, upiNote(user.id, passId));
    if (!result.ok) {
      switch (result.error) {
        case 'utr':
          throw new HTTPException(400, { message: 'UTR must be 12 digits' });
        case 'passId':
          throw new HTTPException(400, { message: 'unknown pass' });
        case 'utrUsed':
          throw new HTTPException(409, { message: 'That UTR was already used' });
        case 'tooManyPending':
          throw new HTTPException(429, {
            message: 'You already have payments waiting for approval',
          });
      }
    }
    // Never throws: a Telegram failure is logged inside and the submit still succeeds.
    await notifyAdminPending(deps, result.id);
    return c.json({ id: result.id, status: 'pending' as const }, 201);
  });

  r.get('/mine', async (c) => {
    const rows = await listPayments(db, { userId: c.get('user').id, limit: 20 });
    return c.json({
      payments: rows.map((p) => ({
        id: p.id,
        passId: p.passId,
        days: p.days,
        amount: p.amount,
        status: p.status,
        createdAt: p.createdAt,
        decidedAt: p.decidedAt,
      })),
    });
  });

  return r;
}
