#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# InfluenceOS — STAGING backup / restore / disaster-recovery drill
#
# Proves the backup pipeline on STAGING before production promotion. It:
#   1. asserts the target is staging (never production)
#   2. takes a fresh backup of the staging database
#   3. restores it into a NEW temporary database (does NOT touch the live DB)
#   4. verifies the schema (table inventory matches)
#   5. verifies representative records (users / brands / campaigns / attachments)
#   6. drops the temporary database
#
# This is the executable, NON-destructive core of the DR drill. The full
# app-level recovery drill (stop app → restore into primary → restart → verify)
# is destructive to the live staging environment and is documented as an
# operator procedure in docs/STAGING.md; run it once during staging acceptance
# and record the result in docs/STAGING_ACCEPTANCE.md.
#
# Usage:
#   SOURCE_DATABASE_URL=postgresql://…/influenceos_staging scripts/dr-drill-staging.sh
# Env:
#   SOURCE_DATABASE_URL   staging DB (default DIRECT_DATABASE_URL/DATABASE_URL)
#   ADMIN_DATABASE_URL    maintenance DB for CREATE/DROP (default: derive /postgres)
#   SCRATCH_DB            temp restore db name (default influenceos_staging_drill)
# ---------------------------------------------------------------------------
set -euo pipefail

log() { printf '%s [dr-drill] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }
mask() { printf '%s' "$1" | sed -E 's#(//[^:/]+):[^@]+@#\1:****@#g'; }

SOURCE="${SOURCE_DATABASE_URL:-${DIRECT_DATABASE_URL:-${DATABASE_URL:-}}}"
[ -n "$SOURCE" ] || die "Set SOURCE_DATABASE_URL (the staging database)."
command -v pg_dump >/dev/null || die "pg_dump not found."
command -v pg_restore >/dev/null || die "pg_restore not found."
command -v psql >/dev/null || die "psql not found."

# --- 1. Staging guard -------------------------------------------------------
case "$SOURCE" in
  *staging*) : ;;
  *) die "Refusing: source does not look like a staging database ($(mask "$SOURCE")). This drill only runs against staging." ;;
esac
case "$SOURCE" in *production*|*_prod*|*-prod*) die "Source contains 'production'/'prod' — refusing." ;; esac

SCRATCH_DB="${SCRATCH_DB:-influenceos_staging_drill}"
case "$SCRATCH_DB" in *staging*|*drill*) : ;; *) die "SCRATCH_DB must contain 'staging' or 'drill' as a safety marker."; esac

if [ -n "${ADMIN_DATABASE_URL:-}" ]; then ADMIN="$ADMIN_DATABASE_URL"
else ADMIN="$(printf '%s' "$SOURCE" | sed -E 's#(://[^/]+)/[^?]+#\1/postgres#')"; fi
SCRATCH_URL="$(printf '%s' "$SOURCE" | sed -E "s#(://[^/]+)/[^?]+#\1/${SCRATCH_DB}#")"

log "Source (staging): $(mask "$SOURCE")"
log "Scratch restore DB: ${SCRATCH_DB}"

DUMP="$(mktemp /tmp/influenceos-staging-drill-XXXXXX.dump)"
cleanup() {
  rm -f "$DUMP"
  psql "$ADMIN" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\";" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# --- 2. Backup --------------------------------------------------------------
log "Backing up the staging database…"
pg_dump --dbname="$SOURCE" --format=custom --no-owner --no-privileges --file="$DUMP"
pg_restore --list "$DUMP" >/dev/null || die "Backup failed its integrity check."
log "Backup OK ($(du -h "$DUMP" | cut -f1))."

# --- 3. Restore into a temporary database ----------------------------------
log "Creating + restoring into ${SCRATCH_DB}…"
psql "$ADMIN" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\";" >/dev/null
psql "$ADMIN" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$SCRATCH_DB\";" >/dev/null
pg_restore --dbname="$SCRATCH_URL" --no-owner --no-privileges --exit-on-error "$DUMP"

# --- 4. Schema verification -------------------------------------------------
src_t="$(psql "$SOURCE"      -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")"
dst_t="$(psql "$SCRATCH_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")"
log "Public tables — source: $src_t, restored: $dst_t"
[ "$src_t" = "$dst_t" ] && [ "$src_t" -gt 0 ] || die "Schema mismatch after restore."

# --- 5. Representative record verification ----------------------------------
ok=1
for t in User Brand Campaign Influencer Attachment; do
  s="$(psql "$SOURCE"      -tAc "SELECT count(*) FROM \"$t\";" 2>/dev/null || echo ERR)"
  d="$(psql "$SCRATCH_URL" -tAc "SELECT count(*) FROM \"$t\";" 2>/dev/null || echo ERR)"
  if [ "$s" = "ERR" ] || [ "$d" = "ERR" ]; then log "  ! $t: not queryable (ERR)"; ok=0; continue; fi
  if [ "$s" = "$d" ]; then log "  ✓ $t rows match ($s)"; else log "  ✗ $t mismatch (source $s vs restored $d)"; ok=0; fi
done
[ "$ok" = "1" ] || die "Representative-record verification FAILED — staging is NOT approved for production promotion."

log "PASS — staging backup restores cleanly with matching schema and records."
log "Record this result (and the app-level recovery drill from docs/STAGING.md) in docs/STAGING_ACCEPTANCE.md."
