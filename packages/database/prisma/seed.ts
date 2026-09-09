/* eslint-disable no-console */
import { hash } from '@node-rs/argon2';
import { PrismaClient, type Platform } from '@prisma/client';

const prisma = new PrismaClient();

/** Human-readable "user@host/db" for the configured database (no credentials). */
function describeDatabase(): string {
  try {
    const u = new URL(process.env.DATABASE_URL ?? '');
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

/**
 * The demo seed is DESTRUCTIVE — it wipes every table. Guard it hard so it can
 * never run against a production database or clobber real data by accident
 * (finding #6):
 *   - Refuse outright when NODE_ENV=production.
 *   - Require an explicit opt-in (SEED_DEMO=true) so it can't run implicitly.
 *   - Refuse to wipe a database that already holds data unless the operator
 *     confirms with CONFIRM_WIPE=true, echoing which database is targeted.
 */
async function guardDestructiveSeed(): Promise<void> {
  const target = describeDatabase();
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `Refusing to run the destructive demo seed with NODE_ENV=production (target: ${target}). ` +
        `Use the safe bootstrap instead: pnpm --filter @influenceos/database bootstrap`,
    );
  }
  if (process.env.SEED_DEMO !== 'true') {
    throw new Error(
      `The demo seed wipes ALL data in ${target}. This is opt-in: re-run with SEED_DEMO=true to confirm. ` +
        `For a production-safe first admin use: pnpm --filter @influenceos/database bootstrap`,
    );
  }
  const existingUsers = await prisma.user.count().catch(() => 0);
  if (existingUsers > 0 && process.env.CONFIRM_WIPE !== 'true') {
    throw new Error(
      `Database ${target} already contains ${existingUsers} user(s). Refusing to wipe it. ` +
        `Re-run with CONFIRM_WIPE=true if you really intend to erase and reseed this database.`,
    );
  }
  console.warn(`⚠️  Demo seed will ERASE and repopulate ${target}.`);
}

/** Demo login password — dev-only. The demo seed cannot run in production, so
 *  this is never a production credential. Override with DEMO_PASSWORD. */
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Password123!';

const now = new Date();
function daysAgo(n: number): Date {
  return new Date(now.getTime() - n * 864e5);
}
function daysFromNow(n: number): Date {
  return new Date(now.getTime() + n * 864e5);
}
function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length]!;
}

async function wipe() {
  // Delete in FK-safe order.
  await prisma.notificationDelivery.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.contentMonitoringEvent.deleteMany();
  await prisma.contentMetricSnapshot.deleteMany();
  await prisma.publishedContent.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.campaignExpense.deleteMany();
  await prisma.scriptReferenceVersion.deleteMany();
  await prisma.deliverable.deleteMany();
  await prisma.scriptReference.deleteMany();
  await prisma.campaignInfluencer.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.socialMetricSnapshot.deleteMany();
  await prisma.socialAccount.deleteMany();
  await prisma.influencerTag.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.brandInfluencer.deleteMany();
  await prisma.note.deleteMany();
  await prisma.influencer.deleteMany();
  await prisma.brand.deleteMany();
  await prisma.deviceSession.deleteMany();
  await prisma.user.deleteMany();
  await prisma.integrationSetting.deleteMany();
  await prisma.featureFlag.deleteMany();
  await prisma.appVersion.deleteMany();
  await prisma.clientConfig.deleteMany();
}

async function main() {
  await guardDestructiveSeed();
  console.log('Seeding InfluenceOS demo data…');
  await wipe();

  const passwordHash = await hash(DEMO_PASSWORD);
  const admin = await prisma.user.create({
    data: { email: 'admin@influenceos.app', name: 'Layla Al-Rashid', role: 'ADMIN', passwordHash },
  });
  const sarah = await prisma.user.create({
    data: { email: 'sarah@influenceos.app', name: 'Sarah Kanaan', role: 'STAFF', passwordHash },
  });
  const ahmed = await prisma.user.create({
    data: { email: 'ahmed@influenceos.app', name: 'Ahmed Darwish', role: 'STAFF', passwordHash },
  });
  const staff = [sarah, ahmed, admin];

  // --- Brands --------------------------------------------------------------
  const brandData = [
    { name: 'Lumière Beauty', slug: 'lumiere', description: 'Premium skincare & cosmetics for the modern Gulf consumer.', primaryColor: '#E11D74', accentColor: '#F59E0B' },
    { name: 'Peak Athletics', slug: 'peak', description: 'Performance sportswear and active lifestyle gear.', primaryColor: '#0EA5E9', accentColor: '#22C55E' },
    { name: 'Cedar & Sage', slug: 'cedar-sage', description: 'Considered home, fragrance and lifestyle objects.', primaryColor: '#10B981', accentColor: '#84CC16' },
    { name: 'Volt Mobile', slug: 'volt', description: 'Next-generation mobile network and devices.', primaryColor: '#7C3AED', accentColor: '#F43F5E' },
  ];
  const brands = [];
  for (const b of brandData) {
    brands.push(await prisma.brand.create({ data: b }));
  }
  const [lumiere, peak, cedar, volt] = brands;

  // --- Tags ----------------------------------------------------------------
  const tagNames = ['Beauty', 'Fashion', 'Fitness', 'Tech', 'Lifestyle', 'Food', 'Travel', 'Gaming', 'Family', 'Luxury', 'UGC', 'Reviewer'];
  const tags = new Map<string, string>();
  for (const name of tagNames) {
    const t = await prisma.tag.create({ data: { name } });
    tags.set(name, t.id);
  }

  // --- Influencers ---------------------------------------------------------
  interface Acct { platform: Platform; username: string; followers: number; verified?: boolean }
  interface InfSpec {
    displayName: string; fullName: string; category: string; country: string; city: string;
    primaryPlatform: Platform; accounts: Acct[]; tags: string[]; relationship: string; priority: string;
    health: 'HEALTHY' | 'REVIEW' | 'LIMITED_DATA'; languages: string[];
  }
  const infSpecs: InfSpec[] = [
    { displayName: 'Nour Haddad', fullName: 'Nour Haddad', category: 'Beauty', country: 'Kuwait', city: 'Kuwait City', primaryPlatform: 'INSTAGRAM', accounts: [{ platform: 'INSTAGRAM', username: 'nourhaddad', followers: 412000, verified: true }, { platform: 'TIKTOK', username: 'nourhaddad', followers: 890000 }], tags: ['Beauty', 'Lifestyle'], relationship: 'RECURRING', priority: 'HIGH', health: 'HEALTHY', languages: ['Arabic', 'English'] },
    { displayName: 'Yousef Karam', fullName: 'Yousef Karam', category: 'Fitness', country: 'UAE', city: 'Dubai', primaryPlatform: 'YOUTUBE', accounts: [{ platform: 'YOUTUBE', username: 'yousefkaramfit', followers: 233000, verified: true }, { platform: 'INSTAGRAM', username: 'yousef.karam', followers: 176000 }], tags: ['Fitness', 'Lifestyle'], relationship: 'ACTIVE', priority: 'HIGH', health: 'HEALTHY', languages: ['Arabic', 'English'] },
    { displayName: 'Maya Fernandes', fullName: 'Maya Fernandes', category: 'Fashion', country: 'UAE', city: 'Abu Dhabi', primaryPlatform: 'INSTAGRAM', accounts: [{ platform: 'INSTAGRAM', username: 'maya.styles', followers: 640000, verified: true }], tags: ['Fashion', 'Luxury'], relationship: 'ACTIVE', priority: 'MEDIUM', health: 'REVIEW', languages: ['English'] },
    { displayName: 'Faisal Otaibi', fullName: 'Faisal Al-Otaibi', category: 'Tech', country: 'Saudi Arabia', city: 'Riyadh', primaryPlatform: 'YOUTUBE', accounts: [{ platform: 'YOUTUBE', username: 'faisaltech', followers: 1250000, verified: true }, { platform: 'X', username: 'faisaltech', followers: 320000, verified: true }], tags: ['Tech', 'Reviewer'], relationship: 'RECURRING', priority: 'HIGH', health: 'HEALTHY', languages: ['Arabic'] },
    { displayName: 'Reem Sabbagh', fullName: 'Reem Sabbagh', category: 'Food', country: 'Kuwait', city: 'Hawalli', primaryPlatform: 'TIKTOK', accounts: [{ platform: 'TIKTOK', username: 'reemeats', followers: 1520000 }, { platform: 'INSTAGRAM', username: 'reemeats', followers: 430000 }], tags: ['Food', 'Lifestyle'], relationship: 'ACTIVE', priority: 'MEDIUM', health: 'HEALTHY', languages: ['Arabic', 'English'] },
    { displayName: 'Omar Zayed', fullName: 'Omar Zayed', category: 'Gaming', country: 'Qatar', city: 'Doha', primaryPlatform: 'YOUTUBE', accounts: [{ platform: 'YOUTUBE', username: 'omarplays', followers: 780000 }, { platform: 'TIKTOK', username: 'omarplays', followers: 610000 }], tags: ['Gaming', 'Tech'], relationship: 'CONTACTED', priority: 'LOW', health: 'HEALTHY', languages: ['Arabic', 'English'] },
    { displayName: 'Lina Mansour', fullName: 'Lina Mansour', category: 'Beauty', country: 'Lebanon', city: 'Beirut', primaryPlatform: 'INSTAGRAM', accounts: [{ platform: 'INSTAGRAM', username: 'linabeauty', followers: 295000, verified: true }], tags: ['Beauty', 'UGC'], relationship: 'ACTIVE', priority: 'MEDIUM', health: 'LIMITED_DATA', languages: ['Arabic', 'French'] },
    { displayName: 'Tariq Nassar', fullName: 'Tariq Nassar', category: 'Travel', country: 'UAE', city: 'Dubai', primaryPlatform: 'INSTAGRAM', accounts: [{ platform: 'INSTAGRAM', username: 'tariqtravels', followers: 510000 }, { platform: 'YOUTUBE', username: 'tariqtravels', followers: 210000 }], tags: ['Travel', 'Lifestyle'], relationship: 'PROSPECT', priority: 'LOW', health: 'HEALTHY', languages: ['English'] },
    { displayName: 'Hala Ibrahim', fullName: 'Hala Ibrahim', category: 'Family', country: 'Kuwait', city: 'Salmiya', primaryPlatform: 'INSTAGRAM', accounts: [{ platform: 'INSTAGRAM', username: 'halafamily', followers: 188000 }, { platform: 'SNAPCHAT', username: 'halafamily', followers: 240000 }], tags: ['Family', 'Lifestyle'], relationship: 'ACTIVE', priority: 'MEDIUM', health: 'REVIEW', languages: ['Arabic'] },
    { displayName: 'Sami Khalil', fullName: 'Sami Khalil', category: 'Fitness', country: 'Bahrain', city: 'Manama', primaryPlatform: 'TIKTOK', accounts: [{ platform: 'TIKTOK', username: 'samikhalilfit', followers: 940000 }], tags: ['Fitness'], relationship: 'CONTACTED', priority: 'MEDIUM', health: 'HEALTHY', languages: ['Arabic', 'English'] },
    { displayName: 'Dana Aziz', fullName: 'Dana Aziz', category: 'Fashion', country: 'Kuwait', city: 'Kuwait City', primaryPlatform: 'INSTAGRAM', accounts: [{ platform: 'INSTAGRAM', username: 'danaaziz', followers: 720000, verified: true }, { platform: 'TIKTOK', username: 'danaaziz', followers: 1100000 }], tags: ['Fashion', 'Luxury'], relationship: 'RECURRING', priority: 'HIGH', health: 'HEALTHY', languages: ['Arabic', 'English'] },
    { displayName: 'Khalid Rahman', fullName: 'Khalid Rahman', category: 'Tech', country: 'UAE', city: 'Sharjah', primaryPlatform: 'X', accounts: [{ platform: 'X', username: 'khalidr', followers: 145000 }, { platform: 'YOUTUBE', username: 'khalidrtech', followers: 98000 }], tags: ['Tech', 'Reviewer'], relationship: 'ACTIVE', priority: 'LOW', health: 'HEALTHY', languages: ['English'] },
    { displayName: 'Aisha Noor', fullName: 'Aisha Noor', category: 'Beauty', country: 'Saudi Arabia', city: 'Jeddah', primaryPlatform: 'INSTAGRAM', accounts: [{ platform: 'INSTAGRAM', username: 'aishanoor', followers: 355000 }], tags: ['Beauty', 'UGC'], relationship: 'ACTIVE', priority: 'MEDIUM', health: 'HEALTHY', languages: ['Arabic'] },
    { displayName: 'Rami Habib', fullName: 'Rami Habib', category: 'Food', country: 'Jordan', city: 'Amman', primaryPlatform: 'TIKTOK', accounts: [{ platform: 'TIKTOK', username: 'ramicooks', followers: 480000 }], tags: ['Food'], relationship: 'PROSPECT', priority: 'LOW', health: 'LIMITED_DATA', languages: ['Arabic'] },
    { displayName: 'Salma Adel', fullName: 'Salma Adel', category: 'Lifestyle', country: 'Egypt', city: 'Cairo', primaryPlatform: 'INSTAGRAM', accounts: [{ platform: 'INSTAGRAM', username: 'salmaadel', followers: 610000, verified: true }, { platform: 'YOUTUBE', username: 'salmaadel', followers: 190000 }], tags: ['Lifestyle', 'Family'], relationship: 'ACTIVE', priority: 'MEDIUM', health: 'HEALTHY', languages: ['Arabic', 'English'] },
    { displayName: 'Nasser Ali', fullName: 'Nasser Ali', category: 'Gaming', country: 'Kuwait', city: 'Jahra', primaryPlatform: 'YOUTUBE', accounts: [{ platform: 'YOUTUBE', username: 'nasserplays', followers: 320000 }, { platform: 'TIKTOK', username: 'nasserplays', followers: 250000 }], tags: ['Gaming'], relationship: 'CONTACTED', priority: 'LOW', health: 'HEALTHY', languages: ['Arabic'] },
    { displayName: 'Farah Wehbe', fullName: 'Farah Wehbe', category: 'Fashion', country: 'Lebanon', city: 'Beirut', primaryPlatform: 'INSTAGRAM', accounts: [{ platform: 'INSTAGRAM', username: 'farahwehbe', followers: 830000, verified: true }], tags: ['Fashion', 'Luxury'], relationship: 'ACTIVE', priority: 'HIGH', health: 'HEALTHY', languages: ['Arabic', 'French', 'English'] },
    { displayName: 'Zaid Amiri', fullName: 'Zaid Amiri', category: 'Travel', country: 'UAE', city: 'Dubai', primaryPlatform: 'INSTAGRAM', accounts: [{ platform: 'INSTAGRAM', username: 'zaidwanders', followers: 275000 }], tags: ['Travel'], relationship: 'PROSPECT', priority: 'LOW', health: 'LIMITED_DATA', languages: ['English'] },
    { displayName: 'Mariam Saleh', fullName: 'Mariam Saleh', category: 'Beauty', country: 'Kuwait', city: 'Kuwait City', primaryPlatform: 'TIKTOK', accounts: [{ platform: 'TIKTOK', username: 'mariamglow', followers: 1350000 }, { platform: 'INSTAGRAM', username: 'mariamglow', followers: 520000, verified: true }], tags: ['Beauty', 'UGC'], relationship: 'RECURRING', priority: 'HIGH', health: 'REVIEW', languages: ['Arabic', 'English'] },
    { displayName: 'Bilal Hassan', fullName: 'Bilal Hassan', category: 'Tech', country: 'Qatar', city: 'Doha', primaryPlatform: 'YOUTUBE', accounts: [{ platform: 'YOUTUBE', username: 'bilaltech', followers: 445000 }, { platform: 'X', username: 'bilaltech', followers: 120000 }], tags: ['Tech', 'Reviewer'], relationship: 'ACTIVE', priority: 'MEDIUM', health: 'HEALTHY', languages: ['Arabic', 'English'] },
  ];

  const influencers = [];
  for (let i = 0; i < infSpecs.length; i++) {
    const spec = infSpecs[i]!;
    const inf = await prisma.influencer.create({
      data: {
        displayName: spec.displayName,
        fullName: spec.fullName,
        primaryUsername: spec.accounts[0]!.username,
        primaryPlatform: spec.primaryPlatform,
        category: spec.category,
        country: spec.country,
        city: spec.city,
        languages: spec.languages,
        relationshipStatus: spec.relationship as never,
        priority: spec.priority as never,
        audienceHealth: spec.health,
        preferredContact: pick(['WHATSAPP', 'EMAIL', 'INSTAGRAM_DM'], i) as never,
        email: `${spec.accounts[0]!.username}@creators.example`,
        whatsapp: `+9655${(1000000 + i * 13337).toString().slice(0, 7)}`,
        bio: `${spec.category} creator based in ${spec.city}. ${spec.languages.join(' / ')}.`,
        internalNotes: i % 4 === 0 ? 'Great to work with. Fast turnaround, strong engagement.' : null,
        pricingNotes: spec.priority === 'HIGH' ? 'Premium tier — negotiate package deals.' : null,
      },
    });
    influencers.push(inf);

    // Tags
    for (const tName of spec.tags) {
      const tagId = tags.get(tName);
      if (tagId) await prisma.influencerTag.create({ data: { influencerId: inf.id, tagId } });
    }

    // Social accounts + follower history
    for (let a = 0; a < spec.accounts.length; a++) {
      const acc = spec.accounts[a]!;
      const account = await prisma.socialAccount.create({
        data: {
          influencerId: inf.id,
          platform: acc.platform,
          username: acc.username,
          profileUrl:
            acc.platform === 'TIKTOK'
              ? `https://www.tiktok.com/@${acc.username}`
              : acc.platform === 'X'
                ? `https://x.com/${acc.username}`
                : acc.platform === 'YOUTUBE'
                  ? `https://www.youtube.com/@${acc.username}`
                  : `https://www.instagram.com/${acc.username}`,
          followers: acc.followers,
          following: Math.round(acc.followers * 0.002) + 120,
          postCount: 200 + i * 7 + a * 30,
          isVerified: acc.verified ?? false,
          isPrimary: a === 0,
          dataSource: acc.platform === 'YOUTUBE' || acc.platform === 'X' ? 'OFFICIAL_API' : 'MANUAL',
          lastSyncedAt: daysAgo(a),
        },
      });

      // Follower snapshots over 90 days.
      const points = 10;
      const start = Math.round(acc.followers * (spec.health === 'REVIEW' ? 0.7 : 0.85));
      for (let p = 0; p < points; p++) {
        const frac = p / (points - 1);
        let followers = Math.round(start + (acc.followers - start) * frac);
        // Inject an abnormal spike for REVIEW-labelled creators.
        if (spec.health === 'REVIEW' && p === points - 3) followers = Math.round(followers * 1.55);
        await prisma.socialMetricSnapshot.create({
          data: {
            socialAccountId: account.id,
            followers,
            following: Math.round(followers * 0.002) + 120,
            postCount: 200 + i * 7 + a * 30 - (points - p) * 2,
            engagementRate: 0.4 + ((i + a) % 5) * 0.35,
            capturedAt: daysAgo(90 - p * 10),
            source: account.dataSource,
          },
        });
      }
    }
  }

  console.log(`Created ${influencers.length} influencers.`);

  // --- Brand ↔ Influencer relationships -----------------------------------
  const brandAssign: [number, number[]][] = [
    [0, [0, 6, 12, 18, 2]], // Lumière → beauty/fashion
    [1, [1, 9, 4, 8]], // Peak → fitness/food/family
    [2, [7, 14, 17, 8, 4]], // Cedar & Sage → lifestyle/travel/food
    [3, [3, 11, 5, 15, 19]], // Volt → tech/gaming
  ];
  for (const [bIdx, infIdxs] of brandAssign) {
    for (const infIdx of infIdxs) {
      await prisma.brandInfluencer.create({
        data: {
          brandId: brands[bIdx]!.id,
          influencerId: influencers[infIdx]!.id,
          relationshipStatus: pick(['ACTIVE', 'RECURRING', 'CONTACTED'], infIdx) as never,
          priority: pick(['HIGH', 'MEDIUM', 'LOW'], infIdx) as never,
          defaultRate: 500 + (infIdx % 6) * 350,
          currency: 'KWD',
          totalCollaborations: (infIdx % 4) + 1,
          firstCollaborationAt: daysAgo(200 + infIdx),
          lastCampaignAt: daysAgo(infIdx * 3),
        },
      });
    }
  }

  await seedCampaigns(brands, influencers, staff, tags);
  await seedIntegrationsAndConfig();

  console.log('Seed complete.');
}

async function seedCampaigns(
  brands: { id: string; name: string; slug: string; currency?: string }[],
  influencers: { id: string; displayName: string }[],
  staff: { id: string; name: string }[],
  _tags: Map<string, string>,
) {
  const [lumiere, peak, cedar, volt] = brands;

  interface CampSpec {
    brandId: string; name: string; slug: string; status: string; objective: string;
    start: number; end: number; budget: number; participants: { idx: number; deal: string; cost?: number; gift?: number; pay?: string }[];
  }
  const camps: CampSpec[] = [
    { brandId: lumiere!.id, name: 'Summer Glow Launch', slug: 'summer-glow', status: 'ACTIVE', objective: 'LAUNCH', start: -20, end: 25, budget: 12000, participants: [{ idx: 0, deal: 'PAID', cost: 2500, pay: 'PAID' }, { idx: 6, deal: 'PAID', cost: 1200, pay: 'UNPAID' }, { idx: 18, deal: 'PAID_PLUS_GIFTED', cost: 1800, gift: 300, pay: 'PARTIALLY_PAID' }, { idx: 12, deal: 'GIFTED_PRODUCT', gift: 250 }] },
    { brandId: peak!.id, name: 'Move With Peak', slug: 'move-with-peak', status: 'ACTIVE', objective: 'ENGAGEMENT', start: -12, end: 18, budget: 9000, participants: [{ idx: 1, deal: 'PAID', cost: 2200, pay: 'PAID' }, { idx: 9, deal: 'FREE' }, { idx: 4, deal: 'PAID', cost: 1500, pay: 'UNPAID' }] },
    { brandId: volt!.id, name: 'Volt 5G Reveal', slug: 'volt-5g-reveal', status: 'PLANNING', objective: 'AWARENESS', start: 5, end: 45, budget: 20000, participants: [{ idx: 3, deal: 'PAID', cost: 5000 }, { idx: 11, deal: 'PAID', cost: 1500 }, { idx: 19, deal: 'PAID_PLUS_GIFTED', cost: 2000, gift: 800 }] },
    { brandId: cedar!.id, name: 'Autumn Home Stories', slug: 'autumn-home', status: 'COMPLETED', objective: 'UGC', start: -80, end: -20, budget: 7000, participants: [{ idx: 7, deal: 'PAID', cost: 1600, pay: 'PAID' }, { idx: 14, deal: 'GIFTED_PRODUCT', gift: 400 }, { idx: 8, deal: 'FREE' }] },
    { brandId: lumiere!.id, name: 'Winter Skincare Ritual', slug: 'winter-skincare', status: 'DRAFT', objective: 'CONVERSIONS', start: 20, end: 60, budget: 15000, participants: [{ idx: 2, deal: 'PAID', cost: 3000 }, { idx: 12, deal: 'PAID', cost: 900 }] },
    { brandId: peak!.id, name: 'Ramadan Active', slug: 'ramadan-active', status: 'PAUSED', objective: 'AWARENESS', start: -5, end: 30, budget: 6000, participants: [{ idx: 8, deal: 'FREE' }, { idx: 1, deal: 'PAID', cost: 1800, pay: 'UNPAID' }] },
  ];

  // Real, public, embeddable content (per platform) for the live wall + player.
  const contentPool: { platform: Platform; url: string; caption: string; status: string; hasMetrics: boolean }[] = [
    { platform: 'YOUTUBE', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', caption: 'Full glow routine ✨ #ad', status: 'LIVE', hasMetrics: true },
    { platform: 'YOUTUBE', url: 'https://www.youtube.com/watch?v=9bZkp7q19f0', caption: 'Training day with Peak 💪', status: 'LIVE', hasMetrics: true },
    { platform: 'X', url: 'https://x.com/jack/status/20', caption: 'So excited to share this collab', status: 'LIVE', hasMetrics: true },
    { platform: 'TIKTOK', url: 'https://www.tiktok.com/@tiktok/video/7106594312292453675', caption: 'Get ready with me ☀️', status: 'LIVE', hasMetrics: false },
    { platform: 'YOUTUBE', url: 'https://www.youtube.com/watch?v=ScMzIvxBSi4', caption: 'A calm morning at home', status: 'UNAVAILABLE', hasMetrics: true },
    { platform: 'INSTAGRAM', url: 'https://www.instagram.com/p/C2removed99/', caption: 'Loved this campaign', status: 'REMOVED', hasMetrics: false },
    { platform: 'YOUTUBE', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', caption: 'Unboxing the new device', status: 'LIVE', hasMetrics: true },
    { platform: 'INSTAGRAM', url: 'https://www.instagram.com/reel/C1uleWFxYQK/', caption: 'New drop is here 🔥', status: 'LIVE', hasMetrics: false },
    { platform: 'TIKTOK', url: 'https://www.tiktok.com/@tiktok/video/7300000000000000001', caption: 'Quick recipe 🍳', status: 'LIVE', hasMetrics: false },
  ];
  let contentCursor = 0;

  for (const c of camps) {
    const owner = pick(staff, camps.indexOf(c));
    const campaign = await prisma.campaign.create({
      data: {
        brandId: c.brandId,
        name: c.name,
        slug: c.slug,
        description: `${c.name} — a coordinated multi-influencer push.`,
        brief: 'Highlight the product hero shots, keep captions authentic, disclose #ad. Deliver within the campaign window.',
        objective: c.objective as never,
        status: c.status as never,
        startDate: daysFromNow(c.start),
        endDate: daysFromNow(c.end),
        currency: 'KWD',
        plannedBudget: c.budget,
        targetMarket: 'GCC',
        ownerId: owner.id,
      },
    });

    // Script reference for the campaign
    const script = await prisma.scriptReference.create({
      data: { campaignId: campaign.id, title: `${c.name} — Creator Brief`, currentVersion: 1 },
    });
    await prisma.scriptReferenceVersion.create({
      data: {
        scriptReferenceId: script.id,
        version: 1,
        body: `Key message: ${c.name}. Show the product in natural daily use. Keep it authentic.`,
        captionSuggestion: `Loving my new ${c.name.split(' ')[0]} pieces! #ad #gifted`,
        talkingPoints: ['Product hero moment', 'Personal story', 'Clear call to action'],
        dos: ['Disclose #ad', 'Tag the brand', 'Use the campaign hashtag'],
        donts: ['No competitor mentions', 'No unapproved claims'],
        hashtags: [`#${c.slug.replace(/-/g, '')}`, '#ad'],
        mentions: [`@${brands.find((b) => b.id === c.brandId)?.slug}`],
        createdById: owner.id,
      },
    });

    // Expenses (production/ads)
    await prisma.campaignExpense.create({
      data: { campaignId: campaign.id, type: 'PRODUCTION', label: 'Photoshoot & editing', amount: 800, currency: 'KWD', paymentStatus: 'PAID', createdById: owner.id, incurredAt: daysFromNow(c.start + 2) },
    });
    if (c.status === 'ACTIVE' || c.status === 'COMPLETED') {
      await prisma.campaignExpense.create({
        data: { campaignId: campaign.id, type: 'ADS', label: 'Boosted posts', amount: 600, currency: 'KWD', paymentStatus: 'UNPAID', createdById: owner.id, incurredAt: daysFromNow(c.start + 5) },
      });
    }

    for (let pi = 0; pi < c.participants.length; pi++) {
      const p = c.participants[pi]!;
      const inf = influencers[p.idx]!;
      const ci = await prisma.campaignInfluencer.create({
        data: {
          campaignId: campaign.id,
          influencerId: inf.id,
          dealType: p.deal as never,
          agreedCost: p.cost ?? null,
          giftedProductValue: p.gift ?? null,
          currency: 'KWD',
          paymentStatus: (p.pay ?? (p.deal === 'FREE' || p.deal === 'GIFTED_PRODUCT' ? 'NOT_APPLICABLE' : 'UNPAID')) as never,
          participationStatus: c.status === 'COMPLETED' ? 'COMPLETED' : pick(['CONFIRMED', 'IN_PROGRESS', 'INVITED'], pi) as never,
          dateContacted: daysFromNow(c.start - 5),
          expectedPublishAt: daysFromNow(c.start + 3 + pi * 2),
          notes: p.deal === 'FREE' ? 'Free collaboration — long-term relationship play.' : null,
        },
      });

      // Deliverables (1-2 each)
      const delCount = 1 + (pi % 2);
      for (let d = 0; d < delCount; d++) {
        const isPublished = (c.status === 'ACTIVE' || c.status === 'COMPLETED') && d === 0 && pi < 2;
        const overdue = c.status === 'ACTIVE' && d === 1 && pi === 0;
        const del = await prisma.deliverable.create({
          data: {
            campaignInfluencerId: ci.id,
            platform: pick<Platform>(['INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'X'], pi + d),
            type: pick(['REEL', 'STORY', 'VIDEO', 'POST', 'SHORT'], pi + d) as never,
            quantity: 1 + (d % 2),
            dueDate: overdue ? daysAgo(3) : daysFromNow(c.start + 5 + d * 3),
            requirements: 'Follow the brief. Submit for internal record after publishing.',
            requiredHashtags: [`#${c.slug.replace(/-/g, '')}`, '#ad'],
            requiredMentions: [`@${brands.find((b) => b.id === c.brandId)?.slug}`],
            scriptReferenceId: script.id,
            status: isPublished ? 'PUBLISHED' : overdue ? 'AWAITING_PUBLICATION' : pick(['PLANNED', 'SENT_TO_INFLUENCER', 'AWAITING_PUBLICATION'], pi + d) as never,
          },
        });

        // Published content for published deliverables
        if (isPublished && contentCursor < contentPool.length) {
          const cp = contentPool[contentCursor++]!;
          const brand = brands.find((b) => b.id === c.brandId)!;
          const pc = await prisma.publishedContent.create({
            data: {
              platform: cp.platform,
              originalUrl: cp.url,
              caption: cp.caption,
              publishedAt: daysAgo(2 + pi),
              detectedAt: daysAgo(2 + pi),
              brandId: brand.id,
              campaignId: campaign.id,
              influencerId: inf.id,
              campaignInfluencerId: ci.id,
              deliverableId: del.id,
              availabilityStatus: cp.status as never,
              lastCheckedAt: daysAgo(0),
              lastMetricsSyncAt: cp.hasMetrics ? daysAgo(0) : null,
              dataSource: cp.hasMetrics ? 'OFFICIAL_API' : 'MANUAL',
              nextCheckAt: daysFromNow(0),
            },
          });
          await prisma.deliverable.update({ where: { id: del.id }, data: { publishedUrl: cp.url, publishedAt: daysAgo(2 + pi) } });

          // Metric snapshots
          if (cp.hasMetrics) {
            for (let s = 0; s < 3; s++) {
              const views = 40000 + pi * 12000 + s * 8000;
              await prisma.contentMetricSnapshot.create({
                data: {
                  publishedContentId: pc.id,
                  views,
                  likes: Math.round(views * 0.06),
                  comments: Math.round(views * 0.004),
                  shares: cp.platform === 'X' ? Math.round(views * 0.002) : null,
                  engagementRate: 6 + s * 0.2,
                  capturedAt: daysAgo(2 - s),
                  source: 'OFFICIAL_API',
                },
              });
            }
          }

          // Monitoring events
          await prisma.contentMonitoringEvent.create({
            data: { publishedContentId: pc.id, type: 'CHECK_OK', toStatus: 'LIVE', success: true, checkedAt: daysAgo(1) },
          });
          if (cp.status === 'REMOVED' || cp.status === 'UNAVAILABLE') {
            await prisma.contentMonitoringEvent.create({
              data: { publishedContentId: pc.id, type: 'STATUS_CHANGED', fromStatus: 'LIVE', toStatus: cp.status as never, success: true, message: 'Detected during scheduled check', checkedAt: daysAgo(0) },
            });
            await prisma.notification.create({
              data: {
                category: cp.status === 'REMOVED' ? 'CONTENT_REMOVED' : 'CONTENT_UNAVAILABLE',
                title: `Content ${cp.status.toLowerCase()}`,
                body: `A ${cp.platform} post by ${inf.displayName} is now ${cp.status.toLowerCase()}.`,
                targetUrl: `/content/${pc.id}`,
                brandId: brand.id,
                campaignId: campaign.id,
                publishedContentId: pc.id,
                deliveries: { create: { channel: 'IN_APP', status: 'SENT', deliveredAt: daysAgo(0) } },
              },
            });
          }

          await prisma.activityLog.create({
            data: {
              type: 'CONTENT_PUBLISHED',
              message: `${owner.name} added a published ${cp.platform} post by ${inf.displayName} to ${c.name}.`,
              actorId: owner.id,
              brandId: brand.id,
              campaignId: campaign.id,
              influencerId: inf.id,
              publishedContentId: pc.id,
              createdAt: daysAgo(2 + pi),
            },
          });
        }
      }

      await prisma.activityLog.create({
        data: {
          type: 'INFLUENCER_ADDED_TO_CAMPAIGN',
          message: `${owner.name} added ${inf.displayName} to ${c.name}.`,
          actorId: owner.id,
          brandId: c.brandId,
          campaignId: campaign.id,
          influencerId: inf.id,
          createdAt: daysFromNow(c.start - 4 + pi),
        },
      });
    }

    await prisma.activityLog.create({
      data: { type: 'CAMPAIGN_CREATED', message: `${owner.name} created the campaign ${c.name}.`, actorId: owner.id, brandId: c.brandId, campaignId: campaign.id, createdAt: daysFromNow(c.start - 6) },
    });
  }

  // A few overdue-deliverable + general notifications for the admin
  await prisma.notification.create({
    data: {
      category: 'DELIVERABLE_OVERDUE',
      title: 'Deliverable overdue',
      body: 'A deliverable in Summer Glow Launch has passed its due date.',
      targetUrl: '/campaigns',
      deliveries: { create: { channel: 'IN_APP', status: 'SENT', deliveredAt: daysAgo(0) } },
    },
  });
  console.log('Created campaigns, deliverables, content & activity.');
}

async function seedIntegrationsAndConfig() {
  const platforms: Platform[] = ['INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'SNAPCHAT', 'X'];
  for (const platform of platforms) {
    await prisma.integrationSetting.create({
      data: {
        platform,
        status: 'NOT_CONFIGURED',
        isEnabled: true,
        monitoringEnabled: true,
      },
    });
  }
  await prisma.clientConfig.create({
    data: { defaultLanguage: 'en', supportedLanguages: ['en', 'ar'], maxUploadMb: 50, supportInfo: 'support@influenceos.app' },
  });
  await prisma.appVersion.create({ data: { platform: 'IOS', recommendedVersion: '1.0.0', minimumVersion: '1.0.0', forceUpdate: false } });
  await prisma.appVersion.create({ data: { platform: 'ANDROID', recommendedVersion: '1.0.0', minimumVersion: '1.0.0', forceUpdate: false } });
  for (const key of ['liveContentEnabled', 'audienceHealthEnabled', 'campaignReportsEnabled', 'xIntegrationEnabled', 'snapchatIntegrationEnabled']) {
    await prisma.featureFlag.create({ data: { key, scope: 'PLATFORM', enabled: true, description: `Toggle for ${key}` } });
  }
  console.log('Created integrations, client config, app versions & feature flags.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
