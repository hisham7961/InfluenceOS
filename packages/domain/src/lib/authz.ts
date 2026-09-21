import type { Capability } from '@influenceos/contracts';
import type { Actor, DomainContext } from '../context';
import { AppError } from '../errors';
import { hasCapability } from './capabilities';

/** Require an authenticated actor for a mutation. */
export function requireActor(ctx: DomainContext): Actor {
  if (!ctx.actor) throw AppError.unauthorized();
  return ctx.actor;
}

/** Require an ADMIN actor (brands, users, integrations, platform settings). */
export function requireAdmin(ctx: DomainContext): Actor {
  const actor = requireActor(ctx);
  if (actor.role !== 'ADMIN') {
    throw AppError.forbidden('This action requires an administrator.');
  }
  return actor;
}

/**
 * Least-privilege gate for a destructive action on a user-owned record
 * (SEC-04 groundwork). An ADMIN may act on anything; a non-admin may act only
 * on a record they own. A record with no recorded owner (`ownerId == null`) is
 * treated as not-yours for a non-admin, so only an ADMIN can remove it.
 */
export function requireOwnerOrAdmin(
  ctx: DomainContext,
  ownerId: string | null | undefined,
  label = 'item',
): Actor {
  const actor = requireActor(ctx);
  if (actor.role === 'ADMIN') return actor;
  if (ownerId && ownerId === actor.id) return actor;
  throw AppError.forbidden(`You can only delete your own ${label}.`);
}

/** A system context (worker/seed) bypasses actor requirements. */
export function isSystem(ctx: DomainContext): boolean {
  return ctx.actor === null;
}

/**
 * Require the actor to hold a specific Capability (Advanced Roles pass) — the
 * ONE way a new operational check should gate access. Never scatter
 * `actor.role === 'X'` / `actor.roleProfile === 'X'` comparisons through the
 * app; add or adjust a Capability's default resolution in capabilities.ts
 * instead. An ADMIN always passes.
 */
export async function requireCapability(ctx: DomainContext, capability: Capability): Promise<Actor> {
  const actor = requireActor(ctx);
  if (await hasCapability(ctx, capability)) return actor;
  throw AppError.forbidden(`This action requires the ${capability} capability.`);
}
