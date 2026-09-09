#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# InfluenceOS — production rollback
#
# Redeploys a KNOWN-GOOD previous revision by its EXPLICIT git SHA/tag. Rollback
# is just a deploy of an earlier immutable revision — there is no "undo last
# deploy" guesswork; you name the target.
#
#   scripts/rollback-production.sh <previous-good-sha-or-tag>
#
# IMPORTANT — database migrations:
#   Application rollback is safe and fast. DATABASE rollback is NOT automatic:
#   `prisma migrate deploy` only rolls forward. If the bad release added a
#   migration that is incompatible with the older code, you must either
#     (a) roll back to a revision whose schema the DB still satisfies (additive
#         migrations are usually backward-compatible — old code ignores new
#         columns), or
#     (b) restore the pre-deploy backup with scripts/restore-db.sh and then
#         deploy the older revision.
#   This script will WARN and require --yes when the target predates the latest
#   applied migration.
# ---------------------------------------------------------------------------
set -euo pipefail

log() { printf '%s [rollback] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

TARGET="${1:-}"
CONFIRM="no"; [ "${2:-}" = "--yes" ] && CONFIRM="yes"
[ -n "$TARGET" ] || die "Usage: rollback-production.sh <previous-good-sha-or-tag> [--yes]"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.full.yml}"

git fetch --all --tags --prune
git rev-parse --verify "${TARGET}^{commit}" >/dev/null 2>&1 || die "Unknown revision: $TARGET"
SHA="$(git rev-parse "${TARGET}^{commit}")"

# Warn if rolling back across migrations.
CUR_MIGRATIONS="$(ls -1 packages/database/prisma/migrations 2>/dev/null | grep -c '^[0-9]' || echo 0)"
TGT_MIGRATIONS="$(git ls-tree -r --name-only "$SHA" -- packages/database/prisma/migrations 2>/dev/null | grep -c 'migration.sql' || echo 0)"
if [ "$TGT_MIGRATIONS" -lt "$CUR_MIGRATIONS" ] && [ "$CONFIRM" != "yes" ]; then
  log "WARNING: target $TARGET has FEWER migrations ($TGT_MIGRATIONS) than the current tree ($CUR_MIGRATIONS)."
  log "The database will NOT be downgraded automatically. If the newer migration is not"
  log "backward-compatible you must restore a backup (scripts/restore-db.sh) first."
  log "Re-run with:  scripts/rollback-production.sh $TARGET --yes"
  exit 2
fi

log "Rolling back to $TARGET ($SHA)…"
# Reuse the deploy path but skip its own pre-backup (we're recovering, and the
# operator has already decided on the DB strategy above).
SKIP_BACKUP=1 bash "$REPO_ROOT/scripts/deploy-production.sh" "$SHA"
log "Rollback to $TARGET complete."
