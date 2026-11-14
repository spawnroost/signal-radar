# Deploy plan: signalradar.spawnroost.com on the mo-kalama VPS

Production runs on the same OVH VPS (Germany) as mo-kalama, which already runs Docker Compose with one
Caddy that owns ports 80/443 (Cloudflare proxied in front, SSL Full strict). Reference implementation:
/home/sambit/projects/mo-kalama-deploy (`deploy/compose.yml`, `deploy/Caddyfile`, `deploy/backup.sh`,
`deploy/cron.sh`, `deploy/env.example`, `Dockerfile`, `docs/deploy-plan.md`, runbook). Copy its patterns;
read how its Caddy reaches app upstreams (`PROD_APP_UPSTREAM`) before choosing ours.

GitHub Actions is unusable right now (account billing lock), so the first deploys must not need Actions
or a registry: build images locally, ship them over SSH (`docker save | ssh ... docker load`), then
`docker compose up -d` on the server. A GitHub Actions deploy workflow can come later.

## Part A: deploy kit in this repo (build and prove locally; no server access)

1. `Dockerfile` (multi-stage, Node 24, pnpm via corepack, non-root, `.dockerignore` never ships .env,
   tests, data, docs). Targets:
   - `api`: production API (`apps/api/src/server.ts` or a built version; match how the repo runs it),
     healthcheck route `/api/health` (add if missing: 200 + DB ping, no secrets).
   - `web`: `pnpm web:build` output (includes the pre-rendered landing/pricing) served by a tiny static
     server (caddy:alpine or nginx:alpine) with SPA fallback to index.html, long cache for hashed assets,
     no cache for index.html / service worker / manifest.
   - `tools`: full deps + tsx + drizzle-kit for `db:migrate`, `radar run`, admin CLI commands.
2. `deploy/compose.yml`, project name `signalradar`: `postgres` (same major as local docker-compose,
   named volume, no published port), `migrate` one-shot (tools, `db:migrate`) before `api`, `api`,
   `web`, `cron` (tools image; runs `radar run` at 03:00 and 15:00 UTC like the old workflow, plus nightly
   backup). api and web bound to 127.0.0.1 on ports that do not clash with mo-kalama (check its compose),
   or on a shared external docker network if that is how mo-kalama's Caddy reaches its app.
3. `deploy/Caddyfile.snippet`: the site block to add to mo-kalama's Caddyfile:
   `signalradar.spawnroost.com` -> `/api/*` to api, everything else to web; security headers adapted
   from mo-kalama (CSP must allow Razorpay checkout: checkout.razorpay.com, api.razorpay.com, and
   lumberjack/razorpay frames; Google/GitHub OAuth redirects; web push). Do NOT edit the mo-kalama repo;
   write the exact change in the snippet file plus instructions.
4. `deploy/env.example`: every env var the api/cli read (grep the zod env and `process.env`), grouped,
   secrets marked; production values: BETTER_AUTH_URL and WEB_ORIGIN = https://signalradar.spawnroost.com,
   NODE_ENV=production.
5. `deploy/backup.sh` / `restore.sh`: pg_dump -Fc nightly, keep 14 daily, mirroring mo-kalama's approach
   (reuse its offsite target if it has one; else local + note).
6. `deploy/ship.sh`: build the images locally, `docker save | ssh $HOST docker load`, copy compose +
   env-less files to `/opt/signalradar` (or the dir mo-kalama's layout suggests), `docker compose up -d`.
   Host and user come from env/args, nothing hard-coded. `deploy/README.md` runbook: first deploy,
   update, rollback (previous image tag), logs, run a CLI command, DB tunnel, restore test.
7. Delete `.github/workflows/radar.yml` (replaced by the cron container). Keep ci.yml.
8. Telegram: if the bot uses a webhook, document the `setWebhook` call for the new domain in the runbook.
9. Local proof: `docker compose -f deploy/compose.yml --env-file deploy/env.local up -d` (env.local
   gitignored, dummy secrets, different ports/project name so it does not clash with the dev stack)
   -> migrations apply, `/api/health` 200, web serves landing + SPA routes, email sign-up works, one
   `radar run` from the cron/tools image completes. Then tear it down (`down -v`).

## Part B: server (done together with the owner, not by the agent)

Cloudflare A record `signalradar` -> VPS IP (proxied); add the Caddy snippet on the server and reload;
create `/opt/signalradar/.env` (chmod 600); ship; set Telegram webhook; submit the site to Razorpay;
later Google/GitHub OAuth apps with the production callback URLs.

## Rules

- Do not commit. Never add Co-authored-by or AI attribution. Never bypass pnpm minimumReleaseAge.
- Don't touch the running dev servers (8787, 5173) or the dev Postgres container/volume.
- Don't revert uncommitted work in the tree. Keep typecheck, lint and tests green.
