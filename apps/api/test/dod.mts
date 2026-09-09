import { buildApp } from '../src/app.ts';

async function main() {
  const app = await buildApp();
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'admin@influenceos.app', password: 'Password123!' } });
  const token = (login.json() as any).tokens.accessToken;
  const H = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const call = async (method: any, url: string, payload?: any) => {
    const r = await app.inject({ method, url, headers: H, payload });
    if (r.statusCode >= 400) throw new Error(`${method} ${url} -> ${r.statusCode} ${r.body}`);
    return r.json() as any;
  };

  // 1. Pick a brand
  const brands = await call('GET', '/api/v1/brands');
  const brand = brands[0];

  // 2. Resolve a profile URL (manual fallback without API key) + create influencer
  const handle = `dodcreator${Date.now()}`;
  const resolved = await call('POST', '/api/v1/influencers/resolve', { input: `https://www.youtube.com/@${handle}` });
  console.log('resolve:', resolved.platform, resolved.source, 'manual=' + resolved.manual);
  const inf = await call('POST', '/api/v1/influencers', { displayName: 'DoD Creator', category: 'Tech', country: 'Kuwait' });
  await call('POST', `/api/v1/influencers/${inf.id}/social-accounts`, { platform: resolved.platform, username: resolved.username, followers: 123000, isPrimary: true });
  console.log('influencer created:', inf.displayName, inf.id);

  // 3. Create a campaign
  const camp = await call('POST', '/api/v1/campaigns', { brandId: brand.id, name: 'DoD Verification Campaign', status: 'ACTIVE', startDate: new Date().toISOString(), endDate: new Date(Date.now() + 20 * 864e5).toISOString(), plannedBudget: 5000 });
  console.log('campaign created:', camp.name, camp.id);

  // 4. Add influencers — one paid, and reuse a seeded influencer as FREE
  const ci = await call('POST', `/api/v1/campaigns/${camp.id}/influencers`, { influencerId: inf.id, dealType: 'PAID', agreedCost: 800, paymentStatus: 'UNPAID' });
  const others = await call('GET', '/api/v1/influencers?pageSize=10');
  const freeInf = others.data.find((x: any) => x.id !== inf.id);
  await call('POST', `/api/v1/campaigns/${camp.id}/influencers`, { influencerId: freeInf.id, dealType: 'FREE' });
  console.log('added 2 campaign influencers (1 PAID, 1 FREE)');

  // 5. Add a deliverable + script
  const deliverable = await call('POST', `/api/v1/campaign-influencers/${ci.id}/deliverables`, { platform: 'YOUTUBE', type: 'VIDEO', dueDate: new Date(Date.now() + 3 * 864e5).toISOString() });
  await call('POST', '/api/v1/scripts', { campaignId: camp.id, deliverableId: deliverable.id, title: 'DoD brief', body: 'Show the product.', dos: ['Disclose #ad'], donts: ['No competitors'] });
  console.log('deliverable + script created');

  // 6. Progress before publishing
  const before = await call('GET', `/api/v1/campaigns/${camp.id}`);
  console.log('progress BEFORE:', before.progress.deliverablesPublished + '/' + before.progress.deliverablesTotal, 'spend', before.progress.spend);

  // 7. Paste the published content URL, linked to the deliverable
  const content = await call('POST', '/api/v1/content', { url: `https://www.youtube.com/watch?v=dQw4w9WgXcQ&r=${Date.now()}`, campaignId: camp.id, deliverableId: deliverable.id });
  console.log('published content:', content.platform, 'embeddable=' + content.embeddable, 'embed=' + content.embed?.kind);

  // 8. Verify it appears in feed, deliverable published, progress advanced, dashboard What's New
  const feed = await call('GET', `/api/v1/content/feed?campaignId=${camp.id}`);
  const after = await call('GET', `/api/v1/campaigns/${camp.id}`);
  const cis = await call('GET', `/api/v1/campaigns/${camp.id}/influencers`);
  const dash = await call('GET', '/api/v1/dashboard/global');
  const inFeed = feed.data.some((c: any) => c.id === content.id);
  const delPublished = cis.flatMap((c: any) => c.deliverables).some((d: any) => d.id === deliverable.id && d.status === 'PUBLISHED');
  const inWhatsNew = dash.whatsNew.some((w: any) => w.content?.id === content.id);

  console.log('progress AFTER:', after.progress.deliverablesPublished + '/' + after.progress.deliverablesTotal);
  console.log('content in campaign feed:', inFeed);
  console.log('deliverable auto-marked PUBLISHED:', delPublished);
  console.log('content in global What\'s New:', inWhatsNew);

  const ok = inFeed && delPublished && after.progress.deliverablesPublished > before.progress.deliverablesPublished && inWhatsNew;
  await app.close();
  console.log(ok ? 'DOD SCENARIO OK ✅' : 'DOD SCENARIO FAILED ❌');
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error('DOD FAILED', e); process.exit(1); });
