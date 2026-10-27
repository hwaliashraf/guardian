import type { BucketPolicy, DailyUsageState, ScreenTimePolicy, SchedulePolicy, VacationMode } from '../types';
import { BucketEngine } from '../buckets';
import { isWithinAllowedWindow } from '../schedules';

/**
 * Integration check (T05 done-when #2): T05's real `isWithinAllowedWindow(schedules,
 * vacation, categoryId, at)` is wired into T03's `BucketEngine.startSession` — which was
 * already built against an injected 2-arg `(categoryId, atTime) => boolean` predicate — via a
 * simple adapter closure that partially applies `schedules`/`vacation`. `BucketEngine` itself
 * is not modified for this ticket; only the closure at the call site adapts arities.
 */
describe('integration: BucketEngine.startSession + schedules isWithinAllowedWindow', () => {
  const policy: BucketPolicy = {
    perCategory: {},
    default: {
      maxSessionMinutes: 45,
      mandatoryBreakMinutes: 15,
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
    return {
      date: '2026-07-10',
      perCategoryMinutesUsed: {},
      perCategorySessionCount: {},
      totalMinutesUsed: 0,
    };
  }

  const homeworkWindow: SchedulePolicy = {
    id: 'homework-weekday',
    type: 'homework',
    daysOfWeek: [1, 2, 3, 4, 5],
    startTime: '15:00',
    endTime: '17:00',
    allowedCategories: ['education'],
  };
  const schedules = [homeworkWindow];
  const noVacation: VacationMode = { enabled: false, endDate: null };

  function predicateFor(vacation: VacationMode) {
    return (categoryId: string, atTime: Date): boolean =>
      isWithinAllowedWindow(schedules, vacation, categoryId, atTime);
  }

  it('refuses a session outside the allowed categories during an active schedule window', () => {
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), null, null);
    const duringHomework = new Date(2026, 6, 10, 16, 0); // Fri 16:00

    const result = engine.startSession('games', duringHomework, predicateFor(noVacation));

    expect(result).toEqual({ ok: false, reason: 'outside_allowed_window' });
  });

  it('starts a session for a category the active window allows', () => {
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), null, null);
    const duringHomework = new Date(2026, 6, 10, 16, 0);

    const result = engine.startSession('education', duringHomework, predicateFor(noVacation));

    expect(result.ok).toBe(true);
  });

  it('vacation mode lets BucketEngine start a normally-blocked category', () => {
    const engine = new BucketEngine(policy, screenTime, freshDailyUsage(), null, null);
    const duringHomework = new Date(2026, 6, 10, 16, 0);
    const vacation: VacationMode = { enabled: true, endDate: '2026-07-20T00:00:00' };

    const result = engine.startSession('games', duringHomework, predicateFor(vacation));

    expect(result.ok).toBe(true);
  });
});
