'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { MessageSquare, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { CommentThread } from '@/components/collaboration/comment-thread';
import { cn } from '@/lib/cn';

/**
 * The always-accessible Logistics Team Chat (Advanced Roles & Logistics
 * Operations pass) — channel-level coordination distinct from per-shipment
 * Comments, but reusing the SAME Collaboration Layer (`<CommentThread>`,
 * the Note model, mentions, pinning). Docked as a collapsible sidebar on
 * desktop (`| Logistics Queue | Chat |`) and a drawer on mobile — never
 * squeezed permanently onto a small screen.
 */
function Thread() {
  const t = useTranslations('logistics');
  return (
    <CommentThread
      context={{ channel: 'logistics' }}
      cacheKey="logistics-chat"
      conversationKey="channel:logistics"
      emptyTitle={t('chat.emptyTitle')}
      emptyDescription={t('chat.emptyDescription')}
      composerPlaceholder={t('chat.composerPlaceholder')}
    />
  );
}

export function LogisticsChatPanel() {
  const t = useTranslations('logistics');
  const [open, setOpen] = React.useState(true);

  return (
    <>
      {/* Desktop: a collapsible docked sidebar column. */}
      <div className={cn('hidden shrink-0 lg:block', open ? 'w-80' : 'w-auto')}>
        {open ? (
          <Card className="sticky top-4 flex max-h-[calc(100vh-6rem)] w-80 flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <MessageSquare className="h-4 w-4 text-accent" /> {t('chat.title')}
              </span>
              <Button type="button" variant="ghost" size="icon-sm" title={t('chat.collapseChat')} onClick={() => setOpen(false)}>
                <PanelRightClose className="h-4 w-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <Thread />
            </div>
          </Card>
        ) : (
          <Button type="button" variant="outline" size="icon" title={t('chat.openChat')} onClick={() => setOpen(true)} className="sticky top-4">
            <PanelRightOpen className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Mobile / tablet: a drawer, never squeezed permanently onto the page. */}
      <div className="lg:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" /> {t('chat.chatButton')}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="flex h-[85vh] flex-col">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-1.5">
                <MessageSquare className="h-4 w-4 text-accent" /> {t('chat.title')}
              </SheetTitle>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Thread />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
