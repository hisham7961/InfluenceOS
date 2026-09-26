'use client';

import { RouteError } from '@/components/common/route-error';

// Catches failures of the app shell itself (e.g. the API was unreachable while
// loading the signed-in user) — shown instead of signing everyone out.
export default function RootError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="px-4">
      <RouteError {...props} />
    </main>
  );
}
