/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';

/**
 * A least-privilege database login for the running app (API + worker),
 * made automatically when the server's .env asks for one:
 *
 *   APP_DB_USER=influenceos_app
 *   APP_DB_PASSWORD=<a long random password>
 *
 * Runs in the `migrate` one-shot after `prisma migrate deploy`, connected as
 * the database owner (DIRECT_DATABASE_URL). It creates the login if it's
 * missing, sets its password, and lets it read and write rows — no schema
 * changes, no TRUNCATE, no ownership, and the migrations table read-only.
 * Tables later migrations add get the same rights. The compose files then
 * give the app DATABASE_URL with this login; migrations keep using the owner.
 *
 * Without APP_DB_PASSWORD it does nothing (the app keeps the owner login).
 * Safe to run on every deploy. Same rules as deploy/postgres/app-role.sql.
 */
async function main(): Promise<void> {
  const password = process.env.APP_DB_PASSWORD?.trim();
  const user = process.env.APP_DB_USER?.trim();
  if (!password) {
    if (user)
      throw new Error(
        'APP_DB_USER is set but APP_DB_PASSWORD is not. Set both in .env, or neither.',
      );
    console.log(
      'App database login: not set up (no APP_DB_PASSWORD) — the app uses the owner login.',
    );
    return;
  }
  if (!user) {
    throw new Error(
      'APP_DB_PASSWORD is set but APP_DB_USER is not. Set both in .env (e.g. APP_DB_USER=influenceos_app).',
    );
  }
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(user) || user === 'postgres') {
    throw new Error('APP_DB_USER must be a lower-case name like influenceos_app (not postgres).');
  }
  if (password.length < 16 || !/^[A-Za-z0-9._~-]+$/.test(password)) {
    // It goes into the app's DATABASE_URL as is, so only URL-safe characters.
    throw new Error(
      'APP_DB_PASSWORD must be at least 16 characters of letters, digits, . _ ~ or - (try: openssl rand -hex 24).',
    );
  }

  const ownerUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasourceUrl: ownerUrl });
  try {
    const [row] = await prisma.$queryRaw<{ owner: string }[]>`SELECT current_user AS owner`;
    const owner = row?.owner ?? '';
    if (owner === user) {
      throw new Error(
        'Migrations must run as the database owner, not as APP_DB_USER (check DIRECT_DATABASE_URL).',
      );
    }
    // Identifiers and the password are quoted by Postgres itself (format %I / %L).
    const statements = await prisma.$queryRaw<{ sql: string }[]>`
      SELECT unnest(ARRAY[
        CASE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${user})
             THEN format('CREATE ROLE %I LOGIN', ${user}) END,
        format('ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', ${user}, ${password}),
        format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), ${user}),
        format('GRANT USAGE ON SCHEMA public TO %I', ${user}),
        format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', ${user}),
        format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO %I', ${user}),
        format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO %I', ${user}),
        format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', current_user, ${user}),
        format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I', current_user, ${user}),
        format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO %I', current_user, ${user}),
        format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE %I FROM %I', '_prisma_migrations', ${user})
      ]) AS sql`;
    for (const { sql } of statements) {
      if (sql) await prisma.$executeRawUnsafe(sql);
    }
    console.log(
      `App database login "${user}" is ready (rows only; migrations stay with "${owner}").`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`App database login: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
