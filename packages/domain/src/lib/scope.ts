import type { DomainContext } from '../context';

/**
 * Resolve the brand scope for the current actor (W4-4). Returns the list of
 * brand ids the actor is limited to, or `null` when the actor is unscoped and
 * may see every brand. Unscoped means: a system/worker context, an ADMIN, or a
 * user who has NO explicit brand-access rows — so existing users are unaffected
 * and scoping is strictly opt-in (grant a user brands to restrict them).
 */
export async function scopedBrandIds(ctx: DomainContext): Promise<string[] | null> {
  const actor = ctx.actor;
  if (!actor || actor.role === 'ADMIN') return null;
  const rows = await ctx.prisma.userBrandAccess.findMany({
    where: { userId: actor.id },
    select: { brandId: true },
  });
  if (rows.length === 0) return null;
  return rows.map((r) => r.brandId);
}

/** True when the actor is brand-scoped and the given brand is out of scope. */
export function isBrandOutOfScope(scope: string[] | null, brandId: string): boolean {
  return scope !== null && !scope.includes(brandId);
}
