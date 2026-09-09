#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# InfluenceOS — PostgreSQL restore
#
# Restores a pg_dump custom-format archive (produced by backup-db.sh) into a
# target database. This is a DESTRUCTIVE operation against the target: it drops
# and recreates the public schema before loading. It refuses to run without an
# explicit confirmation.
#
# Usage:
#   scripts/restore-db.sh <backup-file.dump> [--target <DATABASE_URL>] --yes
#   scripts/restore-db.sh s3://bucket/daily/influenceos-....dump --yes   # fetch first
#
# Env:
#   DATABASE_URL / DIRECT_DATABASE_URL   default target if --target not given
#   BACKUP_S3_ENDPOINT / BACKUP_S3_ACCESS_KEY_ID / BACKUP_S3_SECRET_ACCESS_KEY
#     used when the source is an s3:// URL
#
# Recommended: practise restores regularly into a scratch database
# (see scripts/restore-test.sh) so recovery is a known quantity, not a hope.
# ---------------------------------------------------------------------------
set -euo pipefail

log() { printf '%s [restore] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

SRC=""
TARGET="${DIRECT_DATABASE_URL:-${DATABASE_URL:-}}"
CONFIRM="no"
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --yes|-y) CONFIRM="yes"; shift ;;
    -*) die "Unknown option: $1" ;;
    *) SRC="$1"; shift ;;
  esac
done

[ -n "$SRC" ] || die "Usage: restore-db.sh <backup-file|s3-url> [--target URL] --yes"
[ -n "$TARGET" ] || die "No target database (set DATABASE_URL or pass --target)."
command -v pg_restore >/dev/null || die "pg_restore not found (install postgresql-client)."
command -v psql >/dev/null || die "psql not found (install postgresql-client)."

# Fetch from S3 if the source is a bucket URL.
CLEANUP=""
if [[ "$SRC" == s3://* ]]; then
  command -v aws >/dev/null || die "aws CLI required to fetch an s3:// source."
  TMP="$(mktemp /tmp/influenceos-restore-XXXXXX.dump)"
  CLEANUP="$TMP"
  ENDPOINT_ARG=()
  [ -n "${BACKUP_S3_ENDPOINT:-}" ] && ENDPOINT_ARG=(--endpoint-url "$BACKUP_S3_ENDPOINT")
  log "Fetching $SRC"
  AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY_ID:-${AWS_ACCESS_KEY_ID:-}}" \
  AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY:-${AWS_SECRET_ACCESS_KEY:-}}" \
    aws "${ENDPOINT_ARG[@]}" s3 cp "$SRC" "$TMP" || die "Failed to fetch backup from S3."
  SRC="$TMP"
fi
trap '[ -n "$CLEANUP" ] && rm -f "$CLEANUP"' EXIT

[ -f "$SRC" ] || die "Backup file not found: $SRC"
pg_restore --list "$SRC" >/dev/null || die "Source is not a valid pg_dump custom archive."

# Never wipe a database without an explicit go-ahead.
if [ "$CONFIRM" != "yes" ]; then
  log "About to DROP and reload the public schema of the target database."
  log "Re-run with --yes to proceed. Target host: $(printf '%s' "$TARGET" | sed -E 's#(//[^:]+):[^@]+@#\1:****@#')"
  exit 2
fi

log "Resetting target schema…"
psql "$TARGET" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;" >/dev/null

log "Restoring archive…"
# --exit-on-error surfaces any load failure; --no-owner/--no-privileges keep the
# restore portable across role names.
pg_restore --dbname="$TARGET" --no-owner --no-privileges --exit-on-error "$SRC"

# Sanity check: the User table should exist and be queryable post-restore.
COUNT="$(psql "$TARGET" -tAc 'SELECT count(*) FROM "User";' 2>/dev/null || echo 'ERR')"
[ "$COUNT" != "ERR" ] || die "Post-restore sanity check failed (User table not queryable)."
log "Restore complete. User rows: $COUNT"
log "NEXT: run 'pnpm --filter @influenceos/database migrate:deploy' if the backup predates newer migrations."
