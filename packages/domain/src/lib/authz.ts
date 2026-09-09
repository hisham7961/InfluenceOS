import type { Actor, DomainContext } from '../context';
import { AppError } from '../errors';

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

/** A system context (worker/seed) bypasses actor requirements. */
export function isSystem(ctx: DomainContext): boolean {
  return ctx.actor === null;
}
