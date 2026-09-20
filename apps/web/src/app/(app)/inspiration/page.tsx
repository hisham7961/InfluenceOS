import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { InspirationWorkspace } from './inspiration-workspace';

export const dynamic = 'force-dynamic';

/**
 * Trends & Inspiration (Operations Intelligence pass) — external reference
 * material the team wants to remember and discuss (a competitor's ad, a
 * trending format, a technique). Deliberately separate from PublishedContent
 * and from Content Command Center's review/analytics pipeline — this is
 * never the brand's own posted content.
 */
export default async function InspirationPage() {
  const api = getServerApi();
  const brands = await api.brands.list();

  return (
    <div>
      <PageHeader title="Inspiration" description="Trends, competitor moves, and reference material worth remembering." />
      <InspirationWorkspace brands={brands} />
    </div>
  );
}
