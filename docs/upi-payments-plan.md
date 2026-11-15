# Plan: replace Razorpay with direct UPI payments approved by an admin

Self-contained build brief. Work through "Build steps" in order, one commit per step. Do not skip the
constraints.

## Constraints (read first)

- **pnpm minimumReleaseAge**: never bypass it (no `--ignore-...`, no editing the setting). If `pnpm add`
  refuses a version as too new, pin an older version explicitly (`pnpm add qrcode@1.5.4`).
- **Commits**: no `Co-authored-by` trailers and no Claude/AI attribution in commit messages. Plain
  conventional-commit style like the existing log (`feat: ...`, `fix(web): ...`).
- **UI**: match the existing app (mobile-first PWA, 44px touch targets, existing CSS classes and tokens in
  `apps/web/src/styles.css`, no coloured borders, no gradients/glow, no emoji, no template "AI" look). Copy
  patterns from `apps/web/src/components/Pricing.tsx`, `SignInSheet.tsx`, `CustomizeSheet.tsx`, `Settings.tsx`.
  Dark/light theme follows the phone; test both.
- Keep each commit green: `pnpm lint && pnpm typecheck && pnpm test` (CI runs the same). DB tests are
  `describe.skipIf(!dbAvailable)`; run `pnpm db:up` first so they actually execute.
- Short, plain commit scope; do not refactor unrelated code.

## Product decisions (fixed)

- One-time payment, no auto-renew. Plans are the existing passes in `packages/core/src/passes.ts`:
  `p30` (30 days, INR 99), `p90` (90 days, INR 249), `p365` (365 days, INR 799). Amounts in the DB are in
  paise like `pass_purchase`. UPI is INR only; USD is no longer offered.
- User pays via `upi://pay?pa=<UPI_VPA>&pn=Signal%20Radar&am=<rupees>&cu=INR&tn=SR-<shortUserId>-<passId>`
  plus a QR of the same link, then submits the 12-digit UTR.
- UTR is unique across all payments (DB unique constraint); duplicate -> "already used" error.
- Pending payment -> Telegram alert to admin with inline Approve / Reject buttons. Admin web page does the
  same. Approve extends Pro by the pass days from current expiry if Pro is still running, else from now
  (`extendUntil` in `@radar/core` already does exactly this).
- Expiry reminder a few days (3) before Pro ends: Telegram if the user linked it, else web push if they
  have a push subscription. There is no email sending in signal-radar (see open questions).

## What mo-kalama does (source to port from, `/home/sambit/projects/mo-kalama`)

mo-kalama is Next.js + Postgres RLS; signal-radar is Hono + Vite SPA + drizzle without RLS. Port the
logic, not the framework code.

| mo-kalama file                    | Use                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/upi.ts`                      | Copy `normalizeUtr`, `isValidUtr`, `UTR_LENGTH`, `upiPayLink` (pure, encodes every value). Drop VPA-QR parsing (`parseUpiQr`) and writer-VPA handling, unless admin VPA validation is wanted (`UPI_RE`, `parseUpiId`).                                                                                                                                                                                                                                  |
| `lib/payments.ts` lines ~215-312  | `createUpiPayment` (UTR normalise, max-pending cap, unique-violation mapping via `uniqueConstraint()`, `utrUsed` error), `approvePayment`, `rejectPayment`. Re-implement against drizzle. Cap constant is `MAX_PENDING_PER_READER = 5` in `lib/payment-shared.ts` (use 3).                                                                                                                                                                              |
| `drizzle/0018_upi_approval.sql`   | Semantics only: approve is atomic, row-locked, idempotent (only a `pending` row moves), requires a UTR, grant happens in the same transaction. mo-kalama needs a SECURITY DEFINER SQL function only because of RLS; signal-radar has no RLS, so do it in a drizzle transaction (`SELECT ... FOR UPDATE`). Also `drizzle/0017_good_peter_quill.sql` line 3: CHECK `utr ~ '^[0-9]{12}$'`, and `drizzle/0000_schema.sql` line ~107: `payments_utr_unique`. |
| `app/pay/page.tsx` ~lines 140-210 | How the pay link is built and the QR is rendered (`qrcode` package `QRCode.toString(link, {type:'svg'})`, white quiet zone). `app/pay/pay-form.tsx` for the UTR form.                                                                                                                                                                                                                                                                                   |
| `app/admin/payments/page.tsx`     | Layout reference for the admin list (UTR column, status, amount).                                                                                                                                                                                                                                                                                                                                                                                       |
| `tests/payments.test.ts`          | Port: "order code, UTR and UPI link" block (~lines 152-175, UTR strip/validate and encoded link), duplicate-UTR and bad-UTR cases (~260-293), approve once / second approve is a no-op / reject grants nothing / approve after reject is false (~lines 352-490, `approvePayment`/`rejectPayment` tests), extension-from-current-expiry case (~390-440). Skip RLS, author, e-book, donation cases.                                                       |
| `tests/upi-gate.test.ts`          | Not needed (it is about writers needing a VPA).                                                                                                                                                                                                                                                                                                                                                                                                         |

## signal-radar facts the builder needs

- Monorepo (pnpm workspaces): `apps/api` (Hono, vitest), `apps/web` (Vite React SPA), `apps/cli`
  (`radar` CLI, `apps/cli/src/index.ts`), `packages/core`, `packages/db` (drizzle, `packages/db/src/schema.ts`,
  migrations `packages/db/drizzle/0000..0009`, generate with `pnpm db:generate`, apply with `pnpm db:migrate`).
- Entitlement: `subscription` table (`plan`, `status`, `currentPeriodEnd`, `provider`, `trialEndsAt`);
  `isPro()` in `apps/api/src/http.ts`; `userIsPro`/`requirePro`/`requireAuth` in `apps/api/src/middleware.ts`.
  `grantPass()` in `packages/db/src/store.ts` (lines ~17-77) is the Razorpay grant: marks `pass_purchase`
  paid and extends via `extendUntil` with a row lock. `SubscriptionProvider` type is in schema.ts line ~95.
- There is **no admin concept** today (no role column). Admin = emails listed in a new `ADMIN_EMAILS` env.
- Telegram: `packages/core/src/digest/telegram.ts` (`sendMessage` is text-only; private `postMessage`),
  webhook route `apps/api/src/routes/telegram.ts` (handles only `message`, secret-token header check, `/start`
  linking), CLI `radar telegram:webhook` in `apps/cli/src/index.ts` (~line 251; sets
  `allowed_updates: ['message']`). `user_config.telegram_chat_id` holds a user's linked chat.
  `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` already exist. `TELEGRAM_CHAT_ID` in `.env.example` is
  for single-user `--local` mode only; do not reuse it for the admin.
- Push: `packages/core/src/digest/push.ts` (`createPushSender(env)`, `sendPush(sender, subs, payload)`,
  `formatPush`), table `push_subscription`, route `apps/api/src/routes/push.ts`.
- Cron: `deploy/cron.sh` loops, runs `pnpm radar run` at `RADAR_AT` slots (UTC). `deploy/compose.yml` has
  `x-api-env` and `x-cron-env` blocks. Cron env already has `TELEGRAM_BOT_TOKEN`, VAPID keys, `WEB_ORIGIN`.
- Test helpers: `apps/api/test/helpers.ts` (`setup`, `signUp`, `call`, `dbAvailable`), model new API tests
  on `apps/api/test/billing.test.ts`; DB store tests in `packages/db/test/store.test.ts`; core tests in
  `packages/core/test/`; web logic tests in `apps/web/test/`.
- Rate limiter: `createLimiter(perMinute)` exported from `apps/api/src/routes/search.ts`.

## Razorpay: shelved, where it lives

Strategy: keep the code but make it unreachable and invisible. Do not delete (owner may revive it).

- `apps/api/src/routes/billing.ts`: `/order`, `/verify`, `/webhook` routes + helpers (`razorpayKeys`,
  `verifySignature`). They already return 503 when keys are unset. Leave in place, add a `SHELVED` comment.
  Keep `/passes`, `/checkout`, `/cancel` (dev stubs, blocked in production).
- `apps/api/src/env.ts`: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (keep optional).
- `packages/db/src/schema.ts`: `passPurchase` table (razorpay columns), `PassPurchaseStatus`;
  `packages/db/src/store.ts`: `grantPass`; migration `0008_big_rick_jones.sql`. Keep.
- `apps/web/src/lib/billing.ts`: `createOrder`, `loadCheckout`, `openCheckout`, `verifyPayment`,
  `CheckoutOptions`. Stop importing from `Pricing.tsx`; keep file with a `SHELVED` comment.
- `apps/web/src/components/Pricing.tsx`: `CHECKOUT_INK`, Razorpay checkout flow in `buy()` -> replaced.
- Tests `apps/api/test/billing.test.ts`, `packages/db/test/store.test.ts` (grantPass), keep passing.
- Env/deploy: `.env.example`, `deploy/env.example`, `deploy/compose.yml` (x-api-env), `deploy/README.md`,
  `deploy/Caddyfile.snippet`. In compose, drop the three `RAZORPAY_*` lines from the api env so the keys can
  never be set in production (this is what keeps the shelved routes dead). Keep them documented in the
  example files under a "shelved" comment.
- Copy mentioning Razorpay (rewrite for UPI): `apps/web/src/components/Legal.tsx` (lines ~62, 124, 170, 179),
  `apps/web/src/components/Pricing.tsx` (~306 FAQ "How do I pay?"), `apps/web/src/lib/site.ts` (~29),
  `radar.config.ts` comment on `internationalPayments`, `README.md`.

## Schema migration

Edit `packages/db/src/schema.ts`, then `pnpm db:generate` to produce `0010_*.sql` plus the snapshot; the
SQL it must produce is equivalent to:

```sql
-- Generic table (not UPI-only) so a second provider needs no table change.
CREATE TABLE "payment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "pass_id" text NOT NULL,
  "days" integer NOT NULL,
  "amount" integer NOT NULL,            -- paise, taken from PASSES server-side, never from the client
  "provider" text NOT NULL DEFAULT 'upi',     -- 'upi' | 'instamojo' (provider seam, see "Later: Instamojo")
  "provider_ref" text,                  -- gateway payment/request id (instamojo); null for upi
  "utr" text,                           -- required for provider 'upi', null otherwise
  "note" text NOT NULL,                 -- the tn= value, e.g. SR-A1B2C3-p30
  "status" text NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "decided_at" timestamptz,
  "decided_by" text,                    -- admin user id, or 'telegram:<chatId>'
  "telegram_message_id" integer,        -- admin alert, so it can be edited after a decision
  CONSTRAINT "payment_utr_unique" UNIQUE ("utr"),
  CONSTRAINT "payment_utr_format" CHECK ("utr" IS NULL OR "utr" ~ '^[0-9]{12}$'),
  CONSTRAINT "payment_upi_needs_utr" CHECK ("provider" <> 'upi' OR "utr" IS NOT NULL),
  CONSTRAINT "payment_provider_check" CHECK ("provider" IN ('upi','instamojo')),
  CONSTRAINT "payment_provider_ref_unique" UNIQUE ("provider", "provider_ref"),
  CONSTRAINT "payment_status_check" CHECK ("status" IN ('pending','approved','rejected'))
);
CREATE INDEX "payment_user_idx" ON "payment" ("user_id");
CREATE INDEX "payment_status_idx" ON "payment" ("status", "created_at");
-- Remember which expiry we already reminded about, so the reminder fires once per period.
ALTER TABLE "subscription" ADD COLUMN "expiry_reminder_for" timestamptz;
```

Also add `'upi'` and `'instamojo'` to the `SubscriptionProvider` union and export `UpiPaymentRow`/`NewUpiPaymentRow` types from
`packages/db/src/index.ts`. No backfill needed. The unique constraint is the duplicate-UTR guard; map
Postgres error 23505 with constraint name containing `utr` to a `utrUsed` result (see `uniqueConstraint()`
in mo-kalama `lib/payments.ts`; drizzle wraps the driver error, so check both `err.code` and `err.cause.code`).

## Env vars

Add to `apps/api/src/env.ts` (all optional strings), `.env.example`, `deploy/env.example`, and the
`x-api-env` block in `deploy/compose.yml`:

- `UPI_VPA` - receiving UPI ID, e.g. `name@bank`. Unset = UPI payments closed (Buy hidden, "Pro is coming
  soon" as today). Validate the shape with mo-kalama's `UPI_RE`.
- `UPI_PAYEE_NAME` - default `Signal Radar` (the `pn=` value).
- `ADMIN_EMAILS` - comma-separated, lowercase-compared against the session user's email.
- `TELEGRAM_ADMIN_CHAT_ID` - optional override. Default: the Telegram chat already linked (Settings ->
  Notifications -> Connect Telegram) to the user(s) in `ADMIN_EMAILS`, looked up from the DB. Alerts go
  there and only taps from those chat ids are honoured.
- Reminder (cron container, optional): `REMIND_AT` (default `09:00` UTC), `REMIND_DAYS` (default `3`).
  `TELEGRAM_BOT_TOKEN`, VAPID keys and `WEB_ORIGIN` are already in `x-cron-env`.

## Telegram callback handling

1. `packages/core/src/digest/telegram.ts`: add `sendMessageWithButtons(fetchFn, token, chatId, text,
buttons)` that returns the sent `message_id` (needs `reply_markup: {inline_keyboard: [[{text, callback_data}, ...]]}`;
   `postMessage` currently discards the response, so parse `result.message_id`), `answerCallbackQuery(fetchFn,
token, id, text)` and `editMessageText(fetchFn, token, chatId, messageId, text)` (omitting `reply_markup`
   removes the buttons). Callback data: `upi:a:<uuid>` / `upi:r:<uuid>` (42 bytes, under the 64-byte limit).
2. Alert text (plain, no emoji): `UPI payment pending`, user email, pass (`30 days, Rs 99`), UTR, note, and a
   link to `<WEB_ORIGIN>/admin`. Buttons "Approve" / "Reject". Store the returned message id in
   `payment.telegram_message_id`. A failure to alert never fails the user's submission (log it).
3. `apps/api/src/routes/telegram.ts`: extend the `Update` zod schema with
   `callback_query: {id, data?, from: {id}, message?: {message_id, chat: {id}}}`. Handle it before the
   `message` branch (the existing early return needs `message` text). Rules:
   - Webhook secret check stays first and unchanged.
   - If `TELEGRAM_ADMIN_CHAT_ID` is unset or `String(callback.from.id) !== TELEGRAM_ADMIN_CHAT_ID` ->
     `answerCallbackQuery("Not allowed")`, do nothing.
   - Parse `data` with `/^upi:([ar]):([0-9a-f-]{36})$/`; otherwise answer and ignore.
   - Call the same DB functions as the web admin (`approvePayment` / `rejectPayment`, decidedBy
     `telegram:<id>`). Approve of an already-decided payment returns false -> answer "Already handled".
   - On success: `answerCallbackQuery("Approved"/"Rejected")`, `editMessageText` to append the decision and
     drop the buttons, then notify the user (Telegram if linked, else push) "Your Pro was extended to <date>"
     or "Your payment could not be verified".
   - Always return HTTP 200.
4. `apps/cli/src/index.ts` `cmdTelegramWebhook`: change `allowed_updates` to `['message', 'callback_query']`.
   **Owner step after deploy**: rerun `radar telegram:webhook <publicBaseUrl>` once, otherwise button taps never
   arrive.

## New and changed files

New:

- `packages/core/src/upi.ts` (+ export from `packages/core/src/index.ts`): `normalizeUtr`, `isValidUtr`,
  `upiPayLink` (amount as rupees, e.g. `99` or `99.00`; build from paise), `shortUserId(id)` (first 6 chars
  uppercased, strip non-alphanumerics), `upiNote(userId, passId)` -> `SR-<short>-<passId>`.
- `packages/db/src/upi.ts` (export from `index.ts`): `createPayment(db, userId, passId, rawUtr, note, now)`,
  `approvePayment(db, id, decidedBy, now)`, `rejectPayment(db, id, decidedBy, now)`, `listPayments(db,
{status?, userId?})`. Approve = one transaction: `SELECT ... FOR UPDATE` the payment; if not `pending`
  return null; set `approved`, `decided_at/by`; lock the `subscription` row; `extendUntil(currentPeriodEnd, now,
days)`; upsert subscription `{plan:'pro', status:'active', provider:'upi', currentPeriodEnd}`; return the
  new end. Put the grant itself in ONE exported function `grantPayment(tx, paymentId, decidedBy, now)`
  (lock row, only `pending` -> `approved`, extend subscription with `provider` copied from the payment row);
  `approvePayment` (admin web + Telegram) calls it, and a future webhook calls the same function. Nothing else
  may write `subscription.currentPeriodEnd` for purchases. Reject: `UPDATE ... WHERE id=? AND status='pending'`, returns boolean. Extract the shared
  "extend subscription" part of `grantPass` into a helper used by both (keep `grantPass` behaviour and its
  tests unchanged). Trial note: `grantPass` ignores `trialEndsAt`, so a trialing user loses the rest of the
  trial when paying although the Pricing page says a pass "starts where the trial stops". In the shared
  helper use base = later of `currentPeriodEnd` and (if `status='trialing'`) `trialEndsAt`; add a test.
- `apps/api/src/routes/upi.ts`, mounted at `/api/upi` in `apps/api/src/app.ts`:
  - `GET /link?passId=p30` (auth) -> `{ link, vpa, name, amount (rupees), days, note }`; 503 when `UPI_VPA` unset.
  - `POST /submit` (auth, body `{passId, utr}`, zod) -> 201 `{id, status:'pending'}`; 400 bad UTR
    ("UTR must be 12 digits"), 409 "That UTR was already used", 429 when 3 pending exist or limiter trips.
    Amount/days come from `PASSES` server-side. After insert, fire the admin Telegram alert (non-blocking
    for the response result, but awaited with try/catch so tests can assert it).
  - `GET /mine` (auth) -> recent payments of the user with status and decision time.
- `apps/api/src/routes/admin.ts`, mounted at `/api/admin`: `requireAdmin` middleware (new, in
  `apps/api/src/middleware.ts`, email in `ADMIN_EMAILS` else 404/403). `GET /payments?status=pending|all`,
  `POST /payments/:id/approve`, `POST /payments/:id/reject` (approve returns new `currentPeriodEnd`; 409 if
  already decided). Share the decide-and-notify code with the Telegram handler in
  `apps/api/src/payments/notify.ts` (`notifyAdminPending`, `notifyUserDecision`; uses `deps.net?.fetch ??
createFetch(10_000)`, `createPushSender(env)` for push fallback).
- `GET /api/me` (`apps/api/src/routes/me.ts`): add `isAdmin` boolean; web `apps/web/src/lib/me.ts` type too.
- `/api/billing/passes` (`billing.ts`): add `upi: Boolean(env.UPI_VPA)` to the response; keep the rest so the
  shelved Razorpay tests still pass.
- Web: `apps/web/src/lib/upi.ts` (API client: `fetchUpiLink`, `submitUtr`, `fetchMyPayments`),
  `apps/web/src/components/UpiPay.tsx` (the pay sheet), `apps/web/src/components/AdminPayments.tsx`
  (admin page), route `admin` added to `RouteName`/`PATHS` in `apps/web/src/lib/route.ts` (and its prerender
  exclusion in `apps/web/build/prerender.ts` / sitemap if routes are enumerated there), link to Admin in
  `AccountMenu.tsx` only when `me.isAdmin`.
- Web deps: `qrcode` + `@types/qrcode` (dev) in `apps/web` only. mo-kalama pins `qrcode ^1.5.4`,
  `@types/qrcode ^1.5.6`; respect minimumReleaseAge. Load it with a dynamic `import('qrcode')` inside the
  sheet so the main bundle does not grow; render the SVG string into a white rounded square with a quiet zone.
- Reminder: `packages/db/src/upi.ts` `findExpiringPro(db, now, days)` and `markReminded(db, userId, end)`;
  `apps/cli/src/index.ts` new `radar remind [--days N] [--dry-run]`; `deploy/cron.sh` new daily slot.

Changed:

- `apps/web/src/components/Pricing.tsx`: remove Razorpay `buy()` flow, `loadCheckout/openCheckout`, USD toggle
  and `CHECKOUT_INK`; tapping a pass (signed in) opens `UpiPay`; signed out keeps the existing gate. FAQ copy.
- `apps/web/src/lib/payments.ts`: `usePaymentsOpen` reads `info.upi` instead of `info.enabled`.
- `apps/web/src/components/PlanLine.tsx` / `apps/web/src/lib/plan.ts`: if the user has a pending payment show
  "Payment waiting for approval" (use `/api/upi/mine`, or add `pendingPayment` to `/api/me`).
- `apps/web/src/components/Legal.tsx`, `site.ts`, `README.md`, `radar.config.ts`: UPI wording; refunds are
  handled manually (see open questions).
- Env/deploy files listed above.

## The UpiPay sheet (UX)

Opens from a pass card. Content, top to bottom: pass name and price ("30 days of Pro, Rs 99"); primary button
"Pay with UPI app" (an `<a href={link}>`, shown first on mobile); QR of the same link (hidden by default on
phones behind "Show QR", visible on wider screens) with the VPA below and a Copy button; short text "After
paying, enter the 12-digit UTR from your UPI app"; one UTR input (`inputMode="numeric"`, spaces stripped,
shows "12 digits" inline error), primary button "I have paid"; on success a calm "Sent. We will approve it
shortly, usually within a few hours." state. 409 shows "That reference was already used." Reuse existing
sheet, button, input and error-text classes; no new colour accents.

## Reminder job

- `findExpiringPro(db, now, days)`: subscriptions with `plan='pro'`, `status IN ('active','canceled')`,
  `current_period_end` between `now` and `now + days`, and (`expiry_reminder_for IS NULL OR
expiry_reminder_for <> current_period_end`). Trials (`status='trialing'`) are excluded.
- `radar remind`: for each row, send text "Your Signal Radar Pro ends on <date>. Add days at
  <WEB_ORIGIN>/pricing" to `user_config.telegram_chat_id` via `sendMessage` if set; else push via
  `createPushSender` + `sendPush` to that user's `push_subscription` rows (delete `gone` endpoints as the
  existing run code does). Only if something was actually delivered, set `expiry_reminder_for =
current_period_end`. Paying again changes `current_period_end`, so the next period gets a fresh reminder.
- `deploy/cron.sh`: add `REMIND_AT` (default `09:00`) handled like `RADAR_AT`:
  `pnpm radar remind || log "remind failed"`. Add the var to compose cron env and `deploy/README.md`.

## Tests

Port or write (all DB ones use the existing `dbAvailable` skip):

- `packages/core/test/upi.test.ts`: `normalizeUtr` (spaces stripped; 11 digits, letters, dashes -> `""`),
  `upiPayLink` (exact string for known inputs, encoding of `@` and spaces, `am` formatting), `upiNote`.
  (Port from mo-kalama `tests/payments.test.ts` ~152-175.)
- `packages/db/test/upi.test.ts`: create pending; duplicate UTR (any user) -> `utrUsed`; bad UTR; pending cap;
  approve from now when no Pro; approve extends from current expiry when Pro active; approve after lapse
  starts from now; trial remainder preserved; second approve is a no-op (days added once); reject grants
  nothing; approve after reject false; concurrent approvals add days once (`Promise.all`). Port the shapes
  from mo-kalama `tests/payments.test.ts` ~260-293 and ~352-490.
- `apps/api/test/upi.test.ts`: `/api/upi/link` 503 without VPA, correct link with VPA; submit 401 unauth,
  201 ok, 409 dup UTR, 400 bad UTR, amount ignores any client value; admin routes 403/404 for non-admin,
  approve/reject for admin and subscription actually Pro afterwards (`/api/me` `isPro`).
- `apps/api/test/telegram.test.ts` (extend or new): callback from admin chat approves and calls
  `answerCallbackQuery` + `editMessageText` (use the injected `net.fetch` recorder like billing.test.ts);
  callback from another chat id is refused and changes nothing; bad `data` ignored; wrong webhook secret 401;
  already-handled answers "Already handled"; submit sends the alert with both buttons and stores the message id.
- `packages/core/test/digest.test.ts`: `sendMessageWithButtons` payload shape.
- Reminder: DB test for `findExpiringPro` (inside window, outside window, already reminded, renewed ->
  reminded again, trialing excluded) and a CLI-level test with a fake fetch/push sender for Telegram-first,
  push fallback, nothing-delivered-so-not-marked.
- Web: route test for `admin` path (`apps/web/test/`), plan-line text for pending payment, UTR normaliser if
  duplicated client-side (prefer importing from `@radar/core`).
- Existing `apps/api/test/billing.test.ts` and `packages/db/test/store.test.ts` must stay green untouched.

## Build steps (one commit each)

1. `feat(core): UPI helpers` - `packages/core/src/upi.ts`, export, tests.
2. `feat(db): payment table` - schema, `SubscriptionProvider` += `'upi'`, `expiry_reminder_for`,
   generated migration + snapshot, row type exports.
3. `feat(db): create, approve and reject UPI payments` - `packages/db/src/upi.ts`, shared extend helper
   (keep `grantPass` tests green), trial-aware base, tests.
4. `feat(api): UPI and admin env, requireAdmin` - env schema, `.env.example`, `deploy/env.example`,
   compose api env (add UPI/ADMIN vars, remove `RAZORPAY_*`), `requireAdmin`, `isAdmin` on `/api/me`, test.
5. `feat(api): UPI link and submit endpoints` - `routes/upi.ts`, mount, `/passes` `upi` flag, tests (no
   Telegram yet).
6. `feat(core): Telegram inline buttons` - `sendMessageWithButtons`, `answerCallbackQuery`,
   `editMessageText`, tests.
7. `feat(api): alert the admin on Telegram for a pending payment` - `payments/notify.ts`, hook into submit,
   store message id, tests.
8. `feat(api): approve or reject from Telegram` - callback handling in `routes/telegram.ts`, user
   notification, CLI `allowed_updates`, tests.
9. `feat(api): admin payments endpoints` - `routes/admin.ts`, tests.
10. `feat(web): pay with UPI sheet` - `lib/upi.ts`, `UpiPay.tsx`, `qrcode` dep, `Pricing.tsx` rewired,
    `usePaymentsOpen` -> `upi`, SHELVED comment in `lib/billing.ts`, pending state in `PlanLine`. Check on a
    375px viewport in light and dark.
11. `feat(web): admin payments page` - route, `AdminPayments.tsx`, `AccountMenu` link for admins, route test.
12. `feat: expiry reminder` - `findExpiringPro`/`markReminded`, `radar remind`, `cron.sh`, compose/README,
    tests.
13. `docs: UPI copy and shelve Razorpay` - `Legal.tsx`, Pricing FAQ, `site.ts`, `README.md`,
    `radar.config.ts`, `deploy/README.md` (owner steps below), SHELVED comments in `billing.ts`.
14. Final check: `pnpm lint && pnpm typecheck && pnpm test` with the DB up, manual end-to-end locally
    (submit as a user, approve via the admin page, approve via a faked Telegram callback, confirm `/api/me`
    shows Pro until the right date), then a short owner checklist.

## Owner steps after deploy (put in `deploy/README.md`)

Set `UPI_VPA`, `ADMIN_EMAILS`, `TELEGRAM_ADMIN_CHAT_ID` (message the bot, read your chat id from
`getUpdates` or any "id" bot) in the server `.env`; run `ship.sh`; rerun `radar telegram:webhook
<publicBaseUrl>`; make a real INR 1 test payment... only if a test pass exists, otherwise a 99 pass and
refund yourself.

## Later: Instamojo (do not build now)

Second payment method, one-time payments only (no recurring). The seam is the `payment.provider` column and
the single `grantPayment()` function; do not add provider branching elsewhere.

- Webhook route: new `apps/api/src/routes/instamojo.ts` mounted at `/api/instamojo` (`POST /webhook`),
  alongside `billing.ts`/`telegram.ts` in `apps/api/src/app.ts`. It verifies Instamojo's signature (HMAC with
  the salt) on the raw body before parsing, finds the `payment` row by `provider='instamojo'` and
  `provider_ref`, checks status and amount match, then calls `grantPayment()` (idempotent). Add the route to
  `deploy/Caddyfile.snippet` only if the path needs special handling.
- Checkout start: `POST /api/instamojo/order` (auth, `{passId}`) inserts a `pending` row (`provider='instamojo'`,
  amount from `PASSES`, `utr` null), creates the Instamojo payment request via their API
  (`deps.net?.fetch ?? createFetch(10_000)`), stores `provider_ref`, returns the hosted checkout URL.
- Env vars (optional; unset = button hidden): `INSTAMOJO_CLIENT_ID`, `INSTAMOJO_CLIENT_SECRET`,
  `INSTAMOJO_SALT` (webhook signature). Add to `env.ts`, `.env.example`, `deploy/env.example`, compose api env.
- Checkout button: in `apps/web/src/components/UpiPay.tsx` (rename to a pay sheet if it grows) add a second
  option "Pay by card or netbanking" shown when `/api/billing/passes` reports `instamojo: true`; it calls the
  order endpoint and redirects to the returned URL; the return page just refreshes `/api/me`. Client web code
  in `apps/web/src/lib/` next to `upi.ts`.
- Admin page/Telegram: list rows by provider; Instamojo rows are auto-approved by webhook so they never
  alert the admin (optionally a "paid" notice). Reminder job already works since it reads `subscription`.
- Tests then: webhook with bad signature 401, good signature grants once, replay is a no-op, amount mismatch
  refused.
- Open: Instamojo account/API version, fees, whether INR only.

## Risks

- Manual approval means a user can submit a fake UTR; the admin must confirm the credit in their UPI app
  before approving (alert text should say so). UTR uniqueness only stops reuse, not invention.
- Telegram buttons stop working until the webhook is re-registered with `callback_query` allowed.
- If Razorpay env keys are ever set again, the shelved routes grant Pro without admin involvement; keep them
  out of compose.
- `upi://` links do not open on desktop; the QR and copyable VPA cover that.
- UPI `tn` and `am` handling differs slightly by app; keep `am` as plain decimal rupees and test with two
  apps.
- Admin identity rests on `ADMIN_EMAILS`; confirm sign-in verifies emails for the providers in use.

## Owner answers (2026-11-15)

1. `UPI_VPA`: the owner's PhonePe UPI ID; value goes in the server `.env` only, not in the repo.
2. Prices: keep INR 99 / 249 / 799 for 30 / 90 / 365 days.
3. `ADMIN_EMAILS`: the owner's login email, server `.env` only. Admin Telegram: use the owner's already
   linked chat (see Env vars), no chat id needed.
4. Users with neither Telegram nor push: skip for now. Email (Resend) may come later as its own step.
5. Reminder lead time: 3 days.
6. Refund wording: "refunded manually to your UPI ID".
7. Turnaround text: "usually within a few hours".
8. Rejected payments can be resubmitted with a new UTR (the old UTR stays used).
9. Keep the dev stub routes, dev only.
