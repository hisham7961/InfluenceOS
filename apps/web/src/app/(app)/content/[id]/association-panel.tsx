'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { PublishedContentDTO } from '@influenceos/contracts';
import { contentAssociationStatus, CONTENT_ASSOCIATION_STATUS_LABELS, DELIVERABLE_TYPE_LABELS, type Tone } from '@influenceos/shared';
import { ApiError } from '@influenceos/api-client';
import { api } from '@/lib/api-browser';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const NONE = '__none__';

const STATUS_TONE: Record<ReturnType<typeof contentAssociationStatus>, Tone> = {
  FULLY_LINKED: 'success',
  CAMPAIGN_LINKED: 'info',
  INFLUENCER_LINKED: 'info',
  UNASSIGNED: 'warning',
};

function errMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong.';
}

/**
 * The "Content Association Resolution" surface — lets an authorized user
 * assign/change/remove the influencer and campaign on existing content
 * (including resolving previously-unassigned content), reusing the same
 * server-side resolveContentAssociation validation as create() — never a
 * second set of rules on the client. Deliverable linkage is shown read-only
 * here (set once, at creation, from the Deliverable's own "Add Published
 * Content" action — see docs/workflow/WORKFLOW_GAP_MATRIX.md).
 */
export function ContentAssociationPanel({ content }: { content: PublishedContentDTO }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [editing, setEditing] = React.useState(false);
  const [influencerId, setInfluencerId] = React.useState(content.influencer?.id ?? '');
  const [campaignId, setCampaignId] = React.useState(content.campaign?.id ?? '');

  const influencerOptions = useQuery({
    queryKey: ['influencers', 'options'],
    queryFn: () => api.influencers.list({ pageSize: 100 }),
    enabled: editing,
  });
  const campaignOptions = useQuery({
    queryKey: ['campaigns', 'options'],
    queryFn: () => api.campaigns.list({ pageSize: 100 }),
    enabled: editing,
  });

  const status = contentAssociationStatus({
    campaignId: content.campaign?.id ?? null,
    influencerId: content.influencer?.id ?? null,
  });

  const save = useMutation({
    mutationFn: () =>
      api.content.update(content.id, {
        influencerId: influencerId || null,
        campaignId: campaignId || null,
      }),
    onSuccess: () => {
      toast.success('Associations updated.');
      qc.invalidateQueries();
      router.refresh();
      setEditing(false);
    },
    onError: (e) => toast.error(errMessage(e)),
  });

  function startEditing() {
    setInfluencerId(content.influencer?.id ?? '');
    setCampaignId(content.campaign?.id ?? '');
    setEditing(true);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Associations</CardTitle>
          <Badge tone={STATUS_TONE[status]}>{CONTENT_ASSOCIATION_STATUS_LABELS[status]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!editing ? (
          <>
            <AssocRow
              label="Influencer"
              value={content.influencer?.displayName}
              href={content.influencer ? `/influencers/${content.influencer.id}` : undefined}
            />
            <AssocRow
              label="Campaign"
              value={content.campaign?.name}
              href={content.campaign ? `/campaigns/${content.campaign.id}` : undefined}
            />
            <AssocRow label="Brand" value={content.brand?.name} href={content.brand ? `/brands/${content.brand.id}` : undefined} />
            <AssocRow
              label="Deliverable"
              value={content.deliverable ? DELIVERABLE_TYPE_LABELS[content.deliverable.type] : undefined}
            />
            <Button type="button" variant="outline" size="sm" onClick={startEditing}>
              Edit associations
            </Button>
          </>
        ) : (
          <>
            <Field label="Influencer" hint="Clear to mark as unassigned">
              <Select value={influencerId || NONE} onValueChange={(v) => setInfluencerId(v === NONE ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  {(influencerOptions.data?.data ?? []).map((inf) => (
                    <SelectItem key={inf.id} value={inf.id}>
                      {inf.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Campaign" hint="Clear to make this independent content">
              <Select value={campaignId || NONE} onValueChange={(v) => setCampaignId(v === NONE ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="No campaign" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No campaign</SelectItem>
                  {(campaignOptions.data?.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.brand.name} · {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <p className="text-xs text-muted-foreground">
              Validated on save — an influencer not on the chosen campaign&apos;s roster is rejected rather than saved
              inconsistently. Saving this deliverable-linked content&apos;s campaign/influencer without changing the
              deliverable keeps them in sync automatically.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button type="button" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AssocRow({ label, value, href }: { label: string; value?: string; href?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {value && href ? (
        <Link href={href} className="font-medium text-brand hover:underline">
          {value}
        </Link>
      ) : (
        <span className="font-medium text-foreground">{value ?? '—'}</span>
      )}
    </div>
  );
}
