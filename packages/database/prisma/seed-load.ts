/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import {
  LOAD_SEED_MARKER,
  buildLoadCampaignNames,
  buildLoadInfluencers,
  slugify,
} from '@influenceos/shared';

/**
 * W7-3 — scale / load seed. Inserts a large, deterministic, clearly-marked data
 * set (default 10,000 influencers + proportional campaigns) so directory
 * queries, cursor pagination and the W7-2 indexes can be exercised at scale
 * (see docs/LOAD_AND_CHAOS.md).
 *
 * Safety:
 *   - Refuses to run when NODE_ENV=production.
 *   - Opt-in only: requires SEED_LOAD=true.
 *   - ADDITIVE — never wipes. Every row is tagged (internalNotes = "load-seed",
 *     brand/campaign names prefixed "Load "), so the data is idempotent to
 *     re-runs and removable with `pnpm --filter @influenceos/database exec tsx
 *     prisma/seed-load.ts --clean` without touching real records.
 *
 * Env: LOAD_ROWS (influencer count, default 10000), LOAD_CAMPAIGNS (default
 * 2000), LOAD_BATCH (insert batch size, default 1000).
 */

const prisma = new PrismaClient();

const ROWS = Number(process.env.LOAD_ROWS ?? 10_000);
const CAMPAIGNS = Number(process.env.LOAD_CAMPAIGNS ?? 2_000);
const BATCH = Number(process.env.LOAD_BATCH ?? 1_000);
const LOAD_BRAND_SLUG = 'load-seed-brand';

async function clean(): Promise<void> {
  console.log('Removing load-seed data…');
  const brand = await prisma.brand.findUnique({ where: { slug: LOAD_BRAND_SLUG } });
  if (brand) {
    const del = await prisma.campaign.deleteMany({ where: { brandId: brand.id } });
    console.log(`  deleted ${del.count} load campaigns`);
    await prisma.brand.delete({ where: { id: brand.id } }).catch(() => undefined);
  }
  const inf = await prisma.influencer.deleteMany({ where: { internalNotes: LOAD_SEED_MARKER } });
  console.log(`  deleted ${inf.count} load influencers`);
}

async function seed(): Promise<void> {
  const started = Date.now();

  const existing = await prisma.influencer.count({ where: { internalNotes: LOAD_SEED_MARKER } });
  if (existing >= ROWS) {
    console.log(`Load seed already present (${existing} >= ${ROWS} influencers). Nothing to do.`);
    return;
  }

  // Influencers — batched createMany (skipDuplicates keeps re-runs idempotent).
  console.log(`Seeding ${ROWS} influencers in batches of ${BATCH}…`);
  for (let start = existing; start < ROWS; start += BATCH) {
    const count = Math.min(BATCH, ROWS - start);
    await prisma.influencer.createMany({ data: buildLoadInfluencers(count, start), skipDuplicates: true });
    if ((start / BATCH) % 5 === 0) console.log(`  …${start + count}/${ROWS}`);
  }

  // A single brand to hang the campaigns off.
  const brand = await prisma.brand.upsert({
    where: { slug: LOAD_BRAND_SLUG },
    update: {},
    create: { name: 'Load Seed Brand', slug: LOAD_BRAND_SLUG },
  });

  const haveCampaigns = await prisma.campaign.count({ where: { brandId: brand.id } });
  console.log(`Seeding ${CAMPAIGNS} campaigns…`);
  for (let start = haveCampaigns; start < CAMPAIGNS; start += BATCH) {
    const names = buildLoadCampaignNames(Math.min(BATCH, CAMPAIGNS - start), start);
    await prisma.campaign.createMany({
      data: names.map((name) => ({ brandId: brand.id, name, slug: slugify(`${name}-${LOAD_BRAND_SLUG}`) })),
      skipDuplicates: true,
    });
  }

  const [infTotal, campTotal] = await Promise.all([
    prisma.influencer.count({ where: { internalNotes: LOAD_SEED_MARKER } }),
    prisma.campaign.count({ where: { brandId: brand.id } }),
  ]);
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s — ${infTotal} influencers, ${campTotal} campaigns tagged for load.`);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the load seed with NODE_ENV=production.');
  }
  if (process.argv.includes('--clean')) {
    await clean();
    return;
  }
  if (process.env.SEED_LOAD !== 'true') {
    throw new Error('The load seed is opt-in. Re-run with SEED_LOAD=true to insert ~10k rows (additive, tagged).');
  }
  await seed();
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
