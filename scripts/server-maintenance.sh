#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# InfluenceOS — weekly server housekeeping (Docker hosts)
#
# Every deploy pulls three new multi-hundred-MB images and nothing removes the
# old ones; container logs grow without limit. A full disk stops Postgres, so
# this keeps the disk healthy:
#
#   1. Removes images no container uses that are older than a week (the
#      images of the running release — and the previous one for a quick
#      rollback — are kept).
#   2. Removes stopped one-shot containers (migrate, minio-setup) and dangling
#      build cache.
#   3. Prints disk usage and warns at 85% (exit code 2 at 95%, for alerting).
#
# Never touches volumes (database, uploaded files, Redis) or running
# containers.
#
# Cron, Sundays at 04:00:
#   0 4 * * 0  cd /opt/influenceos && scripts/server-maintenance.sh >> /var/log/influenceos-maintenance.log 2>&1
#
# Container log size is capped by Docker itself — see docs/SERVER_MAINTENANCE_AR.md
# for the one-time /etc/docker/daemon.json setting.
# ---------------------------------------------------------------------------
set -euo pipefail

log() { printf '%s [maintenance] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

command -v docker >/dev/null || { log "ERROR: docker not found."; exit 1; }

KEEP_HOURS="${MAINTENANCE_KEEP_IMAGES_HOURS:-168}"

log "Disk before: $(df -h / | awk 'NR==2 {print $3" used of "$2" ("$5")"}')"
docker container prune --force --filter "until=24h" >/dev/null
docker image prune --all --force --filter "until=${KEEP_HOURS}h" | tail -1
docker builder prune --force --filter "until=${KEEP_HOURS}h" >/dev/null 2>&1 || true
log "Disk after:  $(df -h / | awk 'NR==2 {print $3" used of "$2" ("$5")"}')"

USED="$(df --output=pcent / | tail -1 | tr -dc '0-9')"
if [ "$USED" -ge 95 ]; then
  log "CRITICAL: disk ${USED}% full — Postgres will stop when it fills. Free space now."
  exit 2
elif [ "$USED" -ge 85 ]; then
  log "WARNING: disk ${USED}% full."
fi
log "Done."
