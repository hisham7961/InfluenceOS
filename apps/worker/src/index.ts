import http from 'node:http';
import { prisma } from '@influenceos/database';
import { refreshProviderCredentialOverrides } from '@influenceos/domain';
import { Queue, Worker, type Job } from 'bullmq';
import { computeWorkerHealth, shouldDeadLetter } from '@influenceos/shared';
import { createConnection, isRedisAvailable } from './redis';
import {
  checkContent,
  claimDueContentIds,
  claimStaleAccountIds,
  cleanupAbandonedUploads,
  generateNotifications,
  monitoringBacklog,
  syncAccount,
} from './processors';

/** Content checks queued per sweep; grows toward MAX when a backlog builds up. */
const BATCH = Number(process.env.MONITOR_BATCH_SIZE) || 100;
const MAX_BATCH = Math.max(BATCH, Number(process.env.MONITOR_MAX_BATCH_SIZE) || 400);
/** Follower syncs per sweep — kept low: Instagram allows ~200 calls/hour per app. */
const ACCOUNT_BATCH = Number(process.env.MONITOR_ACCOUNT_BATCH_SIZE) || 25;
const MONITOR_CRON = process.env.MONITOR_CRON || '*/30 * * * *';
const HEALTH_PORT = Number(process.env.WORKER_PORT) || 4100;

const QUEUES = {
  content: 'content-check',
  account: 'follower-sync',
  maintenance: 'maintenance',
  deadLetter: 'dead-letter',
} as const;
type Kind = 'content' | 'account';

/** Release identity surfaced on the health endpoint (never secrets). */
const release = {
  service: 'influenceos-worker',
  version: process.env.APP_VERSION ?? process.env.npm_package_version ?? '0.1.0',
  gitSha: process.env.GIT_SHA ?? 'unknown',
  buildTime: process.env.BUILD_TIME ?? null,
  environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development',
};

const stats = {
  mode: 'starting' as string,
  contentChecks: 0,
  accountSyncs: 0,
  notifications: 0,
  abandonedUploadsCleaned: 0,
  jobsFailed: 0,
  deadLettered: 0,
  lastMaintenanceAt: null as string | null,
  /** Content still due / accounts still stale after the last sweep queued its batch. */
  backlog: { dueContent: 0, staleAccounts: 0 },
};

// Whether Redis is currently reachable — drives the /health verdict (WK-03).
// Updated from the shared connection's lifecycle events and a periodic ping.
let redisHealthy = false;
let redisPingTimer: NodeJS.Timeout | null = null;

// Resources registered for orderly shutdown. Closing a BullMQ Worker waits for
// its active jobs to finish (draining); closing Queues/connections releases
// Redis sockets. Populated as we start subsystems.
const workers: Worker[] = [];
const queues: Queue[] = [];
let redisConnection: ReturnType<typeof createConnection> | null = null;
let inlineTimer: NodeJS.Timeout | null = null;
let healthServer: http.Server | null = null;

async function runMaintenance(enqueue: (kind: Kind, id: string) => Promise<void>) {
  // Keys edited in Admin → Integrations take effect without a worker restart.
  await refreshProviderCredentialOverrides(prisma).catch((e) =>
    console.error('[maintenance] could not reload provider credentials', e),
  );

  // Queue more when the last sweep left a backlog, so a pile-up drains
  // instead of growing by a fixed trickle.
  const contentBatch = Math.min(MAX_BATCH, Math.max(BATCH, stats.backlog.dueContent));
  const dueContent = await claimDueContentIds(contentBatch);
  for (const id of dueContent) await enqueue('content', id);

  const staleAccounts = await claimStaleAccountIds(ACCOUNT_BATCH);
  for (const id of staleAccounts) await enqueue('account', id);

  stats.backlog = await monitoringBacklog().catch(() => stats.backlog);

  const notif = await generateNotifications();
  stats.notifications += notif.created;

  // Orphaned-upload cleanup is comparatively expensive (lists storage), so run
  // it at most hourly rather than every sweep. The 24h grace inside it means
  // in-flight uploads are never touched.
  let cleaned = 0;
  if (Date.now() - lastCleanupAt >= 60 * 60 * 1000) {
    cleaned = await cleanupAbandonedUploads().catch((e) => {
      console.error('[maintenance] abandoned-upload cleanup failed', e);
      return 0;
    });
    lastCleanupAt = Date.now();
    stats.abandonedUploadsCleaned += cleaned;
  }

  stats.lastMaintenanceAt = new Date().toISOString();
  console.log(
    `[maintenance] queued ${dueContent.length} content checks, ${staleAccounts.length} account syncs (still waiting: ${stats.backlog.dueContent} content, ${stats.backlog.staleAccounts} accounts), created ${notif.created} notifications, cleaned ${cleaned} orphan uploads`,
  );
}
let lastCleanupAt = 0;

async function startWithRedis() {
  const connection = createConnection();
  redisConnection = connection;
  // main() only calls this after isRedisAvailable() succeeded, so start healthy
  // and let the connection's lifecycle events / periodic ping flip it if Redis
  // drops.
  redisHealthy = true;
  connection.on('ready', () => (redisHealthy = true));
  connection.on('error', () => (redisHealthy = false));
  connection.on('close', () => (redisHealthy = false));
  connection.on('end', () => (redisHealthy = false));
  redisPingTimer = setInterval(() => {
    connection
      .ping()
      .then((pong) => (redisHealthy = pong === 'PONG'))
      .catch(() => (redisHealthy = false));
  }, 10_000);
  redisPingTimer.unref();

  const contentQ = new Queue(QUEUES.content, { connection });
  const accountQ = new Queue(QUEUES.account, { connection });
  const maintenanceQ = new Queue(QUEUES.maintenance, { connection });
  // Dead-letter queue: terminally-failed jobs are recorded here (no processor)
  // so they persist for inspection/alerting instead of vanishing (WK-04/07).
  const deadLetterQ = new Queue(QUEUES.deadLetter, { connection });
  queues.push(contentQ, accountQ, maintenanceQ, deadLetterQ);

  const jobOpts = {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 500,
    removeOnFail: 200,
  } as const;

  // Each claim gets its own job id. A fixed per-row id (`c:<id>`) made BullMQ
  // silently drop every later check while the earlier job was still kept as
  // completed — the row was never checked again. Rows are claimed in the
  // database, so one sweep can't queue the same row twice anyway.
  const enqueue = async (kind: Kind, id: string) => {
    const claim = Date.now().toString(36);
    if (kind === 'content') await contentQ.add('check', { id }, { ...jobOpts, jobId: `c:${id}:${claim}` });
    else await accountQ.add('sync', { id }, { ...jobOpts, jobId: `a:${id}:${claim}` });
  };

  // Attach failure/error observers to a worker: count failures, surface errors,
  // and dead-letter a job once its retries are exhausted.
  const observe = (worker: Worker, queueName: string) => {
    worker.on('failed', (job, err) => {
      stats.jobsFailed++;
      console.error(`[worker] job ${queueName}/${job?.id ?? '?'} failed: ${err?.message ?? err}`);
      if (job && shouldDeadLetter(job.attemptsMade, job.opts.attempts ?? 1)) {
        stats.deadLettered++;
        deadLetterQ
          .add(
            'dead',
            { queue: queueName, jobId: job.id, name: job.name, data: job.data, failedReason: job.failedReason },
            { removeOnComplete: false, removeOnFail: false },
          )
          .catch((e) => console.error('[worker] failed to dead-letter job', e));
        console.error(`[worker] job ${queueName}/${job.id} dead-lettered after ${job.attemptsMade} attempts`);
      }
    });
    worker.on('error', (err) => {
      // A worker-level error usually means the Redis connection is unhealthy.
      redisHealthy = false;
      console.error(`[worker] ${queueName} worker error: ${err?.message ?? err}`);
    });
    return worker;
  };

  workers.push(
    observe(
      new Worker(
        QUEUES.content,
        async (job: Job<{ id: string }>) => {
          await checkContent(job.data.id);
          stats.contentChecks++;
        },
        { connection, concurrency: 3, limiter: { max: 10, duration: 1000 } },
      ),
      QUEUES.content,
    ),
  );

  workers.push(
    observe(
      new Worker(
        QUEUES.account,
        async (job: Job<{ id: string }>) => {
          await syncAccount(job.data.id);
          stats.accountSyncs++;
        },
        { connection, concurrency: 2, limiter: { max: 5, duration: 1000 } },
      ),
      QUEUES.account,
    ),
  );

  workers.push(
    observe(
      new Worker(QUEUES.maintenance, async () => runMaintenance(enqueue), { connection, concurrency: 1 }),
      QUEUES.maintenance,
    ),
  );

  await maintenanceQ.add('sweep', {}, { repeat: { pattern: MONITOR_CRON }, jobId: 'maintenance-sweep' });
  await maintenanceQ.add('sweep-now', {}, jobOpts);

  stats.mode = 'redis+bullmq';
  console.log(`Worker running with Redis/BullMQ. Maintenance cron: ${MONITOR_CRON}`);
}

function startFallback() {
  stats.mode = 'inline-fallback';
  console.warn('Redis unavailable — running an inline maintenance loop (no queue).');
  const enqueueInline = async (kind: Kind, id: string) => {
    if (kind === 'content') {
      await checkContent(id).catch((e) => console.error('checkContent failed', e));
      stats.contentChecks++;
    } else {
      await syncAccount(id).catch((e) => console.error('syncAccount failed', e));
      stats.accountSyncs++;
    }
  };
  const tick = () => runMaintenance(enqueueInline).catch((e) => console.error('maintenance error', e));
  void tick();
  inlineTimer = setInterval(() => void tick(), 30 * 60 * 1000);
}

function startHealth() {
  healthServer = http
    .createServer((req, res) => {
      if (req.url === '/health') {
        const { code, status } = computeWorkerHealth(stats.mode, redisHealthy);
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status, redisHealthy, ...release, ...stats }));
      } else {
        res.writeHead(404);
        res.end();
      }
    })
    .listen(HEALTH_PORT, () => console.log(`Worker health on http://localhost:${HEALTH_PORT}/health`));
}

async function main() {
  startHealth();
  // Load admin-stored (encrypted) provider credentials so worker syncs use the
  // same effective keys as the API (INT-4). No-op when none are stored.
  await refreshProviderCredentialOverrides(prisma).catch(() => undefined);
  if (await isRedisAvailable()) await startWithRedis();
  else startFallback();
}

void main();

// Graceful shutdown: stop the inline loop, drain active jobs by closing each
// Worker (BullMQ waits for in-flight jobs), release Redis and the DB pool, and
// stop the health server. A hard timeout guards against a hung close so an
// orchestrator's SIGKILL grace period is never the only backstop.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] received ${signal}, shutting down…`);
  const timer = setTimeout(() => {
    console.error('[worker] graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, 15_000);
  timer.unref();
  try {
    if (inlineTimer) clearInterval(inlineTimer);
    if (redisPingTimer) clearInterval(redisPingTimer);
    // Closing Workers drains active jobs before resolving.
    await Promise.all(workers.map((w) => w.close()));
    await Promise.all(queues.map((q) => q.close()));
    if (redisConnection) await redisConnection.quit().catch(() => redisConnection?.disconnect());
    await new Promise<void>((resolve) => (healthServer ? healthServer.close(() => resolve()) : resolve()));
    await prisma.$disconnect();
    clearTimeout(timer);
    console.log('[worker] shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('[worker] error during shutdown', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
