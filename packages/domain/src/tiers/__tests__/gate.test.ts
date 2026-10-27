import type { Subscription, Tier } from '../../types';
import type { Feature } from '../features';
import { TIER_DEVICE_LIMIT, TIER_FEATURES } from '../features';
import { assertFeature, canAddDevice, FeatureGatedError, hasFeature } from '../gate';

const TIERS: Tier[] = ['free', 'standard', 'premium'];
const ALL_FEATURES: Feature[] = [
  'website_blocker',
  'instant_pause',
  'app_blocker',
  'schedules',
  'screen_time',
  'locator',
  'vpn_shield',
  'usage_buckets',
  'presence_detection',
  'per_app_limits',
  'priority_support',
];

function subscriptionFor(tier: Tier): Subscription {
  return { familyId: 'fam-1', tier, deviceLimit: TIER_DEVICE_LIMIT[tier] };
}

describe('hasFeature — one assertion per feature/tier pairing (spec §3.8)', () => {
  for (const tier of TIERS) {
    for (const feature of ALL_FEATURES) {
      const expected = TIER_FEATURES[tier].includes(feature);
      it(`${tier} ${expected ? 'can' : 'cannot'} use ${feature}`, () => {
        expect(hasFeature(tier, feature)).toBe(expected);
      });
    }
  }
});

describe('hasFeature — explicit spec-table boundaries', () => {
  it('free cannot use vpn_shield', () => {
    expect(hasFeature('free', 'vpn_shield')).toBe(false);
  });

  it('standard cannot use vpn_shield, usage_buckets, presence_detection, or per_app_limits', () => {
    expect(hasFeature('standard', 'vpn_shield')).toBe(false);
    expect(hasFeature('standard', 'usage_buckets')).toBe(false);
    expect(hasFeature('standard', 'presence_detection')).toBe(false);
    expect(hasFeature('standard', 'per_app_limits')).toBe(false);
  });

  it('premium can use everything', () => {
    for (const feature of ALL_FEATURES) {
      expect(hasFeature('premium', feature)).toBe(true);
    }
  });

  it('every tier is cumulative: standard is a superset of free, premium a superset of standard', () => {
    for (const feature of TIER_FEATURES.free) {
      expect(TIER_FEATURES.standard).toContain(feature);
    }
    for (const feature of TIER_FEATURES.standard) {
      expect(TIER_FEATURES.premium).toContain(feature);
    }
  });
});

describe('assertFeature', () => {
  it('does not throw when the tier is entitled', () => {
    expect(() => assertFeature('premium', 'vpn_shield')).not.toThrow();
    expect(() => assertFeature('free', 'website_blocker')).not.toThrow();
  });

  it('throws a FeatureGatedError with feature/requiredTier when not entitled', () => {
    try {
      assertFeature('free', 'vpn_shield');
      throw new Error('expected assertFeature to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(FeatureGatedError);
      const gated = err as FeatureGatedError;
      expect(gated.feature).toBe('vpn_shield');
      expect(gated.requiredTier).toBe('premium');
    }
  });

  it('reports the minimum required tier, not just "premium"', () => {
    try {
      assertFeature('free', 'app_blocker');
      throw new Error('expected assertFeature to throw');
    } catch (err) {
      expect((err as FeatureGatedError).requiredTier).toBe('standard');
    }
  });
});

describe('canAddDevice — device limit enforcement at 1/10/20', () => {
  it('free: allows adding the 1st device, refuses the 2nd', () => {
    expect(canAddDevice(subscriptionFor('free'), 0)).toBe(true);
    expect(canAddDevice(subscriptionFor('free'), 1)).toBe(false);
  });

  it('standard: allows up to 10, refuses the 11th', () => {
    expect(canAddDevice(subscriptionFor('standard'), 9)).toBe(true);
    expect(canAddDevice(subscriptionFor('standard'), 10)).toBe(false);
  });

  it('premium: allows up to 20, refuses the 21st', () => {
    expect(canAddDevice(subscriptionFor('premium'), 19)).toBe(true);
    expect(canAddDevice(subscriptionFor('premium'), 20)).toBe(false);
  });
});
