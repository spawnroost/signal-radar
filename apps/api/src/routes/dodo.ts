import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { createFetch, type Currency } from '@radar/core';
import {
  createDodoPayment,
  markDodoFailed,
  markDodoPaid,
  markDodoRefunded,
  schema,
} from '@radar/db';
import type { AppVars, RouteDeps } from '../app.js';
import type { ApiEnv } from '../env.js';
import { parseBody } from '../http.js';
import { requireAuth } from '../middleware.js';
import { notifyAdminInfo } from '../payments/notify.js';
import { ORDERS_PER_MINUTE } from './billing.js';
import { createLimiter } from './search.js';

const UNAVAILABLE = "Payments aren't set up";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Standard Webhooks: reject a timestamp further than this from now (seconds). */
const TOLERANCE_S = 300;
const BASES = {
  test_mode: 'https://test.dodopayments.com',
  live_mode: 'https://live.dodopayments.com',
} as const;

const CheckoutBody = z.object({
  passId: z.enum(['p30', 'p90', 'p365']),
  currency: z.enum(['INR', 'USD']),
});

const SessionResponse = z.object({ checkout_url: z.string().url() });

type Pass = 'p30' | 'p90' | 'p365';

interface DodoConfig {
  apiKey: string;
  webhookKey: string;
  base: string;
  products: Record<Pass, string>;
}

function dodoConfig(env: ApiEnv): DodoConfig | null {
  const { DODO_PAYMENTS_API_KEY: apiKey, DODO_PAYMENTS_WEBHOOK_KEY: webhookKey } = env;
  const { DODO_PRODUCT_30: p30, DODO_PRODUCT_90: p90, DODO_PRODUCT_365: p365 } = env;
  if (!apiKey || !webhookKey || !p30 || !p90 || !p365) return null;
  return {
    apiKey,
    webhookKey,
    base: BASES[env.DODO_PAYMENTS_ENVIRONMENT],
    products: { p30, p90, p365 },
  };
}

/**
 * Standard Webhooks check: HMAC-SHA256 (key = base64 after `whsec_`) over `id.timestamp.body`; the
 * header holds space-separated `v1,<base64>` signatures and any one may match. Constant-time compare.
 */
export function verifyDodoSignature(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  nowMs = Date.now(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  if (!/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > TOLERANCE_S) return false;
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
  let ok = false;
  for (const part of signature.split(' ')) {
    const [version, b64] = part.split(',');
    if (version !== 'v1' || !b64) continue;
    const given = Buffer.from(b64, 'base64');
    if (given.length === expected.length && timingSafeEqual(given, expected)) ok = true;
  }
  return ok;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Product ids a Dodo payment payload lists (`product_cart[].product_id`, or a top-level `product_id`). */
function payloadProductIds(data: Record<string, unknown>): string[] {
  const ids: string[] = [];
  if (Array.isArray(data.product_cart)) {
    for (const item of data.product_cart) {
      const id = str(rec(item).product_id);
      if (id) ids.push(id);
    }
  }
  const top = str(data.product_id);
  if (top) ids.push(top);
  return ids;
}

/**
 * Dodo Payments (hosted checkout): create a checkout session, report a payment's status to the return
 * page, and receive Dodo's signed webhooks (the only thing that grants Pro). Closed (503) until the
 * Dodo env is set.
 */
export function dodoRoutes(deps: RouteDeps) {
  const { db, env } = deps;
  const r = new Hono<AppVars>();
  const allowOrder = createLimiter(ORDERS_PER_MINUTE);
  const site = env.WEB_ORIGIN.replace(/\/+$/, '');

  r.use('*', async (_c, next) => {
    if (!dodoConfig(env)) throw new HTTPException(503, { message: UNAVAILABLE });
    await next();
  });
  r.use('/checkout', requireAuth(deps));
  r.use('/status/*', requireAuth(deps));

  r.post('/checkout', async (c) => {
    const cfg = dodoConfig(env)!;
    const user = c.get('user');
    if (!allowOrder(user.id)) {
      return c.json({ error: 'Too many attempts. Wait a moment and try again.' }, 429);
    }
    const { passId, currency } = await parseBody(c, CheckoutBody);
    const made = await createDodoPayment(db, user.id, passId, currency as Currency);
    if (!made.ok) {
      if (made.error === 'tooManyPending') {
        throw new HTTPException(429, {
          message: 'You already have checkouts in progress. Finish one or try again in an hour.',
        });
      }
      throw new HTTPException(400, { message: 'unknown pass' });
    }
    const fail = async (why: string): Promise<never> => {
      console.error(`dodo checkout failed: ${why}`);
      await markDodoFailed(db, made.id);
      throw new HTTPException(502, { message: "Couldn't start the payment. Try again shortly." });
    };
    let res: Response;
    try {
      res = await (deps.net?.fetch ?? createFetch(15_000))(`${cfg.base}/checkouts`, {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          product_cart: [{ product_id: cfg.products[passId], quantity: 1 }],
          customer: { email: user.email, name: user.name },
          billing_currency: currency,
          return_url: `${site}/billing/return?ref=${made.id}`,
          cancel_url: `${site}/pricing`,
          metadata: { payment_ref: made.id, user_id: user.id },
        }),
      });
    } catch (e) {
      return fail((e as Error).message);
    }
    if (!res.ok) return fail(`HTTP ${res.status}`);
    const parsed = SessionResponse.safeParse(await res.json().catch(() => null));
    if (!parsed.success) return fail('no checkout_url in response');
    return c.json({ checkoutUrl: parsed.data.checkout_url });
  });

  r.get('/status/:ref', async (c) => {
    const ref = c.req.param('ref');
    if (!UUID_RE.test(ref)) throw new HTTPException(404, { message: 'not found' });
    const user = c.get('user');
    const [row] = await db
      .select({ status: schema.payment.status })
      .from(schema.payment)
      .where(
        and(
          eq(schema.payment.id, ref),
          eq(schema.payment.userId, user.id),
          eq(schema.payment.provider, 'dodo'),
        ),
      );
    if (!row) throw new HTTPException(404, { message: 'not found' });
    const [sub] = await db
      .select({ end: schema.subscription.currentPeriodEnd })
      .from(schema.subscription)
      .where(eq(schema.subscription.userId, user.id));
    return c.json({ status: row.status, currentPeriodEnd: sub?.end ?? null });
  });

  // Dispute alerts have no row state to make them idempotent, so remember recent deliveries.
  const seenDisputes = new Set<string>();

  const ignored = (c: { json: (v: unknown) => Response }) => c.json({ ok: true, ignored: true });

  r.post('/webhook', async (c) => {
    const cfg = dodoConfig(env)!;
    const raw = await c.req.text();
    const h = c.req.raw.headers;
    const valid = verifyDodoSignature(
      cfg.webhookKey,
      {
        id: h.get('webhook-id'),
        timestamp: h.get('webhook-timestamp'),
        signature: h.get('webhook-signature'),
      },
      raw,
    );
    if (!valid) return c.json({ error: 'invalid signature' }, 401);

    let event: Record<string, unknown>;
    try {
      event = rec(JSON.parse(raw));
    } catch {
      return ignored(c);
    }
    const type = str(event.type);
    const data = rec(event.data);
    const dodoPaymentId = str(data.payment_id);
    const ref = str(rec(data.metadata).payment_ref);

    // Our row for a payment-level event: by our own ref, else by the stored Dodo payment id.
    const rowByDodoId = async () => {
      if (!dodoPaymentId) return null;
      const [row] = await db
        .select({ id: schema.payment.id })
        .from(schema.payment)
        .where(
          and(eq(schema.payment.provider, 'dodo'), eq(schema.payment.providerRef, dodoPaymentId)),
        );
      return row?.id ?? null;
    };

    switch (type) {
      case 'payment.succeeded': {
        if (!ref || !UUID_RE.test(ref) || !dodoPaymentId) return ignored(c);
        const [row] = await db
          .select({
            passId: schema.payment.passId,
            userId: schema.payment.userId,
            email: schema.user.email,
            days: schema.payment.days,
            amount: schema.payment.amount,
            note: schema.payment.note,
          })
          .from(schema.payment)
          .innerJoin(schema.user, eq(schema.user.id, schema.payment.userId))
          .where(and(eq(schema.payment.id, ref), eq(schema.payment.provider, 'dodo')));
        if (!row) return ignored(c);
        // The signed payload must be for the product this pass maps to (when it lists any).
        const ids = payloadProductIds(data);
        if (ids.length > 0 && !ids.includes(cfg.products[row.passId])) {
          console.error(`dodo webhook: product mismatch for payment ${ref} (${ids.join(',')})`);
          return ignored(c);
        }
        let until: Date | null;
        try {
          until = await markDodoPaid(db, ref, dodoPaymentId);
        } catch (e) {
          // e.g. this Dodo payment id is already on another row; do not loop Dodo's retries.
          console.error(`dodo webhook: grant failed for ${ref}: ${(e as Error).message}`);
          return ignored(c);
        }
        if (until) {
          const cur = str(data.currency) ?? row.note.split('-').pop() ?? '';
          await notifyAdminInfo(
            deps,
            [
              'Dodo payment received',
              `User: ${row.email}`,
              `Pass: ${row.days} days (${cur} ${row.amount / 100})`,
              `Pro until ${until.toISOString().slice(0, 10)}`,
            ].join('\n'),
          );
        }
        return c.json({ ok: true });
      }
      case 'payment.failed': {
        if (!ref) return ignored(c);
        await markDodoFailed(db, ref);
        return c.json({ ok: true });
      }
      case 'refund.succeeded': {
        const id = await rowByDodoId();
        if (!id) return ignored(c);
        if (await markDodoRefunded(db, id)) {
          await notifyAdminInfo(
            deps,
            `Dodo refund succeeded\nPayment: ${dodoPaymentId}\nOur ref: ${id}\nPro time was not removed; decide in the admin page.`,
          );
        }
        return c.json({ ok: true });
      }
      case 'dispute.opened': {
        const deliveryId = h.get('webhook-id') ?? '';
        if (seenDisputes.has(deliveryId)) return c.json({ ok: true });
        seenDisputes.add(deliveryId);
        if (seenDisputes.size > 500) seenDisputes.delete(seenDisputes.values().next().value!);
        const id = await rowByDodoId();
        await notifyAdminInfo(
          deps,
          `Dodo dispute opened\nPayment: ${dodoPaymentId ?? '-'}\nOur ref: ${id ?? 'unknown'}\nRespond in the Dodo dashboard within 10 days.`,
        );
        return c.json({ ok: true });
      }
      default:
        return ignored(c);
    }
  });

  return r;
}
