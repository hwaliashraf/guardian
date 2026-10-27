import type { Policy } from '../../../domain/src/types';
import type { DailyUsageState } from '../../../domain/src/buckets/types';
import {
  buildExtraTimeGrant,
  buildRequestCreatedPushPayload,
  buildScheduleChangePolicyUpdate,
  buildUnblockPolicyUpdate,
  type ExtraTimeRequestPayload,
  type ScheduleChangeRequestPayload,
  type UnblockRequestPayload,
} from '../requests';

function basePolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    id: 'policy-1',
    childId: 'child-1',
    version: 1,
    screenTime: { dailyLimitMinutes: 120, weeklyLimitMinutes: 600, perApp: {}, perCategory: {} },
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
      customBlockDomains: ['games.example.com'],
      customBlockKeywords: [],
      safeSearchEnforced: false,
      youtubeRestrictedMode: false,
    },
    appRules: { blockedApps: ['com.games.app'], allowedApps: [], blockByStoreRating: [] },
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

function dailyUsage(overrides: Partial<DailyUsageState> = {}): DailyUsageState {
  return {
    date: '2026-07-16',
    perCategoryMinutesUsed: {},
    perCategorySessionCount: {},
    totalMinutesUsed: 0,
    ...overrides,
  };
}

describe('buildRequestCreatedPushPayload', () => {
  it('builds a high-priority payload naming the request type, for every RequestType', () => {
    const base = { id: 'req-1', childId: 'child-1' } as const;
    expect(buildRequestCreatedPushPayload({ ...base, type: 'extra_time' }).body).toMatch(/extra screen time/i);
    expect(buildRequestCreatedPushPayload({ ...base, type: 'unblock' }).body).toMatch(/unblock/i);
    expect(buildRequestCreatedPushPayload({ ...base, type: 'schedule_change' }).body).toMatch(/schedule change/i);
  });

  it('carries requestId/childId/requestType in data and is high priority', () => {
    const payload = buildRequestCreatedPushPayload({ id: 'req-1', childId: 'child-1', type: 'extra_time' });
    expect(payload.priority).toBe('high');
    expect(payload.data).toEqual({
      type: 'child_request',
      requestId: 'req-1',
      childId: 'child-1',
      requestType: 'extra_time',
    });
  });
});

describe('buildExtraTimeGrant (approve extra_time)', () => {
  it('decrements the device-supplied usage snapshot by the requested minutes', () => {
    const payload: ExtraTimeRequestPayload = {
      categoryId: 'games',
      minutes: 20,
      currentDailyUsage: dailyUsage({ totalMinutesUsed: 90, perCategoryMinutesUsed: { games: 60 } }),
    };
    const updated = buildExtraTimeGrant(payload);
    expect(updated.totalMinutesUsed).toBe(70);
    expect(updated.perCategoryMinutesUsed.games).toBe(40);
  });

  it('floors at 0 rather than going negative', () => {
    const payload: ExtraTimeRequestPayload = {
      categoryId: 'games',
      minutes: 100,
      currentDailyUsage: dailyUsage({ totalMinutesUsed: 10, perCategoryMinutesUsed: { games: 10 } }),
    };
    const updated = buildExtraTimeGrant(payload);
    expect(updated.totalMinutesUsed).toBe(0);
    expect(updated.perCategoryMinutesUsed.games).toBe(0);
  });
});

describe('buildUnblockPolicyUpdate (approve unblock)', () => {
  it('scope "app": moves the target from blockedApps to allowedApps', () => {
    const payload: UnblockRequestPayload = { scope: 'app', target: 'com.games.app' };
    const update = buildUnblockPolicyUpdate(basePolicy(), payload);
    expect(update.appRules?.blockedApps).toEqual([]);
    expect(update.appRules?.allowedApps).toEqual(['com.games.app']);
    expect(update.contentFilter).toBeUndefined();
  });

  it('scope "domain": moves the target from customBlockDomains to customAllowDomains', () => {
    const payload: UnblockRequestPayload = { scope: 'domain', target: 'games.example.com' };
    const update = buildUnblockPolicyUpdate(basePolicy(), payload);
    expect(update.contentFilter?.customBlockDomains).toEqual([]);
    expect(update.contentFilter?.customAllowDomains).toEqual(['games.example.com']);
    expect(update.appRules).toBeUndefined();
  });

  it('is a no-op duplicate-safe when the target is already allowed', () => {
    const policy = basePolicy({
      appRules: { blockedApps: [], allowedApps: ['com.games.app'], blockByStoreRating: [] },
    });
    const update = buildUnblockPolicyUpdate(policy, { scope: 'app', target: 'com.games.app' });
    expect(update.appRules?.allowedApps).toEqual(['com.games.app']); // not duplicated
  });
});

describe('buildScheduleChangePolicyUpdate (approve schedule_change)', () => {
  const newSchedule = {
    id: 'sch_new1',
    type: 'homework' as const,
    daysOfWeek: [1, 2, 3, 4, 5],
    startTime: '15:00',
    endTime: '17:00',
    allowedCategories: ['education'],
  };

  it('appends a new schedule when no entry with that id exists', () => {
    const payload: ScheduleChangeRequestPayload = { schedule: newSchedule };
    const update = buildScheduleChangePolicyUpdate(basePolicy(), payload);
    expect(update.schedules).toEqual([newSchedule]);
  });

  it('replaces an existing schedule with the same id', () => {
    const original = { ...newSchedule, endTime: '16:00' };
    const policy = basePolicy({ schedules: [original] });
    const update = buildScheduleChangePolicyUpdate(policy, { schedule: newSchedule });
    expect(update.schedules).toEqual([newSchedule]);
    expect(update.schedules).toHaveLength(1);
  });

  it('leaves other schedule entries untouched', () => {
    const other = { ...newSchedule, id: 'sch_other', type: 'bedtime' as const };
    const policy = basePolicy({ schedules: [other] });
    const update = buildScheduleChangePolicyUpdate(policy, { schedule: newSchedule });
    expect(update.schedules).toEqual([other, newSchedule]);
  });
});
