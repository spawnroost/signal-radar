#!/bin/sh
# Long-running cron container (tools image). All times UTC.
#   RADAR_AT   "HH:MM ..." slots for `radar run` (default 03:00 15:00, like the old Actions workflow)
#   BACKUP_AT  "HH:MM" for deploy/backup.sh (default 02:00)
# A failing job is logged and retried at its next slot; it never kills the loop.
set -u
cd /app

RADAR_AT="${RADAR_AT:-03:00 15:00}"
BACKUP_AT="${BACKUP_AT:-02:00}"
last=""

log() { printf '%s cron: %s\n' "$(date -u +%FT%TZ)" "$*"; }
log "started; radar at: ${RADAR_AT}; backup at: ${BACKUP_AT}"

while true; do
  now="$(date -u +%H:%M)"
  slot="$(date -u +%F)T${now}"
  if [ "$slot" != "$last" ]; then
    last="$slot"
    for t in $RADAR_AT; do
      if [ "$t" = "$now" ]; then
        log "radar run"
        pnpm radar run || log "radar run failed"
      fi
    done
    if [ "$BACKUP_AT" = "$now" ]; then
      log "backup"
      sh /app/deploy/backup.sh || log "backup failed"
    fi
  fi
  sleep 20
done
