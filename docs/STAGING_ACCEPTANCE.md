# Staging Acceptance Report

The sign-off record for a staging deployment. Fill it in when staging is
actually deployed; production promotion is **forbidden while any genuine 🔴
BLOCKER remains**.

Status legend: ✅ PASS · 🟡 ACCEPTED LIMITATION · 🔴 BLOCKER · ⏳ PENDING (not yet run)

---

## Deployment identity

| Field | Value |
| --- | --- |
| Git SHA (deployed) | `⏳ <filled at deploy>` |
| Staging hostname | `⏳ https://staging.influenceos.example.com` |
| Files hostname | `⏳ https://staging-files.influenceos.example.com` (self-hosted MinIO) or managed S3 |
| Deployment date (UTC) | `⏳` |
| Deployed by | `⏳` |
| Object storage | `⏳ self-hosted MinIO | managed S3` |

## Acceptance results

| # | Check | How | Status | Notes |
| --- | --- | --- | --- | --- |
| 1 | HTTPS works + valid certificate | `smoke-staging.sh` | ⏳ | |
| 2 | HTTP → HTTPS redirect | `smoke-staging.sh` | ⏳ | |
| 3 | Web app + `/login` respond | `smoke-staging.sh` | ⏳ | |
| 4 | API liveness `/health` (env=staging, SHA) | `smoke-staging.sh` | ⏳ | |
| 5 | API readiness `/ready` (DB reachable) | `smoke-staging.sh` | ⏳ | |
| 6 | Security headers present (HSTS, nosniff, frame) | `smoke-staging.sh` | ⏳ | |
| 7 | `/metrics` NOT publicly reachable | `smoke-staging.sh` | ⏳ | |
| 8 | Object storage reachable + private (unsigned GET denied) | `smoke-staging.sh` | ⏳ | |
| 9 | Migration result (`migrate deploy`, no seed) | deploy log | ⏳ | |
| 10 | Worker health = `redis+bullmq`, recent sweep | compose exec worker /health | ⏳ | |
| 11 | Redis/queue health (separate from prod) | worker `mode` field | ⏳ | |
| 12 | Functional acceptance (brand→influencer→campaign→PAID+FREE→deliverable→script→content→attachment up/down/delete→feed→reports→notifications→audit) | `acceptance-staging.sh` | ⏳ | creates + deletes `STAGING-TEST-*` |
| 13 | Backup verification (backup → temp restore → schema + records) | `dr-drill-staging.sh` | ⏳ | **must PASS to promote** |
| 14 | App-level DR drill (stop → restore → restart → verify) | `docs/STAGING.md` §7 | ⏳ | |
| 15 | Storage recovery (volume survives container recreation) | `docs/STAGING.md` §8 | ⏳ | |
| 16 | Monitoring signals live (web/api/worker/db/redis/storage/host) | Prometheus/Grafana | ⏳ | |
| 17 | Alerts actually fire to the configured destination | `docs/STAGING.md` §10 | ⏳ | which alerts tested + where received |
| 18 | Admin can change password via Settings → Security | manual | ⏳ | bootstrap admin, no hardcoded pw |

## Browser acceptance (optional, strongest form)

Run the browser Definition-of-Done journey against staging (proves the real UI
+ presigned S3 upload path over the staging hostname):

```bash
E2E_BASE_URL=https://staging.influenceos.example.com \
  pnpm --filter @influenceos/web exec playwright test dod.spec.ts
```

| Browser DoD journey | Status | Notes |
| --- | --- | --- |
| Login → brand → influencer → campaign → deliverable → content → Live Content → What's New → attachment up/download/delete → admin pages → audit | ⏳ | |

## Social provider status

| Provider | Classification | Notes |
| --- | --- | --- |
| YouTube | ⏳ CONFIGURED / NEEDS CREDENTIALS / NEEDS PROVIDER APPROVAL / MANUAL FALLBACK | |
| X (Twitter) | ⏳ | |
| Instagram | ⏳ | |
| TikTok | ⏳ | |
| Snapchat | ⏳ | (manual/URL-based by design) |

Verified: with credentials absent, the platform stays in manual-fallback and
shows **no fake successful sync** — [ ] confirmed.

## Known limitations (🟡)

- `⏳ list any accepted limitations here`

## Blockers (🔴)

- `⏳ none / list blockers — promotion forbidden while any remain`

## Promotion decision

- [ ] All checks ✅ or 🟡 (no 🔴), backup verification (#13) passed.
- **Approved Git SHA for production promotion:** `⏳`
- Promote with `scripts/deploy-production.sh <that-same-sha>` (same code, prod config).

---

### Pre-deployment readiness (current state — before any staging server exists)

All staging **mechanisms** are prepared and validated locally against a
staging-configured stack (S3/MinIO driver, `APP_ENV=staging`):

| Mechanism | State |
| --- | --- |
| `.env.staging.example` (isolated contract) | ✅ prepared |
| `docker-compose.staging.yml` (only proxy public — verified via `docker compose config`) | ✅ prepared |
| `deploy/caddy/Caddyfile.staging` (main + private files host) | ✅ prepared |
| `deploy-staging.sh` guard rails (APP_ENV / DB / bucket must be staging) | ✅ verified — refuses non-staging targets |
| `smoke-staging.sh` | ✅ prepared |
| `acceptance-staging.sh` (full functional flow + cleanup) | ✅ verified locally end-to-end (incl. S3 attachment round trip) |
| `dr-drill-staging.sh` (backup → restore → verify) | ✅ verified locally (schema + records match) |

**Not yet run:** everything requiring the real staging host/hostname/TLS — i.e.
the ⏳ rows above. Those execute at deploy time once the infrastructure details
(server, hostname, DNS, object-store choice, alert destination, admin email) are
provided.
