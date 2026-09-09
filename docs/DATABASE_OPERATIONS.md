# Database Operations

Operational reference for the InfluenceOS PostgreSQL database. Audience:
ADMIN/STAFF operators and on-call SREs. InfluenceOS is an internal, API-first
platform with no AI and no influencer-facing portals; this document covers the
day-to-day and change-management mechanics of its datastore only.

- **Engine:** PostgreSQL 16
- **ORM / migration tool:** Prisma 6 (primary keys are `cuid` strings)
- **Schema source of truth:** `packages/database/prisma/schema.prisma`
- **Migration history:** `packages/database/prisma/migrations/`

Related runbooks: `docs/BACKUP_AND_RESTORE.md`, `docs/DISASTER_RECOVERY.md`,
`docs/DEPLOYMENT.md`.

---

## 1. Connection model — pooled vs. direct

The application uses **two** connection strings, and the distinction is
load-bearing. Both are documented in `.env.production.example`.

| Variable | Endpoint | Used by | Why |
| --- | --- | --- | --- |
| `DATABASE_URL` | **Pooled** (e.g. via pgbouncer) | API + worker runtime | Application traffic is many short queries; a connection pooler multiplexes them onto a small number of backend sessions and protects the primary from connection storms. |
| `DIRECT_DATABASE_URL` | **Unpooled**, points at the **primary** | Migrations, backups, restore drills | Schema changes (DDL) and `pg_dump` want a stable, session-level connection straight to the primary — not a transaction-pooled connection that can hand you a different backend between statements. |

Rules of thumb:

- **Runtime code** always talks through the pooled `DATABASE_URL`.
- **Migrations and maintenance** (`prisma migrate deploy`, `pg_dump`,
  `pg_restore`, restore drills) use `DIRECT_DATABASE_URL` — the backup and
  restore scripts prefer it automatically, falling back to `DATABASE_URL` only
  if the direct URL is unset.
- In `docker-compose.full.yml` both URLs point at the same `postgres` service
  (there is no separate pooler in the single-host compose stack); in a real
  deployment `DATABASE_URL` is the pooler and `DIRECT_DATABASE_URL` is the
  primary.

---

## 2. Migration workflow

Migrations are **forward-only, ordered, committed SQL files**. Prisma applies
the files in `packages/database/prisma/migrations/` in lexical order and records
each one in the `_prisma_migrations` table.

### 2.1 Author a migration in development

Create migrations locally against a dev database with `migrate dev`. This
diffs the schema, writes a new timestamped migration directory, and applies it:

```bash
# From the repo root (wraps: prisma migrate dev)
pnpm db:migrate
```

Commit the generated `packages/database/prisma/migrations/<timestamp>_<name>/`
directory. **The migration file is the artifact you ship** — production never
diffs the schema, it only replays committed files.

### 2.2 Apply migrations in production

Production applies committed migrations **only** with:

```bash
# From the repo root (wraps: prisma migrate deploy)
pnpm db:deploy
```

`prisma migrate deploy` replays every not-yet-applied migration file in order
against `DIRECT_DATABASE_URL`. It is **forward-only**: it never generates or
runs a down-migration, and there is **no automatic rollback**. Undoing a schema
change means writing a new, additive forward migration — or restoring a backup
(see `docs/BACKUP_AND_RESTORE.md`).

### 2.3 How the container stack runs migrations

`docker-compose.full.yml` defines a one-shot `migrate` service that runs
migrations and then the idempotent first-admin bootstrap **before** the
`api`, `worker`, and `web` services start (they wait on
`migrate: service_completed_successfully`):

```yaml
# docker-compose.full.yml — the migrate one-shot
command: >
  /bin/sh -c "
  pnpm --filter @influenceos/database exec prisma migrate deploy &&
  pnpm --filter @influenceos/database exec tsx prisma/bootstrap.ts
  "
```

`scripts/deploy-production.sh` builds images, takes a **pre-deploy backup**, and
then brings the stack up so this one-shot applies migrations ahead of the app.

---

## 3. Absolute rules (do not violate in production)

1. **Never run `prisma db push` in production.** `db push` mutates the live
   schema to match `schema.prisma` **without recording a migration**, corrupting
   migration history and making the DB un-reproducible. Production changes go
   through `pnpm db:deploy` only.
2. **Never run the seed in production.** The seed at
   `packages/database/prisma/seed.ts` is **destructive — it WIPES data.** It is
   guarded and will refuse to run unless **both** `SEED_DEMO=true` **and**
   `CONFIRM_WIPE=true` are set. Do not set these against a production database.
3. **There is no automatic down-migration.** `migrate deploy` only rolls
   forward. Plan schema changes so they are reversible by a follow-up forward
   migration or by a restore.

---

## 4. First-admin bootstrap

The first ADMIN user is created by `packages/database/prisma/bootstrap.ts`,
**not** by the seed. It is **non-destructive and idempotent** — safe to run on
every deploy; it does nothing if an admin already exists.

```bash
# From the repo root (wraps: tsx prisma/bootstrap.ts)
BOOTSTRAP_ADMIN_EMAIL=admin@example.com \
BOOTSTRAP_ADMIN_PASSWORD='<from-secret-store>' \
pnpm db:bootstrap
```

- `BOOTSTRAP_ADMIN_EMAIL` — required.
- `BOOTSTRAP_ADMIN_PASSWORD` — required in production; supply it from a secret
  store (it is never generated and printed to deployment logs in production).

Because it is idempotent, the compose `migrate` one-shot runs it on every
deploy with no risk of injecting or duplicating an admin.

---

## 5. Adding a column safely (zero-downtime, backward-compatible)

`migrate deploy` runs the new schema **before** the new application code is
guaranteed to be live, and during a rollback the *old* code may run against the
*new* schema. Design every migration to be **additive and backward-compatible**
so both code versions tolerate it:

- **Add**, don't rename or drop, in the same migration a running release
  depends on. Old code simply ignores new columns.
- New columns must be **nullable or carry a default** so existing `INSERT`s from
  old code still succeed.
- Split destructive changes (dropping/renaming a column, tightening a
  constraint) across multiple releases: first ship code that no longer uses the
  column, deploy it, then drop the column in a later migration.

Workflow:

```bash
# 1. Edit packages/database/prisma/schema.prisma — add the nullable column.

# 2. Generate + apply the migration locally.
pnpm db:migrate            # prisma migrate dev — creates the migration file

# 3. Commit the new migrations/<timestamp>_<name>/ directory, open a PR, pass CI.

# 4. Production applies it during deploy.
pnpm db:deploy             # prisma migrate deploy — forward-only
```

This ordering (additive schema first, code that reads it second) is what makes
the deploy zero-downtime and the rollback in
`scripts/rollback-production.sh` safe: an additive migration leaves the DB in a
state the previous release still satisfies.

---

## 6. Connection pooling notes

- **Application services** (`api`, `worker`) connect via the pooled
  `DATABASE_URL`. Keep the pool (pgbouncer) in front of the primary to absorb
  connection churn from the API-first workload.
- **Migrations bypass the pooler** by using `DIRECT_DATABASE_URL`. Prisma's
  migration engine acquires an advisory lock and runs DDL that expects a single,
  stable session — route it at the primary directly, never through a
  transaction-mode pooler.
- **Backups and restore drills** likewise prefer `DIRECT_DATABASE_URL` so the
  dump/restore session is a direct primary session.
- Size the pooler and Postgres `max_connections` for the number of API/worker
  replicas; the pooler is what keeps replica count from exhausting backend
  connections.

---

## 7. Routine tasks

### 7.1 Check which migrations are applied

```bash
# Reports applied vs. pending migrations against DIRECT_DATABASE_URL.
pnpm --filter @influenceos/database exec prisma migrate status
```

Inspect the recorded history directly if you need timestamps:

```bash
psql "$DIRECT_DATABASE_URL" -c \
  'SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY finished_at;'
```

### 7.2 Connect for read-only inspection

Prefer a read-only session so an inspection can never write:

```bash
psql "$DATABASE_URL"
# then, inside psql:
BEGIN; SET TRANSACTION READ ONLY;
SELECT count(*) FROM "User";
-- ... your read-only queries ...
ROLLBACK;
```

`\dt` lists tables; `\d "User"` describes a table. Use the pooled
`DATABASE_URL` for read-only inspection so you do not compete with migrations on
the direct endpoint.

---

## 8. Command quick-reference

| Task | Command |
| --- | --- |
| Author migration (dev) | `pnpm db:migrate` |
| Apply migrations (prod) | `pnpm db:deploy` |
| Bootstrap first admin (idempotent) | `pnpm db:bootstrap` |
| Migration status | `pnpm --filter @influenceos/database exec prisma migrate status` |
| Take a backup | `scripts/backup-db.sh` (see `docs/BACKUP_AND_RESTORE.md`) |
| Restore a backup (destructive) | `scripts/restore-db.sh <file|s3-url> --yes` |
| Restore drill (non-destructive) | `scripts/restore-test.sh` |

**Never in production:** `prisma db push`, `pnpm db:seed` / the demo seed.
