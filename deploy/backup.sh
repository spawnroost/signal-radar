#!/bin/sh
# Nightly logical backup: pg_dump -Fc into /backups (a volume), keep 14 daily. If R2 credentials are
# set it also copies the dump to Cloudflare R2 (same offsite approach as mo-kalama) and applies the
# same retention there. Runs in the tools image; idempotent per day.
# Env: DATABASE_URL. Optional: BACKUP_DIR (/backups), BACKUP_KEEP (14),
#      R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BACKUP_BUCKET, BACKUP_PREFIX (signalradar).
set -eu
umask 077

log() { printf '%s backup: %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

: "${DATABASE_URL:?DATABASE_URL is not set}"
DIR="${BACKUP_DIR:-/backups}"
KEEP="${BACKUP_KEEP:-14}"
PREFIX="${BACKUP_PREFIX:-signalradar}"
FILE="${PREFIX}-$(date -u +%F).dump"
mkdir -p "$DIR/daily"

if [ -s "$DIR/daily/$FILE" ]; then
  log "daily/$FILE already exists; nothing to do"
else
  TMP="$DIR/daily/.$FILE.tmp"
  trap 'rm -f "$TMP"' EXIT INT TERM
  log "dumping to daily/$FILE"
  pg_dump --format=custom --compress=6 --no-owner --file="$TMP" "$DATABASE_URL"
  pg_restore --list "$TMP" >/dev/null || die "dump failed pg_restore --list validation"
  [ -s "$TMP" ] || die "dump is empty"
  mv "$TMP" "$DIR/daily/$FILE"
  log "wrote daily/$FILE ($(wc -c < "$DIR/daily/$FILE" | tr -d ' ') bytes)"
fi

# Keep the newest $KEEP daily dumps.
ls -1t "$DIR"/daily/"$PREFIX"-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  rm -f "$old" && log "removed $(basename "$old")"
done

# Offsite copy, only when R2 is configured.
if [ -n "${R2_ACCOUNT_ID:-}" ] && [ -n "${R2_ACCESS_KEY_ID:-}" ] && [ -n "${R2_SECRET_ACCESS_KEY:-}" ] && [ -n "${R2_BACKUP_BUCKET:-}" ]; then
  export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare
  export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
  export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
  export RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
  export RCLONE_CONFIG_R2_REGION=auto RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
  REMOTE="r2:${R2_BACKUP_BUCKET}/${PREFIX}/daily"
  rclone copyto "$DIR/daily/$FILE" "$REMOTE/$FILE" --s3-no-check-bucket || die "R2 upload failed"
  rclone delete "$REMOTE" --min-age "${KEEP}d" --include "*.dump" || log "R2 retention failed (ignored)"
  log "copied to R2 ${REMOTE}/${FILE}"
else
  log "R2 not configured; local backup only (the volume is on the same disk, so set R2_* for real safety)"
fi
