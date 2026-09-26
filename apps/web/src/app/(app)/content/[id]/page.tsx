import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { PublishedContentDTO } from '@influenceos/contracts';
import { ApiError } from '@influenceos/api-client';
import { getServerApi } from '@/lib/api-server';
import { PlatformBadge } from '@/components/ui/platform-badge';
import { SocialContentPlayer } from '@/components/content/social-content-player';
import { ContentDetails } from '@/components/content/content-viewer';
import { ContentAssociationPanel } from './association-panel';
import { ContentReviewBar } from './review-bar';
import { ContentActions } from './content-actions';

export const dynamic = 'force-dynamic';

/**
 * The canonical content detail page (`/content/:id`). Quick Add, global
 * search results and content-related notifications all link here — this was
 * previously a dead route (see docs/workflow/WORKFLOW_GAP_MATRIX.md). It
 * reuses the same `GET /content/:id` the drawer viewer already calls and the
 * same `ContentDetails` panel the drawer renders — no second content model,
 * no duplicate read path.
 */
export default async function ContentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const api = getServerApi();
  const t = await getTranslations('content');

  let content: PublishedContentDTO;
  try {
    content = await api.content.get(id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  return (
    <div>
      <Link
        href="/content"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="rtl:-scale-x-100 h-3.5 w-3.5" /> {t('viewer.backToFeed')}
      </Link>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <PlatformBadge platform={content.platform} withLabel />
          {content.caption ? <h1 className="truncate text-lg font-semibold text-foreground">{content.caption}</h1> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ContentReviewBar content={content} />
          <ContentActions content={content} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="overflow-hidden rounded-2xl bg-black p-3 lg:p-4">
          <SocialContentPlayer content={content} />
        </div>
        <div className="space-y-6">
          <ContentDetails content={content} />
          <ContentAssociationPanel content={content} />
        </div>
      </div>
    </div>
  );
}
