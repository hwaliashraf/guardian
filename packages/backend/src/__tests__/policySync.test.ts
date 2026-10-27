import type { Policy } from '../../../domain/src/types';
import { FeatureGatedError } from '../../../domain/src/tiers/gate';
import {
  assertPolicyUpdateAllowed,
  buildInstantPausePolicy,
  buildInstantPausePushPayload,
  buildNextPolicyVersion,
  buildPolicyUpdatePushPayload,
  detectGatedFeatureTouches,
  devicesToNotify,
  type PolicyUpdate,
  type PushableDevice,
} from '../policySync';

function basePolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    id: 'policy-1',
    childId: 'child-1',
    version: 1,
    screenTime: {
      dailyLimitMinutes: 120,
      weeklyLimitMinutes: 600,
      perApp: {},
      perCategory: {},
    },
    buckets: {
      perCategory: {},
      default: { maxSessionMinutes: 30, mandatoryBreakMinutes: 10, graceFinishEnabled: false },
    },
    schedules: [],
    vacation: { enabled: false, endDate: null },
    contentFilter: {
      categories: {},
      whitelistOnly: false,
      customAllowDomains: [],
      customBlockDomains: [],
      customBlockKeywords: [],
      safeSearchEnforced: false,
      youtubeRestrictedMode: false,
    },
    appRules: { blockedApps: [], allowedApps: [], blockByStoreRating: [] },
    presence: {
      level0Enabled: false,
      level1Enabled: false,
      level2Enabled: false,
      thresholdMinutes: { level0: 5, level1: 5, level2: 5 },
      onTrigger: 'pauseTimer',
      refundAbandonedMinutes: true,
      notifyParentOnTrigger: true,
    },
    tamper: {
      alertOnUninstallAttempt: true,
      alertOnServiceDisabled: true,
      autoLockUntilRestored: false,
      pinRequired: false,
    },
    instantPause: false,
    ...overrides,
  };
}

describe('detectGatedFeatureTouches', () => {
  it('flags buckets whenever the buckets sub-policy is touched at all', () => {
    const update: PolicyUpdate = { buckets: { perCategory: {}, default: basePolicy().buckets.default } };
    expect(detectGatedFeatureTouches(update)).toEqual(['usage_buckets']);
  });

  it('flags presence_detection only when a level is being enabled', () => {
    const enabling: PolicyUpdate = { presence: { ...basePolicy().presence, level1Enabled: true } };
    expect(detectGatedFeatureTouches(enabling)).toEqual(['presence_detection']);

    const disablingOnly: PolicyUpdate = { presence: { ...basePolicy().presence } };
    expect(detectGatedFeatureTouches(disablingOnly)).toEqual([]);
  });

  it('flags per_app_limits only when screenTime.perApp is non-empty', () => {
    const configured: PolicyUpdate = { screenTime: { ...basePolicy().screenTime, perApp: { yt: 30 } } };
    expect(detectGatedFeatureTouches(configured)).toEqual(['per_app_limits']);

    const emptyPerApp: PolicyUpdate = { screenTime: { ...basePolicy().screenTime, perApp: {} } };
    expect(detectGatedFeatureTouches(emptyPerApp)).toEqual([]);
  });

  it('flags vpn_shield when safeSearchEnforced or youtubeRestrictedMode is enabled', () => {
    const safeSearch: PolicyUpdate = {
      contentFilter: { ...basePolicy().contentFilter, safeSearchEnforced: true },
    };
    expect(detectGatedFeatureTouches(safeSearch)).toEqual(['vpn_shield']);

    const youtube: PolicyUpdate = {
      contentFilter: { ...basePolicy().contentFilter, youtubeRestrictedMode: true },
    };
    expect(detectGatedFeatureTouches(youtube)).toEqual(['vpn_shield']);
  });

  it('returns [] for an ungated update (e.g. schedules only)', () => {
    const update: PolicyUpdate = { schedules: [] };
    expect(detectGatedFeatureTouches(update)).toEqual([]);
  });

  it('flags multiple gated features touched in a single update', () => {
    const update: PolicyUpdate = {
      buckets: basePolicy().buckets,
      presence: { ...basePolicy().presence, level0Enabled: true },
    };
    expect(detectGatedFeatureTouches(update)).toEqual(['usage_buckets', 'presence_detection']);
  });
});

describe('assertPolicyUpdateAllowed — gated-feature rejection', () => {
  it('rejects a standard-tier family configuring buckets, with correct required-tier info', () => {
    const update: PolicyUpdate = { buckets: basePolicy().buckets };
    expect(() => assertPolicyUpdateAllowed('standard', update)).toThrow(FeatureGatedError);
    try {
      assertPolicyUpdateAllowed('standard', update);
      throw new Error('expected assertPolicyUpdateAllowed to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(FeatureGatedError);
      const gated = err as FeatureGatedError;
      expect(gated.feature).toBe('usage_buckets');
      expect(gated.requiredTier).toBe('premium');
    }
  });

  it('rejects a free-tier family enabling presence detection', () => {
    const update: PolicyUpdate = { presence: { ...basePolicy().presence, level2Enabled: true } };
    expect(() => assertPolicyUpdateAllowed('free', update)).toThrow(FeatureGatedError);
  });

  it('rejects a standard-tier family configuring per-app limits', () => {
    const update: PolicyUpdate = { screenTime: { ...basePolicy().screenTime, perApp: { games: 15 } } };
    expect(() => assertPolicyUpdateAllowed('standard', update)).toThrow(FeatureGatedError);
  });

  it('rejects a standard-tier family enabling VPN-shield-enforced safe search', () => {
    const update: PolicyUpdate = {
      contentFilter: { ...basePolicy().contentFilter, safeSearchEnforced: true },
    };
    expect(() => assertPolicyUpdateAllowed('standard', update)).toThrow(FeatureGatedError);
  });

  it('an ungated update succeeds (does not throw) on any tier, including free', () => {
    const update: PolicyUpdate = { schedules: [] };
    expect(() => assertPolicyUpdateAllowed('free', update)).not.toThrow();
  });

  it('a premium family may touch every gated sub-policy at once', () => {
    const update: PolicyUpdate = {
      buckets: basePolicy().buckets,
      presence: { ...basePolicy().presence, level0Enabled: true },
      screenTime: { ...basePolicy().screenTime, perApp: { games: 15 } },
      contentFilter: { ...basePolicy().contentFilter, safeSearchEnforced: true },
    };
    expect(() => assertPolicyUpdateAllowed('premium', update)).not.toThrow();
  });
});

describe('buildNextPolicyVersion', () => {
  it('increments version by exactly 1 and applies the partial update', () => {
    const current = basePolicy({ version: 4 });
    const next = buildNextPolicyVersion(current, { instantPause: false, schedules: [] });
    expect(next.version).toBe(5);
    expect(next.childId).toBe(current.childId);
  });

  it('leaves untouched fields exactly as they were', () => {
    const current = basePolicy({ version: 1 });
    const next = buildNextPolicyVersion(current, { schedules: [] });
    expect(next.buckets).toEqual(current.buckets);
    expect(next.tamper).toEqual(current.tamper);
  });
});

describe('buildInstantPausePolicy', () => {
  it('sets instantPause true and bumps version, leaving all other fields untouched', () => {
    const current = basePolicy({ version: 7, instantPause: false });
    const next = buildInstantPausePolicy(current);
    expect(next.instantPause).toBe(true);
    expect(next.version).toBe(8);
    expect(next.buckets).toEqual(current.buckets);
    expect(next.screenTime).toEqual(current.screenTime);
  });
});

describe('devicesToNotify + push dispatch payload construction', () => {
  const devices: PushableDevice[] = [
    { id: 'd1', pushToken: 'token-1' },
    { id: 'd2', pushToken: null },
    { id: 'd3', pushToken: 'token-3' },
  ];

  it('every family device with a push token is selected, exactly once each', () => {
    const targets = devicesToNotify(devices);
    expect(targets.map((d) => d.id)).toEqual(['d1', 'd3']);
  });

  it('a device with no push token yet is skipped, not errored', () => {
    expect(devicesToNotify(devices).some((d) => d.id === 'd2')).toBe(false);
  });

  it('instant-pause touches every family device (across multiple children)', () => {
    const familyDevices: PushableDevice[] = [
      { id: 'child-a-device', pushToken: 't-a' },
      { id: 'child-b-device-1', pushToken: 't-b1' },
      { id: 'child-b-device-2', pushToken: 't-b2' },
    ];
    expect(devicesToNotify(familyDevices)).toHaveLength(3);
  });

  it('builds a high-priority policy_sync payload carrying childId + new version', () => {
    const payload = buildPolicyUpdatePushPayload({ childId: 'child-9', version: 3 });
    expect(payload.priority).toBe('high');
    expect(payload.data).toEqual({ type: 'policy_sync', childId: 'child-9', version: '3' });
  });

  it('builds a high-priority instant_pause payload', () => {
    const payload = buildInstantPausePushPayload();
    expect(payload.priority).toBe('high');
    expect(payload.data.type).toBe('instant_pause');
  });
});
