# Signal Radar

Signal Radar reads Hacker News, Reddit, GitHub and RSS feeds, ranks every story against the niches you follow, and shows
you what is moving. It has two tiers.

- **Free, no account.** The Read view. Stories are ranked by keyword match and momentum (points, stars and comments per
  hour). Your niches and sources live in localStorage and the ranking runs in the browser against a shared feed, so it
  costs nothing to serve.
- **Pro, sign-up.** The best of each run goes through an AI scorer tuned to your niches, which writes a hook, an angle
  and title options for each story. The results land in a personal Make queue where you pick or skip. Your picks and
  skips are fed back as examples on the next run. Pro also adds custom RSS feeds, a Telegram digest, Web Push, and an
  optional Notion sync. New accounts get a 7-day trial.

![The landing page, the Read view and the Make queue on a phone](docs/demo.gif)

## How it works

1. `radar run` fetches every configured source once, deduplicates by URL and writes the result to the shared feed table.
2. Each item gets a keyword and momentum score. The free Read view is this ranking, and nothing more.
3. For each Pro user, the pipeline prefilters the shared feed by that user's niches and sends the top N to the AI
   provider (DeepSeek or Anthropic). Without a key the provider falls back to `none`: keyword ranking only.
4. Scored items are written to the user's queue. Items the user has already been shown are skipped.
5. If anything new was queued, the user gets a Telegram message and a Web Push notification, when they have set those up.

The scoring prompt includes the user's most recent picks and skips. Picked stories are the positive examples, skipped
ones the negative.

Custom feeds are user-supplied URLs, so the server fetches them defensively: http(s) only, no private, loopback,
link-local or metadata addresses, and the address check runs inside the socket's own DNS lookup, so a domain can't pass
the check and then rebind to an internal IP. Redirects are re-checked (max 3), with an 8 s timeout and a 2 MB cap.

## Stack

TypeScript throughout, on Node 24 with pnpm workspaces.

- `apps/web`: Vite, React 19, installable PWA (`vite-plugin-pwa`).
- `apps/api`: Hono, Better Auth (email and password, sessions in Postgres).
- `apps/cli`: the `radar` command. It is also what the cron job runs.
- `packages/core`: fetchers, ranking, scoring providers, Telegram, Web Push and Notion adapters.
- `packages/db`: Drizzle schema, migrations and the Postgres store.
- Postgres 18. Tests use vitest and a throwaway `radar_test` database.

## Local development

You need Node 24 (see `.nvmrc`), pnpm and Docker.

```sh
git clone https://github.com/sambit24795/signal-radar.git && cd signal-radar
pnpm install
cp .env.example .env     # set BETTER_AUTH_SECRET at least
pnpm db:up               # Postgres on :5432, also creates radar_test
pnpm db:migrate
pnpm api:dev             # API on http://localhost:8787
pnpm web:dev             # web on http://localhost:5173, proxies /api
pnpm radar run           # in another terminal: fetch, score, fill the queues
```

The web dev server proxies `/api` to the API, so run both. Sign up in the browser; you start on the trial and are Pro.
To fill that user's queue, run `pnpm radar run`. With no `DEEPSEEK_API_KEY` it uses the `none` provider, so you get
keyword-ranked items without hooks.

Payments are one-time Pro passes paid by UPI (INR only, no auto-renew). The user pays in their UPI app and submits
the 12-digit UTR; an admin approves it by hand (Telegram buttons or `/admin`). Without `UPI_VPA` the Buy buttons are
hidden and payments are closed; `ADMIN_EMAILS` picks who can approve. Razorpay support is shelved: the code stays but
is unreachable (its keys are not passed to the API container in production).
To make a user Pro locally, use `pnpm radar user:pro --email you@example.com`.

Checks:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm web:build
```

`pnpm web:build` also pre-renders `/` and `/pricing` to static HTML (`apps/web/build/prerender.ts`), so crawlers and link
previews see real content. `apps/web/scripts/og.mjs` regenerates `public/og.png` from `scripts/og.html` (needs Playwright,
which is not a dependency).

## Configuration

Sources, default niches, the scoring provider and `topN` are in `radar.config.ts`. Everything else is environment
variables, read from `.env` by the API and the CLI.

| Variable                  | Purpose                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`      | Telegram bot token. Used for the per-user digest and for single-user `--local` mode.                      |
| `TELEGRAM_CHAT_ID`        | Chat that receives the digest in `radar run --local` mode.                                                |
| `DEEPSEEK_API_KEY`        | Enables the DeepSeek scorer. Missing: falls back to `none`.                                               |
| `NOTION_TOKEN`            | Notion integration token for `radar run --local`.                                                         |
| `DATABASE_URL`            | Postgres connection string. Required by the API and by `radar run`.                                       |
| `TEST_DATABASE_URL`       | Database the test suite resets and writes to. Keep it separate from `DATABASE_URL`.                       |
| `BETTER_AUTH_SECRET`      | Session signing secret, 32 characters or more.                                                            |
| `BETTER_AUTH_URL`         | Public base URL of the API.                                                                               |
| `WEB_ORIGIN`              | Origin of the web app, for CORS and cookies. `http://localhost:5173` in dev.                              |
| `GOOGLE_CLIENT_ID`        | Google sign-in (with `GOOGLE_CLIENT_SECRET`). Callback URL: `<BETTER_AUTH_URL>/api/auth/callback/google`. |
| `GOOGLE_CLIENT_SECRET`    | See above. Both unset: Google sign-in is off.                                                             |
| `GITHUB_CLIENT_ID`        | GitHub sign-in (with `GITHUB_CLIENT_SECRET`). Callback URL: `<BETTER_AUTH_URL>/api/auth/callback/github`. |
| `GITHUB_CLIENT_SECRET`    | See above. Both unset: GitHub sign-in is off.                                                             |
| `API_PORT`                | Port the API listens on.                                                                                  |
| `VAPID_PUBLIC_KEY`        | Web Push public key. Generate a pair with `pnpm --filter @radar/core exec web-push generate-vapid-keys`.  |
| `VAPID_PRIVATE_KEY`       | Web Push private key. With the other VAPID vars unset, push is disabled.                                  |
| `VAPID_SUBJECT`           | `mailto:` contact sent to push services.                                                                  |
| `YOUTUBE_API_KEY`         | YouTube Data API v3 key (server-side only). Unset: YouTube is left out of search.                         |
| `TELEGRAM_BOT_USERNAME`   | Bot username without the `@`. Needed for the Connect Telegram link; unset hides the button.               |
| `TELEGRAM_WEBHOOK_SECRET` | Secret the bot webhook must present. Unset: the webhook returns 404.                                      |
| `VITE_SITE_URL`           | Web origin for canonical and share URLs, sitemap and robots at build. Default `localhost:5173`.           |

Sign-in: with no Google or GitHub keys, email + password is the sign-in. As soon as one provider is configured,
email + password is switched off in production (it stays in development and tests, behind a "Use email (dev only)"
toggle).

Also read, but not in `.env.example`: `ANTHROPIC_API_KEY` (when `provider: 'anthropic'`), `GITHUB_TOKEN` (higher GitHub
rate limit) and `NOTION_DB_ID` (`--local` mode).

### Telegram connect

Create a bot with BotFather, then set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` and a random
`TELEGRAM_WEBHOOK_SECRET`. Point the bot at your API, which must be reachable over HTTPS:

```sh
pnpm radar telegram:webhook https://api.example.com
```

Pro users can then connect their chat from Settings, Notifications.

## Search

"Search everywhere" asks the live sources directly: Hacker News, Google News, GitHub and DEV (single-word queries only),
plus YouTube when `YOUTUBE_API_KEY` is set. It runs only when the reader chooses it, never on each keystroke. The
results line names the sources that answered.

YouTube uses the Data API v3 (`search` then `videos?part=statistics`). Create a key in Google Cloud Console: enable
"YouTube Data API v3", then Credentials, API key, restricted to that API. The free tier is 10,000 units a day for the
whole deployment and a search costs 100 units, so about 100 searches a day. The server therefore:

- caches each normalized query for an hour (at most 500 queries);
- stops calling the API at 9,000 units counted in memory, and after a `quotaExceeded` answer until midnight Pacific;
- logs one line when it skips YouTube (no key, budget, quota or an API error).

There is no RSSHub fallback: RSSHub has no YouTube search route (it only serves channel, user, playlist, live and
similar feeds), so when the API cannot answer, YouTube is simply absent from the results. The key is never sent to the
web app.

## CLI

```
pnpm radar run                    fetch once, write the shared feed, queue items per Pro user
pnpm radar run --dry              print the ranked table, write nothing (no database needed)
pnpm radar run --local            single-user mode: data/seen.json, Notion and one Telegram chat
pnpm radar sources                list sources and their status
pnpm radar db:migrate             apply SQL migrations to DATABASE_URL
pnpm radar user:list              users with plan, status, trial end and niches
pnpm radar user:pro --email <e>   dev: make a user Pro
pnpm radar notion:init --parent <pageId>   create the Topic Queue database in Notion, print its id
pnpm radar telegram:webhook <publicBaseUrl>   point the bot at <base>/api/telegram/webhook
pnpm radar telegram:webhook --delete          remove the bot webhook
```

`run`, `run --dry` and `sources` accept `--config <file>`.

## Self-hosting

Nothing in it depends on a particular host: Postgres, a Node process for the API, static files for the web app, and
something to run `radar run` on a schedule. `Dockerfile` (targets `api`, `web`, `tools`) and `deploy/` hold a
ready-made Docker Compose stack (Postgres, migrations, API, web, and a cron container that runs `radar run` at 03:00 and
15:00 UTC plus a nightly backup). `deploy/README.md` is the runbook: first deploy, update, rollback, logs, CLI
commands, DB tunnel and restore. `docker-compose.yml` at the root is only for local development (Postgres and an
optional RSSHub, `docker compose --profile rsshub up -d rsshub`).

If you self-host it and it saves you time, you can support the project through
[GitHub Sponsors](https://github.com/sponsors/sambit24795). It is optional, and every feature stays free to self-host.

## Layout

```
apps/
  api/       Hono API: auth, feed, queue, settings, billing, push, Telegram webhook
  cli/       the radar command
  web/       Vite + React PWA
packages/
  core/      sources, ranking, scoring, digests, pipeline
  db/        Drizzle schema, migrations, Postgres store
radar.config.ts   sources, default niches, provider
docs/             build plans and the demo GIF
```

## License

[AGPL-3.0-only](LICENSE). If you run a modified version as a network service, you have to offer its source to its users.
