import type { BucketPolicy, ScreenTimePolicy } from '../../types';
import { applyApprovedExtraTime, BucketEngine } from '../engine';
import type { BreakState, DailyUsageState, SessionState } from '../types';

const GAMES = 'games';
const EDUCATION = 'education';

const policy: BucketPolicy = {
  perCategory: {
    [EDUCATION]: {
      maxSessionMinutes: 60,
      mandatoryBreakMinutes: 5,
      graceFinishEnabled: false,
    },
  },
  default: {
    maxSessionMinutes: 45,
    mandatoryBreakMinutes: 15,
    maxSessionsPerDay: 5,
    graceFinishEnabled: true,
  },
};

const screenTime: ScreenTimePolicy = {
  dailyLimitMinutes: 240,
  weeklyLimitMinutes: 1200,
  perApp: {},
  perCategory: {},
};

function freshDailyUsage(overrides: Partial<DailyUsageState> = {}): DailyUsageState {
  return {
    date: '2026-07-10',
    perCategoryMinutesUsed: {},
    perCategorySessionCount: {},
    totalMinutesUsed: 0,
    ...overrides,
  };
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

const T0 = new Date('2026-07-10T10:00:00.000Z');
const allowAll = () => true;

describe('BucketEngine.startSession — daily/weekly total exhausted', () => {
  test('daily total already exhausted refuses with daily_limit_exhausted', () => {
    const engine = new BucketEngine(
      policy,
      screenTime,
      freshDailyUsage({ totalMinutesUsed: 240 }),
      null,
      null,
    );
    const result = engine.startSession(GAMES, T0, allowAll);
    expect(result).toEqual({ ok: false, reason: 'daily_limit_exhausted' });
  });

  test('weekly total already exhausted refuses with weekly_limit_exhausted', () => {
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), null, null, 1200);
    const result = engine.startSession(GAMES, T0, allowAll);
    expect(result).toEqual({ ok: false, reason: 'weekly_limit_exhausted' });
  });
});

describe('BucketEngine.tick — max session length cap', () => {
  test('mustEnd is false before the cap and true once elapsed reaches it', () => {
    const session: SessionState = {
      categoryId: GAMES,
      startedAt: T0.toISOString(),
      elapsedMinutes: 0,
      graceUsed: false,
      warnings5MinFired: false,
      warnings1MinFired: false,
    };
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), session, null);

    const beforeCap = engine.tick(addMinutes(T0, 44));
    expect(beforeCap.mustEnd).toBe(false);
    expect(beforeCap.remainingMinutes).toBeCloseTo(1);

    const atCap = engine.tick(addMinutes(T0, 45));
    expect(atCap.mustEnd).toBe(true);
    expect(atCap.remainingMinutes).toBe(0);
  });
});

describe('BucketEngine.tick — 5-minute and 1-minute warnings', () => {
  test('fires the 5-min warning once, then the 1-min warning, and never re-fires 5-min after it has fired', () => {
    const session: SessionState = {
      categoryId: GAMES,
      startedAt: T0.toISOString(),
      elapsedMinutes: 0,
      graceUsed: false,
      warnings5MinFired: false,
      warnings1MinFired: false,
    };
    const engine1 = new BucketEngine(policy, screenTime, freshDailyUsage(), session, null);
    const at40 = engine1.tick(addMinutes(T0, 40)); // cap 45, 5 min remaining
    expect(at40.fire5MinWarning).toBe(true);
    expect(at40.fire1MinWarning).toBe(false);
    expect(at40.session.warnings5MinFired).toBe(true);

    const engine2 = new BucketEngine(policy, screenTime, freshDailyUsage(), at40.session, null);
    const at44 = engine2.tick(addMinutes(T0, 44)); // 1 min remaining
    expect(at44.fire5MinWarning).toBe(false); // already fired, must not re-fire
    expect(at44.fire1MinWarning).toBe(true);
  });
});

describe('BucketEngine — mandatory break rule', () => {
  test('startSession refuses while the mandatory break is still active', () => {
    const breakState: BreakState = { categoryId: GAMES, startedAt: T0.toISOString(), requiredMinutes: 15 };
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), null, breakState);
    const result = engine.startSession(GAMES, addMinutes(T0, 5), allowAll);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('mandatory_break_active');
      expect(result.remainingBreakMinutes).toBeCloseTo(10);
    }
  });

  test('a short (still-active) break does not reset the break clock: repeated early attempts read the same original window, and a fresh session is granted only once the full break has genuinely elapsed', () => {
    const breakState: BreakState = { categoryId: GAMES, startedAt: T0.toISOString(), requiredMinutes: 15 };

    // Two separate early attempts against the *same original* breakState.startedAt — neither
    // attempt pushes back or extends the window; remaining time shrinks purely with real time.
    const engineAt5 = new BucketEngine(policy, screenTime, freshDailyUsage(), null, breakState);
    const attempt1 = engineAt5.startSession(GAMES, addMinutes(T0, 5), allowAll);
    expect(attempt1).toEqual({ ok: false, reason: 'mandatory_break_active', remainingBreakMinutes: 10 });

    const engineAt10 = new BucketEngine(policy, screenTime, freshDailyUsage(), null, breakState);
    const attempt2 = engineAt10.startSession(GAMES, addMinutes(T0, 10), allowAll);
    expect(attempt2).toEqual({ ok: false, reason: 'mandatory_break_active', remainingBreakMinutes: 5 });

    // Only once the full 15 minutes have elapsed does startSession grant a session, and it is a
    // fresh one (elapsedMinutes 0), never carrying over any prior partial-attempt state.
    const engineAt15 = new BucketEngine(policy, screenTime, freshDailyUsage(), null, breakState);
    const resumed = engineAt15.startSession(GAMES, addMinutes(T0, 15), allowAll);
    expect(resumed.ok).toBe(true);
    if (resumed.ok) {
      expect(resumed.session.elapsedMinutes).toBe(0);
    }
  });
});

describe('BucketEngine.startSession — session count cap', () => {
  test('refuses with session_count_cap_reached once maxSessionsPerDay is reached', () => {
    const engine = new BucketEngine(
      policy,
      screenTime,
      freshDailyUsage({ perCategorySessionCount: { [GAMES]: 5 } }),
      null,
      null,
    );
    const result = engine.startSession(GAMES, T0, allowAll);
    expect(result).toEqual({ ok: false, reason: 'session_count_cap_reached' });
  });

  test('does not refuse when under the cap', () => {
    const engine = new BucketEngine(
      policy,
      screenTime,
      freshDailyUsage({ perCategorySessionCount: { [GAMES]: 4 } }),
      null,
      null,
    );
    expect(engine.startSession(GAMES, T0, allowAll).ok).toBe(true);
  });
});

describe('BucketEngine.startSession — schedule predicate', () => {
  test('refuses with outside_allowed_window when the injected predicate returns false', () => {
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), null, null);
    const result = engine.startSession(GAMES, T0, () => false);
    expect(result).toEqual({ ok: false, reason: 'outside_allowed_window' });
  });
});

describe('BucketEngine — category override vs default', () => {
  test('a category with an explicit BucketPolicy.perCategory override uses its own maxSessionMinutes, not the default', () => {
    const session: SessionState = {
      categoryId: EDUCATION,
      startedAt: T0.toISOString(),
      elapsedMinutes: 0,
      graceUsed: false,
      warnings5MinFired: false,
      warnings1MinFired: false,
    };
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), session, null);
    // education override caps at 60 min, so 50 min elapsed must not yet signal mustEnd
    const result = engine.tick(addMinutes(T0, 50));
    expect(result.mustEnd).toBe(false);
    expect(result.remainingMinutes).toBeCloseTo(10);
  });

  test('a category with no override falls back to BucketPolicy.default', () => {
    const session: SessionState = {
      categoryId: GAMES,
      startedAt: T0.toISOString(),
      elapsedMinutes: 0,
      graceUsed: false,
      warnings5MinFired: false,
      warnings1MinFired: false,
    };
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), session, null);
    // default caps at 45 min, so 50 min elapsed must already signal mustEnd
    const result = engine.tick(addMinutes(T0, 50));
    expect(result.mustEnd).toBe(true);
  });
});

describe('BucketEngine.requestGraceFinish — grace finish usable once only', () => {
  const session: SessionState = {
    categoryId: GAMES,
    startedAt: T0.toISOString(),
    elapsedMinutes: 0,
    graceUsed: false,
    warnings5MinFired: false,
    warnings1MinFired: false,
  };

  test('grants +3 minutes (via effective cap) the first time', () => {
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), session, null);
    const result = engine.requestGraceFinish(T0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.graceUsed).toBe(true);
      const tickEngine = new BucketEngine(policy, screenTime, freshDailyUsage(), result.session, null);
      const tickResult = tickEngine.tick(addMinutes(T0, 47)); // 45 base + 3 grace = 48 cap
      expect(tickResult.mustEnd).toBe(false);
    }
  });

  test('refuses grace_already_used on a second request within the same session', () => {
    const graceUsedSession: SessionState = { ...session, graceUsed: true };
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), graceUsedSession, null);
    expect(engine.requestGraceFinish(T0)).toEqual({ ok: false, reason: 'grace_already_used' });
  });

  test('refuses grace_disabled when the category config has graceFinishEnabled: false', () => {
    const educationSession: SessionState = { ...session, categoryId: EDUCATION };
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), educationSession, null);
    expect(engine.requestGraceFinish(T0)).toEqual({ ok: false, reason: 'grace_disabled' });
  });

  test('refuses no_active_session when there is no current session', () => {
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), null, null);
    expect(engine.requestGraceFinish(T0)).toEqual({ ok: false, reason: 'no_active_session' });
  });
});

describe('BucketEngine.endSession', () => {
  test('adds elapsed minutes to daily usage, increments the session count, and opens a mandatory break', () => {
    const session: SessionState = {
      categoryId: GAMES,
      startedAt: T0.toISOString(),
      elapsedMinutes: 30,
      graceUsed: false,
      warnings5MinFired: false,
      warnings1MinFired: false,
    };
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), session, null);
    const now = addMinutes(T0, 30);
    const { updatedDailyUsage, break: brk } = engine.endSession(now);

    expect(updatedDailyUsage.totalMinutesUsed).toBeCloseTo(30);
    expect(updatedDailyUsage.perCategoryMinutesUsed[GAMES]).toBeCloseTo(30);
    expect(updatedDailyUsage.perCategorySessionCount[GAMES]).toBe(1);
    expect(brk).toEqual({ categoryId: GAMES, startedAt: now.toISOString(), requiredMinutes: 15 });
  });
});

describe('BucketEngine.refundMinutes', () => {
  test('decrements total and per-category minutes, floored at 0', () => {
    const engine = new BucketEngine(
      policy,
      screenTime,
      freshDailyUsage({ totalMinutesUsed: 10, perCategoryMinutesUsed: { [GAMES]: 10 } }),
      null,
      null,
    );
    const updated = engine.refundMinutes(GAMES, 15, T0);
    expect(updated.totalMinutesUsed).toBe(0);
    expect(updated.perCategoryMinutesUsed[GAMES]).toBe(0);
  });
});

describe('applyApprovedExtraTime (T19)', () => {
  test('decrements total and per-category minutes for the granted category, floored at 0', () => {
    const usage = freshDailyUsage({
      totalMinutesUsed: 100,
      perCategoryMinutesUsed: { [GAMES]: 40, [EDUCATION]: 60 },
    });
    const updated = applyApprovedExtraTime(usage, GAMES, 15);
    expect(updated.totalMinutesUsed).toBe(85);
    expect(updated.perCategoryMinutesUsed[GAMES]).toBe(25);
    expect(updated.perCategoryMinutesUsed[EDUCATION]).toBe(60); // other categories untouched
  });

  test('floors at 0 instead of going negative when granted minutes exceed usage', () => {
    const usage = freshDailyUsage({ totalMinutesUsed: 10, perCategoryMinutesUsed: { [GAMES]: 10 } });
    const updated = applyApprovedExtraTime(usage, GAMES, 30);
    expect(updated.totalMinutesUsed).toBe(0);
    expect(updated.perCategoryMinutesUsed[GAMES]).toBe(0);
  });

  test('does not mutate the input DailyUsageState', () => {
    const usage = freshDailyUsage({ totalMinutesUsed: 20, perCategoryMinutesUsed: { [GAMES]: 20 } });
    applyApprovedExtraTime(usage, GAMES, 5);
    expect(usage.totalMinutesUsed).toBe(20);
    expect(usage.perCategoryMinutesUsed[GAMES]).toBe(20);
  });
});

describe('BucketEngine.reconcileOffline — multi-device merge', () => {
  test('additively merges non-overlapping usage without hitting the cap', () => {
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), null, null);
    const local = freshDailyUsage({ totalMinutesUsed: 50, perCategoryMinutesUsed: { [GAMES]: 50 } });
    const remote = freshDailyUsage({ totalMinutesUsed: 30, perCategoryMinutesUsed: { [GAMES]: 30 } });
    const merged = engine.reconcileOffline(local, remote);
    expect(merged.totalMinutesUsed).toBe(80);
    expect(merged.perCategoryMinutesUsed[GAMES]).toBe(80);
  });

  test('never exceeds ScreenTimePolicy.dailyLimitMinutes and never double-counts beyond it', () => {
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), null, null);
    const local = freshDailyUsage({ totalMinutesUsed: 200, perCategoryMinutesUsed: { [GAMES]: 200 } });
    const remote = freshDailyUsage({ totalMinutesUsed: 100, perCategoryMinutesUsed: { [GAMES]: 100 } });
    const merged = engine.reconcileOffline(local, remote);
    // raw sum (300) exceeds dailyLimitMinutes (240); must be capped, never reported above it
    expect(merged.totalMinutesUsed).toBe(240);
    expect(merged.perCategoryMinutesUsed[GAMES]).toBe(240);
  });

  test('merged total is never less than the greater of the two inputs (never grants time back)', () => {
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), null, null);
    const local = freshDailyUsage({ totalMinutesUsed: 220 });
    const remote = freshDailyUsage({ totalMinutesUsed: 10 });
    const merged = engine.reconcileOffline(local, remote);
    expect(merged.totalMinutesUsed).toBeGreaterThanOrEqual(Math.max(local.totalMinutesUsed, remote.totalMinutesUsed));
  });

  test('multi-category merge stays internally consistent: sum(perCategoryMinutesUsed) === totalMinutesUsed even when clamped', () => {
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), null, null);
    const local = freshDailyUsage({
      totalMinutesUsed: 200,
      perCategoryMinutesUsed: { [GAMES]: 100, [EDUCATION]: 100 },
    });
    const remote = freshDailyUsage({
      totalMinutesUsed: 200,
      perCategoryMinutesUsed: { [GAMES]: 100, [EDUCATION]: 100 },
    });
    const merged = engine.reconcileOffline(local, remote);
    // raw additive total (400) exceeds dailyLimitMinutes (240); both categories must be
    // scaled down by the same factor rather than clamped independently, so the merged
    // per-category figures still sum to exactly the merged (clamped) total.
    expect(merged.totalMinutesUsed).toBe(240);
    expect(merged.perCategoryMinutesUsed[GAMES] + merged.perCategoryMinutesUsed[EDUCATION]).toBeCloseTo(
      merged.totalMinutesUsed,
    );
    expect(merged.perCategoryMinutesUsed[GAMES]).toBeCloseTo(120);
    expect(merged.perCategoryMinutesUsed[EDUCATION]).toBeCloseTo(120);
  });

  test('throws on mismatched dates (trust-boundary validation)', () => {
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), null, null);
    const local = freshDailyUsage({ date: '2026-07-10' });
    const remote = freshDailyUsage({ date: '2026-07-11' });
    expect(() => engine.reconcileOffline(local, remote)).toThrow(/date mismatch/);
  });
});
