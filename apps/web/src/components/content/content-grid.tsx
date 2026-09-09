'use client';
import * as React from 'react';
import { PlaySquare } from 'lucide-react';
import type { PublishedContentDTO } from '@influenceos/contracts';
import { cn } from '@/lib/cn';
import { EmptyState } from '@/components/ui/empty-state';
import { ContentCard } from './content-card';
import { ContentViewer } from './content-viewer';

export function ContentGrid({
  items,
  className,
  emptyTitle = 'No content yet',
  emptyDescription = 'Published campaign content will appear here.',
}: {
  items: PublishedContentDTO[];
  className?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const [index, setIndex] = React.useState(0);
  const [open, setOpen] = React.useState(false);

  if (items.length === 0) {
    return <EmptyState icon={PlaySquare} title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <>
      <div className={cn('grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5', className)}>
        {items.map((content, i) => (
          <ContentCard
            key={content.id}
            content={content}
            onOpen={() => {
              setIndex(i);
              setOpen(true);
            }}
          />
        ))}
      </div>
      <ContentViewer items={items} index={index} onIndexChange={setIndex} open={open} onOpenChange={setOpen} />
    </>
  );
}
