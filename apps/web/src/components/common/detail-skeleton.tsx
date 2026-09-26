import { Skeleton, SkeletonText } from '@/components/ui/skeleton';

/**
 * What a detail page (a campaign, a brand, a creator) looks like while the
 * server gathers it (P2.8): the hero, the stat row and the tabs, so the page
 * doesn't jump when it arrives.
 */
export function DetailSkeleton({ cover = false, avatar = false, tabs = 0 }: { cover?: boolean; avatar?: boolean; tabs?: number }) {
  return (
    <div aria-busy="true">
      <Skeleton className="mb-4 h-4 w-32" />
      <div className="mb-6 overflow-hidden rounded-2xl border border-border">
        {cover ? <Skeleton className="h-40 rounded-none sm:h-56" /> : null}
        <div className="flex items-start gap-4 p-6">
          {avatar ? <Skeleton className="size-20 shrink-0 rounded-2xl" /> : null}
          <div className="flex-1 space-y-2.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-7 w-64 max-w-full" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
        </div>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      {tabs > 0 ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {Array.from({ length: tabs }, (_, i) => (
            <Skeleton key={i} className="h-9 w-24" />
          ))}
        </div>
      ) : null}
      <div className="space-y-3 rounded-2xl border border-border p-5">
        <SkeletonText lines={6} />
      </div>
    </div>
  );
}
