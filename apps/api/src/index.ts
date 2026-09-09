import { buildApp } from './app';
import { loadEnv } from './env';

async function main() {
  const env = loadEnv();
  const app = await buildApp();
  try {
    await app.listen({ port: env.API_PORT, host: env.API_HOST });
    app.log.info(`InfluenceOS API listening on http://${env.API_HOST}:${env.API_PORT}`);
    app.log.info(`API docs at http://localhost:${env.API_PORT}/api/docs`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
