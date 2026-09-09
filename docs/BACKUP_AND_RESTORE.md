# Backup and Restore

Runbook for backing up and restoring the InfluenceOS PostgreSQL database.
Audience: ADMIN/STAFF operators and on-call SREs.

Scripts (all `bash`, `set -euo pipefail`, in `scripts/`):

- `scripts/backup-db.sh` — take a backup.
- `scripts/restore-db.sh` — restore a backup (destructive).
- `scripts/restore-test.sh` — non-destructive restore drill.

Related: `docs/DATABASE_OPERATIONS.md`, `docs/DISASTER_RECOVERY.md`.

---

## 1. What, when, where

`scripts/backup-db.sh` takes a **compressed, logical `pg_dump` in custom format
(`-Fc`)**, integrity-checks it, stages it locally, optionally ships it off-host
to S3, and prunes old copies on a **grandfather-father-son (GFS)** schedule.

- **What:** a consistent `pg_dump --format=custom --no-owner --no-privileges`
  archive. Custom format is compressed and can be restored selectively with
  `pg_restore`.
- **Integrity check:** every archive is verified immediately with
  `pg_restore --list` (the table-of-contents must parse) before it is accepted.
  A dump that fails the check is not kept.
- **Source connection:** `DIRECT_DATABASE_URL` if set, otherwise `DATABASE_URL`
  (prefer the unpooled direct endpoint).
- **Where (local):** `BACKUP_DIR` (default `/var/backups/influenceos`), under
  `daily/`. The archive is named `influenceos-<UTC-timestamp>.dump`.
- **Where (off-host):** if `BACKUP_S3_BUCKET` is set, the archive is uploaded to
  `s3://$BACKUP_S3_BUCKET/daily/…` (and to `weekly/`/`monthly/` on the promotion
  days). Requires the `aws` CLI.
- **GFS promotion:** the daily archive is copied to `weekly/` **on Mondays** and
  to `monthly/` **on the 1st of the month**.
- **Retention (newest N kept per tier):**
  - `BACKUP_RETENTION_DAILY` — default **14**
  - `BACKUP_RETENTION_WEEKLY` — default **8**
  - `BACKUP_RETENTION_MONTHLY` — default **6**

> **Durability warning.** If `BACKUP_S3_BUCKET` is unset the script logs a loud
> warning and keeps the backup **only on the same host** — that is not a durable
> backup. Configure off-host S3 for production.

### Environment

Documented in `.env.production.example`:

| Variable | Purpose | Default |
| --- | --- | --- |
| `BACKUP_DIR` | Local staging directory | `/var/backups/influenceos` |
| `BACKUP_S3_BUCKET` | Off-host bucket (strongly recommended) | *(unset → warn)* |
| `BACKUP_S3_ENDPOINT` | S3 endpoint (MinIO/other; omit for AWS) | *(unset)* |
| `BACKUP_S3_ACCESS_KEY_ID` | Off-host credentials | *(unset)* |
| `BACKUP_S3_SECRET_ACCESS_KEY` | Off-host credentials | *(unset)* |
| `BACKUP_RETENTION_DAILY` | Daily copies to keep | `14` |
| `BACKUP_RETENTION_WEEKLY` | Weekly copies to keep | `8` |
| `BACKUP_RETENTION_MONTHLY` | Monthly copies to keep | `6` |
| `DIRECT_DATABASE_URL` / `DATABASE_URL` | Source DB | *(required)* |

Requirements: `pg_dump`/`pg_restore` (`postgresql-client`), plus the `aws` CLI
**when uploading to S3**.

---

## 2. Run a backup

### 2.1 Manually

Export the environment (or source `.env.production`) and run:

```bash
BACKUP_DIR=/var/backups/influenceos \
BACKUP_S3_BUCKET=influenceos-backups \
BACKUP_S3_ENDPOINT=https://s3.example.com \
BACKUP_S3_ACCESS_KEY_ID=... \
BACKUP_S3_SECRET_ACCESS_KEY=... \
DIRECT_DATABASE_URL="postgresql://influenceos:...@db:5432/influenceos" \
  scripts/backup-db.sh
```

The script exits non-zero on any failure so cron / monitoring can alert.

### 2.2 On a schedule (cron)

Run daily at 02:30, appending to a log. This is the intended production
schedule:

```cron
30 2 * * *  /opt/influenceos/scripts/backup-db.sh >> /var/log/influenceos-backup.log 2>&1
```

The script pulls its `BACKUP_*` and `DATABASE_URL` values from the environment
(typically sourced from `/opt/influenceos/.env.production`), promotes to
weekly/monthly on the right days automatically, and prunes per the retention
settings above.

---

## 3. Restore a backup (DESTRUCTIVE)

`scripts/restore-db.sh` restores a backup into a target database. **This is
destructive:** it **drops and recreates the `public` schema** of the target
before loading, then `pg_restore`s the archive, then sanity-checks that the
`User` table is queryable. It **refuses to run without `--yes`**.

```bash
scripts/restore-db.sh <backup-file.dump> [--target <DATABASE_URL>] --yes
```

- **Target:** `--target <DATABASE_URL>`; if omitted, defaults to
  `DIRECT_DATABASE_URL` / `DATABASE_URL`.
- **Safety:** without `--yes` the script prints what it would drop (with the
  password masked) and exits `2` without touching anything.
- **Sanity check:** after loading it runs `SELECT count(*) FROM "User"` and
  fails if the table is not queryable.

### 3.1 Restore from a local file

```bash
scripts/restore-db.sh /var/backups/influenceos/daily/influenceos-20260909-023000.dump \
  --target "$DIRECT_DATABASE_URL" --yes
```

### 3.2 Restore directly from S3

Pass an `s3://` URL as the source; the script fetches it first (needs the `aws`
CLI and the `BACKUP_S3_*` credentials/endpoint):

```bash
BACKUP_S3_ENDPOINT=https://s3.example.com \
BACKUP_S3_ACCESS_KEY_ID=... \
BACKUP_S3_SECRET_ACCESS_KEY=... \
  scripts/restore-db.sh s3://influenceos-backups/daily/influenceos-20260909-023000.dump \
  --target "$DIRECT_DATABASE_URL" --yes
```

### 3.3 After restoring an OLDER backup — re-apply migrations

If the backup predates newer migrations, the restore leaves the schema behind
the committed migration history. The script prints a reminder; run:

```bash
pnpm --filter @influenceos/database migrate:deploy
```

`migrate deploy` is forward-only and idempotent, so re-applying already-present
migrations is a no-op. See `docs/DATABASE_OPERATIONS.md` for the migration
model.

---

## 4. Mandatory restore drill

**A backup you have never restored is a guess, not a backup.**
`scripts/restore-test.sh` is a **non-destructive** drill that proves the backup
pipeline round-trips:

1. Dumps the source database (`pg_dump -Fc`) and integrity-checks the dump.
2. Creates a **throwaway scratch database**.
3. Restores the dump into the scratch DB.
4. Verifies the **public-table count** and the **`User` row count** match the
   source.
5. **Drops the scratch database.**

It exits `0` **only** if the restored inventory matches the source.

### Environment

| Variable | Purpose | Default |
| --- | --- | --- |
| `SOURCE_DATABASE_URL` | DB to dump | `DIRECT_DATABASE_URL` / `DATABASE_URL` |
| `SCRATCH_DB` | Scratch database name | `influenceos_restore_test` |
| `ADMIN_DATABASE_URL` | Maintenance DB URL used to CREATE/DROP the scratch DB | derived by swapping the db name to `/postgres` |

### Run it

```bash
# Uses DIRECT_DATABASE_URL/DATABASE_URL as the source by default.
scripts/restore-test.sh

# Or against an explicit source:
SOURCE_DATABASE_URL="postgresql://influenceos:...@db:5432/influenceos" \
  scripts/restore-test.sh
```

### Schedule it

Run the drill on a schedule (e.g. **weekly**) and in CI so recovery stays a
known quantity. Example cron:

```cron
15 3 * * 1  /opt/influenceos/scripts/restore-test.sh >> /var/log/influenceos-restore-test.log 2>&1
```

> **Verified.** This drill has been run and **passed**: **29 public tables** and
> the `User` row count matched between the source and the restored scratch copy.

---

## 5. Runbooks

### 5.1 Verify a backup

Confirm an archive is a valid, parseable `pg_dump` custom archive (the same
check `backup-db.sh` runs automatically after every dump):

```bash
pg_restore --list /var/backups/influenceos/daily/influenceos-20260909-023000.dump
```

A clean listing of the archive's table-of-contents means the backup is
structurally sound. A non-zero exit means the archive is corrupt — do not rely
on it; investigate the most recent good copy.

### 5.2 Test a restore

Run the non-destructive drill and confirm it exits `0` with matching counts:

```bash
scripts/restore-test.sh
# Expect: "PASS — backup restores cleanly and matches the source inventory."
```

To rehearse a **full** destructive restore, restore into a disposable database
you provision yourself and point `--target` at it (never at production):

```bash
scripts/restore-db.sh /var/backups/influenceos/daily/influenceos-20260909-023000.dump \
  --target "postgresql://influenceos:...@db:5432/influenceos_rehearsal" --yes
```

---

## 6. RPO / RTO analysis

- **RPO (worst-case data loss).** With **daily** backups the worst case is up to
  **~24 hours** of data (everything written since the last successful backup).
  To lower the RPO, schedule backups **more frequently**, or enable **WAL
  archiving / Point-in-Time Recovery (PITR)** at the Postgres layer.
- **RTO (time to restore).** For a logical restore, RTO is roughly the time to
  **provision a database + `pg_restore` the dump**. It **scales with data size**;
  for a small internal dataset this is **minutes**. Add the time to re-apply any
  newer migrations (`migrate:deploy`) and to redeploy the app.

**Recommended minimum posture:** at least **daily** backups shipped off-host to
S3, **plus** a periodic (e.g. **weekly**) automated restore drill via
`scripts/restore-test.sh`. Tighten the backup frequency or move to WAL/PITR if a
~24h RPO is too much for the business.

---

## 7. Command quick-reference

| Task | Command |
| --- | --- |
| Take a backup | `scripts/backup-db.sh` |
| Backup via cron (daily 02:30) | `30 2 * * *  /opt/influenceos/scripts/backup-db.sh >> /var/log/influenceos-backup.log 2>&1` |
| Verify an archive | `pg_restore --list <file.dump>` |
| Restore (local) | `scripts/restore-db.sh <file.dump> --target "$DIRECT_DATABASE_URL" --yes` |
| Restore (S3) | `scripts/restore-db.sh s3://bucket/daily/<file.dump> --yes` |
| Re-apply migrations after old restore | `pnpm --filter @influenceos/database migrate:deploy` |
| Restore drill (non-destructive) | `scripts/restore-test.sh` |
