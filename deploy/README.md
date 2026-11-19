# Deploy runbook: signalradar.spawnroost.com

One Compose project, `signalradar`, on the shared OVH VPS. mo-kalama's Caddy owns ports 80/443 (Cloudflare
proxied, SSL Full strict) and proxies this site to the containers below. Images are built on your machine and
sent over SSH: no registry, no GitHub Actions.

```
postgres (volume pgdata, not published) -> migrate (one-shot) -> api :8787   (alias signalradar-api)
                                                               -> web :8080   (alias signalradar-web)
                                                               -> cron        (radar run 03:00 + 15:00 UTC, remind 09:00 UTC, backup 02:00 UTC)
```

api and web are also bound to `127.0.0.1:18787` / `127.0.0.1:18080` on the server for `curl` debugging
(`HOST_API_PORT`, `HOST_WEB_PORT`; mo-kalama uses 3000 and 5433/1025/8025). Caddy does not use these: it reaches the
containers over the Docker network `signalradar_default`.

## Caddy (once, on the server)

Two changes in mo-kalama's prod project (`/opt/mokalama/prod`), then `docker compose --env-file .env up -d caddy`:

1. `compose.yml`, service `caddy`: join this project's network (it must exist first, so deploy signalradar once
   before restarting Caddy, the same ordering mo-kalama already uses for staging):

   ```yaml
   services:
     caddy:
       networks: [default, staging, signalradar]
   networks:
     signalradar:
       external: true
       name: signalradar_default
   ```

2. `Caddyfile`: append the whole of `deploy/Caddyfile.snippet` (a `(signalradar_security)` snippet and the
   `signalradar.spawnroost.com { ... }` block: `/api/*` to `signalradar-api:8787`, the rest to
   `signalradar-web:8080`). Check with `docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile`.

If Cloudflare's proxy blocks the first ACME HTTP-01 challenge, set the record DNS-only until the certificate is issued.

## First deploy

1. Cloudflare: A record `signalradar` -> VPS IP, proxied.
2. On the server: `sudo mkdir -p /opt/signalradar && sudo chown $USER /opt/signalradar`. Copy `deploy/env.example`
   to `/opt/signalradar/.env`, fill it in, `chmod 600`. Required: `POSTGRES_PASSWORD` (hex), `BETTER_AUTH_SECRET`
   (32+ chars), the three URLs (already `https://signalradar.spawnroost.com`).
3. From this repo on your machine: `DEPLOY_HOST=<vps-ip> DEPLOY_USER=<user> deploy/ship.sh` (add `SSH_OPTS="-i key"`
   if needed). It builds the images, pipes them through `docker save | gzip | ssh ... docker load`, copies
   `compose.yml`, `Caddyfile.snippet` and `env.example` to `/opt/signalradar`, and runs
   `docker compose up -d --no-build`.
4. Apply the Caddy change above and reload Caddy.
5. Check: `curl -fsS https://signalradar.spawnroost.com/api/health` -> `{"ok":true}`; the landing page loads;
   email sign-up works (unless Google/GitHub are configured, which turns email+password off in production).
6. Telegram, if `TELEGRAM_BOT_TOKEN` is set (the bot uses a webhook):
   `docker compose --env-file .env run --rm cron pnpm radar telegram:webhook https://signalradar.spawnroost.com`
   (needs `TELEGRAM_WEBHOOK_SECRET` in `.env`; `--delete` removes it).
7. Later: Google and GitHub OAuth callbacks `https://signalradar.spawnroost.com/api/auth/callback/{google,github}`.

## Payments (owner steps)

Payments go through Dodo Payments (one-time passes). Razorpay is shelved: its keys are not passed to the API
container, so the old routes stay dead. Setup steps are in `docs/dodo-payments-plan.md`.

Put `ADMIN_EMAILS` (your login email, comma-separated for more) in `/opt/signalradar/.env` to see `/admin`, a
read-only payment list. Optional: `TELEGRAM_ADMIN_CHAT_ID`. Without it, payment alerts go to the Telegram chat the
admin linked in Settings.

## Update

`DEPLOY_HOST=... deploy/ship.sh`. The tag is `<git sha>-<utc time>[-dirty]`. Migrations run in the `migrate`
one-shot before the new API starts, so a migration that is not backwards compatible needs a plan before you ship.

## Rollback

Old images stay on the server. On the server, `cat /opt/signalradar/.previous-tag`, then from your machine:
`DEPLOY_HOST=... deploy/ship.sh --rollback <tag>`. (Database changes are not undone; restore from a backup if needed.)
Free disk occasionally: `docker image prune -a --filter until=720h`.

## Day to day (run on the server in `/opt/signalradar`; prefix `docker compose --env-file .env`)

- Status / logs: `ps`, `logs -f --tail=200 api cron`, `logs migrate`.
- Run a CLI command: `run --rm cron pnpm radar user:list`, `run --rm cron pnpm radar run`,
  `run --rm cron pnpm radar user:pro --email a@b.c`.
- Expiry reminders: `radar remind` runs daily at `REMIND_AT` (UTC, default 09:00). It messages paid Pro users
  3 days before their period ends (Telegram if linked, else web push; users with neither are skipped) and
  links to `/pricing`. Once per period; run it by hand with `run --rm cron pnpm radar remind`.
- psql: `exec postgres psql -U radar -d radar`.
- DB tunnel: `--profile tunnel up -d db-tunnel`, then from your machine
  `ssh -L 5433:127.0.0.1:15432 <user>@<vps>` and connect to `localhost:5433` (user radar). Stop it with
  `--profile tunnel stop db-tunnel` when done.

## Backups and restore test

`cron` writes `/backups/daily/signalradar-YYYY-MM-DD.dump` (pg_dump -Fc, 14 kept) in the `backups` volume at
02:00 UTC. With `R2_*` set in `.env` it also copies to `r2:<bucket>/signalradar/daily/` with the same retention
(the same Cloudflare R2 approach as mo-kalama; use the same bucket). Without R2 the dumps sit on the same disk as
the database, so set R2 before relying on them.

- Run one now: `exec cron sh /app/deploy/backup.sh`.
- Restore test into a scratch database (never into `radar`):
  ```
  exec postgres psql -U radar -d radar -c 'create database scratch'
  exec cron sh -c 'RESTORE_DATABASE_URL=$(echo "$DATABASE_URL" | sed "s|/radar\$|/scratch|") \
     sh /app/deploy/restore.sh /backups/daily/signalradar-<date>.dump'
  exec postgres psql -U radar -d radar -c 'drop database scratch'
  ```
- An R2 copy: `exec cron sh -c 'rclone ...'` it down to `/backups` first (the same `RCLONE_CONFIG_R2_*` env as in
  `backup.sh`), then restore as above.

## Local proof (what was run before the first deploy)

```
docker compose -f deploy/compose.yml --env-file deploy/env.local --profile local up -d --build
# one origin at http://localhost:18090 (the production Caddyfile.snippet, address swapped for :80)
curl localhost:18090/api/health; curl localhost:18090/pricing
docker compose -f deploy/compose.yml --env-file deploy/env.local --profile local down -v
```

`deploy/env.local` is gitignored (dummy secrets, project `signalradar-proof`, ports 2xxxx so it never touches the
dev stack on 5432/8787/5173). Recreate it from `env.example` with `COMPOSE_PROJECT_NAME=signalradar-proof`,
`IMAGE_TAG=proof`, and `BETTER_AUTH_URL`/`WEB_ORIGIN`/`VITE_SITE_URL=http://localhost:18090`.
