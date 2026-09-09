#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# InfluenceOS — deployment preflight (NON-DESTRUCTIVE, read-only)
#
# Inspects a would-be deployment host/environment and reports PASS / WARN / FAIL
# per check so an operator knows whether a deploy would succeed BEFORE running
# it. It changes NOTHING: it never deploys, never writes to the database, never
# creates buckets, never touches DNS or external infrastructure.
#
# Usage:
#   scripts/preflight.sh [--env <file>]     # default: .env.production if present, else .env
#
# Exit code: 0 if no FAIL (WARNs allowed), 1 if any FAIL. Intended for use on the
# target host just before scripts/deploy-*.sh, and safe to run anytime.
# ---------------------------------------------------------------------------
set -uo pipefail

ENV_FILE=""
while [ $# -gt 0 ]; do case "$1" in --env) ENV_FILE="$2"; shift 2;; *) echo "unknown arg: $1" >&2; exit 2;; esac; done
if [ -z "$ENV_FILE" ]; then
  for c in .env.production .env.staging .env; do [ -f "$c" ] && { ENV_FILE="$c"; break; }; done
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$REPO_ROOT"
FAILS=0; WARNS=0
P() { printf '  \033[32mPASS\033[0m  %s\n' "$*"; }
W() { printf '  \033[33mWARN\033[0m  %s\n' "$*"; WARNS=$((WARNS+1)); }
F() { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; FAILS=$((FAILS+1)); }
have() { command -v "$1" >/dev/null 2>&1; }
mask() { printf '%s' "$1" | sed -E 's#(//[^:/]+):[^@]+@#\1:****@#g'; }

echo "InfluenceOS preflight — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Env file: ${ENV_FILE:-<none found>}"
echo

# --- Load env (read-only) --------------------------------------------------
if [ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ]; then
  set -a; . "$ENV_FILE" 2>/dev/null; set +a
else
  W "No env file found — env-dependent checks will be skipped. Pass --env <file>."
fi

echo "== Tooling =="
have docker && P "docker present ($(docker --version 2>/dev/null | head -1))" || F "docker not found"
if docker compose version >/dev/null 2>&1; then P "docker compose v2 present"; else F "docker compose v2 not found"; fi
have git && P "git present" || W "git not found (release SHA detection unavailable)"
have curl && P "curl present" || W "curl not found (health/DNS checks limited)"
have psql && P "psql present" || W "psql not found (DB connectivity check skipped)"
have pg_dump && P "pg_dump present (backups)" || W "pg_dump not found (backups need postgresql-client)"

echo
echo "== Required environment =="
REQ=(NODE_ENV DATABASE_URL AUTH_SECRET NEXT_PUBLIC_APP_URL WEB_ORIGIN)
for v in "${REQ[@]}"; do [ -n "${!v:-}" ] && P "$v set" || F "$v missing"; done
if [ "${NODE_ENV:-}" = "production" ]; then
  if [ -n "${AUTH_SECRET:-}" ] && { [ "${#AUTH_SECRET}" -lt 32 ] || printf '%s' "$AUTH_SECRET" | grep -qi 'change-me'; }; then
    F "AUTH_SECRET is weak/default for production (needs >=32 chars, non-default)"
  else [ -n "${AUTH_SECRET:-}" ] && P "AUTH_SECRET strength ok for production"; fi
fi
if [ "${STORAGE_DRIVER:-local}" = "s3" ]; then
  for v in S3_INTERNAL_ENDPOINT S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
    [ -n "${!v:-}" ] || F "STORAGE_DRIVER=s3 but $v missing"
  done
  [ -n "${S3_PUBLIC_ENDPOINT:-}" ] || W "S3_PUBLIC_ENDPOINT unset (browser presigned URLs may not resolve)"
fi

echo
echo "== Host resources =="
if have df; then
  avail_kb="$(df -Pk . | awk 'NR==2{print $4}')"
  avail_gb=$(( avail_kb / 1024 / 1024 ))
  if [ "$avail_gb" -ge 20 ]; then P "disk: ${avail_gb}GB free"; elif [ "$avail_gb" -ge 5 ]; then W "disk: only ${avail_gb}GB free (recommend >=20GB)"; else F "disk: ${avail_gb}GB free (too low)"; fi
fi
if [ -r /proc/meminfo ]; then
  mem_mb=$(( $(awk '/MemTotal/{print $2}' /proc/meminfo) / 1024 ))
  if [ "$mem_mb" -ge 3500 ]; then P "memory: ${mem_mb}MB"; elif [ "$mem_mb" -ge 1800 ]; then W "memory: ${mem_mb}MB (recommend >=4GB)"; else F "memory: ${mem_mb}MB (too low)"; fi
fi

echo
echo "== Ports (proxy must be free to bind 80/443) =="
port_busy() { { have ss && ss -ltn 2>/dev/null | grep -q ":$1 "; } || { have netstat && netstat -ltn 2>/dev/null | grep -q ":$1 "; }; }
for p in 80 443; do
  if port_busy "$p"; then W "port $p already in use (fine if it's this stack's proxy; else free it)"; else P "port $p free to bind"; fi
done
for p in 4000 4100 5432 6379 9000; do
  port_busy "$p" && W "internal port $p is bound on the host (should stay private, not host-published in prod)" || true
done

echo
echo "== DNS / TLS readiness (read-only) =="
host_of() { printf '%s' "$1" | sed -E 's#^https?://##; s#/.*$##; s#:.*$##'; }
if [ -n "${NEXT_PUBLIC_APP_URL:-}" ]; then
  h="$(host_of "$NEXT_PUBLIC_APP_URL")"
  case "$NEXT_PUBLIC_APP_URL" in https://*) P "public URL is https ($h)";; *) [ "${NODE_ENV:-}" = production ] && F "NEXT_PUBLIC_APP_URL is not https in production" || W "public URL not https ($h)";; esac
  if have getent && getent hosts "$h" >/dev/null 2>&1; then P "DNS resolves: $h"; elif have nslookup && nslookup "$h" >/dev/null 2>&1; then P "DNS resolves: $h"; else W "DNS does not resolve yet: $h (point an A/AAAA record before deploy)"; fi
fi

echo
echo "== Dependency connectivity (read-only, only if reachable) =="
if [ -n "${DATABASE_URL:-}" ] && have psql; then
  if psql "$DATABASE_URL" -tAc 'SELECT 1' >/dev/null 2>&1; then P "database reachable ($(mask "$DATABASE_URL"))"; else W "database not reachable from here ($(mask "$DATABASE_URL")) — expected if the DB isn't up yet / not on this network"; fi
fi
if [ -n "${REDIS_URL:-}" ] && have redis-cli; then
  rhost="$(printf '%s' "$REDIS_URL" | sed -E 's#redis://(.*@)?##; s#[:/].*$##')"
  if redis-cli -u "$REDIS_URL" ping >/dev/null 2>&1; then P "redis reachable"; else W "redis not reachable from here ($rhost) — expected if not up yet"; fi
fi
if [ "${STORAGE_DRIVER:-local}" = "s3" ] && [ -n "${S3_INTERNAL_ENDPOINT:-}" ] && have curl; then
  if curl -sf -o /dev/null "${S3_INTERNAL_ENDPOINT%/}/minio/health/live" 2>/dev/null; then P "object storage health endpoint reachable"; else W "object storage not reachable from here — expected if not up yet / managed S3"; fi
fi

echo
echo "== Release identity =="
if have git; then
  sha="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"; P "current checkout: $sha"
  [ -n "${GIT_SHA:-}" ] && P "GIT_SHA env set ($GIT_SHA)" || W "GIT_SHA env not set (deploy script injects it)"
fi

echo
echo "== docker compose config validation =="
for f in docker-compose.yml docker-compose.full.yml docker-compose.staging.yml; do
  [ -f "$f" ] || continue
  if docker compose -f "$f" config >/dev/null 2>/tmp/preflight-compose.err; then P "compose valid: $f"
  else W "compose $f did not validate with the current env (fill required vars): $(head -1 /tmp/preflight-compose.err)"; fi
done

echo
if [ "$FAILS" -eq 0 ]; then
  echo "PREFLIGHT: no blocking failures ($WARNS warning(s)). Review warnings before deploying."
  exit 0
else
  echo "PREFLIGHT: $FAILS blocking failure(s), $WARNS warning(s). Resolve failures before deploying."
  exit 1
fi
