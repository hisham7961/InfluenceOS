'use client';

import { RouteError } from '@/components/common/route-error';

// Shown inside the app shell (navigation stays usable) when a page fails.
export default function AppError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} />;
}
