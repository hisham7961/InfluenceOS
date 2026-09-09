import { buildApp } from '../src/app.ts';

async function main() {
  const app = await buildApp();
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'admin@influenceos.app', password: 'Password123!' },
  });
  const token = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  const h = { authorization: `Bearer ${token}` };
  const get = async (url: string) => {
    const r = await app.inject({ method: 'GET', url, headers: h });
    return { status: r.statusCode, json: r.json() as any };
  };

  const dash = await get('/api/v1/dashboard/global');
  console.log('dashboard', dash.status, {
    pulse: dash.json.pulse,
    whatsNew: dash.json.whatsNew?.length,
    attention: dash.json.attention?.length,
    activeCampaigns: dash.json.activeCampaigns?.length,
    recentActivity: dash.json.recentActivity?.length,
  });

  const feed = await get('/api/v1/content/feed?limit=6');
  console.log('content feed', feed.status, 'items', feed.json.data?.length, 'first embed kind:', feed.json.data?.[0]?.embed?.kind, 'embeddable:', feed.json.data?.[0]?.embeddable);

  const inf = await get('/api/v1/influencers?pageSize=5');
  console.log('influencers', inf.status, 'total', inf.json.pagination?.total, 'first:', inf.json.data?.[0]?.displayName, 'followers:', inf.json.data?.[0]?.totalFollowers, 'health:', inf.json.data?.[0]?.audienceHealth);

  const infId = inf.json.data?.[0]?.id;
  const infDetail = await get(`/api/v1/influencers/${infId}`);
  console.log('influencer 360', infDetail.status, 'accounts', infDetail.json.socialAccounts?.length, 'audience', infDetail.json.audience?.label, 'campaigns', infDetail.json.history?.campaignCount);

  const camps = await get('/api/v1/campaigns?pageSize=10');
  console.log('campaigns', camps.status, 'total', camps.json.pagination?.total, 'first progress:', camps.json.data?.[0]?.progress);

  const report = await get('/api/v1/reports?type=campaign');
  console.log('report campaign', report.status, 'rows', report.json.rows?.length, 'cols', report.json.columns?.length);

  const search = await get('/api/v1/search?q=nour');
  console.log('search', search.status, 'results', search.json?.length);

  const integrations = await get('/api/v1/integrations');
  console.log('integrations', integrations.status, 'count', integrations.json?.length, 'youtube caps:', integrations.json?.find((i: any) => i.platform === 'YOUTUBE')?.capabilities?.contentMetrics);

  await app.close();
  console.log('VERIFY OK');
  process.exit(0);
}
main().catch((e) => {
  console.error('VERIFY FAILED', e);
  process.exit(1);
});
