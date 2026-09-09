import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Mail, MapPin, MessageCircle, Phone, Tag } from 'lucide-react';
import type { InfluencerDetailDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { getServerApi } from '@/lib/api-server';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/ui/stat-card';
import { Avatar } from '@/components/ui/avatar';
import { AudienceHealthBadge, RelationshipStatusBadge } from '@/components/ui/status-badges';
import { formatCompact, formatCurrency } from '@/lib/format';
import { ProfileTabs } from './profile-tabs';
import { InfluencerEditDialog } from './influencer-edit-dialog';

export const dynamic = 'force-dynamic';

/** Normalizes a phone/WhatsApp string into a wa.me link. */
function waHref(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  return `https://wa.me/${digits}`;
}

export default async function InfluencerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const api = getServerApi();

  let influencer: InfluencerDetailDTO;
  try {
    influencer = await api.influencers.get(id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  const [contentFeed, notes, brandRelationships] = await Promise.all([
    api.content.feed({ influencerId: id, limit: 12 }),
    api.influencers.notes(id),
    api.influencers.brandRelationships(id),
  ]);

  const contact = influencer.contact;
  const history = influencer.history;
  const hasContact = Boolean(contact.whatsapp || contact.email || contact.mobile);

  return (
    <div>
      <Link
        href="/influencers"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Influencers
      </Link>

      {/* Hero header */}
      <Card className="mb-6 overflow-hidden">
        <CardContent className="flex flex-col gap-6 p-6 sm:flex-row sm:items-start">
          <Avatar name={influencer.displayName} src={influencer.avatarUrl} size="2xl" rounded="lg" className="shrink-0" />

          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-bold tracking-tight">{influencer.displayName}</h1>
              <RelationshipStatusBadge status={influencer.relationshipStatus} />
              <AudienceHealthBadge status={influencer.audienceHealth} />
            </div>

            {influencer.primaryUsername ? (
              <p className="text-sm text-muted-foreground">@{influencer.primaryUsername}</p>
            ) : null}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
              {influencer.country ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {influencer.country}
                  {influencer.city ? `, ${influencer.city}` : ''}
                </span>
              ) : null}
              {influencer.category ? (
                <span className="inline-flex items-center gap-1">
                  <Tag className="h-3.5 w-3.5" />
                  {influencer.category}
                </span>
              ) : null}
              {contact.managerName ? <span>Managed by {contact.managerName}</span> : null}
            </div>

            {influencer.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {influencer.tags.map((tag) => (
                  <Badge key={tag} tone="neutral">
                    {tag}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col">
            <InfluencerEditDialog influencer={influencer} />
            {contact.whatsapp ? (
              <Button asChild variant="secondary" size="sm">
                <a href={waHref(contact.whatsapp)} target="_blank" rel="noreferrer">
                  <MessageCircle /> WhatsApp
                </a>
              </Button>
            ) : null}
            {contact.email ? (
              <Button asChild variant="secondary" size="sm">
                <a href={`mailto:${contact.email}`}>
                  <Mail /> Email
                </a>
              </Button>
            ) : null}
            {contact.mobile ? (
              <Button asChild variant="secondary" size="sm">
                <a href={`tel:${contact.mobile}`}>
                  <Phone /> Call
                </a>
              </Button>
            ) : null}
            {!hasContact ? <p className="text-xs text-muted-foreground">No contact info on file</p> : null}
          </div>
        </CardContent>
      </Card>

      {/* Stat row — iconName (not icon) for the RSC boundary. */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Total Followers"
          value={influencer.totalFollowers}
          iconName="users"
          tone="info"
          formatted={influencer.totalFollowers != null ? formatCompact(influencer.totalFollowers) : 'N/A'}
        />
        <StatCard label="Campaigns" value={history.campaignCount} iconName="megaphone" tone="accent" hint={`${influencer.activeCampaigns} active now`} />
        <StatCard
          label="Average Rate"
          value={history.averageRate}
          iconName="wallet"
          tone="warning"
          formatted={history.averageRate != null ? formatCurrency(history.averageRate) : 'N/A'}
        />
        <StatCard
          label="Deliverables Published"
          value={history.deliverablesPublished}
          iconName="deliverables"
          tone="success"
          hint={`of ${history.deliverablesTotal} total`}
        />
      </div>

      <ProfileTabs influencer={influencer} content={contentFeed.data} notes={notes} brandRelationships={brandRelationships} />
    </div>
  );
}
