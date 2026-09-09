#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# InfluenceOS — production deploy
#
# Deploys an EXACT, immutable git revision (the SHA that passed CI) to the
# production host using docker compose. The revision you deploy is the revision
# you tested — never "latest", never a moving branch.
#
# Flow:
#   1. Resolve and check out the target SHA/tag (detached).
#   2. Take a pre-deploy database backup (safety net for the migration).
#   3. Inject release metadata (GIT_SHA / APP_VERSION / BUILD_TIME) so the
#      running build is self-identifying on /health and Settings → Platform.
#   4. Build images, apply migrations (prisma migrate deploy — NEVER db push),
#      then start services. compose waits on healthchecks; we then gate on
#      /health and /ready before declaring success.
#
# Usage:
#   scripts/deploy-production.sh <git-sha-or-tag>
#
# Required env (typically from /opt/influenceos/.env.production, kept out of git):
#   POSTGRES_PASSWORD MINIO_ROOT_USER MINIO_ROOT_PASSWORD AUTH_SECRET
#   BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD NEXT_PUBLIC_APP_URL WEB_ORIGIN
# Optional:
#   COMPOSE_FILE (default docker-compose.full.yml)
#   HEALTH_URL   (default http://localhost:4000)  — API base for health gating
#   SKIP_BACKUP=1 to skip the pre-deploy backup (NOT recommended)
# ---------------------------------------------------------------------------
set -euo pipefail

log() { printf '%s [deploy] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

TARGET="${1:-}"
[ -n "$TARGET" ] || die "Usage: deploy-production.sh <git-sha-or-tag>"
command -v docker >/dev/null || die "docker not found."
docker compose version >/dev/null 2>&1 || die "docker compose v2 not found."

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.full.yml}"
HEALTH_URL="${HEALTH_URL:-http://localhost:4000}"

# --- 1. Check out the exact revision --------------------------------------
log "Fetching and checking out $TARGET"
git fetch --all --tags --prune
git checkout --quiet --detach "$TARGET" || die "Cannot check out $TARGET"
SHA="$(git rev-parse HEAD)"
log "Deploying commit $SHA"

# --- 2. Pre-deploy safety backup ------------------------------------------
if [ "${SKIP_BACKUP:-0}" != "1" ]; then
  log "Taking a pre-deploy database backup…"
  # Run backup inside the running postgres container's network via a temporary
  # client, or on the host if DATABASE_URL is reachable. Best-effort but loud.
  if [ -n "${DATABASE_URL:-}" ] && command -v pg_dump >/dev/null; then
    bash "$REPO_ROOT/scripts/backup-db.sh" || die "Pre-deploy backup failed — aborting."
  else
    log "WARNING: could not run host backup (no pg_dump/DATABASE_URL). Ensure a recent backup exists before continuing."
  fi
fi

# --- 3. Release metadata ---------------------------------------------------
export GIT_SHA="$SHA"
export APP_VERSION="${APP_VERSION:-$(git describe --tags --always 2>/dev/null || echo "$SHA")}"
export BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "Release: version=$APP_VERSION sha=${SHA:0:12} built=$BUILD_TIME"

# --- 4. Build, migrate, start ---------------------------------------------
log "Building images…"
docker compose -f "$COMPOSE_FILE" build

# The `migrate` one-shot in the compose file runs `prisma migrate deploy` and
# the idempotent bootstrap before api/worker/web start.
log "Applying migrations and starting services…"
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

# --- Health gate -----------------------------------------------------------
gate() {
  local url="$1" name="$2" tries=30
  log "Waiting for $name ($url)…"
  for _ in $(seq 1 "$tries"); do
    if curl -fsS -o /dev/null "$url"; then log "$name OK"; return 0; fi
    sleep 3
  done
  return 1
}
gate "$HEALTH_URL/health" "API liveness" || die "API /health did not come up. Investigate: docker compose -f $COMPOSE_FILE logs api"
gate "$HEALTH_URL/ready"  "API readiness" || die "API /ready did not become ready (dependency down). Check DB/Redis."

RUNNING_SHA="$(curl -fsS "$HEALTH_URL/health" | grep -o '"gitSha":"[^"]*"' || true)"
log "Deployed. Reported build: ${RUNNING_SHA:-unknown}"
log "Post-deploy: run scripts/smoke-test.sh $HEALTH_URL to verify key journeys."
log "SUCCESS — $TARGET is live."
