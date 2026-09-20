import { getServerApi } from '@/lib/api-server';
import { PageHeader } from '@/components/common/page-header';
import { LogisticsWorkspace } from './logistics-workspace';

export const dynamic = 'force-dynamic';

/**
 * The central cross-campaign logistics workspace (WORKFLOW_GAP_MATRIX.md).
 * Reads the SAME ProductShipment rows every campaign's Shipments tab reads —
 * never a copy — so a status the logistics employee sets here is exactly
 * what the campaign employee sees on the campaign page, and vice versa.
 */
export default async function LogisticsPage() {
  const api = getServerApi();
  const [initial, brands] = await Promise.all([api.shipments.list({ limit: 50 }), api.brands.list()]);

  return (
    <div>
      <PageHeader
        title="Logistics"
        description="Every fulfilment request — gifted products and UGC shipments — across every campaign, in one place."
      />
      <LogisticsWorkspace initial={initial} brands={brands} />
    </div>
  );
}
