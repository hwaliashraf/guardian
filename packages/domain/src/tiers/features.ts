import type { Tier } from '../types.ts';

export type Feature =
  | 'website_blocker'
  | 'instant_pause'
  | 'app_blocker'
  | 'schedules'
  | 'screen_time'
  | 'locator'
  | 'vpn_shield'
  | 'usage_buckets'
  | 'presence_detection'
  | 'per_app_limits'
  | 'priority_support';

// Cumulative by design (spec §3.8): each tier's list is written out in full — standard
// literally repeats free's features, premium literally repeats standard's — rather than
// computed via spread/merge, so this table can be spot-checked directly against the spec.
export const TIER_FEATURES: Record<Tier, Feature[]> = {
  free: ['website_blocker', 'instant_pause'],
  standard: [
    'website_blocker',
    'instant_pause',
    'app_blocker',
    'schedules',
    'screen_time',
    'locator',
  ],
  premium: [
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
  ],
};

export const TIER_DEVICE_LIMIT: Record<Tier, number> = { free: 1, standard: 10, premium: 20 };
