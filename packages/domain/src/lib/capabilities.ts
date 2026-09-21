import type { Capability, RoleProfile } from '@influenceos/contracts';
import { CAPABILITIES } from '@influenceos/contracts';
import type { Actor, DomainContext } from '../context';

const ALL_CAPABILITIES: readonly Capability[] = CAPABILITIES;

/**
 * Default capability set per Role Profile (Advanced Roles pass). These are
 * DEFAULTS a profile resolves to, not the only authorization path — an
 * explicit UserCapability grant/revoke can widen or narrow them per user.
 * ADMIN gets every capability unconditionally.
 */
const ROLE_PROFILE_CAPABILITIES: Record<RoleProfile, readonly Capability[]> = {
  ADMIN: ALL_CAPABILITIES,
  GENERAL_MANAGER: [
    'BRANDS_VIEW',
    'CAMPAIGNS_VIEW',
    'CAMPAIGNS_MANAGE',
    'INFLUENCERS_VIEW',
    'INFLUENCERS_MANAGE',
    'CONTENT_VIEW',
    'CONTENT_MANAGE',
    'UGC_REVIEW',
    'LOGISTICS_VIEW',
    'LOGISTICS_MANAGE',
    'LOGISTICS_ADDRESS_VIEW',
    'FINANCE_VIEW',
    'REPORTS_VIEW',
    'OPERATIONS_VIEW',
  ],
  OPERATIONS_MANAGER: [
    'BRANDS_VIEW',
    'CAMPAIGNS_VIEW',
    'INFLUENCERS_VIEW',
    'CONTENT_VIEW',
    'UGC_REVIEW',
    'LOGISTICS_VIEW',
    'LOGISTICS_ADDRESS_VIEW',
    'REPORTS_VIEW',
    'OPERATIONS_VIEW',
  ],
  LOGISTICS: [
    'LOGISTICS_VIEW',
    'LOGISTICS_MANAGE',
    'LOGISTICS_ASSIGN',
    'LOGISTICS_ADDRESS_VIEW',
    'LOGISTICS_ADDRESS_EDIT',
    'LOGISTICS_ISSUE_MANAGE',
  ],
  INFLUENCER_MANAGER: [
    'BRANDS_VIEW',
    'CAMPAIGNS_VIEW',
    'INFLUENCERS_VIEW',
    'INFLUENCERS_MANAGE',
    'CONTENT_VIEW',
    'LOGISTICS_VIEW',
  ],
  VIEWER: [
    'BRANDS_VIEW',
    'CAMPAIGNS_VIEW',
    'INFLUENCERS_VIEW',
    'CONTENT_VIEW',
    'LOGISTICS_VIEW',
    'REPORTS_VIEW',
    'OPERATIONS_VIEW',
  ],
};

/**
 * Legacy fallback for a user with no roleProfile assigned — preserves
 * pre-Advanced-Roles behavior exactly (STAFF could already do virtually
 * everything operational; ADMIN-only technical capabilities stay excluded).
 */
const LEGACY_STAFF_CAPABILITIES: readonly Capability[] = ALL_CAPABILITIES.filter(
  (c) => c !== 'USERS_MANAGE' && c !== 'ROLES_MANAGE' && c !== 'SYSTEM_SETTINGS_MANAGE' && c !== 'INTEGRATIONS_MANAGE',
);

function baseCapabilities(actor: Actor): readonly Capability[] {
  if (actor.role === 'ADMIN') return ALL_CAPABILITIES;
  if (actor.roleProfile) return ROLE_PROFILE_CAPABILITIES[actor.roleProfile];
  if (actor.role === 'VIEWER') return ROLE_PROFILE_CAPABILITIES.VIEWER;
  return LEGACY_STAFF_CAPABILITIES;
}

/**
 * Resolve the actor's full, real capability set: Role Profile (or legacy
 * role) default, plus any explicit UserCapability grants, minus any explicit
 * revokes. This is the ONE place capability logic lives — callers ask
 * `hasCapability`/`requireCapability`, never compare `actor.role` directly.
 */
export async function resolveCapabilities(ctx: DomainContext): Promise<Set<Capability>> {
  const actor = ctx.actor;
  if (!actor) return new Set();
  const base = new Set(baseCapabilities(actor));
  const overrides = await ctx.prisma.userCapability.findMany({ where: { userId: actor.id } });
  for (const o of overrides) {
    if (o.granted) base.add(o.capability);
    else base.delete(o.capability);
  }
  return base;
}

export async function hasCapability(ctx: DomainContext, capability: Capability): Promise<boolean> {
  if (!ctx.actor) return false;
  if (ctx.actor.role === 'ADMIN') return true;
  const capabilities = await resolveCapabilities(ctx);
  return capabilities.has(capability);
}
