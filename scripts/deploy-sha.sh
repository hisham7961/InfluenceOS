#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# InfluenceOS — deploy an exact CI-built release from GHCR (pull-based).
#
# For servers that run the images CI built and tested (docker-compose.registry.yml
# in COMPOSE_FILE), instead of building on the host:
#
#   scripts/deploy-sha.sh <git-sha>     deploy that build
#   scripts/deploy-sha.sh --rollback    go back to the build deployed before this one
#   scripts/deploy-sha.sh --status      show what is running and the deploy history
#
# Each deploy:
#   1. checks the SHA looks like a commit and its images exist in the registry;
#   2. takes a database copy first (scripts/backup.sh --db-only), unless
#      SKIP_BACKUP=1;
#   3. pins IMAGE_TAG=<sha> in .env (so a later `docker compose up -d` or a
#      reboot keeps this build instead of drifting to :latest), pulls, and
#      starts — the `migrate` one-shot applies migrations before the app;
#   4. waits for the API to report ready and the web to answer;
#   5. records the SHA in .deploy-history (newest last);
#   6. removes registry images of builds older than the last KEEP_RELEASES
#      (default 3), so the disk doesn't fill up but a rollback stays one pull
#      away.
# If the new build doesn't come up healthy, it says so and prints the command
# to go back; it doesn't roll back on its own (migrations may have run).
#
# Run from the project directory on the server (where .env and the compose
# files are). Needs: docker compose v2, and `docker login ghcr.io` done once.
# ---------------------------------------------------------------------------
set -euo pipefail

log() { printf '%s [deploy] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

cd "$(dirname "$0")/.."
HISTORY=".deploy-history"
KEEP_RELEASES="${KEEP_RELEASES:-3}"
command -v docker >/dev/null || die "docker not found."
docker compose version >/dev/null 2>&1 || die "docker compose v2 not found."
[ -f .env ] || die "No .env here — run this from the project directory on the server."

current_tag() { grep -E '^IMAGE_TAG=' .env | tail -1 | cut -d= -f2- | tr -d '"' || true; }

case "${1:-}" in
  --status)
    log "IMAGE_TAG in .env: $(current_tag || echo '(not set — :latest)')"
    [ -f "$HISTORY" ] && { log "Deploy history (newest last):"; tail -n 10 "$HISTORY"; } || log "No deploy history yet."
    docker compose ps
    exit 0
    ;;
  --rollback)
    [ -f "$HISTORY" ] || die "No deploy history — name the SHA to go back to: scripts/deploy-sha.sh <sha>"
    CURRENT="$(tail -n 1 "$HISTORY" | awk '{print $2}')"
    TARGET="$(awk '{print $2}' "$HISTORY" | grep -v -x "$CURRENT" | tail -n 1 || true)"
    [ -n "$TARGET" ] || die "No earlier build in $HISTORY to go back to."
    log "Rolling back from ${CURRENT:0:12} to ${TARGET:0:12}."
    log "Note: the database is NOT rolled back. If the newer build added a migration the older one can't work with, restore the pre-deploy copy (scripts/restore-db.sh) first."
    ;;
  ''|-h|--help)
    sed -n '2,30p' "$0"; exit 0 ;;
  *)
    TARGET="$1" ;;
esac

[[ "$TARGET" =~ ^[0-9a-f]{7,40}$ ]] || die "'$TARGET' is not a commit SHA (7–40 hex characters)."

# --- 1. The images exist -----------------------------------------------------
export IMAGE_TAG="$TARGET"
log "Pulling images for ${TARGET:0:12}…"
docker compose pull migrate api worker web || die "Could not pull images tagged $TARGET. Did CI finish for this commit (the 'images' job)? Is 'docker login ghcr.io' done?"

# --- 2. Database copy first --------------------------------------------------
if [ "${SKIP_BACKUP:-0}" != "1" ] && [ -x scripts/backup.sh ]; then
  log "Taking a database copy before deploying…"
  scripts/backup.sh --db-only --no-offsite || die "Pre-deploy backup failed — not deploying. (SKIP_BACKUP=1 to override, not recommended.)"
else
  log "Skipping the pre-deploy backup."
fi

# --- 3. Pin and start ---------------------------------------------------------
if grep -qE '^IMAGE_TAG=' .env; then
  sed -i.bak -E "s/^IMAGE_TAG=.*/IMAGE_TAG=${TARGET}/" .env && rm -f .env.bak
else
  printf '\n# Pinned by scripts/deploy-sha.sh — the build that is running.\nIMAGE_TAG=%s\n' "$TARGET" >> .env
fi
log "Starting ${TARGET:0:12} (migrations run first)…"
docker compose up -d --remove-orphans

# --- 4. Health gate -------------------------------------------------------------
healthy=0
for _ in $(seq 1 40); do
  if docker compose exec -T api node -e "fetch('http://localhost:4000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1 \
     && docker compose exec -T web node -e "fetch('http://localhost:3000/login').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    healthy=1; break
  fi
  sleep 3
done
if [ "$healthy" != "1" ]; then
  log "The new build did not become healthy within 2 minutes."
  log "Look:        docker compose logs --tail=100 migrate api web"
  log "Go back:     scripts/deploy-sha.sh --rollback"
  exit 1
fi
REPORTED="$(docker compose exec -T api node -e "fetch('http://localhost:4000/health').then(r=>r.json()).then(j=>console.log(j.gitSha||'')).catch(()=>{})" 2>/dev/null || true)"
log "Healthy. API reports build: ${REPORTED:-unknown}"

# --- 5. Record ------------------------------------------------------------------
printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$TARGET" >> "$HISTORY"

# --- 6. Prune old builds -----------------------------------------------------------
KEEP="$(awk '{print $2}' "$HISTORY" | tail -n "$KEEP_RELEASES" | sort -u)"
for repo in influenceos-api influenceos-worker influenceos-web; do
  { docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -E "/${repo}:[0-9a-f]{7,40}$" || true; } | while read -r ref; do
    tag="${ref##*:}"
    if ! grep -qx "$tag" <<<"$KEEP"; then
      docker image rm "$ref" >/dev/null 2>&1 && log "Removed old image $ref" || true
    fi
  done
done

log "SUCCESS — ${TARGET:0:12} is live. Previous builds kept: $(tr '\n' ' ' <<<"$KEEP")"
