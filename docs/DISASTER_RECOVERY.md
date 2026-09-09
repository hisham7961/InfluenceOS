# Disaster Recovery

Recovery runbook for InfluenceOS. Audience: ADMIN/STAFF operators and on-call
SREs. This document enumerates failure scenarios and the step-by-step recovery
for each. Execute the steps in order; do not improvise destructive actions.

Cross-references:

- `docs/BACKUP_AND_RESTORE.md` — backup/restore/drill mechanics and every
  `scripts/*` command referenced here.
- `docs/OPERATIONS_RUNBOOK.md` — general operational procedures, health checks,
  and on-call escalation.
- `docs/DATABASE_OPERATIONS.md` — migration model and connection URLs.
- `docs/DEPLOYMENT.md` — deploy/rollback flow.

---

## Targets and priorities

### RPO / RTO targets

- **RPO:** up to **~24h** with the default daily backups (see
  `docs/BACKUP_AND_RESTORE.md` §6). Tighten with more frequent backups or
  Postgres WAL archiving / PITR if the business needs a smaller window.
- **RTO:** for a logical restore, roughly the time to **provision a DB +
  `pg_restore` the dump**, which **scales with data size** — **minutes** for a
  small internal dataset — plus the time to redeploy the app and re-point
  traffic.

### Recovery priority order

Recover in this order; each layer depends on the one before it:

1. **Database first** — the system of record. Nothing else is trustworthy until
   the DB is restored and consistent.
2. **Application** — API, worker, web. Redeploy the exact tested SHA once the DB
   is healthy.
3. **Object storage** — attachment blobs. The app runs without them; missing
   blobs degrade downloads, they do not stop the platform.

### DR test cadence

- **Weekly:** automated restore drill (`scripts/restore-test.sh`) — proves the
  backup round-trips (already verified: 29 public tables, `User` rows matched).
- **Quarterly:** a full DR game-day — provision a throwaway host, restore the
  latest off-host backup, redeploy a tested SHA, and validate with
  `scripts/smoke-test.sh`. Record the measured RTO.

---

## Scenario 1 — Database corruption or loss

Symptom: the primary database is corrupt, unqueryable, or gone; the app's
`/ready` check fails on the DB dependency.

1. **Stop writes.** Take the app offline or scale API/worker to zero so nothing
   writes to a bad database and widens the data loss.
2. **Pick the latest good backup.** Identify the most recent archive that passes
   its integrity check:
   ```bash
   pg_restore --list /var/backups/influenceos/daily/<latest>.dump
   ```
   If local storage is also gone, pull from off-host S3 (Scenario 2 covers the
   fetch).
3. **Restore it (destructive) into the target DB:**
   ```bash
   scripts/restore-db.sh /var/backups/influenceos/daily/<latest>.dump \
     --target "$DIRECT_DATABASE_URL" --yes
   ```
   The script drops/recreates `public`, `pg_restore`s the archive, and
   sanity-checks that `User` is queryable.
4. **Re-apply migrations** in case the backup predates newer migrations:
   ```bash
   pnpm --filter @influenceos/database migrate:deploy
   ```
   (Forward-only and idempotent — a no-op if the schema is already current.)
5. **Smoke-test** and bring the app back:
   ```bash
   scripts/smoke-test.sh "$HEALTH_URL"
   ```
   Confirm `/health` and `/ready` are green, then restore traffic.

> Data written after the restored backup is lost (bounded by the RPO). If WAL/
> PITR is enabled at the Postgres layer, prefer point-in-time recovery to that
> layer's latest consistent point over a plain logical restore.

---

## Scenario 2 — Full host loss

Symptom: the entire production host (DB + app + local backups) is gone.

1. **Provision a new host** with Docker + Docker Compose v2 and the
   `postgresql-client` and `aws` CLIs. Restore `/opt/influenceos/.env.production`
   (with `DATABASE_URL`, `DIRECT_DATABASE_URL`, `BACKUP_S3_*`, `BOOTSTRAP_*`,
   secrets) from your secret store.
2. **Stand up the datastore** (e.g. bring up just `postgres` from
   `docker-compose.full.yml`, or attach managed Postgres).
3. **Restore the DB from the off-host S3 backup** — this is why off-host copies
   exist:
   ```bash
   BACKUP_S3_ENDPOINT=https://s3.example.com \
   BACKUP_S3_ACCESS_KEY_ID=... \
   BACKUP_S3_SECRET_ACCESS_KEY=... \
     scripts/restore-db.sh s3://influenceos-backups/daily/<latest>.dump \
     --target "$DIRECT_DATABASE_URL" --yes
   ```
4. **Re-apply migrations** if the backup is older than the deployed tree:
   ```bash
   pnpm --filter @influenceos/database migrate:deploy
   ```
5. **Redeploy the exact tested SHA** — the same immutable revision that passed
   CI, never "latest":
   ```bash
   scripts/deploy-production.sh <tested-good-sha-or-tag>
   ```
   The compose `migrate` one-shot re-runs `migrate deploy` + the idempotent
   bootstrap before app services start; the deploy gates on `/health` and
   `/ready`.
6. **Re-point DNS / reverse proxy** at the new host and confirm external
   reachability.
7. **Validate:**
   ```bash
   scripts/smoke-test.sh "$HEALTH_URL"
   ```

---

## Scenario 3 — Bad release

Symptom: a deploy is live but broken (regressions, failing journeys), and you
need to return to the previous good revision.

1. **Roll back to the prior good SHA/tag.** Rollback is just a deploy of an
   earlier immutable revision:
   ```bash
   scripts/rollback-production.sh <previous-good-sha-or-tag>
   ```
2. **Handle the database.** Application rollback is fast; **the database is NOT
   auto-downgraded** — `migrate deploy` only rolls forward. If the bad release
   added a migration:
   - **If the migration is additive / backward-compatible** (old code ignores
     new columns): the current DB still satisfies the older code. The rollback
     proceeds; no DB action needed.
   - **If the migration is incompatible with the older code:** you must
     **restore a backup first**, then deploy the older revision. Use the
     pre-deploy backup that `scripts/deploy-production.sh` takes before every
     deploy:
     ```bash
     scripts/restore-db.sh /var/backups/influenceos/daily/<pre-deploy>.dump \
       --target "$DIRECT_DATABASE_URL" --yes
     scripts/rollback-production.sh <previous-good-sha-or-tag>
     ```
   `rollback-production.sh` **warns and requires `--yes`** when the target
   revision has **fewer migrations** than the current tree, precisely because
   the DB will not be downgraded automatically — that prompt is your cue to
   choose "additive, safe to proceed" vs. "restore a backup first".
3. **Validate:**
   ```bash
   scripts/smoke-test.sh "$HEALTH_URL"
   ```

---

## Scenario 4 — Object storage loss

Symptom: the attachment object store (S3 / MinIO bucket, e.g. `influenceos`) is
lost or unreachable.

**Impact.** Attachment **blobs live in object storage**, not in the database. If
the bucket is lost, those blobs are **gone unless the object store itself is
backed up or replicated.** The database rows that reference them remain intact,
so the app keeps running, but **attachment downloads 404** (the presigned URLs
point at objects that no longer exist).

Recovery:

1. **If object-store replication/versioning exists:** fail over to the replica
   or restore the bucket/objects from the object store's own backup, then
   re-point `S3_*` endpoints if the location changed. DB rows already match, so
   no database change is needed.
2. **If no object-store backup exists:** the blobs are unrecoverable. Recreate
   the bucket so new uploads work again; existing rows will continue to 404 on
   download. Communicate the data-loss scope to stakeholders.
3. **Prevent recurrence:** enable **object-store replication and/or object
   versioning** on the attachments bucket. The logical DB backup does **not**
   cover attachment blobs — object storage must be protected at its own layer.

> Object storage is the **lowest** recovery priority: restore the DB and app
> first (the platform is usable without historical attachment blobs), then
> address storage.

---

## Recovery decision summary

| Failure | First action | DB action | App action | Validate |
| --- | --- | --- | --- | --- |
| DB corruption/loss | Stop writes | `restore-db.sh --yes` → `migrate:deploy` | Bring app back up | `smoke-test.sh` |
| Full host loss | Provision host + secrets | `restore-db.sh s3://… --yes` → `migrate:deploy` | `deploy-production.sh <sha>`, re-point DNS | `smoke-test.sh` |
| Bad release | Identify prior good SHA | Restore backup **only if** migration incompatible | `rollback-production.sh <sha>` | `smoke-test.sh` |
| Object storage loss | Assess replication | None (rows intact) | Recreate bucket / fail over | Downloads work for new uploads |

**Always:** DB first → app second → storage third.
