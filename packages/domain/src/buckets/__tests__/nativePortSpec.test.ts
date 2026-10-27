// T24, Requirement 2: this file is the canonical, runnable cross-check that
// `app/android/app/src/main/kotlin/com/guardian/usage/NativeBucketEngine.kt`'s restated rule
// table (see that file's own header comment, and LEDGER.md's T24 entry) did not drift from T03's
// real `BucketEngine`. It is a "doc-as-test": one `describe`/`test` per named rule, asserted
// against the REAL engine (not a re-implementation) — since the Kotlin port itself cannot be
// compiled/run in this build environment (no JVM), this is the closest available guarantee that
// the *rules* the Kotlin file claims to implement are correct; the Kotlin *implementation* of
// them remains unverified (see NativeBucketEngine.kt's own header comment).
import type { BucketPolicy, ScreenTimePolicy } from '../../types';
import { BucketEngine, GRACE_FINISH_MINUTES } from '../engine';
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
    maxSessionsPerDay: 2,
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

describe('NativeBucketEngine rule spec: total daily/weekly cap', () => {
  test('rule: startSession refuses once the daily total cap is already exhausted', () => {
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage({ totalMinutesUsed: 240 }), null, null);
    expect(engine.startSession(GAMES, T0, allowAll)).toEqual({ ok: false, reason: 'daily_limit_exhausted' });
  });

  test('rule: startSession refuses once the weekly total cap is already exhausted', () => {
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), null, null, 1200);
    expect(engine.startSession(GAMES, T0, allowAll)).toEqual({ ok: false, reason: 'weekly_limit_exhausted' });
  });

  test('rule: startSession succeeds when both totals are under cap', () => {
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), null, null, 0);
    const result = engine.startSession(GAMES, T0, allowAll);
    expect(result.ok).toBe(true);
  });
});

describe('NativeBucketEngine rule spec: max session length', () => {
  test('rule: mustEnd flips true exactly when elapsed reaches the category cap', () => {
    const session: SessionState = {
      categoryId: GAMES,
      startedAt: T0.toISOString(),
      elapsedMinutes: 0,
      graceUsed: false,
      warnings5MinFired: false,
      warnings1MinFired: false,
    };
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), session, null);
    expect(engine.tick(addMinutes(T0, 44)).mustEnd).toBe(false);
    expect(engine.tick(addMinutes(T0, 45)).mustEnd).toBe(true);
  });

  test('rule: a category override (education: 60min) applies instead of the default (45min)', () => {
    const session: SessionState = {
      categoryId: EDUCATION,
      startedAt: T0.toISOString(),
      elapsedMinutes: 0,
      graceUsed: false,
      warnings5MinFired: false,
      warnings1MinFired: false,
    };
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), session, null);
    expect(engine.tick(addMinutes(T0, 45)).mustEnd).toBe(false); // default cap would already be exceeded
    expect(engine.tick(addMinutes(T0, 60)).mustEnd).toBe(true);
  });
});

describe('NativeBucketEngine rule spec: mandatory break, short pause does not reset the clock', () => {
  test('rule: startSession refuses with mandatory_break_active while the break window has not elapsed', () => {
    const breakState: BreakState = { categoryId: GAMES, startedAt: T0.toISOString(), requiredMinutes: 15 };
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), null, breakState);
    const result = engine.startSession(GAMES, addMinutes(T0, 5), allowAll);
    expect(result).toEqual({ ok: false, reason: 'mandatory_break_active', remainingBreakMinutes: 10 });
  });

  test('rule: startSession succeeds once the full mandatory break has genuinely elapsed', () => {
    const breakState: BreakState = { categoryId: GAMES, startedAt: T0.toISOString(), requiredMinutes: 15 };
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), null, breakState);
    const result = engine.startSession(GAMES, addMinutes(T0, 15), allowAll);
    expect(result.ok).toBe(true);
  });

  test('rule: repeated early startSession attempts during a break never push back its own window', () => {
    const breakState: BreakState = { categoryId: GAMES, startedAt: T0.toISOString(), requiredMinutes: 15 };
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), null, breakState);
    // Two early attempts, 1 minute apart — the break's remainingBreakMinutes must be computed
    // from the ORIGINAL startedAt both times, not extended/reset by the attempt itself.
    const first = engine.startSession(GAMES, addMinutes(T0, 3), allowAll);
    const second = engine.startSession(GAMES, addMinutes(T0, 4), allowAll);
    expect(first).toEqual({ ok: false, reason: 'mandatory_break_active', remainingBreakMinutes: 12 });
    expect(second).toEqual({ ok: false, reason: 'mandatory_break_active', remainingBreakMinutes: 11 });
  });

  test("rule: tick()'s elapsed is continuous wall-clock time since session start, unaffected by a pause the caller never ends the session for", () => {
    const session: SessionState = {
      categoryId: GAMES,
      startedAt: T0.toISOString(),
      elapsedMinutes: 10,
      graceUsed: false,
      warnings5MinFired: false,
      warnings1MinFired: false,
    };
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), session, null);
    // A 2-minute phone-lock "pause" is simply the absence of any endSession call in between —
    // tick() still measures continuously from startedAt, so the session's clock was never reset.
    const afterPause = engine.tick(addMinutes(T0, 12));
    expect(afterPause.session.elapsedMinutes).toBe(12);
  });
});

describe('NativeBucketEngine rule spec: session count cap', () => {
  test('rule: startSession refuses with session_count_cap_reached once maxSessionsPerDay is hit', () => {
    const engine = new BucketEngine(
      policy,
      screenTime,
      freshDailyUsage({ perCategorySessionCount: { [GAMES]: 2 } }),
      null,
      null,
    );
    expect(engine.startSession(GAMES, T0, allowAll)).toEqual({ ok: false, reason: 'session_count_cap_reached' });
  });

  test('rule: a category with no maxSessionsPerDay configured is never capped by session count', () => {
    const engine = new BucketEngine(
      policy,
      screenTime,
      freshDailyUsage({ perCategorySessionCount: { [EDUCATION]: 999 } }),
      null,
      null,
    );
    expect(engine.startSession(EDUCATION, T0, allowAll).ok).toBe(true);
  });
});

describe('NativeBucketEngine rule spec: 5-min / 1-min warnings', () => {
  test('rule: fire5MinWarning fires exactly once, at [cap-5, cap)', () => {
    const session: SessionState = {
      categoryId: GAMES,
      startedAt: T0.toISOString(),
      elapsedMinutes: 0,
      graceUsed: false,
      warnings5MinFired: false,
      warnings1MinFired: false,
    };
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), session, null);
    expect(engine.tick(addMinutes(T0, 39)).fire5MinWarning).toBe(false);
    const at40 = engine.tick(addMinutes(T0, 40));
    expect(at40.fire5MinWarning).toBe(true);
    // Once already fired (warnings5MinFired true on the returned session), a second engine
    // built from that session must not re-fire it.
    const engine2 = new BucketEngine(policy, screenTime, freshDailyUsage(), at40.session, null);
    expect(engine2.tick(addMinutes(T0, 41)).fire5MinWarning).toBe(false);
  });

  test('rule: fire1MinWarning fires exactly once, at [cap-1, cap)', () => {
    const session: SessionState = {
      categoryId: GAMES,
      startedAt: T0.toISOString(),
      elapsedMinutes: 0,
      graceUsed: false,
      warnings5MinFired: true,
      warnings1MinFired: false,
    };
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), session, null);
    expect(engine.tick(addMinutes(T0, 43)).fire1MinWarning).toBe(false);
    expect(engine.tick(addMinutes(T0, 44)).fire1MinWarning).toBe(true);
  });
});

describe('NativeBucketEngine rule spec: one-time +3min grace finish', () => {
  test('rule: requestGraceFinish extends the effective cap by GRACE_FINISH_MINUTES', () => {
    const session: SessionState = {
      categoryId: GAMES,
      startedAt: T0.toISOString(),
      elapsedMinutes: 0,
      graceUsed: false,
      warnings5MinFired: false,
      warnings1MinFired: false,
    };
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), session, null);
    const grace = engine.requestGraceFinish(addMinutes(T0, 44));
    expect(grace).toEqual({ ok: true, session: { ...session, graceUsed: true } });

    const engineAfterGrace = new BucketEngine(policy, screenTime, freshDailyUsage(), grace.ok ? grace.session : session, null);
    expect(GRACE_FINISH_MINUTES).toBe(3);
    expect(engineAfterGrace.tick(addMinutes(T0, 45)).mustEnd).toBe(false); // 45 = default cap, but +3 grace now applies
    expect(engineAfterGrace.tick(addMinutes(T0, 48)).mustEnd).toBe(true);
  });

  test('rule: requestGraceFinish refuses a second time once already used', () => {
    const session: SessionState = {
      categoryId: GAMES,
      startedAt: T0.toISOString(),
      elapsedMinutes: 0,
      graceUsed: true,
      warnings5MinFired: false,
      warnings1MinFired: false,
    };
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), session, null);
    expect(engine.requestGraceFinish(T0)).toEqual({ ok: false, reason: 'grace_already_used' });
  });

  test('rule: requestGraceFinish refuses when the category has grace disabled', () => {
    const session: SessionState = {
      categoryId: EDUCATION,
      startedAt: T0.toISOString(),
      elapsedMinutes: 0,
      graceUsed: false,
      warnings5MinFired: false,
      warnings1MinFired: false,
    };
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), session, null);
    expect(engine.requestGraceFinish(T0)).toEqual({ ok: false, reason: 'grace_disabled' });
  });
});

describe('NativeBucketEngine rule spec: category overrides fall back to the policy default', () => {
  test('rule: a category with no perCategory entry uses policy.default', () => {
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), null, null);
    // 'unknown_category' has no perCategory override; default.maxSessionsPerDay is 2, so a
    // count of 2 already-run sessions must cap it exactly like GAMES (also default-configured).
    const engineCapped = new BucketEngine(
      policy,
      screenTime,
      freshDailyUsage({ perCategorySessionCount: { unknown_category: 2 } }),
      null,
      null,
    );
    expect(engine.startSession('unknown_category', T0, allowAll).ok).toBe(true);
    expect(engineCapped.startSession('unknown_category', T0, allowAll)).toEqual({
      ok: false,
      reason: 'session_count_cap_reached',
    });
  });
});

describe('NativeBucketEngine rule spec: endSession folds elapsed into daily usage and opens the break', () => {
  test('rule: endSession adds finalElapsed to total/per-category minutes, +1 session count, opens a mandatoryBreakMinutes break', () => {
    const session: SessionState = {
      categoryId: GAMES,
      startedAt: T0.toISOString(),
      elapsedMinutes: 44,
      graceUsed: false,
      warnings5MinFired: true,
      warnings1MinFired: true,
    };
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), session, null);
    const result = engine.endSession(addMinutes(T0, 45));
    expect(result.updatedDailyUsage.totalMinutesUsed).toBe(45);
    expect(result.updatedDailyUsage.perCategoryMinutesUsed[GAMES]).toBe(45);
    expect(result.updatedDailyUsage.perCategorySessionCount[GAMES]).toBe(1);
    expect(result.break).toEqual({ categoryId: GAMES, startedAt: addMinutes(T0, 45).toISOString(), requiredMinutes: 15 });
  });
});

describe('NativeBucketEngine rule spec: refundMinutes is a floor-at-0 decrement', () => {
  test('rule: refunding more than used never goes negative', () => {
    const engine = new BucketEngine(
      policy,
      screenTime,
      freshDailyUsage({ totalMinutesUsed: 5, perCategoryMinutesUsed: { [GAMES]: 5 } }),
      null,
      null,
    );
    const refunded = engine.refundMinutes(GAMES, 20, T0);
    expect(refunded.totalMinutesUsed).toBe(0);
    expect(refunded.perCategoryMinutesUsed[GAMES]).toBe(0);
  });
});
