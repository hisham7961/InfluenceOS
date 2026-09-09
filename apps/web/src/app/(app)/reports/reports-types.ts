// Boundary-neutral constants shared by the server page and the client view.
// Runtime values must NOT be imported from a 'use client' module into a Server
// Component — Next turns such a cross-boundary value import into a client
// reference (not the real array), which fails at runtime. Keeping these here
// (no 'use client') lets both sides import the genuine value.

export const REPORT_TYPES = ['campaign', 'influencer', 'brand', 'content', 'spend'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
