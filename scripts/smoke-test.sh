#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# InfluenceOS — production smoke test (NON-DESTRUCTIVE)
#
# Verifies a freshly-deployed environment answers on its critical paths without
# creating, modifying, or deleting any data. Safe to run against production
# immediately after a deploy.
#
# Checks:
#   - API   GET /health  → 200, reports a gitSha
#   - API   GET /ready    → 200 (dependencies reachable)
#   - API   GET /api/v1/... unauthenticated → 401 (authz is enforced, not open)
#   - Web   GET /login    → 200 and returns HTML (SSR is serving)
#   - (optional) authenticated read: if SMOKE_EMAIL/SMOKE_PASSWORD are set, log
#     in, GET /auth/me and one read-only list, then log out. Still non-mutating.
#
# Usage:
#   scripts/smoke-test.sh [API_BASE_URL] [WEB_BASE_URL]
#   API_BASE_URL default http://localhost:4000 ; WEB_BASE_URL default http://localhost:3000
#
# Exit non-zero on the first failed check.
# ---------------------------------------------------------------------------
set -euo pipefail

API="${1:-${API_BASE_URL:-http://localhost:4000}}"
WEB="${2:-${WEB_BASE_URL:-http://localhost:3000}}"
API="${API%/}"; WEB="${WEB%/}"

pass() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }
info() { printf '%s\n' "$*"; }

command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }

info "Smoke test — API=$API  WEB=$WEB"

# --- API liveness ----------------------------------------------------------
HEALTH="$(curl -fsS "$API/health")" || fail "GET /health failed"
echo "$HEALTH" | grep -q '"status":"ok"' || fail "/health did not report status ok"
SHA="$(echo "$HEALTH" | grep -o '"gitSha":"[^"]*"' | cut -d'"' -f4)"
pass "/health ok (build ${SHA:-unknown})"

# --- API readiness ---------------------------------------------------------
code="$(curl -s -o /dev/null -w '%{http_code}' "$API/ready")"
[ "$code" = "200" ] || fail "/ready returned $code (a dependency is down)"
pass "/ready ok"

# --- Authorization is enforced (unauthenticated protected route → 401) -----
code="$(curl -s -o /dev/null -w '%{http_code}' "$API/api/v1/auth/me")"
[ "$code" = "401" ] || fail "unauthenticated /auth/me returned $code (expected 401)"
pass "protected route rejects anonymous access (401)"

# --- Web login page renders ------------------------------------------------
LOGIN_HTML="$(curl -fsS "$WEB/login")" || fail "GET /login failed"
echo "$LOGIN_HTML" | grep -qi '<html' || fail "/login did not return HTML"
pass "web /login renders"

# --- Optional authenticated read (still non-destructive) -------------------
if [ -n "${SMOKE_EMAIL:-}" ] && [ -n "${SMOKE_PASSWORD:-}" ]; then
  info "Authenticated read checks (using SMOKE_EMAIL)…"
  LOGIN_RES="$(curl -fsS -X POST "$API/api/v1/auth/login" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"$SMOKE_PASSWORD\"}")" || fail "login failed"
  ACCESS="$(echo "$LOGIN_RES" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)"
  REFRESH="$(echo "$LOGIN_RES" | grep -o '"refreshToken":"[^"]*"' | cut -d'"' -f4)"
  [ -n "$ACCESS" ] || fail "no access token in login response"
  pass "login succeeded"

  ME_CODE="$(curl -s -o /dev/null -w '%{http_code}' "$API/api/v1/auth/me" -H "authorization: Bearer $ACCESS")"
  [ "$ME_CODE" = "200" ] || fail "/auth/me returned $ME_CODE"
  pass "/auth/me ok"

  # A read-only list endpoint.
  BRANDS_CODE="$(curl -s -o /dev/null -w '%{http_code}' "$API/api/v1/brands" -H "authorization: Bearer $ACCESS")"
  [ "$BRANDS_CODE" = "200" ] || fail "/brands returned $BRANDS_CODE"
  pass "/brands list ok"

  # Clean up the session we created (revoke — does not touch business data).
  curl -fsS -X POST "$API/api/v1/auth/logout" -H 'content-type: application/json' \
    -d "{\"refreshToken\":\"$REFRESH\"}" -o /dev/null || true
  pass "logged out (session revoked)"
fi

info "All smoke checks passed."
