import type { Subscription, Tier } from '../types.ts';
import { TIER_DEVICE_LIMIT, TIER_FEATURES, type Feature } from './features.ts';

const TIER_ORDER: Tier[] = ['free', 'standard', 'premium'];

function minimumTierFor(feature: Feature): Tier {
  const tier = TIER_ORDER.find((t) => TIER_FEATURES[t].includes(feature));
  // Every Feature is present in at least premium's list (see features.ts); this is
  // unreachable for a well-typed `feature`, but keeps the function total.
  if (!tier) {
    throw new Error(`tiers/gate: no tier grants feature "${feature}"`);
  }
  return tier;
}

export function hasFeature(tier: Tier, feature: Feature): boolean {
  return TIER_FEATURES[tier].includes(feature);
}

export class FeatureGatedError extends Error {
  readonly feature: Feature;
  readonly requiredTier: Tier;

  constructor(feature: Feature, requiredTier: Tier) {
    super(`Feature "${feature}" requires the "${requiredTier}" tier or higher`);
    this.name = 'FeatureGatedError';
    this.feature = feature;
    this.requiredTier = requiredTier;
  }
}

export function assertFeature(tier: Tier, feature: Feature): void {
  if (!hasFeature(tier, feature)) {
    throw new FeatureGatedError(feature, minimumTierFor(feature));
  }
}

// Enforced cap is TIER_DEVICE_LIMIT[subscription.tier] (the spec-defined source of truth,
// also used directly by T12/T20), not the stored Subscription.deviceLimit convenience field.
export function canAddDevice(subscription: Subscription, currentDeviceCount: number): boolean {
  return currentDeviceCount < TIER_DEVICE_LIMIT[subscription.tier];
}
