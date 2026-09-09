# Redis and Queues

How InfluenceOS uses Redis, how the worker's background queues behave, how the
system degrades when Redis is unreachable, and how to harden and observe it in
production. Operational reference for running and recovering the worker.

## 1. Redis's two roles

Redis serves two distinct purposes. They are independent — either can be in use
without the other.

| Role | Component | Config gate | Failure behaviour |
|---|---|---|---|
| **Job queues** (BullMQ) | worker (`apps/worker`) | `REDIS_URL` | Falls back to an inline maintenance loop (see §5) |
| **Rate-limit store** (optional) | API (`apps/api`) | `RATE_LIMIT_REDIS` truthy **and** `REDIS_URL` set | Degrades to allowing the request (`skipOnError`, see §7) |

`REDIS_URL` configures the Redis connection for both roles.

## 2. The three queues

The worker runs three BullMQ queues:

| Queue | Responsibility |
|---|---|
| `content-check` | Runs due content checks. |
| `follower-sync` | Runs stale account (follower) syncs. |
| `maintenance` | Runs the repeatable maintenance sweep (see §4), which enqueues work onto the other two queues and generates notifications. |

The worker runs **three BullMQ Workers**, one per queue.

## 3. Retry, backoff, and concurrency

Each queue's Workers are configured with:

- **Retry:** `attempts: 3` with **exponential backoff**. A failing job is retried
  up to three times with growing delay between attempts.
- **Retention caps:** `removeOnComplete` / `removeOnFail` caps bound how many
  completed and failed jobs are retained in Redis, so the queues do not grow
  unbounded.
- **Per-queue concurrency** and **per-queue rate limiters** — each queue has its
  own concurrency and rate-limit settings, so one queue cannot starve the others.

```text
attempts: 3
backoff:  exponential
removeOnComplete: capped
removeOnFail:     capped
concurrency:      per-queue
rateLimiter:      per-queue
```

## 4. The maintenance sweep and MONITOR_CRON

A **repeatable** maintenance sweep runs on a cron schedule set by `MONITOR_CRON`
(default `*/30 * * * *` — every 30 minutes). Each sweep:

1. Enqueues **due content checks** (onto `content-check`).
2. Enqueues **stale account syncs** (onto `follower-sync`).
3. Generates **notifications**.

```bash
# Default: every 30 minutes
MONITOR_CRON="*/30 * * * *"
```

The sweep is the scheduler that keeps content checks and account syncs current;
the other two queues do the actual work it enqueues.

## 5. Degraded mode: inline fallback

If Redis is **unreachable at worker startup**, the worker does not fail. It falls
back to an **inline maintenance loop**, reported as mode `inline-fallback`.

| | `redis+bullmq` (normal) | `inline-fallback` (degraded) |
|---|---|---|
| Maintenance sweep runs on a timer | Yes | **Yes** |
| Backed by a real queue | Yes | **No** |
| Distributed retries (`attempts: 3`, backoff) | Yes | **No** |
| Multiple workers share the load | Yes | No (no shared queue) |

**What still works:** maintenance still runs on a timer, so due content checks,
stale account syncs, and notification generation continue.

**What you lose:** there is no real queue, and therefore **no distributed
retries** — the per-queue retry/backoff, concurrency, and rate-limiter guarantees
from §3 do not apply. This is a keep-the-lights-on mode, not a substitute for
Redis. Treat a worker reporting `inline-fallback` as a Redis outage to
investigate.

## 6. Observing queue health

The worker exposes a health endpoint at `:WORKER_PORT/health` (default port
**4100**). It returns JSON (not Prometheus text) with:

| Field | Meaning |
|---|---|
| `mode` | `redis+bullmq` (normal) or `inline-fallback` (degraded — Redis was unreachable at startup) |
| `contentChecks` | Content-check activity counter |
| `accountSyncs` | Account-sync activity counter |
| `notifications` | Notifications generated |
| `lastMaintenanceAt` | Timestamp of the last maintenance sweep |

```bash
curl -s http://worker:4100/health
```

Operational checks:

- **`mode` must be `redis+bullmq`** in production. `inline-fallback` means Redis
  was down at startup.
- **`lastMaintenanceAt` should advance** roughly on the `MONITOR_CRON` cadence. A
  stale `lastMaintenanceAt` means the sweep has stopped.

## 7. How failures degrade

The system is designed so a Redis problem does not cascade into a full outage:

- **API rate limiter (`skipOnError: true`).** When Redis is used as the rate-limit
  store and a Redis blip occurs, the limiter **does not take the API down** — it
  degrades to **allowing** the request. The rate limit is temporarily not
  enforced, but the API keeps serving.
- **Worker inline fallback.** If Redis is unreachable at worker startup, the
  worker runs the inline maintenance loop instead of failing (see §5).
- **Queue durability across restarts.** With `appendonly` persistence enabled,
  jobs persist in Redis, so the **queues tolerate Redis restarts** — a Redis
  bounce does not lose in-flight jobs.
- **Graceful worker shutdown.** The worker **drains active jobs before exit**, so
  a deploy or restart does not abandon jobs mid-flight.

## 8. Production hardening

| Requirement | Why |
|---|---|
| **Require a password** (`requirepass`) | Redis has no auth by default; an unauthenticated Redis is an open door. |
| **Keep Redis off the public network** | Redis must be reachable only on the private network. |
| **Enable `appendonly` persistence** | Jobs persist across restarts, so the queues tolerate a Redis bounce without losing jobs. |

The dev / full compose stack runs Redis with `--appendonly yes`:

```yaml
# docker-compose.full.yml (Redis service)
redis:
  command: ["redis-server", "--appendonly", "yes"]
```

In production, additionally set `requirepass` and ensure Redis is bound to the
private network only (never a public interface).

## 9. Environment variables

| Variable | Applies to | Default | Notes |
|---|---|---|---|
| `REDIS_URL` | worker + API | — | Redis connection URL; gates both roles |
| `RATE_LIMIT_REDIS` | API | — | When truthy (and `REDIS_URL` set), the API rate limiter uses Redis so the limit is **shared across API instances** |
| `MONITOR_CRON` | worker | `*/30 * * * *` | Maintenance sweep schedule |
| `WORKER_PORT` | worker | `4100` | Port for the worker health endpoint (`/health`) |

> **Shared vs per-instance rate limiting.** Without `RATE_LIMIT_REDIS`, each API
> instance limits independently (in-memory). With it, the limit is shared across
> instances via Redis — the correct choice when running more than one API
> replica.
