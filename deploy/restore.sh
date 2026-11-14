#!/bin/sh
# Restore a pg_dump -Fc backup into a THROWAWAY database and verify it.
# Usage: RESTORE_DATABASE_URL=postgres://.../scratch deploy/restore.sh <file.dump>
# The source is a local file path (inside the container: /backups/daily/<file>); for an R2 copy,
# `rclone copyto` it down first (see deploy/README.md). Refuses to write into DATABASE_URL.
set -eu
umask 077

log() { printf '%s restore: %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

SRC="${1:-}"
[ -n "$SRC" ] || { echo "usage: $0 <file.dump>" >&2; exit 2; }
[ -f "$SRC" ] || die "no such file: $SRC"
: "${RESTORE_DATABASE_URL:?set RESTORE_DATABASE_URL to a throwaway database, not prod}"
if [ "$RESTORE_DATABASE_URL" = "${DATABASE_URL:-}" ] && [ "${RESTORE_FORCE:-0}" != "1" ]; then
  die "RESTORE_DATABASE_URL is DATABASE_URL; refusing without RESTORE_FORCE=1"
fi

pg_restore --list "$SRC" >/dev/null || die "not a valid custom-format dump"
log "restoring into ${RESTORE_DATABASE_URL##*/}"
pg_restore --clean --if-exists --no-owner --single-transaction --exit-on-error \
  --dbname="$RESTORE_DATABASE_URL" "$SRC"

TABLES="$(psql "$RESTORE_DATABASE_URL" -tAc "select count(*) from information_schema.tables where table_schema='public'")"
USERS="$(psql "$RESTORE_DATABASE_URL" -tAc 'select count(*) from "user"')"
ITEMS="$(psql "$RESTORE_DATABASE_URL" -tAc 'select count(*) from feed_item')"
[ "$TABLES" -gt 0 ] || die "restore produced no tables"
log "restored ${TABLES} tables, ${USERS} users, ${ITEMS} feed items"
