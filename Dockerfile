# syntax=docker/dockerfile:1.7
#
# Signal Radar deploy images (see deploy/README.md).
#   api:   the Hono API (tsx runs the TypeScript sources, as in dev), non-root, /api/health healthcheck.
#   web:   `pnpm web:build` output (pre-rendered landing/pricing included) behind a tiny Caddy file server.
#   tools: same sources + pg client + rclone for `db:migrate`, `radar ...` and the cron/backup loop.
#
# VITE_SITE_URL is baked into the web build (canonical/OG URLs, sitemap), so it is a build arg.

ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_HOME=/opt/corepack \
    CI=true
RUN apk add --no-cache tzdata
# Warm the corepack cache as root, then let the non-root user read it (no re-download on start).
RUN corepack enable && corepack prepare pnpm@12.16.1 --activate && pnpm --version \
    && chown -R root:node "$COREPACK_HOME" && chmod -R g+rwX "$COREPACK_HOME"
WORKDIR /app

# Dependencies only: manifests first so source edits do not bust the install layer.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/cli/package.json apps/cli/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS source
COPY . .

FROM source AS web-build
ARG VITE_SITE_URL=http://localhost:5173
ENV VITE_SITE_URL=$VITE_SITE_URL
RUN pnpm web:build

# ----- web: static files, SPA fallback, cache rules -------------------------------
FROM caddy:2-alpine AS web
RUN addgroup -S -g 1001 web && adduser -S -u 1001 -G web web
COPY deploy/web.Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /app/apps/web/dist /srv
ENV XDG_DATA_HOME=/tmp/caddy-data XDG_CONFIG_HOME=/tmp/caddy-config
USER web
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]

# ----- api ---------------------------------------------------------------------------
FROM source AS api
ENV NODE_ENV=production API_PORT=8787
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "apps/api/src/server.ts"]

# ----- tools: migrate, radar CLI, cron, backups -------------------------------------
# System packages sit on top of deps (not source) so source edits reuse this cached layer.
FROM deps AS tools
ENV NODE_ENV=production \
    npm_config_verify_deps_before_run=false
USER root
RUN apk add --no-cache postgresql18-client rclone \
    && mkdir -p /backups && chown node:node /backups
COPY . .
USER node
CMD ["pnpm", "radar", "--help"]
