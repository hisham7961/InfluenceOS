import { PageHeader } from '@/components/common/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { CommentThread } from '@/components/collaboration/comment-thread';

export const dynamic = 'force-dynamic';

/**
 * General Team Chat (Operations Intelligence pass, PART 15) — one org-wide
 * space for cross-brand/cross-campaign coordination that doesn't belong on
 * any one entity. Reuses the SAME Collaboration Layer as every other
 * comment surface (Content, Deliverable, Shipment, Trends, Campaign Chat),
 * scoped by channel: 'general' — never a bespoke chat system.
 */
export default function TeamPage() {
  return (
    <div>
      <PageHeader title="Team" description="General coordination that doesn't belong to one brand or campaign." />
      <Card>
        <CardContent className="pt-6">
          <CommentThread
            context={{ channel: 'general' }}
            cacheKey="general-chat"
            conversationKey="channel:general"
            emptyTitle="No messages yet"
            emptyDescription="Say hello, or post something the whole team should know."
            composerPlaceholder="Message the team… use @ to mention someone"
          />
        </CardContent>
      </Card>
    </div>
  );
}
