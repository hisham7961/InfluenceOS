/**
 * Re-seal stored secrets (provider API keys, creators' OAuth tokens) under
 * the current encryption key. Run once after adding ENCRYPTION_KEY:
 *
 *   pnpm --filter @influenceos/api run reseal
 *   # in Docker:
 *   docker compose exec api pnpm --filter @influenceos/api exec tsx src/scripts/reseal.ts
 *
 * Keep AUTH_SECRET unchanged while running it — values sealed under the old
 * key are read with it. Safe to run more than once.
 */
import { prisma } from '@influenceos/database';
import { resealStoredSecrets } from '@influenceos/domain';

async function main() {
  if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length < 32) {
    console.error('ENCRYPTION_KEY is not set (at least 32 characters). Nothing to do.');
    process.exit(1);
  }
  const r = await resealStoredSecrets(prisma);
  console.log(`Checked ${r.checked} stored secret(s): ${r.resealed} re-sealed, ${r.unreadable} unreadable.`);
  if (r.unreadable > 0) {
    console.error('Some values could not be opened with ENCRYPTION_KEY or AUTH_SECRET — re-enter those keys in Admin → Integrations.');
    process.exitCode = 2;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
