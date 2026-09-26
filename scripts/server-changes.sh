#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# InfluenceOS — what on this server differs from the repository.
#
# Changes made by hand on the server (an edited compose file, a local
# docker-compose.override.yml) live only here: an update can overwrite them,
# or they quietly keep an old setting after the repository fixed it. The
# deploy scripts run this first and show what they find.
#
#   scripts/server-changes.sh            report (always exits 0)
#   scripts/server-changes.sh --strict   exit 1 if tracked files were edited
#
# It reports:
#   - files from the repository that were edited here (git status);
#   - compose override files that aren't in the repository
#     (docker-compose.override.yml, compose.override.yml, *.override.yml,
#     and any file named in COMPOSE_FILE that git doesn't know), with the
#     services and settings they touch.
# .env and the other files git ignores on purpose are not reported.
# ---------------------------------------------------------------------------
set -euo pipefail

STRICT=0
[ "${1:-}" = "--strict" ] && STRICT=1

cd "$(dirname "$0")/.."
say() { printf '[server-changes] %s\n' "$*"; }

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  say "Not a git checkout — nothing to compare."
  exit 0
fi

found=0

# 1. Repository files edited on this server.
edited="$(git status --porcelain --untracked-files=no 2>/dev/null || true)"
if [ -n "$edited" ]; then
  found=1
  say "Files from the repository that were changed on this server:"
  printf '%s\n' "$edited" | sed 's/^/    /'
  say "  An update may overwrite these, or fail to apply. If a change is needed,"
  say "  put it in the repository (or in .env) and undo it here: git checkout -- <file>"
fi

# 2. Compose files that exist only on this server.
compose_files="$(grep -E '^COMPOSE_FILE=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' || true)"
compose_files="${COMPOSE_FILE:-$compose_files}"
candidates="$(
  {
    ls -1 docker-compose.override.yml compose.override.yml ./*.override.yml ./*.override.yaml 2>/dev/null || true
    printf '%s\n' "$compose_files" | tr ':' '\n'
  } | sed 's#^\./##' | { grep -v '^$' || true; } | sort -u
)"
for f in $candidates; do
  [ -f "$f" ] || continue
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then continue; fi
  found=1
  say "Compose file that exists only on this server: $f"
  say "  It changes these services/settings:"
  grep -nE '^[A-Za-z0-9_.-]+:|^  [A-Za-z0-9_.-]+:|^    [A-Za-z0-9_.-]+:' "$f" | head -n 25 | sed 's/^/    /'
  say "  Keep only what is really specific to this server; anything the app needs"
  say "  everywhere belongs in the repository's compose files or .env."
done

if [ "$found" = "0" ]; then
  say "No local changes: this server matches the repository (apart from .env)."
elif [ "$STRICT" = "1" ] && [ -n "$edited" ]; then
  exit 1
fi
exit 0
