import http from 'node:http';
import { Queue, Worker, type Job } from 'bullmq';
import { createConnection, isRedisAvailable } from './redis';
import {
  checkContent,
  findDueContentIds,
  findStaleAccountIds,
  generateNotifications,
  syncAccount,
} from './processors';

const BATCH = Number(process.env.MONITOR_BATCH_SIZE) || 25;
const MONITOR_CRON = process.env.MONITOR_CRON || '*/30 * * * *';
const HEALTH_PORT = Number(process.env.WORKER_PORT) || 4100;

const QUEUES = { content: 'content-check', account: 'follower-sync', maintenance: 'maintenance' } as const;
type Kind = 'content' | 'account';

const stats = {
  mode: 'starting' as string,
  contentChecks: 0,
  accountSyncs: 0,
  notifications: 0,
  lastMaintenanceAt: null as string | null,
};

async function runMaintenance(enqueue: (kind: Kind, id: string) => Promise<void>) {
  const dueContent = await findDueContentIds(BATCH);
  for (const id of dueContent) await enqueue('content', id);

  const staleAccounts = await findStaleAccountIds(BATCH);
  for (const id of staleAccounts) await enqueue('account', id);

  const notif = await generateNotifications();
  stats.notifications += notif.created;
  stats.lastMaintenanceAt = new Date().toISOString();
  console.log(
    `[maintenance] queued ${dueContent.length} content checks, ${staleAccounts.length} account syncs, created ${notif.created} notifications`,
  );
}

async function startWithRedis() {
  const connection = createConnection();
  const contentQ = new Queue(QUEUES.content, { connection });
  const accountQ = new Queue(QUEUES.account, { connection });
  const maintenanceQ = new Queue(QUEUES.maintenance, { connection });

  const jobOpts = {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 500,
    removeOnFail: 200,
  } as const;

  const enqueue = async (kind: Kind, id: string) => {
    if (kind === 'content') await contentQ.add('check', { id }, { ...jobOpts, jobId: `c:${id}` });
    else await accountQ.add('sync', { id }, { ...jobOpts, jobId: `a:${id}` });
  };

  new Worker(
    QUEUES.content,
    async (job: Job<{ id: string }>) => {
      await checkContent(job.data.id);
      stats.contentChecks++;
    },
    { connection, concurrency: 3, limiter: { max: 10, duration: 1000 } },
  );

  new Worker(
    QUEUES.account,
    async (job: Job<{ id: string }>) => {
      await syncAccount(job.data.id);
      stats.accountSyncs++;
    },
    { connection, concurrency: 2, limiter: { max: 5, duration: 1000 } },
  );

  new Worker(QUEUES.maintenance, async () => runMaintenance(enqueue), { connection, concurrency: 1 });

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
  setInterval(() => void tick(), 30 * 60 * 1000);
}

function startHealth() {
  http
    .createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', service: 'influenceos-worker', ...stats }));
      } else {
        res.writeHead(404);
        res.end();
      }
    })
    .listen(HEALTH_PORT, () => console.log(`Worker health on http://localhost:${HEALTH_PORT}/health`));
}

async function main() {
  startHealth();
  if (await isRedisAvailable()) await startWithRedis();
  else startFallback();
}

void main();

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
