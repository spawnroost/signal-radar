#!/usr/bin/env bash
# Build the images here, ship them over SSH (no registry, no CI), and `docker compose up -d` on the server.
#
#   DEPLOY_HOST=203.0.113.7 deploy/ship.sh            build + ship + start
#   deploy/ship.sh --host 203.0.113.7 --user deploy   same, host/user as args
#   deploy/ship.sh --rollback <tag>                   start images already on the server (no build)
#   deploy/ship.sh --dry-run                          build only; print what would be shipped
#
# Settings (env or flags; nothing is hard-coded):
#   DEPLOY_HOST (required), DEPLOY_USER (default: your login), DEPLOY_DIR (default /opt/signalradar),
#   SSH_OPTS (e.g. "-i ~/.ssh/key -p 2222"), IMAGE_TAG (default: <git sha>-<utc time>),
#   VITE_SITE_URL (default https://signalradar.spawnroost.com; baked into the web build).
# The server keeps its own $DEPLOY_DIR/.env (chmod 600); this script never copies secrets.
set -euo pipefail
cd "$(dirname "$0")/.."

HOST="${DEPLOY_HOST:-}"; USER_="${DEPLOY_USER:-}"; DIR="${DEPLOY_DIR:-/opt/signalradar}"
SSH_OPTS="${SSH_OPTS:-}"; TAG="${IMAGE_TAG:-}"; SITE="${VITE_SITE_URL:-https://signalradar.spawnroost.com}"
ROLLBACK=""; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --user) USER_="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    --rollback) ROLLBACK="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

TARGET="${HOST}"; [ -n "$USER_" ] && TARGET="${USER_}@${HOST}"
if [ "$DRY" = 0 ]; then [ -n "$HOST" ] || { echo "set DEPLOY_HOST or --host" >&2; exit 2; }; fi
# shellcheck disable=SC2206
SSH=(ssh $SSH_OPTS "$TARGET")
log() { printf '== %s\n' "$*"; }

IMAGES=(api web tools)

if [ -z "$ROLLBACK" ]; then
  if [ -z "$TAG" ]; then
    TAG="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)-$(date -u +%Y%m%d%H%M%S)"
    git diff --quiet 2>/dev/null || TAG="${TAG}-dirty"
  fi
  log "building signalradar-{api,web,tools}:${TAG} (VITE_SITE_URL=${SITE})"
  for t in "${IMAGES[@]}"; do
    docker build --target "$t" --build-arg "VITE_SITE_URL=${SITE}" -t "signalradar-${t}:${TAG}" .
  done
else
  TAG="$ROLLBACK"
fi

if [ "$DRY" = 1 ]; then
  log "dry run: would ship tag ${TAG} to ${TARGET:-<host>}:${DIR}"
  exit 0
fi

if [ -z "$ROLLBACK" ]; then
  log "shipping images to ${TARGET}"
  docker save $(for t in "${IMAGES[@]}"; do printf 'signalradar-%s:%s ' "$t" "$TAG"; done) | gzip | "${SSH[@]}" 'gunzip | docker load'
fi

log "syncing compose files to ${DIR}"
"${SSH[@]}" "mkdir -p '${DIR}'"
# shellcheck disable=SC2086
scp $SSH_OPTS deploy/compose.yml deploy/Caddyfile.snippet deploy/env.example "${TARGET}:${DIR}/"

log "starting tag ${TAG}"
"${SSH[@]}" bash -s -- "$DIR" "$TAG" <<'REMOTE'
set -euo pipefail
dir="$1"; tag="$2"
cd "$dir"
[ -f .env ] || { echo "missing $dir/.env: copy env.example to .env, fill it in and chmod 600" >&2; exit 1; }
for t in api web tools; do docker image inspect "signalradar-$t:$tag" >/dev/null || { echo "image signalradar-$t:$tag not on this server" >&2; exit 1; }; done
prev="$(grep -E '^IMAGE_TAG=' .env | tail -1 | cut -d= -f2- || true)"
[ -n "$prev" ] && [ "$prev" != "$tag" ] && echo "$prev" > .previous-tag
if grep -qE '^IMAGE_TAG=' .env; then sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=$tag|" .env; else echo "IMAGE_TAG=$tag" >> .env; fi
docker compose --env-file .env up -d --no-build --remove-orphans
docker compose --env-file .env ps
echo "deployed ${tag}; previous: $(cat .previous-tag 2>/dev/null || echo none)"
REMOTE
log "done. Check: curl -fsS ${SITE}/api/health"
