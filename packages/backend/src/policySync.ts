// T08: pure decision logic for policy-sync + push dispatch. No I/O (no DB, no network, no
// timers) — importable by both the Jest suite (packages/backend/src/__tests__/policySync.test.ts)
// and the Deno edge function (packages/backend/supabase/functions/policy-sync/index.ts), which
// stays a thin HTTP wrapper around this module per the ticket's explicit ask.
//
// Imports reach directly into packages/domain's SOURCE via relative paths (not the
// '@guardian/domain' package specifier, and not the barrel `index.ts`) for two reasons:
//   1. Dual-runtime importability: Deno (the edge function's runtime) cannot resolve the bare
//      '@guardian/domain' npm-workspace specifier without a Deno import map, and the domain
//      package's barrel (`index.ts`) transitively pulls in `zod` (via schemas.ts), which is an
//      external npm dependency Deno can't resolve locally without one too. `tiers/gate.ts` and
//      `tiers/features.ts` (and the narrow `types.ts` slices used here) have zero external
//      dependencies, so importing them directly keeps this module (and the edge function that
//      imports it) resolvable by Deno with no import map / network fetch required.
//   2. This still typechecks fine under Node/ts-jest/tsc (relative-file resolution, no package
//      boundary involved) — see packages/backend/src/__tests__/policySync.test.ts.
import { assertFeature } from '../../domain/src/tiers/gate.ts';
import type { Feature } from '../../domain/src/tiers/features.ts';
import type { Policy, Tier } from '../../domain/src/types.ts';

export type PolicyUpdate = Partial<Omit<Policy, 'id' | 'childId' | 'version'>>;

// Narrow device shape this module needs. Deliberately NOT T02's `Device` type: the domain model
// has no push-token field (see migration 0003_push_log.sql's comment for why that lives only in
// the `device` table, not packages/domain, for this ticket).
export interface PushableDevice {
  id: string;
  pushToken: string | null;
}

export interface PushDispatchPayload {
  title: string;
  body: string;
  data: Record<string, string>;
  priority: 'high' | 'normal';
}

// A device gets notified iff it has a non-empty push token — devices that haven't registered
// for push yet (token still null) are silently skipped, not an error.
export function devicesToNotify(devices: PushableDevice[]): PushableDevice[] {
  return devices.filter((d): d is PushableDevice & { pushToken: string } => !!d.pushToken);
}

// --- Feature gating ---------------------------------------------------------------------
//
// Ticket's explicit sub-policy -> Feature mapping, gating only on the write actually *enabling*
// the premium capability (never on clearing/disabling a section) — mirrors T06's TIER_FEATURES
// gate, which controls capability *access*, not whether a given write loosens or tightens a
// restriction:
//   - buckets touched at all                              -> 'usage_buckets'
//   - presence.levelNEnabled set true for any level        -> 'presence_detection'
//   - screenTime.perApp non-empty (the actual numeric      -> 'per_app_limits'
//     "per-app limits" field; AppRulePolicy itself has no
//     numeric per-app fields — see LEDGER T08 entry for
//     the reconciliation of the ticket's "appRules
//     per-app limits" prose against T02's actual types)
//   - contentFilter.safeSearchEnforced /                   -> 'vpn_shield'
//     youtubeRestrictedMode set true (the VPN-shield-
//     enforced fields per spec §4 Layer 1's "force-routes
//     SafeSearch CNAMEs")
export function detectGatedFeatureTouches(update: PolicyUpdate): Feature[] {
  const touched: Feature[] = [];

  if (update.buckets !== undefined) {
    touched.push('usage_buckets');
  }

  const presence = update.presence;
  if (presence && (presence.level0Enabled || presence.level1Enabled || presence.level2Enabled)) {
    touched.push('presence_detection');
  }

  const perApp = update.screenTime?.perApp;
  if (perApp !== undefined && Object.keys(perApp).length > 0) {
    touched.push('per_app_limits');
  }

  const contentFilter = update.contentFilter;
  if (contentFilter?.safeSearchEnforced === true || contentFilter?.youtubeRestrictedMode === true) {
    touched.push('vpn_shield');
  }

  return touched;
}

/**
 * Calls assertFeature() for every gated sub-policy the update touches, in the order they were
 * detected. Throws FeatureGatedError (from '../../domain/src/tiers/gate.ts') on the first one the
 * family's tier doesn't grant.
 */
export function assertPolicyUpdateAllowed(tier: Tier, update: PolicyUpdate): void {
  for (const feature of detectGatedFeatureTouches(update)) {
    assertFeature(tier, feature);
  }
}

// --- Versioning --------------------------------------------------------------------------
//
// Both builders return a full `Policy` (including `current.id`) for convenient typing, but
// `policy` is an append-only, versioned table (unique on (child_id, version) — see
// 0001_init.sql) — the caller (edge function) MUST insert this as a brand-new row (own fresh
// id, DB default `gen_random_uuid()`), never UPDATE the row `current.id` points to. The
// returned `id` field is not meant to be reused verbatim; callers build their insert payload by
// picking columns off this result and omitting `id`.

/** Merges a partial update onto the current active Policy, bumping version by exactly 1. */
export function buildNextPolicyVersion(current: Policy, update: PolicyUpdate): Policy {
  return { ...current, ...update, version: current.version + 1 };
}

/** Instant pause: flips instantPause on and bumps version, leaving every other field as-is. */
export function buildInstantPausePolicy(current: Policy): Policy {
  return { ...current, instantPause: true, version: current.version + 1 };
}

// --- Push payloads -----------------------------------------------------------------------

export function buildPolicyUpdatePushPayload(policy: { childId: string; version: number }): PushDispatchPayload {
  return {
    title: 'Family policy updated',
    body: "Your parent updated your device's rules.",
    data: { type: 'policy_sync', childId: policy.childId, version: String(policy.version) },
    priority: 'high',
  };
}

export function buildInstantPausePushPayload(): PushDispatchPayload {
  return {
    title: 'Devices paused',
    body: 'A parent has paused all family devices.',
    data: { type: 'instant_pause' },
    priority: 'high',
  };
}
