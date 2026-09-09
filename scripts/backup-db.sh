#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# InfluenceOS — PostgreSQL backup
#
# Takes a consistent, compressed logical backup with pg_dump, writes it to a
# local staging directory, optionally ships it to a remote S3 bucket, and prunes
# old backups per a grandfather-father-son retention policy.
#
# It is intended to run from cron on the database host (or a jump host with
# network access to the DB), e.g. daily at 02:30:
#   30 2 * * *  /opt/influenceos/scripts/backup-db.sh >> /var/log/influenceos-backup.log 2>&1
#
# Configuration (env, typically sourced from .env.production):
#   DATABASE_URL                 postgres connection string (required)
#     — or DIRECT_DATABASE_URL if you prefer the unpooled endpoint (preferred)
#   BACKUP_DIR                   local staging dir (default /var/backups/influenceos)
#   BACKUP_S3_BUCKET             remote bucket for off-host copies (optional but
#                                STRONGLY recommended — a backup on the same host
#                                is not a backup)
#   BACKUP_S3_ENDPOINT           S3 endpoint (for MinIO/other; omit for AWS)
#   BACKUP_S3_ACCESS_KEY_ID / BACKUP_S3_SECRET_ACCESS_KEY   remote creds
#   BACKUP_RETENTION_DAILY       keep N daily   (default 14)
#   BACKUP_RETENTION_WEEKLY      keep N weekly  (default 8)
#   BACKUP_RETENTION_MONTHLY     keep N monthly (default 6)
#
# Exit non-zero on any failure so cron / your monitoring alerts.
# ---------------------------------------------------------------------------
set -euo pipefail

log() { printf '%s [backup] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

DB_URL="${DIRECT_DATABASE_URL:-${DATABASE_URL:-}}"
[ -n "$DB_URL" ] || die "DATABASE_URL (or DIRECT_DATABASE_URL) is required."
command -v pg_dump >/dev/null || die "pg_dump not found (install postgresql-client)."

BACKUP_DIR="${BACKUP_DIR:-/var/backups/influenceos}"
RET_DAILY="${BACKUP_RETENTION_DAILY:-14}"
RET_WEEKLY="${BACKUP_RETENTION_WEEKLY:-8}"
RET_MONTHLY="${BACKUP_RETENTION_MONTHLY:-6}"

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly" "$BACKUP_DIR/monthly"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
DOW="$(date -u +%u)"    # 1..7 (Mon..Sun)
DOM="$(date -u +%d)"    # 01..31
FILE="influenceos-${STAMP}.dump"
DAILY_PATH="$BACKUP_DIR/daily/$FILE"

# --- Dump ------------------------------------------------------------------
# Custom format (-Fc) is compressed and restorable selectively with pg_restore.
log "Dumping database → $DAILY_PATH"
if ! pg_dump --dbname="$DB_URL" --format=custom --no-owner --no-privileges --file="$DAILY_PATH.tmp"; then
  rm -f "$DAILY_PATH.tmp"
  die "pg_dump failed."
fi
mv "$DAILY_PATH.tmp" "$DAILY_PATH"

# Integrity check: pg_restore --list must parse the archive TOC.
pg_restore --list "$DAILY_PATH" >/dev/null || die "Backup archive failed its integrity check."
SIZE="$(du -h "$DAILY_PATH" | cut -f1)"
log "Backup complete: $FILE ($SIZE)"

# Promote to weekly (Mondays) and monthly (1st of month) by hard link/copy.
if [ "$DOW" = "1" ]; then cp -f "$DAILY_PATH" "$BACKUP_DIR/weekly/$FILE"; log "Promoted to weekly."; fi
if [ "$DOM" = "01" ]; then cp -f "$DAILY_PATH" "$BACKUP_DIR/monthly/$FILE"; log "Promoted to monthly."; fi

# --- Off-host copy (S3) ----------------------------------------------------
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  command -v aws >/dev/null || die "aws CLI not found but BACKUP_S3_BUCKET is set."
  ENDPOINT_ARG=()
  [ -n "${BACKUP_S3_ENDPOINT:-}" ] && ENDPOINT_ARG=(--endpoint-url "$BACKUP_S3_ENDPOINT")
  log "Uploading to s3://$BACKUP_S3_BUCKET/daily/$FILE"
  AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY_ID:-${AWS_ACCESS_KEY_ID:-}}" \
  AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY:-${AWS_SECRET_ACCESS_KEY:-}}" \
    aws "${ENDPOINT_ARG[@]}" s3 cp "$DAILY_PATH" "s3://$BACKUP_S3_BUCKET/daily/$FILE" \
    || die "S3 upload failed."
  [ "$DOW" = "1" ] && AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY_ID:-${AWS_ACCESS_KEY_ID:-}}" AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY:-${AWS_SECRET_ACCESS_KEY:-}}" aws "${ENDPOINT_ARG[@]}" s3 cp "$DAILY_PATH" "s3://$BACKUP_S3_BUCKET/weekly/$FILE" >/dev/null
  [ "$DOM" = "01" ] && AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY_ID:-${AWS_ACCESS_KEY_ID:-}}" AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY:-${AWS_SECRET_ACCESS_KEY:-}}" aws "${ENDPOINT_ARG[@]}" s3 cp "$DAILY_PATH" "s3://$BACKUP_S3_BUCKET/monthly/$FILE" >/dev/null
  log "Off-host upload complete."
else
  log "WARNING: BACKUP_S3_BUCKET not set — backup exists only on this host. Configure a remote destination for real durability."
fi

# --- Local retention pruning (keep newest N in each tier) ------------------
prune() {
  local dir="$1" keep="$2"
  local files
  # List newest-first; delete everything past the keep count.
  mapfile -t files < <(ls -1t "$dir"/influenceos-*.dump 2>/dev/null || true)
  if [ "${#files[@]}" -gt "$keep" ]; then
    for f in "${files[@]:$keep}"; do rm -f "$f" && log "Pruned $(basename "$f")"; done
  fi
}
prune "$BACKUP_DIR/daily"   "$RET_DAILY"
prune "$BACKUP_DIR/weekly"  "$RET_WEEKLY"
prune "$BACKUP_DIR/monthly" "$RET_MONTHLY"

log "Done."
