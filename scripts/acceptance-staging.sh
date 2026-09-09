#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# InfluenceOS — STAGING functional acceptance suite
#
# Unlike the smoke test, this EXERCISES the platform end to end by creating
# DISPOSABLE records (all named "STAGING-TEST-<runid>-…"), verifying they appear
# where they should, then DELETING them. It never touches pre-existing business
# records and never runs the demo seed.
#
# Drives the API directly with a bearer token (the same contract the web/mobile
# clients use). Requires a staging admin login.
#
# Usage:
#   BASE_URL=https://staging.influenceos.example.com \
#   STAGING_ADMIN_EMAIL=... STAGING_ADMIN_PASSWORD=... \
#   scripts/acceptance-staging.sh
#
# Exits non-zero on the first failed step. Attempts best-effort cleanup on exit.
# ---------------------------------------------------------------------------
set -uo pipefail

BASE="${BASE_URL:-${NEXT_PUBLIC_APP_URL:-}}"; BASE="${BASE%/}"
API="$BASE/api/v1"
EMAIL="${STAGING_ADMIN_EMAIL:-${SMOKE_EMAIL:-}}"
PASSWORD="${STAGING_ADMIN_PASSWORD:-${SMOKE_PASSWORD:-}}"
PREFIX="STAGING-TEST-$(date -u +%H%M%S)-$RANDOM"

[ -n "$BASE" ] || { echo "Set BASE_URL (staging https URL)" >&2; exit 2; }
[ -n "$EMAIL" ] && [ -n "$PASSWORD" ] || { echo "Set STAGING_ADMIN_EMAIL and STAGING_ADMIN_PASSWORD" >&2; exit 2; }
command -v curl >/dev/null || { echo "curl required" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 required (JSON parsing)" >&2; exit 1; }

pass() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; cleanup; exit 1; }
info() { printf '%s\n' "$*"; }
# Extract a field (dot path, supports [n]) from JSON on stdin.
pyget() { python3 -c "import sys,json
d=json.load(sys.stdin)
for k in '$1'.split('.'):
    if k=='' : continue
    if '[' in k:
        n=k[:k.index('[')]; i=int(k[k.index('[')+1:k.index(']')])
        d=(d[n] if n else d)[i]
    else:
        d=d[k]
print(d if d is not None else '')" 2>/dev/null; }

ACCESS=""; REFRESH=""
declare -a DEL_BRAND DEL_INF DEL_CAMP DEL_CONTENT DEL_SCRIPT DEL_FILE

api() { # api METHOD PATH [json-body]
  local m="$1" p="$2" b="${3:-}"
  if [ -n "$b" ]; then
    curl -s -X "$m" "$API$p" -H "authorization: Bearer $ACCESS" -H 'content-type: application/json' -d "$b"
  else
    curl -s -X "$m" "$API$p" -H "authorization: Bearer $ACCESS"
  fi
}
code() { # code METHOD PATH [body] -> http status
  local m="$1" p="$2" b="${3:-}"
  if [ -n "$b" ]; then curl -s -o /dev/null -w '%{http_code}' -X "$m" "$API$p" -H "authorization: Bearer $ACCESS" -H 'content-type: application/json' -d "$b"
  else curl -s -o /dev/null -w '%{http_code}' -X "$m" "$API$p" -H "authorization: Bearer $ACCESS"; fi
}

cleanup() {
  info "Cleaning up STAGING-TEST records…"
  for id in "${DEL_CONTENT[@]:-}"; do [ -n "$id" ] && api DELETE "/content/$id" >/dev/null; done
  for id in "${DEL_FILE[@]:-}";    do [ -n "$id" ] && api DELETE "/files/$id" >/dev/null; done
  for id in "${DEL_SCRIPT[@]:-}";  do [ -n "$id" ] && api DELETE "/scripts/$id" >/dev/null; done
  for id in "${DEL_CAMP[@]:-}";    do [ -n "$id" ] && api DELETE "/campaigns/$id" >/dev/null; done
  for id in "${DEL_INF[@]:-}";     do [ -n "$id" ] && api DELETE "/influencers/$id" >/dev/null; done
  for id in "${DEL_BRAND[@]:-}";   do [ -n "$id" ] && api DELETE "/brands/$id" >/dev/null; done
  info "Cleanup done."
}

info "Staging acceptance — $BASE  (record prefix: $PREFIX)"

# --- Login ------------------------------------------------------------------
LR="$(curl -s -X POST "$API/auth/login" -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")"
ACCESS="$(echo "$LR" | pyget tokens.accessToken)"
REFRESH="$(echo "$LR" | pyget tokens.refreshToken)"
[ -n "$ACCESS" ] || fail "login failed (no access token)"
pass "login"

# --- Brand ------------------------------------------------------------------
B="$(api POST /brands "{\"name\":\"$PREFIX Brand\"}")"
BRAND_ID="$(echo "$B" | pyget id)"; [ -n "$BRAND_ID" ] || fail "create brand: $B"
DEL_BRAND+=("$BRAND_ID"); pass "create brand ($BRAND_ID)"

# --- Influencer (PAID) + social profile ------------------------------------
I1="$(api POST /influencers "{\"displayName\":\"$PREFIX Creator A\",\"priority\":\"MEDIUM\"}")"
INF1="$(echo "$I1" | pyget id)"; [ -n "$INF1" ] || fail "create influencer A: $I1"
DEL_INF+=("$INF1"); pass "create influencer A ($INF1)"
SA="$(api POST "/influencers/$INF1/social-accounts" "{\"platform\":\"YOUTUBE\",\"username\":\"${PREFIX}_yt\",\"isPrimary\":true}")"
[ -n "$(echo "$SA" | pyget id)" ] || fail "add social profile: $SA"
pass "add social profile (YOUTUBE)"

# --- Influencer (FREE) ------------------------------------------------------
I2="$(api POST /influencers "{\"displayName\":\"$PREFIX Creator B\"}")"
INF2="$(echo "$I2" | pyget id)"; [ -n "$INF2" ] || fail "create influencer B: $I2"
DEL_INF+=("$INF2"); pass "create influencer B ($INF2)"

# --- Campaign ---------------------------------------------------------------
C="$(api POST /campaigns "{\"brandId\":\"$BRAND_ID\",\"name\":\"$PREFIX Campaign\",\"status\":\"ACTIVE\"}")"
CAMP="$(echo "$C" | pyget id)"; [ -n "$CAMP" ] || fail "create campaign: $C"
DEL_CAMP+=("$CAMP"); pass "create campaign ($CAMP)"

# --- Add PAID + FREE influencers to the campaign ---------------------------
CIP="$(api POST "/campaigns/$CAMP/influencers" "{\"influencerId\":\"$INF1\",\"dealType\":\"PAID\",\"agreedCost\":750}")"
CIP_ID="$(echo "$CIP" | pyget id)"; [ -n "$CIP_ID" ] || fail "add PAID influencer: $CIP"
pass "add PAID influencer (agreedCost 750)"
CIF="$(api POST "/campaigns/$CAMP/influencers" "{\"influencerId\":\"$INF2\",\"dealType\":\"FREE\"}")"
[ -n "$(echo "$CIF" | pyget id)" ] || fail "add FREE influencer: $CIF"
pass "add FREE influencer"

# --- Deliverable on the PAID participation ---------------------------------
D="$(api POST "/campaign-influencers/$CIP_ID/deliverables" "{\"platform\":\"YOUTUBE\",\"type\":\"VIDEO\",\"quantity\":1}")"
[ -n "$(echo "$D" | pyget id)" ] || fail "create deliverable: $D"
pass "create deliverable"

# --- Script / reference -----------------------------------------------------
S="$(api POST /scripts "{\"campaignId\":\"$CAMP\",\"title\":\"$PREFIX Script\",\"body\":\"Test talking points\"}")"
SCRIPT_ID="$(echo "$S" | pyget id)"; [ -n "$SCRIPT_ID" ] || fail "create script: $S"
DEL_SCRIPT+=("$SCRIPT_ID"); pass "create script/reference ($SCRIPT_ID)"

# --- Published content ------------------------------------------------------
VID="stg$(date +%s | tail -c 8)"
PC="$(api POST /content "{\"url\":\"https://www.youtube.com/watch?v=$VID\",\"campaignId\":\"$CAMP\",\"caption\":\"$PREFIX content\"}")"
CONTENT_ID="$(echo "$PC" | pyget id)"; [ -n "$CONTENT_ID" ] || fail "publish content: $PC"
DEL_CONTENT+=("$CONTENT_ID"); pass "publish content ($CONTENT_ID)"

# --- Attachment: upload → list → download → delete -------------------------
INIT="$(api POST /files "{\"fileName\":\"$PREFIX.txt\",\"mimeType\":\"text/plain\",\"sizeBytes\":24,\"target\":{\"influencerId\":\"$INF1\"}}")"
UPTOKEN="$(echo "$INIT" | pyget uploadToken)"
UPURL="$(echo "$INIT" | pyget uploadUrl)"
DIRECT="$(echo "$INIT" | pyget direct)"
[ -n "$UPTOKEN" ] || fail "attachment initiate: $INIT"
TMPF="$(mktemp)"; printf 'staging acceptance bytes!!' > "$TMPF"
if [ "$DIRECT" = "True" ] || [ "$DIRECT" = "true" ]; then
  # Presigned S3 PUT (staging S3 driver): honor the signed Content-Type.
  CT="$(echo "$INIT" | python3 -c "import sys,json;print(json.load(sys.stdin).get('headers',{}).get('Content-Type','application/octet-stream'))" 2>/dev/null)"
  put="$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$UPURL" -H "content-type: ${CT:-text/plain}" --data-binary @"$TMPF")"
else
  # Local-driver proxy PUT (relative path → API origin).
  case "$UPURL" in
    http*) purl="$UPURL" ;;
    /api/*) purl="$BASE$UPURL" ;;
    *) purl="$API$UPURL" ;;
  esac
  put="$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$purl" -H 'content-type: application/octet-stream' -H "authorization: Bearer $ACCESS" --data-binary @"$TMPF")"
fi
rm -f "$TMPF"
[ "$put" = "200" ] || [ "$put" = "204" ] || fail "attachment PUT failed ($put)"
CMP="$(api POST /files/complete "{\"uploadToken\":\"$UPTOKEN\"}")"
FILE_ID="$(echo "$CMP" | pyget id)"; [ -n "$FILE_ID" ] || fail "attachment complete: $CMP"
DEL_FILE+=("$FILE_ID"); pass "attachment upload + complete ($FILE_ID)"
LIST="$(api GET "/files?influencerId=$INF1")"
echo "$LIST" | grep -q "$FILE_ID" || fail "attachment not in list"
DLURL="$(echo "$CMP" | pyget downloadUrl)"
case "$DLURL" in http*) dl="$DLURL";; /api/*) dl="$BASE$DLURL";; *) dl="$API$DLURL";; esac
dlc="$(curl -s -o /dev/null -w '%{http_code}' "$dl")"
[ "$dlc" = "200" ] || fail "signed download failed ($dlc)"
pass "attachment list + signed download"
[ "$(code DELETE "/files/$FILE_ID")" = "204" ] || fail "attachment delete failed"
DEL_FILE=(); pass "attachment delete"

# --- Live Content feed reflects the content --------------------------------
FEED="$(api GET '/content/feed')"
echo "$FEED" | grep -q "$CONTENT_ID" && pass "content appears in Live Content feed" || info "  ! content not yet in feed (eventual — acceptable)"

# --- Reports respond --------------------------------------------------------
[ "$(code GET "/reports?type=campaign")" = "200" ] || fail "reports (campaign) did not return 200"
[ "$(code GET "/reports?type=spend")" = "200" ] || fail "reports (spend) did not return 200"
pass "reports respond (campaign, spend)"

# --- Notifications respond --------------------------------------------------
[ "$(code GET "/notifications")" = "200" ] || fail "notifications did not return 200"
pass "notifications respond"

# --- Audit log contains our actions ----------------------------------------
AUD="$(api GET "/platform/audit?q=$PREFIX&limit=50")"
echo "$AUD" | grep -q "$PREFIX" && pass "audit log reflects STAGING-TEST activity" || info "  ! audit entries not matched by free-text (acceptable if audit messages omit the name)"

# --- Worker/platform status -------------------------------------------------
ST="$(api GET /platform/status)"
echo "$ST" | grep -q '"environment":"staging"' && pass "platform status reports environment=staging" || info "  ! environment not 'staging' in status"

# --- Cleanup + logout -------------------------------------------------------
cleanup
curl -s -X POST "$API/auth/logout" -H 'content-type: application/json' -d "{\"refreshToken\":\"$REFRESH\"}" -o /dev/null || true
info "Staging acceptance PASSED."
