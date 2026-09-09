/* eslint-disable no-console */
import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Production-safe first-admin bootstrap (finding #6).
 *
 * Unlike the demo seed, this is NON-destructive and idempotent: it creates a
 * single ADMIN user if — and only if — the database has no users yet, so it is
 * safe to run on every deploy. There is NO hardcoded password:
 *
 *   - BOOTSTRAP_ADMIN_EMAIL    (required)
 *   - BOOTSTRAP_ADMIN_PASSWORD (optional; a strong one is generated & printed
 *                               ONCE if omitted, to be rotated on first login)
 *   - BOOTSTRAP_ADMIN_NAME     (optional; defaults to "Administrator")
 *
 * If any users already exist it does nothing, so it can't be used to inject an
 * admin into an established system.
 */
async function main(): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) {
    throw new Error('BOOTSTRAP_ADMIN_EMAIL is required to bootstrap the first admin.');
  }

  const userCount = await prisma.user.count();
  if (userCount > 0) {
    console.log(`Bootstrap skipped — ${userCount} user(s) already exist. No changes made.`);
    return;
  }

  const provided = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const isProd = process.env.NODE_ENV === 'production';

  // In production we NEVER generate-and-log a password (deployment logs are not
  // a secret channel): the operator must supply BOOTSTRAP_ADMIN_PASSWORD from a
  // real secret source. Only outside production do we fall back to a generated
  // one printed once, for local convenience.
  if (isProd && !provided) {
    throw new Error(
      'BOOTSTRAP_ADMIN_PASSWORD is required in production — supply it from a secret store. ' +
        'A password is never generated and printed to deployment logs.',
    );
  }

  const generated = provided ? null : randomBytes(18).toString('base64url');
  const password = provided ?? generated!;
  if (password.length < 10) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 10 characters.');
  }

  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Administrator';
  await prisma.user.create({
    data: { email, name, role: 'ADMIN', passwordHash: await hash(password) },
  });

  console.log(`✅ Created first admin: ${email}`);
  if (generated) {
    // Non-production only. Rotate it via POST /api/v1/auth/change-password.
    console.log('──────────────────────────────────────────────────────────────');
    console.log(`  Generated temporary password (dev only, shown once): ${generated}`);
    console.log('  Sign in and change it immediately (Settings → Security).');
    console.log('──────────────────────────────────────────────────────────────');
  } else {
    console.log('  Using the supplied BOOTSTRAP_ADMIN_PASSWORD. Rotate it on first sign-in.');
  }
}

main()
  .catch((err) => {
    console.error('Bootstrap failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
