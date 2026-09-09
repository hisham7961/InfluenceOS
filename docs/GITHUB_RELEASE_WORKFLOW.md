# GitHub Release & Deployment Workflow

Release engineering process for **InfluenceOS**, an internal ADMIN/STAFF-only,
API-first influencer-campaign platform. This document describes how a commit
becomes a production release: how releases are identified, what gates a release
candidate must pass, how to tag and stage it, how to deploy and verify it, how
to roll it back, and how to keep migrations safe during a rollout.

The core promise: **the exact revision that passed CI is the exact revision you
run in production.**

---

## 1. Principles

These four principles govern every release. If a step in this document appears
to conflict with one of them, the principle wins.

1. **Immutable revision.** You deploy an exact git SHA or annotated tag — the
   exact revision that passed CI — never a moving branch and never `latest`.
   The SHA that CI tested is the SHA you deploy. Once a release SHA passes CI
   you do **not** add another commit merely to record that it passed; that would
   change the SHA and invalidate the test result. A rollback is nothing more
   than deploying an earlier, already-tested SHA.

2. **CI-green gate.** A revision is releasable only when **all** CI jobs are
   green on that SHA. A partially green or manually patched build is not a
   release candidate.

3. **Self-identifying builds.** Every build reports its own identity. Given a
   running instance you can always answer "which SHA is this?" from the build
   itself — via `/health`, `/metrics`, or the web **Settings → Platform** page —
   without trusting deploy notes or memory.

4. **Config, not code, between environments.** Staging and production run the
   **same** images built from the **same** SHA, using the **same**
   `docker-compose.full.yml` and the **same** deploy script. Environments differ
   only by configuration and secrets (database, Redis, object store, domain,
   `APP_ENV`) — never by code.

---

## 2. Release identification

Every build is self-identifying through three values:

| Value        | Meaning                                             |
|--------------|-----------------------------------------------------|
| `APP_VERSION`| Human-readable version; defaults to `git describe --tags` |
| `GIT_SHA`    | The exact revision that was built and deployed      |
| `BUILD_TIME` | When the build was produced                         |

These are injected at deploy time by `scripts/deploy-production.sh` and are
**never secrets** — they are safe to expose.

### Where the identity surfaces

- **`GET /health`** — returns the build identity (including the reported
  `gitSha`).
- **`/metrics`** — exposed as the `influenceos_build_info` series.
- **Web Settings → Platform** — shows the **git SHA**, **built**, and **uptime**
  tiles.

### Confirming the deployed build matches the intended SHA

After any deploy or rollback, confirm identity before declaring success. The
deploy script itself prints the running build's reported `gitSha` as its final
step (see §6), but you can verify independently at any time:

```bash
# Ask the running instance what it is
curl -fsS https://<host>/health

# Or scrape the build_info series
curl -fsS https://<host>/metrics | grep influenceos_build_info
```

The `gitSha` reported by the instance must equal the SHA (or the SHA the tag
resolves to) that you deployed. If it does not, treat the deploy as unverified.

---

## 3. The release pipeline (CI)

CI is defined in `.github/workflows/ci.yml`. It runs on:

- pushes to `main` and `claude/**` branches, and
- pull requests.

### Jobs that must be green

A release candidate is a SHA on which **all** of the following jobs are green:

| Job        | What it does |
|------------|--------------|
| `security` | `gitleaks` secret scan (**blocking**) plus a **report-only** dependency audit |
| `build`    | typecheck, lint, unit, integration (including a **real MinIO S3 round-trip**), contract, DoD, and build |
| `images`   | builds the `api` / `worker` / `web` production images with buildx and **smoke-tests that the API image enforces env fail-fast** |
| `e2e`      | full stack on the **local storage driver** + worker health/sweep + Playwright smoke & DoD |
| `e2e-s3`   | full stack on **S3/MinIO** + browser DoD journey |

The dependency audit inside `security` is report-only and does **not** block; the
`gitleaks` secret scan **does** block.

### Finding the candidate SHA and knowing when it is releasable

1. Identify the commit you intend to release (typically the tip of `main` after
   the relevant PR merged).
2. Confirm every job above is green **on that exact SHA** — not on a newer commit
   and not on the branch in the abstract.
3. That green SHA is your **release candidate**. Do not add commits to "bless"
   it; the passing result already belongs to that SHA (immutable-revision rule).

---

## 4. Tagging a release

Tagging gives a green SHA a stable, human-readable name. `deploy-production.sh`
accepts either a tag or a raw SHA, and `APP_VERSION` defaults to
`git describe --tags`, so tagging directly improves the identity reported by the
running build.

Create an **annotated** tag on the green SHA:

```bash
# Tag the exact release-candidate SHA (replace with your candidate SHA)
git tag -a v1.0.0 <green-sha> -m "InfluenceOS v1.0.0"

# Push the tag
git push origin v1.0.0
```

Optionally publish a **GitHub Release** for the tag (for changelog/visibility):

```bash
gh release create v1.0.0 --title "v1.0.0" --notes "InfluenceOS v1.0.0"
```

The tag points at the immutable SHA; deploying the tag deploys that exact
revision.

---

## 5. Staging

Run a **separate** staging environment that mirrors production: its own
database, Redis, object store, secrets, and a staging domain. Staging uses the
**same** `docker-compose.full.yml` and the **same** `scripts/deploy-production.sh`
as production — the only difference is configuration and secrets, with
`APP_ENV=staging`.

### Validate a candidate on staging

1. Deploy the candidate SHA (or tag) to staging using the same deploy command
   you will use for production:

   ```bash
   APP_ENV=staging scripts/deploy-production.sh v1.0.0
   ```

   (Staging supplies its own `/opt/influenceos/.env.production`-equivalent
   secrets and its own staging domain via `NEXT_PUBLIC_APP_URL` / `WEB_ORIGIN`.)

2. Run the non-destructive smoke test against staging:

   ```bash
   scripts/smoke-test.sh https://staging-api.<domain> https://staging.<domain>
   ```

3. Exercise the **DoD journey** on staging.

### Promote the identical SHA

Once staging validates, promote the **same SHA** to production. Do not rebuild,
do not re-tag a different commit, and do not "fix forward" onto a new SHA between
staging and production — that would break the immutable-revision guarantee. The
artifact you validated on staging is the artifact you ship.

---

## 6. Deploy to production

Production deploys run `scripts/deploy-production.sh` with the exact
SHA or tag:

```bash
scripts/deploy-production.sh <git-sha-or-tag>
```

### What the script does, in order

1. `git fetch` + `git checkout` the exact revision (detached HEAD).
2. Takes a **pre-deploy DB backup** via `scripts/backup-db.sh`.
3. Exports `GIT_SHA`, `APP_VERSION` (`git describe`), and `BUILD_TIME`.
4. `docker compose -f docker-compose.full.yml build`.
5. `docker compose up -d`. The compose **`migrate` one-shot runs
   `prisma migrate deploy` plus an idempotent admin bootstrap BEFORE the
   `api`/`worker`/`web` services start.**
6. Gates on `GET /health`, then `GET /ready`, before declaring success.
7. Prints the running build's reported `gitSha`.

### Required environment

Provided from `/opt/influenceos/.env.production` (**never committed**):

- `POSTGRES_PASSWORD`
- `MINIO_ROOT_USER`
- `MINIO_ROOT_PASSWORD`
- `AUTH_SECRET`
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`
- `NEXT_PUBLIC_APP_URL`
- `WEB_ORIGIN`

Optional: `COMPOSE_FILE`, `HEALTH_URL`, `SKIP_BACKUP`.

### Post-deploy smoke test

After the health gate passes, run the non-destructive smoke test:

```bash
scripts/smoke-test.sh https://api.<domain> https://<domain>
```

It verifies `/health`, `/ready`, an **anonymous 401 on a protected route**, and
that the web `/login` page renders. Provide `SMOKE_EMAIL` / `SMOKE_PASSWORD` to
also exercise an authenticated read followed by logout:

```bash
SMOKE_EMAIL='...' SMOKE_PASSWORD='...' scripts/smoke-test.sh https://api.<domain> https://<domain>
```

Finally, confirm the reported `gitSha` matches the SHA you deployed (§2).

---

## 7. Zero / low-downtime rollouts

### Forward-only, additive migrations (expand/contract)

`prisma migrate deploy` is **forward-only**; the database is not auto-downgraded.
Migrations must therefore be **additive and backward-compatible** so old and new
code can run against the same schema during a rollout. Never ship a destructive
migration in the same release as the code that depends on it.

Use the **expand/contract** pattern across releases:

> **Add** columns first → **deploy** code that writes both old and new →
> **backfill** → and only in a **later** release, **remove** the old shape.

#### Worked example — adding a `NOT NULL` column safely

Goal: add a required `country_code` column to `campaigns`. Doing this in one
step would break the currently running (old) code, which does not supply the
column. Split it across two releases:

**Release N (expand):**

1. Migration adds `country_code` as **nullable** (or with a default). Old code
   ignores the new column; the migration is backward-compatible.
2. New code writes `country_code` on every insert/update, and reads it
   defensively (tolerating rows that predate it).
3. Backfill existing rows (`country_code` populated for all historical
   campaigns).

**Release N+1 (contract):**

4. Now that every row has a value and all running code writes it, a migration
   tightens the column to `NOT NULL`.
5. Any now-unused old columns can be dropped in this later release.

At no point does a running instance see a schema its code cannot satisfy.

### Health-gated rollout

The reverse proxy (Caddy/Nginx) gates traffic on `/health` and `/ready`. An
instance that is not ready is kept **out of rotation**, so partially-started or
migrating instances never receive traffic.

### Multiple instances + shared rate limit

For a true rolling deploy, run **multiple API instances** behind the proxy and
use the **Redis-backed rate limiter** (`RATE_LIMIT_REDIS`) so the limit is shared
across instances. **Start new instances before stopping old ones**, letting the
proxy's health gate shift traffic to instances that are ready.

### Honest note: single-host restart window

The single-host `docker-compose` flow has a **brief restart window** on
`compose up -d` while services restart. This is acceptable for a small internal
tool. To reduce it:

- rely on the **health-gated rollout** (the proxy keeps not-ready instances out
  of rotation), and/or
- run **2+ API replicas** behind the proxy with the shared Redis rate limiter and
  start new replicas before stopping old ones.

---

## 8. Rollback

A rollback redeploys an earlier immutable revision — nothing more:

```bash
scripts/rollback-production.sh <previous-good-sha-or-tag>
```

`rollback-production.sh` reuses the deploy path, so the target revision goes
through the same fetch/checkout, backup, build, migrate, and health-gate steps.

### Migration caveat (read before rolling back)

Because `prisma migrate deploy` is **forward-only** and the DB is **not**
auto-downgraded, the script **warns and requires `--yes`** when the target
revision has **fewer migrations** than the current tree:

```bash
scripts/rollback-production.sh <previous-good-sha-or-tag> --yes
```

In that situation the operator must choose one of:

- **Target a revision whose schema the current DB still satisfies.** Because
  additive migrations are backward-compatible, old code simply ignores the newer
  columns, so rolling back the code without touching the schema is safe. **Or**
- **Restore a DB backup first** with `scripts/restore-db.sh`, then roll the code
  back to a revision that matches that restored schema.

Never force a rollback past a destructive schema change without restoring a
compatible database first.

### Verify after rollback

Confirm the rollback took effect exactly as for a deploy (§2):

```bash
curl -fsS https://api.<domain>/health          # gitSha == the previous-good SHA
scripts/smoke-test.sh https://api.<domain> https://<domain>
```

The reported `gitSha` must equal the previous-good SHA (or the SHA its tag
resolves to).

---

## 9. End-to-end example: releasing v1.2.0

Assume `<sha>` is the tip of `main` on which **all** CI jobs
(`security`, `build`, `images`, `e2e`, `e2e-s3`) are green.

**1. Confirm the candidate is green** on the exact SHA (§3), then tag it:

```bash
git tag -a v1.2.0 <sha> -m "InfluenceOS v1.2.0"
git push origin v1.2.0
gh release create v1.2.0 --title "v1.2.0" --notes "InfluenceOS v1.2.0"
```

**2. Validate on staging** (same compose, same script, `APP_ENV=staging`):

```bash
APP_ENV=staging scripts/deploy-production.sh v1.2.0
scripts/smoke-test.sh https://staging-api.<domain> https://staging.<domain>
# then exercise the DoD journey on staging
```

**3. Promote the identical SHA to production:**

```bash
scripts/deploy-production.sh v1.2.0
```

The script takes a pre-deploy backup, injects `GIT_SHA` / `APP_VERSION` /
`BUILD_TIME`, runs migrations via the `migrate` one-shot before services start,
and gates on `/health` then `/ready`.

**4. Verify production:**

```bash
scripts/smoke-test.sh https://api.<domain> https://<domain>
curl -fsS https://api.<domain>/health          # gitSha == v1.2.0's SHA
```

### Rollback example

If v1.2.0 misbehaves and the previous good release was `v1.1.0`:

```bash
scripts/rollback-production.sh v1.1.0
```

If v1.2.0 introduced migrations that v1.1.0 does not have, the script warns and
requires confirmation:

```bash
scripts/rollback-production.sh v1.1.0 --yes
```

Only pass `--yes` after confirming the current DB schema is still compatible with
v1.1.0's code (additive migrations are backward-compatible), **or** after
restoring a compatible backup with `scripts/restore-db.sh` first. Verify as in
step 4, expecting `gitSha` to equal v1.1.0's SHA.

---

## Script reference

| Script                          | Purpose |
|---------------------------------|---------|
| `scripts/deploy-production.sh`  | Deploy an exact SHA/tag: checkout, pre-deploy backup, inject build identity, build, `compose up -d` (migrate one-shot runs first), health-gate on `/health` then `/ready`, print reported `gitSha`. |
| `scripts/rollback-production.sh`| Redeploy an earlier immutable revision via the deploy path; warns and requires `--yes` when the target has fewer migrations than the current tree. |
| `scripts/backup-db.sh`          | Take a database backup (run automatically pre-deploy). |
| `scripts/restore-db.sh`         | Restore a database backup — used when rolling back to a revision whose schema the current DB cannot satisfy. |
| `scripts/smoke-test.sh`         | Non-destructive post-deploy verification: `/health`, `/ready`, anonymous 401 on a protected route, web `/login` renders; optional authenticated read + logout via `SMOKE_EMAIL` / `SMOKE_PASSWORD`. |
