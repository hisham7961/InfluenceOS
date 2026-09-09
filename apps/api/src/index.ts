import { prisma } from '@influenceos/database';
import { buildApp } from './app';
import { loadEnv } from './env';
import { releaseInfo } from './release';

async function main() {
  const env = loadEnv();
  const app = await buildApp();

  // Fail fast if the database is unreachable at boot: a container that cannot
  // reach Postgres must not report itself as started.
  try {
    await prisma.$connect();
  } catch (err) {
    app.log.error({ err }, 'Database connection failed at startup');
    process.exit(1);
  }

  // Graceful shutdown: on SIGTERM/SIGINT stop accepting new connections, let
  // in-flight requests drain (Fastify close), then release the DB pool. An
  // orchestrator sends SIGTERM on rollout/scale-down; draining avoids dropping
  // requests mid-flight. A hard timeout guards against a hung close.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'Shutting down API');
    const timer = setTimeout(() => {
      app.log.error('Graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, 10_000);
    timer.unref();
    try {
      await app.close();
      await prisma.$disconnect();
      clearTimeout(timer);
      app.log.info('API shutdown complete');
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await app.listen({ port: env.API_PORT, host: env.API_HOST });
    const rel = releaseInfo();
    app.log.info(
      { version: rel.version, gitSha: rel.gitSha, environment: rel.environment },
      `InfluenceOS API listening on http://${env.API_HOST}:${env.API_PORT}`,
    );
    app.log.info(`API docs at http://localhost:${env.API_PORT}/api/docs`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
