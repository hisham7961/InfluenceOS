import { hash } from '@node-rs/argon2';
import { prisma } from '@influenceos/database';
import { buildApp } from '../src/app.ts';

async function main() {
  // Ensure a known admin exists for the login test.
  const email = 'smoke-admin@influenceos.local';
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: 'Smoke Admin', role: 'ADMIN', passwordHash: await hash('Passw0rd!') },
  });

  const app = await buildApp();

  const health = await app.inject({ method: 'GET', url: '/health' });
  console.log('health', health.statusCode, health.json());

  const openapi = await app.inject({ method: 'GET', url: '/api/openapi.json' });
  const spec = openapi.json() as { paths?: Record<string, unknown> };
  console.log('openapi paths', Object.keys(spec.paths ?? {}).length);

  const unauth = await app.inject({ method: 'GET', url: '/api/v1/influencers' });
  console.log('influencers unauth', unauth.statusCode, unauth.json());

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: 'Passw0rd!' },
  });
  console.log('login', login.statusCode);
  const auth = login.json() as { tokens?: { accessToken?: string }; user?: { role?: string } };
  const token = auth.tokens?.accessToken;
  console.log('login user role', auth.user?.role, 'has token', !!token);

  const me = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/me',
    headers: { authorization: `Bearer ${token}` },
  });
  console.log('me', me.statusCode, me.json());

  const clientConfig = await app.inject({ method: 'GET', url: '/api/v1/client-config' });
  console.log('client-config (public)', clientConfig.statusCode);

  const features = await app.inject({
    method: 'GET',
    url: '/api/v1/platform/features',
    headers: { authorization: `Bearer ${token}` },
  });
  const feats = features.json() as unknown[];
  console.log('platform features', features.statusCode, Array.isArray(feats) ? feats.length : 'n/a');

  const badLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: 'wrong' },
  });
  console.log('bad login', badLogin.statusCode, badLogin.json());

  await app.close();
  await prisma.$disconnect();
  console.log('SMOKE OK');
}

main().catch((e) => {
  console.error('SMOKE FAILED', e);
  process.exit(1);
});
