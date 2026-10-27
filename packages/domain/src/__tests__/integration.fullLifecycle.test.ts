import type { BucketPolicy, ScreenTimePolicy } from '../types';
import { BucketEngine } from '../buckets/engine';
import type { BreakState, DailyUsageState } from '../buckets/types';

// T30: end-to-end `BucketEngine` session lifecycle, built against the exact `BucketPolicy`/
// `ScreenTimePolicy` shape T13's ScreenTimeScreen.tsx and T14's BucketsScreen.tsx actually save
// (full `{default, perCategory}` object / `{dailyLimitMinutes, weeklyLimitMinutes, perApp,
// perCategory}`, not a synthetic shape) — this is the seam check the ticket's Requirement 3 asks
// for: does a policy shaped the way the real parent-facing UI produces it actually drive a full
// session through the real (unmodified) engine, start to mandatory-break-blocks-early-restart?
// `BucketEngine` is a pure, immutable-per-call class (its own doc comment: "never mutating
// `this`... construct a fresh `BucketEngine` for the next call") — this test follows that
// contract exactly, constructing a new engine instance after every state transition, the same
// way a real caller (T08's policy-sync consumer, T21's useLocalBucketEngine, T24's
// NativeBucketEngine) is required to.

const GAMES = 'games';

const policy: BucketPolicy = {
  perCategory: {},
  default: {
    maxSessionMinutes: 10,
    mandatoryBreakMinutes: 5,
    graceFinishEnabled: true,
  },
};

const screenTime: ScreenTimePolicy = {
  dailyLimitMinutes: 240,
  weeklyLimitMinutes: 1200,
  perApp: {},
  perCategory: {},
};

function freshDailyUsage(): DailyUsageState {
  return { date: '2026-07-10', perCategoryMinutesUsed: {}, perCategorySessionCount: {}, totalMinutesUsed: 0 };
}

const alwaysAllowed = () => true;
const t0 = new Date('2026-07-10T09:00:00.000Z');
const plusMinutes = (n: number) => new Date(t0.getTime() + n * 60_000);

test('full session lifecycle: start -> warnings -> grace -> end -> break -> mandatory-break-blocks-early-restart -> fresh session after break', () => {
  // 1. start
  const started = new BucketEngine(policy, screenTime, freshDailyUsage(), null, null).startSession(
    GAMES,
    t0,
    alwaysAllowed,
  );
  expect(started.ok).toBe(true);
  if (!started.ok) return;
  expect(started.session.elapsedMinutes).toBe(0);

  // 2. tick at +5min: 5-minute warning fires (cap 10, no grace yet)
  const tick5 = new BucketEngine(policy, screenTime, freshDailyUsage(), started.session, null).tick(plusMinutes(5));
  expect(tick5.fire5MinWarning).toBe(true);
  expect(tick5.fire1MinWarning).toBe(false);
  expect(tick5.mustEnd).toBe(false);

  // 3. tick at +9min: 1-minute warning fires
  const tick9 = new BucketEngine(policy, screenTime, freshDailyUsage(), tick5.session, null).tick(plusMinutes(9));
  expect(tick9.fire1MinWarning).toBe(true);
  expect(tick9.mustEnd).toBe(false);

  // 4. grace finish requested before the cap
  const grace = new BucketEngine(policy, screenTime, freshDailyUsage(), tick9.session, null).requestGraceFinish(
    plusMinutes(9),
  );
  expect(grace.ok).toBe(true);
  if (!grace.ok) return;
  expect(grace.session.graceUsed).toBe(true);

  // 5. tick at +12min: still under the grace-extended cap (10 + 3 = 13)
  const tick12 = new BucketEngine(policy, screenTime, freshDailyUsage(), grace.session, null).tick(plusMinutes(12));
  expect(tick12.mustEnd).toBe(false);
  expect(tick12.remainingMinutes).toBe(1);

  // 6. tick at +13min: grace-extended cap reached
  const tick13 = new BucketEngine(policy, screenTime, freshDailyUsage(), tick12.session, null).tick(plusMinutes(13));
  expect(tick13.mustEnd).toBe(true);

  // 7. end session at the cap
  const ended = new BucketEngine(policy, screenTime, freshDailyUsage(), tick13.session, null).endSession(
    plusMinutes(13),
  );
  expect(ended.updatedDailyUsage.totalMinutesUsed).toBe(13);
  expect(ended.updatedDailyUsage.perCategoryMinutesUsed[GAMES]).toBe(13);
  expect(ended.updatedDailyUsage.perCategorySessionCount[GAMES]).toBe(1);
  expect(ended.break).toEqual<BreakState>({
    categoryId: GAMES,
    startedAt: plusMinutes(13).toISOString(),
    requiredMinutes: 5,
  });

  // 8. attempting to start a new session 2 minutes into a 5-minute mandatory break is refused,
  // and does not reset/extend the break's own window (spec §5: "does not reset the session
  // clock, resuming early does not grant a fresh full session").
  const earlyRestart = new BucketEngine(
    policy,
    screenTime,
    ended.updatedDailyUsage,
    null,
    ended.break,
  ).startSession(GAMES, plusMinutes(15), alwaysAllowed); // 13 + 2 = 15
  expect(earlyRestart.ok).toBe(false);
  if (earlyRestart.ok) return;
  expect(earlyRestart.reason).toBe('mandatory_break_active');
  expect(earlyRestart.remainingBreakMinutes).toBeCloseTo(3, 5);

  // A second early attempt slightly later still measures against the ORIGINAL break start, not
  // a window pushed back by the first refused attempt.
  const secondEarlyRestart = new BucketEngine(
    policy,
    screenTime,
    ended.updatedDailyUsage,
    null,
    ended.break,
  ).startSession(GAMES, plusMinutes(17), alwaysAllowed); // 13 + 4 = 17, still < 13 + 5
  expect(secondEarlyRestart.ok).toBe(false);
  if (secondEarlyRestart.ok) return;
  expect(secondEarlyRestart.remainingBreakMinutes).toBeCloseTo(1, 5);

  // 9. once the full mandatory break has genuinely elapsed, a fresh session (elapsedMinutes: 0,
  // not a continuation of the old one) is granted.
  const restarted = new BucketEngine(
    policy,
    screenTime,
    ended.updatedDailyUsage,
    null,
    ended.break,
  ).startSession(GAMES, plusMinutes(18) /* 13 + 5, break exactly elapsed */, alwaysAllowed);
  expect(restarted.ok).toBe(true);
  if (!restarted.ok) return;
  expect(restarted.session.elapsedMinutes).toBe(0);
  expect(restarted.session.graceUsed).toBe(false);
});

test('daily limit exhaustion blocks a new session outright, independent of any break state', () => {
  const dailyUsage: DailyUsageState = {
    date: '2026-07-10',
    perCategoryMinutesUsed: { [GAMES]: 240 },
    perCategorySessionCount: { [GAMES]: 3 },
    totalMinutesUsed: 240,
  };
  const result = new BucketEngine(policy, screenTime, dailyUsage, null, null).startSession(GAMES, t0, alwaysAllowed);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.reason).toBe('daily_limit_exhausted');
});
