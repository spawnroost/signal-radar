# Dodo Payments migration

Decided 2026-11-18: replace the direct-UPI flow with Dodo Payments (merchant of record).
One-time passes, no auto-renew. Buying again adds days to the end (same rule as today).

## Dodo setup (test mode, created 2026-11-18)

Brand: Spawnroost (bus_0NsCLcVqJmkRC3wkAnmhz), site signalradar.spawnroost.com.
Each product has a USD base price and an INR localized price (pricing_mode by_currency).
Product metadata: pass_days, app=signal-radar.

| Pass    | Test product id            | USD   | INR  |
|---------|----------------------------|-------|------|
| 30 days | pdt_0NsCPFRsnpRSmLKfirRiX  | $3    | ₹149 |
| 90 days | pdt_0NsCPFU74tpvGiWaZgA1T  | $7    | ₹349 |
| 1 year  | pdt_0NsCPFWS6Jw0gyUrwfhuE  | $19   | ₹999 |

Prices raised 2026-11-18 to cover Dodo fees (~5.5% + ₹13/40c) and tax taken from tax-inclusive prices.
The app copy (apps/web/src/lib/tiers.ts, passes.ts) still shows the old prices: update in the build.

Live-mode products (created 2026-11-19): 30 days pdt_0NsHXU4cvF1v4e2pKSEZ5, 90 days pdt_0NsHXU7vefyQ6nL4RCZY6, 1 year pdt_0NsHXUB6rV2BegT8jTcJf.

## Server env (keep out of the repo)

- DODO_PAYMENTS_API_KEY: test key from dashboard, Developer > API Keys
- DODO_PAYMENTS_WEBHOOK_KEY: signing secret of the webhook below
- DODO_PAYMENTS_ENVIRONMENT: test_mode (later live_mode)
- DODO_PRODUCT_30 / DODO_PRODUCT_90 / DODO_PRODUCT_365: product ids above

## Webhook (create in dashboard: the MCP connection has no webhook scope)

URL: https://signalradar.spawnroost.com/api/billing/dodo/webhook
Events: payment.succeeded, payment.failed, refund.succeeded, dispute.opened

## Code work (planned 2026-11-18, not started)

Reuse the `payment` table (packages/db/src/schema.ts:129): it already has `provider` +
`providerRef` with a unique (provider, provider_ref), and `grantPayment()` (packages/db/src/upi.ts)
already does the locked, idempotent pending -> approved + extendSubscription. No new table.
No SDK: plain fetch + node:crypto (avoids pnpm minimumReleaseAge trouble and a dependency).

### Step 1: core + db
- packages/core: PASSES prices -> 149/349/999 INR, 3/7/19 USD. Add `dodoProductId` lookup by
  pass id from env (keep env reading in api, core stays pure).
- schema: `PaymentProvider` add 'dodo'; check `payment_provider_check` -> ('upi','instamojo','dodo').
  `PaymentStatus` add 'failed' and 'refunded' if not present. New drizzle migration (drizzle-kit generate).
- db: `createDodoPayment(db, userId, passId, currency)` -> pending row, provider 'dodo',
  amount from PASSES in the chosen currency, note `SR-<short>-<pass>`.
  `markDodoPaid(db, ourId, dodoPaymentId)`: in one tx set providerRef, then grantPayment(tx, id, 'dodo').
  `markDodoFailed`, `markDodoRefunded` (status only; no Pro clawback, admin decides).
- tests in packages/db/test.

### Step 2: api (apps/api/src/routes/dodo.ts, mounted at /api/billing/dodo)
- env.ts: DODO_PAYMENTS_API_KEY, DODO_PAYMENTS_WEBHOOK_KEY, DODO_PAYMENTS_ENVIRONMENT
  (test_mode | live_mode), DODO_PRODUCT_30/90/365. Routes answer 503 when unset.
  Base URL: test_mode https://test.dodopayments.com, live_mode https://live.dodopayments.com.
- POST /checkout (auth, rate-limited like ORDERS_PER_MINUTE) body {passId, currency}:
  create pending row, then POST {base}/checkouts with
  product_cart [{product_id, quantity:1}], customer {email, name}, billing_currency,
  return_url `${SITE_URL}/billing/return?ref=<ourId>`, cancel_url `${SITE_URL}/pricing`,
  metadata {payment_ref: ourId, user_id}. Return {checkoutUrl}. Cap pending dodo rows per user (reuse MAX_PENDING_PER_USER, expire >1h old pending as 'failed').
- GET /status/:ref (auth, own rows only) -> {status, currentPeriodEnd}. Used by the return page.
- POST /webhook (no auth): read raw text, verify Standard Webhooks signature
  (headers webhook-id, webhook-timestamp, webhook-signature "v1,<b64>"; key = base64 after "whsec_";
  HMAC-SHA256 over `${id}.${ts}.${body}`; reject ts older than 5 min; timingSafeEqual).
  Confirm header/secret format with search_docs before coding.
  payment.succeeded: metadata.payment_ref -> row; check product_id matches row.passId; markDodoPaid.
  payment.failed -> markDodoFailed. refund.succeeded / dispute.opened -> mark + Telegram alert
  to admin (reuse apps/api/src/payments/notify.ts). Unknown ref or event -> 200 ignored.
  Always idempotent: repeat deliveries are no-ops.
- Telegram notify on a granted dodo payment (info only, no approve buttons).
- tests: apps/api/test/dodo.test.ts (fetch mocked; signature good/bad/stale; double delivery grants once;
  product mismatch ignored; status route only shows own rows).

### Step 3: web
- lib/payments.ts: `startCheckout(passId, currency)` -> POST, then `location.assign(checkoutUrl)`.
- Pricing.tsx / UpgradeLink: buttons call startCheckout; prices from tiers.ts/passes.ts (new prices).
- New BillingReturn screen at /billing/return: poll /status/:ref every 2s up to ~60s;
  approved -> "You're Pro until <date>"; failed -> retry link; still pending -> "We'll update when Dodo confirms".
- Legal.tsx: payments processed by Dodo Payments (merchant of record), refunds per Dodo policy.
- Settings.tsx: payment history from existing /mine-style list (keep UPI rows visible as history).

### Step 4: remove UPI flow
- Delete routes/upi.ts submit/link, UpiPay.tsx, web lib/upi.ts, core upi.ts helpers not used by history,
  Telegram approve/reject callbacks, AdminPayments approve/reject (keep read-only list), their tests.
- Keep the `utr` column and old rows (history). Keep shelved Razorpay code untouched.

### Step 5: deploy
- deploy/Caddyfile.snippet CSP: drop razorpay hosts. Checkout is a top-level redirect, so no
  Dodo hosts needed (add `form-action https://*.dodopayments.com` only if a form post is used).
- docker-compose: pass the DODO_* env vars to api.
- After deploy: create the webhook in the dashboard (URL above), set DODO_PAYMENTS_WEBHOOK_KEY, ship again,
  then a test-mode purchase end to end (card 4242 4242 4242 4242).

Progress: Steps 1-5 code done (uncommitted, 2026-11-18). Left: commit, ship, create webhook, set env on server, test purchase. Step 3 added `dodo: boolean` to GET /api/billing/passes.
Verify on the first test purchase: checkout metadata.payment_ref reaches the payment.succeeded payload, and where the
product id sits (code reads data.product_cart[].product_id or data.product_id; grants if neither is present).

Build order: 1 -> 2 -> 3 -> 4 -> 5, typecheck + tests after each. Suggested split: Sonnet builds
each step, Opus reviews the diff per step.

## Owner blockers (2026-11-18)

- Dodo business verification submitted for review 2026-11-18 (needed for live mode only).
- Webhook not created yet: create it when the webhook route is deployed (URL above), then add DODO_PAYMENTS_WEBHOOK_KEY.

## Temporary staging (for the Dodo test purchase)

Same VPS, separate compose project, DB and env; prod untouched. compose aliases are `${EDGE_ALIAS}-api/-web`.
1. DNS: A record signalradar-staging.spawnroost.com -> VPS IP (same as prod).
2. Server: /opt/signalradar-staging/.env from env.example with COMPOSE_PROJECT_NAME=signalradar-staging,
   EDGE_ALIAS=signalradar-staging, HOST_API_PORT=28787, HOST_WEB_PORT=28080, HOST_DB_PORT=25432,
   new POSTGRES_PASSWORD and BETTER_AUTH_SECRET, BETTER_AUTH_URL/WEB_ORIGIN/VITE_SITE_URL=https://signalradar-staging.spawnroost.com,
   DODO_* test values, ADMIN_EMAILS. Leave TELEGRAM_*, VAPID_*, OAuth empty (staging must not touch the prod bot webhook). chmod 600.
3. Edge Caddy (/srv/edge): site block signalradar-staging.spawnroost.com, /api/* -> signalradar-staging-api:8787,
   rest -> signalradar-staging-web:8080 (copy prod block + import signalradar_security), reload.
4. Ship: DEPLOY_HOST=<ip> DEPLOY_DIR=/opt/signalradar-staging VITE_SITE_URL=https://signalradar-staging.spawnroost.com deploy/ship.sh
5. Dodo test dashboard: webhook https://signalradar-staging.spawnroost.com/api/billing/dodo/webhook (4 events),
   put its secret in staging .env as DODO_PAYMENTS_WEBHOOK_KEY, `docker compose --env-file .env up -d api`.
6. Sign up on staging, buy 30-day pass with card 4242 4242 4242 4242, check /billing/return, then the webhook payload.
Status 2026-11-18: steps 1-4 done (DNS record id 530096d9aae74ed2cfb27fe631a72eb0, Caddy file /srv/edge/sites/signalradar.staging.caddy, must sort after signalradar.caddy). /api/billing/passes shows dodo:false until the webhook key is set.
Teardown: `docker compose --env-file .env down -v` in /opt/signalradar-staging, delete the Caddy file + reload (docker exec edge-caddy-1 caddy reload --config /etc/caddy/Caddyfile), DNS record, Dodo webhook.
