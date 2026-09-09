#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# InfluenceOS — restore verification (backup drill)
#
# Proves the backup pipeline actually round-trips: dump the source database,
# restore it into a throwaway scratch database, verify the schema and row
# counts survived, then drop the scratch database. A backup you have never
# restored is a guess, not a backup — run this on a schedule (e.g. weekly) and
# in CI.
#
# Usage:
#   scripts/restore-test.sh                # dump SOURCE and restore to scratch
#   SOURCE_DATABASE_URL=... scripts/restore-test.sh
#
# Env:
#   SOURCE_DATABASE_URL   DB to dump (default: DIRECT_DATABASE_URL/DATABASE_URL)
#   SCRATCH_DB            scratch db name (default influenceos_restore_test)
#   ADMIN_DATABASE_URL    a URL to a maintenance DB (e.g. .../postgres) used to
#                         CREATE/DROP the scratch DB (default: derive from source)
#
# Exits 0 only if the restored copy matches the source table inventory.
# ---------------------------------------------------------------------------
set -euo pipefail

log() { printf '%s [restore-test] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

SOURCE="${SOURCE_DATABASE_URL:-${DIRECT_DATABASE_URL:-${DATABASE_URL:-}}}"
[ -n "$SOURCE" ] || die "Set SOURCE_DATABASE_URL (or DATABASE_URL)."
command -v pg_dump >/dev/null || die "pg_dump not found."
command -v pg_restore >/dev/null || die "pg_restore not found."
command -v psql >/dev/null || die "psql not found."

SCRATCH_DB="${SCRATCH_DB:-influenceos_restore_test}"

# Derive an admin URL (connect to the 'postgres' maintenance DB on the same
# server) so we can create/drop the scratch database.
if [ -n "${ADMIN_DATABASE_URL:-}" ]; then
  ADMIN="$ADMIN_DATABASE_URL"
else
  # Replace the path (/dbname[?params]) with /postgres, keeping credentials/host.
  ADMIN="$(printf '%s' "$SOURCE" | sed -E 's#(://[^/]+)/[^?]+#\1/postgres#')"
fi
# The scratch DB URL: swap the db name into the source URL.
SCRATCH_URL="$(printf '%s' "$SOURCE" | sed -E "s#(://[^/]+)/[^?]+#\1/${SCRATCH_DB}#")"

DUMP="$(mktemp /tmp/influenceos-drill-XXXXXX.dump)"
cleanup() {
  rm -f "$DUMP"
  psql "$ADMIN" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\";" >/dev/null 2>&1 || true
}
trap cleanup EXIT

log "Dumping source…"
pg_dump --dbname="$SOURCE" --format=custom --no-owner --no-privileges --file="$DUMP"
pg_restore --list "$DUMP" >/dev/null || die "Dump failed integrity check."

log "Creating scratch database '$SCRATCH_DB'…"
psql "$ADMIN" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\";" >/dev/null
psql "$ADMIN" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$SCRATCH_DB\";" >/dev/null

log "Restoring into scratch…"
pg_restore --dbname="$SCRATCH_URL" --no-owner --no-privileges --exit-on-error "$DUMP"

# --- Verify: table inventory matches, and key tables are queryable. --------
src_tables="$(psql "$SOURCE"      -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")"
dst_tables="$(psql "$SCRATCH_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")"
log "Public tables — source: $src_tables, restored: $dst_tables"
[ "$src_tables" = "$dst_tables" ] || die "Table count mismatch after restore."
[ "$src_tables" -gt 0 ] || die "No tables restored."

src_users="$(psql "$SOURCE"      -tAc 'SELECT count(*) FROM "User";' 2>/dev/null || echo ERR)"
dst_users="$(psql "$SCRATCH_URL" -tAc 'SELECT count(*) FROM "User";' 2>/dev/null || echo ERR)"
[ "$dst_users" != "ERR" ] || die "Restored DB missing the User table."
log "User rows — source: $src_users, restored: $dst_users"
[ "$src_users" = "$dst_users" ] || die "User row count mismatch ($src_users vs $dst_users)."

log "PASS — backup restores cleanly and matches the source inventory."
