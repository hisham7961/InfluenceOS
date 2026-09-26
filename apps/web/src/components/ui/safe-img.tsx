'use client';

import * as React from 'react';

/**
 * An <img> that shows `fallback` instead of a broken image when the source
 * fails to load — social covers are signed links that expire after a few
 * days. Resets when the source changes.
 */
export function SafeImg({
  src,
  fallback = null,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & { src: string; fallback?: React.ReactNode }) {
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  if (failedSrc === src) return <>{fallback}</>;
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  return <img src={src} {...props} onError={() => setFailedSrc(src)} />;
}
