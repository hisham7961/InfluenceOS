import { Skeleton, SkeletonText } from '@/components/ui/skeleton';

// Instant feedback while the next page loads on the server (every page waits
// for several API calls before it can render).
export default function AppLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="space-y-3 rounded-2xl border border-border p-5">
        <SkeletonText lines={6} />
      </div>
    </div>
  );
}
