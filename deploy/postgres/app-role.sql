-- InfluenceOS — a least-privilege database role for the running app (P2.4).
--
-- With the compose files you don't need this: set APP_DB_USER and
-- APP_DB_PASSWORD in .env and the `migrate` one-shot makes the login
-- (packages/database/prisma/app-role.ts). This file is for a database run
-- outside compose.
--
-- The app (API + worker) only needs to read and write rows. Migrations need to
-- change the schema, so they keep using the owner account. Run this once as
-- the owner (postgres), then:
--   DATABASE_URL        → influenceos_app   (the app's everyday connection)
--   DIRECT_DATABASE_URL → postgres (owner)  (prisma migrate deploy uses it)
--
--   psql "$DIRECT_DATABASE_URL" -v app_password="'<a long random password>'" \
--        -f deploy/postgres/app-role.sql
--
-- Safe to run again (it only adds what is missing). Nothing here changes data.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'influenceos_app') THEN
    CREATE ROLE influenceos_app LOGIN;
  END IF;
END
$$;

ALTER ROLE influenceos_app WITH LOGIN PASSWORD :app_password
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;

GRANT CONNECT ON DATABASE influenceos TO influenceos_app;
GRANT USAGE ON SCHEMA public TO influenceos_app;

-- Rows only: no DDL, no TRUNCATE, no ownership.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO influenceos_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO influenceos_app;

-- Tables and sequences that future migrations create (as postgres) get the
-- same rights automatically.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO influenceos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO influenceos_app;

-- The migrations table stays read-only for the app.
REVOKE INSERT, UPDATE, DELETE ON TABLE "_prisma_migrations" FROM influenceos_app;
