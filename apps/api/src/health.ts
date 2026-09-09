import { Prisma, prisma } from '@influenceos/database';

export interface DependencyCheck {
  name: string;
  status: 'ok' | 'down';
  detail?: string;
}

/** Lightweight, bounded database liveness probe used by /ready. */
export async function checkDatabase(): Promise<DependencyCheck> {
  try {
    await prisma.$queryRaw(Prisma.sql`SELECT 1`);
    return { name: 'database', status: 'ok' };
  } catch (err) {
    return { name: 'database', status: 'down', detail: err instanceof Error ? err.message : 'query failed' };
  }
}
