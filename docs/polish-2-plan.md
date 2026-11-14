# Polish 2 (plan)

Read the relevant code before changing it. UI rules: hand-crafted, mobile-first, matches the existing
look (serif titles, sans UI, light theme default); no colored-border cards, no generic AI-looking UI.

## 1. Sign-in: Google + GitHub only

- Add GitHub as a Better Auth social provider exactly like the existing (uncommitted) Google one:
  on only when `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` are set (zod env, `.env.example` with the
  callback URL `<BETTER_AUTH_URL>/api/auth/callback/github`, README env table). Trusted for account linking.
  Extend the existing "which providers are on" check the web uses (`googleEnabled`) to cover both.
- Email + password is on only when NO social provider is configured (no Google and no GitHub keys).
  Once at least one provider is configured it is off in production (server: Better Auth
  `emailAndPassword.enabled`; web: form not rendered). In dev/test it stays available beside providers
  (demo account, tests) behind a small "Use email (dev only)" toggle. When it is the only method
  (no providers), show the email form as the main sign-in UI, no "dev only" wording. `/api/auth-methods`
  returns `{ google, github, email, emailPrimary }`.
- Redesign the sign-in screen (it looks empty now): brand mark + one-line value prop, two full-width
  provider buttons (Google with its official G, GitHub with its mark, official guideline colors), a
  short line linking Terms and Privacy. Centred, comfortable on a phone, not a bare form. Also the
  SignInSheet (bottom sheet for signed-out Save/Summarize) uses the same buttons.
- If no provider is configured (e.g. production before OAuth keys exist), the email form is the main UI.

## 2. Skeleton loaders everywhere

The server is in Germany, users mostly in India: every screen that waits on the API shows a skeleton
shaped like its content (Read feed, Ideas queue, Saved list, reader view, Pricing cards, account/settings,
anything else that fetches). One shared Skeleton component + CSS (subtle shimmer, respects
`prefers-reduced-motion`, works in dark theme). No layout shift when data arrives. No spinners for page
loads. Show the skeleton only if loading takes >150 ms to avoid flashes.

## 3. Currency and payments safety

- Default currency is INR for everyone; USD only when the user picks it (remember the choice in
  localStorage). Remove any geo/locale-based default.
- `radar.config.ts`: `internationalPayments: false`. While false: hide the "Show in $" toggle, server
  creates orders only in INR (reject USD orders). When true: current behavior with the toggle.
- Stub (free) checkout must never work when NODE_ENV=production, whether or not Razorpay keys are set
  (apps/api/src/routes/billing.ts `/checkout` and `/cancel`). Update tests.

## 4. Pricing page design pass

Current: three equal grey cards with heavy black Buy buttons, then three loose meta lines. Make it calmer
and clearer: one plan visibly recommended (1 year, "Best value") without colored borders; lighter
card treatment; per-month price as the comparison line on all three; group the payment/legal lines into
one tidy block (statement name, Razorpay methods, terms/refund links, "time adds up"); keep it short.
Mobile: cards stack, Buy buttons full width.

## 5. Saved page spacing

Match the Ideas screen exactly: same page header block (title, intro, spacing), same gaps between
header, input, tabs and list, same empty-state spacing and type sizes. Use the same classes/tokens as Ideas;
don't invent new spacing values.

## Rules

- Do not commit. Never add Co-authored-by or AI attribution. Never bypass pnpm minimumReleaseAge
  (no new deps expected). Don't start/stop dev servers (API on 8787 and vite on 5173 are running).
- Don't revert existing uncommitted changes (Google sign-in, Saves feature, Lemon Squeezy removal).
- Run typecheck, lint (incl. prettier) and tests; keep everything green.
