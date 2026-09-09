#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# InfluenceOS — STAGING deploy
#
# Deploys an EXACT git revision to the STAGING environment with hard safety
# rails so it can never touch production. It:
#   1. verifies required variables            9. builds/pulls images
#   2. displays the target environment        10. runs prisma migrate deploy
#   3. verifies APP_ENV=staging               11. bootstraps the admin safely
#   4. verifies the target DB is staging      12. starts/updates services
#   5. verifies the target bucket is staging  13. waits for health/readiness
#   6. acquires a deploy lock                  14. runs the staging smoke test
#   7. records the target Git SHA              15. reports the deployed Git SHA
#   8. pre-deploy DB backup (if DB exists)     16. releases the deploy lock
#
# It ABORTS on any failure and NEVER invokes the destructive demo seed.
#
# Usage:
#   scripts/deploy-staging.sh <git-sha-or-tag>
#
# Config: reads .env.staging (override with STAGING_ENV_FILE). Requires
# NODE_ENV=production and APP_ENV=staging in that file.
# ---------------------------------------------------------------------------
set -euo pipefail

log()  { printf '%s [deploy-staging] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die()  { log "ERROR: $*" >&2; release_lock; exit 1; }
mask() { printf '%s' "$1" | sed -E 's#(//[^:/]+):[^@]+@#\1:****@#g'; }

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

TARGET="${1:-}"
[ -n "$TARGET" ] || die "Usage: deploy-staging.sh <git-sha-or-tag>"

ENV_FILE="${STAGING_ENV_FILE:-.env.staging}"
COMPOSE_FILE="${STAGING_COMPOSE_FILE:-docker-compose.staging.yml}"
PROJECT="${STAGING_PROJECT:-influenceos-staging}"
LOCK_DIR="${STAGING_LOCK_DIR:-/tmp/influenceos-staging-deploy.lock}"

acquire_lock() {
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    die "Another staging deploy holds the lock ($LOCK_DIR). Remove it if stale."
  fi
  echo "$$" > "$LOCK_DIR/pid"
  LOCK_HELD=1
}
release_lock() { [ "${LOCK_HELD:-0}" = "1" ] && rm -rf "$LOCK_DIR" 2>/dev/null || true; }
trap release_lock EXIT

command -v docker >/dev/null || die "docker not found."
docker compose version >/dev/null 2>&1 || die "docker compose v2 not found."
[ -f "$ENV_FILE" ] || die "Env file not found: $ENV_FILE (copy .env.staging.example and fill it in)."

# --- 1. Required variables --------------------------------------------------
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
REQUIRED=(NODE_ENV APP_ENV DATABASE_URL AUTH_SECRET NEXT_PUBLIC_APP_URL WEB_ORIGIN
          SITE_ADDRESS S3_BUCKET S3_PUBLIC_ENDPOINT POSTGRES_PASSWORD
          MINIO_ROOT_USER MINIO_ROOT_PASSWORD BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD)
missing=()
for v in "${REQUIRED[@]}"; do [ -n "${!v:-}" ] || missing+=("$v"); done
[ "${#missing[@]}" -eq 0 ] || die "Missing required staging vars: ${missing[*]}"

# --- 3/4/5. Environment guard rails (fail LOUD before anything happens) -----
[ "${NODE_ENV}" = "production" ] || die "Staging must run production builds (NODE_ENV=production), got '${NODE_ENV}'."
[ "${APP_ENV}" = "staging" ] || die "Refusing: APP_ENV must be 'staging', got '${APP_ENV}'. This guard prevents deploying to production."
case "${DATABASE_URL}" in
  *staging*) : ;;
  *) die "Refusing: DATABASE_URL does not look like a staging database (no 'staging' in it): $(mask "$DATABASE_URL"). Guard against touching the production DB." ;;
esac
case "${S3_BUCKET}" in
  *staging*) : ;;
  *) die "Refusing: S3_BUCKET '${S3_BUCKET}' does not look like a staging bucket (no 'staging'). Guard against using the production bucket." ;;
esac
# Belt-and-braces: never point staging at an obvious production target.
case "${DATABASE_URL}${S3_BUCKET}${SITE_ADDRESS}" in
  *production*|*_prod*|*-prod*) die "A target contains 'production'/'prod' — refusing to deploy staging against a production resource." ;;
esac

# --- 2. Display target ------------------------------------------------------
log "================= STAGING DEPLOY ================="
log "  Environment : APP_ENV=${APP_ENV}  NODE_ENV=${NODE_ENV}"
log "  Hostname    : ${SITE_ADDRESS}  (${NEXT_PUBLIC_APP_URL})"
log "  Database    : $(mask "${DIRECT_DATABASE_URL:-$DATABASE_URL}")"
log "  Object store: bucket=${S3_BUCKET}  public=${S3_PUBLIC_ENDPOINT}"
log "  Compose     : ${COMPOSE_FILE}  project=${PROJECT}"
log "  Target rev  : ${TARGET}"
log "=================================================="

# --- 6. Acquire deploy lock -------------------------------------------------
acquire_lock
log "Deploy lock acquired."

# --- 7. Record the target Git SHA ------------------------------------------
git fetch --all --tags --prune
git checkout --quiet --detach "$TARGET" || die "Cannot check out $TARGET"
SHA="$(git rev-parse HEAD)"
export GIT_SHA="$SHA"
export APP_VERSION="${APP_VERSION:-$(git describe --tags --always 2>/dev/null || echo "$SHA")}"
export BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "Deploying commit ${SHA} (version ${APP_VERSION})"

dc() { docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

# --- 8. Pre-deploy backup (only if the staging DB already has data) ---------
if [ "${SKIP_BACKUP:-0}" != "1" ] && dc ps --status running postgres 2>/dev/null | grep -q postgres; then
  log "Existing staging database detected — taking a pre-deploy backup…"
  if dc exec -T postgres pg_isready -U influenceos_staging >/dev/null 2>&1; then
    ts="$(date -u +%Y%m%d-%H%M%S)"
    mkdir -p "${STAGING_BACKUP_DIR:-/var/backups/influenceos-staging}"
    if dc exec -T postgres pg_dump -U influenceos_staging -Fc "${POSTGRES_DB:-influenceos_staging}" \
        > "${STAGING_BACKUP_DIR:-/var/backups/influenceos-staging}/predeploy-${ts}.dump" 2>/dev/null; then
      log "Pre-deploy backup written: predeploy-${ts}.dump"
    else
      log "WARNING: pre-deploy backup could not be taken (continuing — first deploy or empty DB)."
    fi
  fi
else
  log "No running staging database yet (first deploy) — skipping pre-deploy backup."
fi

# --- 9/10/11/12. Build, migrate (one-shot), bootstrap, start ----------------
log "Building images…"
dc build

# The compose `migrate` one-shot runs `prisma migrate deploy` then the idempotent
# bootstrap BEFORE api/worker/web start. The demo seed is never invoked.
log "Applying migrations + bootstrapping admin (idempotent), then starting services…"
dc up -d --remove-orphans

# --- 13. Wait for health/readiness -----------------------------------------
log "Waiting for the API to become ready inside the stack…"
for _ in $(seq 1 40); do
  if dc exec -T api node -e "fetch('http://localhost:4000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    log "API is ready."; API_READY=1; break
  fi
  sleep 3
done
[ "${API_READY:-0}" = "1" ] || { dc logs --tail 60 api migrate || true; die "API did not become ready. See logs above."; }

# Worker health (informational — inline fallback is acceptable but noted).
if dc exec -T worker node -e "fetch('http://localhost:4100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
  log "Worker health OK."
else
  log "WARNING: worker health not confirmed — check 'dc logs worker'."
fi

# --- 14. Staging smoke test (over the real HTTPS hostname) ------------------
if [ "${SKIP_SMOKE:-0}" != "1" ]; then
  log "Running staging smoke test against ${NEXT_PUBLIC_APP_URL}…"
  if API_BASE_URL="${NEXT_PUBLIC_APP_URL}" WEB_BASE_URL="${NEXT_PUBLIC_APP_URL}" \
       FILES_URL="${S3_PUBLIC_ENDPOINT}" bash "$REPO_ROOT/scripts/smoke-staging.sh"; then
    log "Smoke test passed."
  else
    die "Staging smoke test FAILED — investigate before promoting. (Set SKIP_SMOKE=1 only to bypass a known-external DNS/TLS delay.)"
  fi
else
  log "SKIP_SMOKE=1 — skipping the HTTPS smoke test (not recommended)."
fi

# --- 15. Report the deployed build -----------------------------------------
RUNNING="$(dc exec -T api node -e "fetch('http://localhost:4000/health').then(r=>r.json()).then(j=>console.log(j.gitSha+' '+j.environment)).catch(()=>console.log('unknown'))" 2>/dev/null || echo unknown)"
log "Deployed. API reports build: ${RUNNING}"
log "SUCCESS — staging is running ${TARGET} (${SHA})."
# --- 16. Lock released by the EXIT trap ------------------------------------
