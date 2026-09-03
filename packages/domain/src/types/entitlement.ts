/**
 * A compact, provider-agnostic view of access. Billing providers may update
 * the authoritative subscription record, but product code consumes this
 * stable shape rather than provider-specific identifiers.
 */
export type EntitlementTier = 'free' | 'paid';

export interface EntitlementLimits {
  dailyGenerations: number;
  requestsPerMinute: number;
}

export interface UserEntitlement {
  tier: EntitlementTier;
  active: boolean;
  expiresAt: string | null;
  limits: EntitlementLimits;
}

/** A future Stripe/App Store adapter only needs to resolve this contract. */
export interface EntitlementProvider {
  getEntitlement(userId: string): Promise<UserEntitlement>;
}

export const ENTITLEMENT_LIMITS: Record<EntitlementTier, EntitlementLimits> = {
  free: { dailyGenerations: 20, requestsPerMinute: 10 },
  paid: { dailyGenerations: 200, requestsPerMinute: 30 },
};

/** Pure mirror of the database eligibility rule for provider adapters and tests. */
export function deriveUserEntitlement(input: {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  currentPeriodEndsAt: string | null;
  nowIso: string;
}): UserEntitlement {
  const periodValid = input.currentPeriodEndsAt === null || new Date(input.currentPeriodEndsAt).getTime() > new Date(input.nowIso).getTime();
  const providerActive = (input.status === 'active' || input.status === 'on_trial') && periodValid;
  const tier: EntitlementTier = input.tier === 'paid' && providerActive ? 'paid' : 'free';
  return { tier, active: tier === 'free' || providerActive, expiresAt: input.currentPeriodEndsAt, limits: ENTITLEMENT_LIMITS[tier] };
}
import type { SubscriptionStatus, SubscriptionTier } from './billing.js';
