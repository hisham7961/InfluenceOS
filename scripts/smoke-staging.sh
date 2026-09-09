#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# InfluenceOS — STAGING smoke test (NON-DESTRUCTIVE)
#
# Verifies the DEPLOYED staging system over its real HTTPS hostname. Creates,
# modifies, and deletes NOTHING. Safe to run repeatedly and from monitoring.
#
# Checks:
#   - HTTP → HTTPS redirect
#   - HTTPS works and the TLS certificate is valid (not expired, host matches)
#   - Web app responds; /login renders HTML
#   - API liveness (GET /health) and readiness (GET /ready = DB reachable)
#   - Public API responds (GET /api/v1/client-config)
#   - Security headers present (HSTS, X-Content-Type-Options, X-Frame-Options)
#   - Deployed build identity (gitSha / version / environment=staging)
#   - Object-storage endpoint reachable and PRIVATE (unsigned GET is denied)
#   - (optional) authenticated depth via SMOKE_EMAIL/SMOKE_PASSWORD:
#       login → /platform/status (DB health, versions) → /auth/me → logout
#
# Usage:
#   scripts/smoke-staging.sh [BASE_URL] [FILES_URL]
#   BASE_URL default $API_BASE_URL/$WEB_BASE_URL/$NEXT_PUBLIC_APP_URL
#   FILES_URL default $FILES_URL/$S3_PUBLIC_ENDPOINT
# ---------------------------------------------------------------------------
set -euo pipefail

BASE="${1:-${BASE_URL:-${API_BASE_URL:-${NEXT_PUBLIC_APP_URL:-}}}}"
FILES="${2:-${FILES_URL:-${S3_PUBLIC_ENDPOINT:-}}}"
[ -n "$BASE" ] || { echo "Usage: smoke-staging.sh <https-base-url> [files-url]" >&2; exit 2; }
BASE="${BASE%/}"; FILES="${FILES%/}"

pass() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
command -v curl >/dev/null || { echo "curl required" >&2; exit 1; }

host="$(printf '%s' "$BASE" | sed -E 's#^https?://##; s#/.*$##; s#:.*$##')"
echo "Staging smoke — $BASE (host $host)"

# --- Enforce HTTPS ---------------------------------------------------------
case "$BASE" in
  https://*) : ;;
  *) fail "BASE_URL must be https:// for staging ($BASE)" ;;
esac

# --- HTTP → HTTPS redirect --------------------------------------------------
redir="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "http://${host}/" || true)"
code="${redir%% *}"; loc="${redir#* }"
if [ "$code" = "301" ] || [ "$code" = "302" ] || [ "$code" = "308" ]; then
  case "$loc" in https://*) pass "HTTP redirects to HTTPS ($code)";; *) warn "HTTP $code but redirect target not https: $loc";; esac
else
  warn "No HTTP→HTTPS redirect observed (code $code) — acceptable if the LB handles it"
fi

# --- HTTPS + valid certificate ---------------------------------------------
curl -fsS -o /dev/null "$BASE/login" || fail "HTTPS request to /login failed (TLS or app down)"
pass "HTTPS works and the certificate is valid (curl verified the chain)"

# --- Web /login renders -----------------------------------------------------
curl -fsS "$BASE/login" | grep -qi '<html' || fail "/login did not return HTML"
pass "web /login renders"

# --- API liveness + readiness ----------------------------------------------
H="$(curl -fsS "$BASE/health")" || fail "GET /health failed"
echo "$H" | grep -q '"status":"ok"' || fail "/health not ok"
SHA="$(echo "$H" | grep -o '"gitSha":"[^"]*"' | cut -d'"' -f4)"
ENVV="$(echo "$H" | grep -o '"environment":"[^"]*"' | cut -d'"' -f4)"
pass "/health ok (build ${SHA:-unknown}, env ${ENVV:-unknown})"
[ "$ENVV" = "staging" ] || warn "/health environment is '${ENVV}', expected 'staging' (check APP_ENV)"
rc="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/ready")"
[ "$rc" = "200" ] || fail "/ready returned $rc (a dependency — likely the database — is down)"
pass "/ready ok (database reachable)"

# --- Public API responds ----------------------------------------------------
rc="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/client-config")"
[ "$rc" = "200" ] || fail "public /api/v1/client-config returned $rc"
pass "public API responds"

# --- Authorization enforced -------------------------------------------------
rc="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/auth/me")"
[ "$rc" = "401" ] || fail "unauthenticated /auth/me returned $rc (expected 401)"
pass "protected route rejects anonymous access (401)"

# --- Security headers -------------------------------------------------------
hdrs="$(curl -fsS -D - -o /dev/null "$BASE/login")"
echo "$hdrs" | grep -qi '^strict-transport-security:' || fail "missing HSTS header"
echo "$hdrs" | grep -qi '^x-content-type-options:' || fail "missing X-Content-Type-Options"
echo "$hdrs" | grep -qi '^x-frame-options:' || fail "missing X-Frame-Options"
pass "security headers present (HSTS, nosniff, frame-options)"

# --- /metrics MUST NOT be public -------------------------------------------
mc="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/metrics")"
if [ "$mc" = "200" ]; then fail "/metrics is publicly reachable (must be internal-only)"; else pass "/metrics not exposed publicly ($mc)"; fi

# --- Object storage reachable and private ----------------------------------
if [ -n "$FILES" ]; then
  fc="$(curl -s -o /dev/null -w '%{http_code}' "$FILES/${S3_BUCKET:-influenceos-staging}/nonexistent-smoke-object" || echo 000)"
  case "$fc" in
    403|404|400) pass "object storage endpoint reachable and private (unsigned GET → $fc)";;
    200) fail "object storage returned 200 for an unsigned GET — bucket may be PUBLIC";;
    000) warn "could not reach the files endpoint ($FILES) — check DNS/proxy for the files host";;
    *) warn "unexpected status $fc from the files endpoint";;
  esac
fi

# --- Optional authenticated depth ------------------------------------------
if [ -n "${SMOKE_EMAIL:-}" ] && [ -n "${SMOKE_PASSWORD:-}" ]; then
  echo "Authenticated depth checks…"
  LR="$(curl -fsS -X POST "$BASE/api/v1/auth/login" -H 'content-type: application/json' \
        -d "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"$SMOKE_PASSWORD\"}")" || fail "login failed"
  AT="$(echo "$LR" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)"
  RT="$(echo "$LR" | grep -o '"refreshToken":"[^"]*"' | cut -d'"' -f4)"
  [ -n "$AT" ] || fail "no access token from login"
  pass "login ok"
  ST="$(curl -fsS "$BASE/api/v1/platform/status" -H "authorization: Bearer $AT")" || fail "/platform/status failed"
  echo "$ST" | grep -q '"environment":"staging"' || warn "platform status environment is not 'staging'"
  echo "$ST" | grep -qiE '"name":"Database","status":"ok"' || warn "platform status DB not 'ok'"
  pass "authenticated /platform/status ok (env + DB health)"
  curl -fsS -X POST "$BASE/api/v1/auth/logout" -H 'content-type: application/json' -d "{\"refreshToken\":\"$RT\"}" -o /dev/null || true
  pass "logged out"
fi

echo "All staging smoke checks passed."
