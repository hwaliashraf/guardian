import type { Policy } from '../../../domain/src/types';
import { buildVacationRestorePushPayload, buildVacationRestoreUpdate, selectVacationsToRestore } from '../vacationCron';

function basePolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    id: 'policy-1',
    childId: 'child-1',
    version: 3,
    screenTime: { dailyLimitMinutes: 120, weeklyLimitMinutes: 600, perApp: {}, perCategory: {} },
    buckets: { perCategory: {}, default: { maxSessionMinutes: 30, mandatoryBreakMinutes: 10, graceFinishEnabled: false } },
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

const NOW = new Date('2026-07-13T00:00:00.000Z');

describe('selectVacationsToRestore', () => {
  it('selects a policy whose vacation endDate has already passed', () => {
    const expired = basePolicy({
      childId: 'child-expired',
      vacation: { enabled: true, endDate: '2026-07-01T00:00:00.000Z' },
    });
    expect(selectVacationsToRestore([expired], NOW)).toEqual([expired]);
  });

  it('does not select a policy whose vacation endDate is in the future', () => {
    const active = basePolicy({
      childId: 'child-active',
      vacation: { enabled: true, endDate: '2026-12-01T00:00:00.000Z' },
    });
    expect(selectVacationsToRestore([active], NOW)).toEqual([]);
  });

  it('does not select a policy with vacation disabled', () => {
    const disabled = basePolicy({ vacation: { enabled: false, endDate: '2026-07-01T00:00:00.000Z' } });
    expect(selectVacationsToRestore([disabled], NOW)).toEqual([]);
  });

  it('does not select a policy with a null endDate even if enabled (never auto-restores)', () => {
    const indefinite = basePolicy({ vacation: { enabled: true, endDate: null } });
    expect(selectVacationsToRestore([indefinite], NOW)).toEqual([]);
  });

  it('filters a mixed batch across multiple children to only the expired-and-enabled ones', () => {
    const expired = basePolicy({ childId: 'a', vacation: { enabled: true, endDate: '2026-07-01T00:00:00.000Z' } });
    const active = basePolicy({ childId: 'b', vacation: { enabled: true, endDate: '2026-12-01T00:00:00.000Z' } });
    const notOnVacation = basePolicy({ childId: 'c', vacation: { enabled: false, endDate: null } });
    const result = selectVacationsToRestore([expired, active, notOnVacation], NOW);
    expect(result.map((p) => p.childId)).toEqual(['a']);
  });
});

describe('buildVacationRestoreUpdate', () => {
  it('flips vacation.enabled to false and bumps version, leaving other fields untouched', () => {
    const current = basePolicy({
      version: 5,
      vacation: { enabled: true, endDate: '2026-07-01T00:00:00.000Z' },
    });
    const next = buildVacationRestoreUpdate(current);
    expect(next.vacation.enabled).toBe(false);
    expect(next.version).toBe(6);
    expect(next.buckets).toEqual(current.buckets);
    expect(next.screenTime).toEqual(current.screenTime);
  });

  it('preserves the endDate value (only enabled flips)', () => {
    const current = basePolicy({ vacation: { enabled: true, endDate: '2026-07-01T00:00:00.000Z' } });
    const next = buildVacationRestoreUpdate(current);
    expect(next.vacation.endDate).toBe('2026-07-01T00:00:00.000Z');
  });
});

describe('buildVacationRestorePushPayload', () => {
  it('builds a normal-priority vacation_restored payload carrying childId', () => {
    const payload = buildVacationRestorePushPayload('child-9');
    expect(payload.priority).toBe('normal');
    expect(payload.data).toEqual({ type: 'vacation_restored', childId: 'child-9' });
  });
});
