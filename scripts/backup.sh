#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# InfluenceOS — nightly backup for Docker Compose deployments
#
# Backs up BOTH halves of the system and records each run in the database so
# Settings → Platform shows when the last good copy was taken:
#
#   1. Database  — pg_dump (custom format) taken inside the postgres container,
#                  integrity-checked with pg_restore --list, kept with a
#                  daily / weekly / monthly rotation.
#   2. Files     — every uploaded file, mirrored out of MinIO with mc
#                  (incremental: only new or changed files are copied).
#   3. Off-server— when BACKUP_S3_BUCKET is set, both are copied with rclone to
#                  any S3-compatible bucket (Backblaze B2, Cloudflare R2, AWS,
#                  Wasabi …), encrypted first when BACKUP_ENCRYPTION_PASSWORD
#                  is set. A backup that lives only on this server is lost with
#                  the server.
#   4. Restore test (weekly, and with --restore-test) — the newest dump is
#                  restored into a scratch database and sanity-checked, then
#                  dropped.
#
# Run from the project directory on the server (where docker-compose and .env
# live). Cron example, every night at 02:30 server time:
#   30 2 * * *  cd /opt/influenceos && scripts/backup.sh >> /var/log/influenceos-backup.log 2>&1
#
# Before every update, take an extra database copy:
#   scripts/backup.sh --db-only
#
# Options:
#   --db-only        database only (fast; use right before a deploy)
#   --files-only     uploaded files only
#   --restore-test   also run the restore test now (it runs weekly by itself)
#   --no-offsite     skip the off-server copy for this run
#
# Settings (environment, or BACKUP_* lines in the project's .env):
#   BACKUP_DIR                 local folder (default /var/backups/influenceos)
#   BACKUP_RETENTION_DAILY     local daily dumps kept   (default 14)
#   BACKUP_RETENTION_WEEKLY    local weekly dumps kept  (default 8)
#   BACKUP_RETENTION_MONTHLY   local monthly dumps kept (default 6)
#   BACKUP_S3_BUCKET           off-server bucket (optional, strongly recommended)
#   BACKUP_S3_PREFIX           folder inside it (default influenceos)
#   BACKUP_S3_ENDPOINT         endpoint URL (omit for AWS)
#   BACKUP_S3_REGION           region (optional)
#   BACKUP_S3_PROVIDER         rclone S3 provider name (default Other; e.g. Cloudflare, AWS, Wasabi)
#   BACKUP_S3_ACCESS_KEY_ID / BACKUP_S3_SECRET_ACCESS_KEY
#   BACKUP_ENCRYPTION_PASSWORD encrypt everything before it leaves the server
#                              (rclone crypt). KEEP A COPY OF IT ELSEWHERE — without
#                              it the off-server copy cannot be read.
#   BACKUP_REMOTE_KEEP_DAYS    delete off-server daily dumps older than this (default 35)
#   BACKUP_RESTORE_TEST_DAY    weekday for the automatic restore test, 1=Mon … 7=Sun (default 5, Friday)
#   BACKUP_HEALTHCHECK_URL     pinged on success, <url>/fail on failure (e.g. Healthchecks.io)
#   BACKUP_PG_USER / BACKUP_PG_DB   default postgres / influenceos
#   BACKUP_APP_BUCKET          MinIO bucket holding uploads (default influenceos)
#   BACKUP_RCLONE_IMAGE        used when rclone is not installed (default rclone/rclone:1.68)
#
# Exits non-zero when any part failed, so cron mail / the health ping alerts.
# ---------------------------------------------------------------------------
set -euo pipefail

log() { printf '%s [backup] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# BACKUP_* settings may live in .env next to the compose files. Read only those
# keys (never `source` the whole file — its other values aren't shell-safe).
if [ -f .env ]; then
  while IFS= read -r line; do
    key="${line%%=*}"
    [ -n "${!key:-}" ] && continue # an explicitly exported value wins
    val="${line#*=}"
    val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
    export "$key=$val"
  done < <(grep -E '^BACKUP_[A-Z0-9_]+=' .env || true)
fi

DO_DB=1 DO_FILES=1 FORCE_RESTORE_TEST=0 OFFSITE=1
for arg in "$@"; do
  case "$arg" in
    --db-only) DO_FILES=0 ;;
    --files-only) DO_DB=0 ;;
    --restore-test) FORCE_RESTORE_TEST=1 ;;
    --no-offsite) OFFSITE=0 ;;
    -h|--help) sed -n '2,60p' "$0"; exit 0 ;;
    *) die "Unknown option: $arg (see --help)" ;;
  esac
done

command -v docker >/dev/null || die "docker not found."
docker compose version >/dev/null 2>&1 || die "docker compose v2 not found."

BACKUP_DIR="${BACKUP_DIR:-/var/backups/influenceos}"
PG_USER="${BACKUP_PG_USER:-postgres}"
PG_DB="${BACKUP_PG_DB:-influenceos}"
APP_BUCKET="${BACKUP_APP_BUCKET:-influenceos}"
RET_DAILY="${BACKUP_RETENTION_DAILY:-14}"
RET_WEEKLY="${BACKUP_RETENTION_WEEKLY:-8}"
RET_MONTHLY="${BACKUP_RETENTION_MONTHLY:-6}"
RESTORE_DAY="${BACKUP_RESTORE_TEST_DAY:-5}"
mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly" "$BACKUP_DIR/monthly" "$BACKUP_DIR/files"
chmod 700 "$BACKUP_DIR"

# One run at a time (a slow off-server upload must not overlap the next night).
exec 9>"$BACKUP_DIR/.lock"
flock -n 9 || die "Another backup is still running."

dc() { docker compose "$@"; }
pg() { dc exec -T postgres "$@"; }

FAILED=0
FAIL_REASONS=()
fail() {
  FAILED=1
  FAIL_REASONS+=("$1")
  log "FAILED: $1" >&2
}

# Record a run in the BackupRun table (best effort: a backup must never fail
# just because the bookkeeping row couldn't be written).
record() { # kind ok(true|false) startedAt sizeBytes|'' offsite(true|false) message
  local msg="${6//\'/\'\'}" size="${4:-NULL}"
  [ -n "$4" ] || size=NULL
  pg psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -q -c \
    "INSERT INTO \"BackupRun\" (id, kind, ok, \"startedAt\", \"sizeBytes\", offsite, message)
     VALUES (gen_random_uuid()::text, '$1', $2, '$3', $size, $5, NULLIF('${msg:0:500}', ''))" >/dev/null 2>&1 \
    || log "WARNING: could not record the $1 run in the database."
}

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# --- Off-server copy (rclone) ----------------------------------------------
REMOTE=""
rclone_run() {
  local env_args=(
    -e RCLONE_CONFIG_OFFSITE_TYPE=s3
    -e "RCLONE_CONFIG_OFFSITE_PROVIDER=${BACKUP_S3_PROVIDER:-Other}"
    -e "RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID=${BACKUP_S3_ACCESS_KEY_ID:-}"
    -e "RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY=${BACKUP_S3_SECRET_ACCESS_KEY:-}"
    -e "RCLONE_CONFIG_OFFSITE_ENDPOINT=${BACKUP_S3_ENDPOINT:-}"
    -e "RCLONE_CONFIG_OFFSITE_REGION=${BACKUP_S3_REGION:-}"
    -e RCLONE_CONFIG_OFFSITE_NO_CHECK_BUCKET=true
  )
  if [ -n "${SEALED_PASSWORD:-}" ]; then
    env_args+=(
      -e RCLONE_CONFIG_SEALED_TYPE=crypt
      -e "RCLONE_CONFIG_SEALED_REMOTE=offsite:${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX:-influenceos}"
      -e "RCLONE_CONFIG_SEALED_PASSWORD=$SEALED_PASSWORD"
    )
  fi
  if command -v rclone >/dev/null; then
    # Same settings, host binary: turn "-e K=V" pairs into an env prefix.
    local envs=() i
    for ((i = 1; i < ${#env_args[@]}; i += 2)); do envs+=("${env_args[$i]}"); done
    env "${envs[@]}" rclone "$@"
  else
    docker run --rm -i -v "$BACKUP_DIR:/data:ro" "${env_args[@]}" \
      "${BACKUP_RCLONE_IMAGE:-rclone/rclone:1.68}" "$@"
  fi
}
# Paths under the backup dir as rclone sees them (container mounts it at /data).
local_path() { if command -v rclone >/dev/null; then echo "$BACKUP_DIR/$1"; else echo "/data/$1"; fi; }

setup_offsite() {
  [ "$OFFSITE" = 1 ] && [ -n "${BACKUP_S3_BUCKET:-}" ] || return 1
  if [ -n "${BACKUP_ENCRYPTION_PASSWORD:-}" ]; then
    SEALED_PASSWORD="$(printf '%s' "$BACKUP_ENCRYPTION_PASSWORD" | rclone_run obscure -)" \
      || { fail "could not prepare off-server encryption"; return 1; }
    REMOTE="sealed:"
  else
    REMOTE="offsite:${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX:-influenceos}/"
  fi
  return 0
}

# --- 1. Database -----------------------------------------------------------
prune() {
  local dir="$1" keep="$2" files
  mapfile -t files < <(ls -1t "$dir"/influenceos-*.dump 2>/dev/null || true)
  if [ "${#files[@]}" -gt "$keep" ]; then
    for f in "${files[@]:$keep}"; do rm -f "$f" && log "Pruned $(basename "$f")"; done
  fi
}

DB_FILE=""
backup_database() {
  local started stamp tmp size
  started="$(now)"
  stamp="$(date -u +%Y%m%d-%H%M%S)"
  DB_FILE="$BACKUP_DIR/daily/influenceos-$stamp.dump"
  tmp="$DB_FILE.tmp"
  log "Dumping database $PG_DB → $DB_FILE"
  if ! pg pg_dump -U "$PG_USER" -d "$PG_DB" --format=custom --no-owner --no-privileges >"$tmp"; then
    rm -f "$tmp"; DB_FILE=""
    fail "database dump"; record database false "$started" "" false "pg_dump failed"; return
  fi
  if ! pg pg_restore --list <"$tmp" >/dev/null; then
    rm -f "$tmp"; DB_FILE=""
    fail "database dump integrity check"; record database false "$started" "" false "archive failed pg_restore --list"; return
  fi
  mv "$tmp" "$DB_FILE"
  chmod 600 "$DB_FILE"
  size="$(stat -c %s "$DB_FILE")"
  if [ "$(date -u +%u)" = 1 ]; then cp -f "$DB_FILE" "$BACKUP_DIR/weekly/" && log "Promoted to weekly."; fi
  if [ "$(date -u +%d)" = 01 ]; then cp -f "$DB_FILE" "$BACKUP_DIR/monthly/" && log "Promoted to monthly."; fi
  prune "$BACKUP_DIR/daily" "$RET_DAILY"
  prune "$BACKUP_DIR/weekly" "$RET_WEEKLY"
  prune "$BACKUP_DIR/monthly" "$RET_MONTHLY"
  log "Database backup OK ($(du -h "$DB_FILE" | cut -f1))."

  local offsite=false
  if [ -n "$REMOTE" ]; then
    if rclone_run copy "$(local_path daily)" "${REMOTE}db/daily" \
       && rclone_run copy "$(local_path weekly)" "${REMOTE}db/weekly" \
       && rclone_run copy "$(local_path monthly)" "${REMOTE}db/monthly"; then
      offsite=true
      log "Database copied off-server."
      rclone_run delete --min-age "${BACKUP_REMOTE_KEEP_DAYS:-35}d" "${REMOTE}db/daily" \
        || log "WARNING: could not prune old off-server dumps."
    else
      fail "database off-server copy"
    fi
  fi
  record database true "$started" "$size" "$offsite" ""
}

# --- 2. Uploaded files -----------------------------------------------------
backup_files() {
  local started size offsite=false
  started="$(now)"
  log "Mirroring uploaded files (bucket $APP_BUCKET) → $BACKUP_DIR/files"
  # A throwaway container from the minio service: same image (it ships mc),
  # same network and credentials. Mirror only adds and updates — a file
  # deleted in the app stays in the backup.
  # shellcheck disable=SC2016 # expanded inside the container
  if ! dc run --rm --no-deps -T -v "$BACKUP_DIR/files:/backup" --entrypoint sh minio -c \
       'mc alias set src http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mc mirror --overwrite src/'"$APP_BUCKET"' /backup >/dev/null'; then
    fail "file mirror"; record files false "$started" "" false "mc mirror failed"; return
  fi
  size="$(du -sb "$BACKUP_DIR/files" | cut -f1)"
  log "Files mirrored ($(du -sh "$BACKUP_DIR/files" | cut -f1))."
  if [ -n "$REMOTE" ]; then
    # copy, not sync: nothing is ever deleted off-server by this job.
    if rclone_run copy "$(local_path files)" "${REMOTE}files"; then
      offsite=true
      log "Files copied off-server."
    else
      fail "files off-server copy"
    fi
  fi
  record files true "$started" "$size" "$offsite" ""
}

# --- 3. Restore test -------------------------------------------------------
restore_test() {
  local started dump scratch counts
  started="$(now)"
  dump="${DB_FILE:-$( (ls -1t "$BACKUP_DIR"/daily/influenceos-*.dump 2>/dev/null || true) | head -1)}"
  [ -n "$dump" ] || { fail "restore test (no dump to test)"; record restore-test false "$started" "" false "no dump found"; return; }
  scratch="restore_check_$(date -u +%Y%m%d%H%M%S)"
  log "Restore test: $(basename "$dump") → scratch database $scratch"
  local sql="SELECT (SELECT count(*) FROM \"User\") || ' users, ' || (SELECT count(*) FROM \"Influencer\") || ' creators, ' || (SELECT count(*) FROM \"Campaign\") || ' campaigns'"
  # A dump that restores but holds no users is as bad as no dump at all.
  if pg createdb -U "$PG_USER" "$scratch" \
     && pg pg_restore -U "$PG_USER" -d "$scratch" --no-owner --no-privileges --exit-on-error <"$dump" \
     && counts="$(pg psql -U "$PG_USER" -d "$scratch" -tAc "$sql")" \
     && [ "${counts%% *}" -gt 0 ] 2>/dev/null; then
    log "Restore test OK: $counts"
    record restore-test true "$started" "$(stat -c %s "$dump")" false "$counts"
  else
    fail "restore test"
    record restore-test false "$started" "" false "restore of $(basename "$dump") failed"
  fi
  pg dropdb -U "$PG_USER" --if-exists "$scratch" >/dev/null 2>&1 || log "WARNING: could not drop $scratch"
}

# --- Run -------------------------------------------------------------------
if [ -z "${BACKUP_S3_BUCKET:-}" ]; then
  log "WARNING: BACKUP_S3_BUCKET not set — backups exist only on this server."
fi
setup_offsite || true

if [ "$DO_DB" = 1 ]; then backup_database; fi
if [ "$DO_FILES" = 1 ]; then backup_files; fi
if [ "$FORCE_RESTORE_TEST" = 1 ] || { [ "$DO_DB" = 1 ] && [ "$(date -u +%u)" = "$RESTORE_DAY" ]; }; then
  restore_test
fi

ping() { [ -z "${BACKUP_HEALTHCHECK_URL:-}" ] || curl -fsS -m 10 --retry 3 "$@" >/dev/null 2>&1 || true; }
if [ "$FAILED" = 1 ]; then
  ping --data-raw "${FAIL_REASONS[*]}" "${BACKUP_HEALTHCHECK_URL%/}/fail"
  die "Backup finished with failures: ${FAIL_REASONS[*]}"
fi
ping "${BACKUP_HEALTHCHECK_URL:-}"
log "Done."
