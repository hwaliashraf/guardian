import type { SchedulePolicy, VacationMode } from '../types';

/**
 * Parses an "HH:mm" local time string and returns a new Date anchored to `anchor`'s
 * calendar date (year/month/day) with that hour/minute/0s/0ms, in local time — matching
 * `SchedulePolicy.startTime`/`endTime`'s "HH:mm local" contract from `packages/domain/src/
 * types.ts`.
 */
function combineDateAndTime(anchor: Date, hhmm: string): Date {
  const [hours, minutes] = hhmm.split(':').map(Number);
  const out = new Date(anchor);
  out.setHours(hours, minutes, 0, 0);
  return out;
}

/**
 * True if `at` falls within a live instance of `schedule`'s day/time window.
 *
 * Weekday/weekend (or any other) sleep-time split is modeled as two separate `bedtime`
 * `SchedulePolicy` rows with different `daysOfWeek` sets (e.g. Mon-Thu vs Fri-Sat) — there is
 * no special-cased "weekend" branch here; each policy row is evaluated independently and
 * "most restrictive wins" (see `isWithinAllowedWindow`) composes them.
 *
 * Handles windows that cross midnight (e.g. "21:00"-"07:00"): a window's start day is
 * anchored to `schedule.daysOfWeek`, and if `endTime <= startTime` the window is treated as
 * spanning into the next calendar day. Because a midnight-crossing window instance that
 * *started yesterday* can still be active right now, this checks window instances anchored to
 * both `at`'s own day and the day before it.
 */
/**
 * T21 addition: widened from module-private to exported so a caller (the child app's plain-
 * language "Bedtime starts at 9:00 PM" display, `useLocalBucketEngine`) can reuse this exact
 * midnight-crossing window check instead of re-deriving its own (and risking drift from) the
 * same date math. Behavior-preserving — only the visibility changed, body untouched.
 */
export function isActiveAt(schedule: SchedulePolicy, at: Date): boolean {
  for (const dayOffset of [0, -1]) {
    const anchor = new Date(at);
    anchor.setDate(at.getDate() + dayOffset);
    const anchorDow = anchor.getDay();
    if (!schedule.daysOfWeek.includes(anchorDow)) continue;

    const start = combineDateAndTime(anchor, schedule.startTime);
    let end = combineDateAndTime(anchor, schedule.endTime);
    if (end.getTime() <= start.getTime()) {
      // Crosses midnight: the window actually ends the following calendar day.
      end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    }

    if (at.getTime() >= start.getTime() && at.getTime() < end.getTime()) {
      return true;
    }
  }
  return false;
}

/**
 * Pure predicate: is `categoryId` allowed to be used at time `at`, given the family's
 * `schedules` and current `vacation` mode?
 *
 * Vacation mode: if `vacation.enabled` and `vacation.endDate` is either `null` (no expiry set)
 * or still in the future relative to `at`, ALL normal schedule restrictions are bypassed
 * (returns `true` unconditionally) — this is vacation mode's whole purpose. If
 * `vacation.endDate` has already passed relative to `at`, this predicate treats vacation as
 * auto-expired (behaves exactly as `enabled: false`) even though the stored flag may not yet
 * have been flipped — the caller (backend cron / T09) is responsible for eventually
 * persisting that auto-restore via `shouldAutoRestore` (see `./vacation.ts`); this pure
 * predicate must be correct regardless of whether that write has happened yet.
 *
 * Normal-schedule resolution: only `SchedulePolicy` rows whose day/time window is *active* at
 * `at` (see `isActiveAt`) matter. If no schedule window is active, nothing restricts usage and
 * the category is allowed. If one or more windows are active, "most restrictive wins": the
 * category is allowed only if EVERY active window's `allowedCategories` includes it — a single
 * active window that does not list the category is enough to disallow it, even if another
 * simultaneously-active window would have allowed it.
 */
export function isWithinAllowedWindow(
  schedules: SchedulePolicy[],
  vacation: VacationMode,
  categoryId: string,
  at: Date,
): boolean {
  if (vacation.enabled) {
    const notExpired = vacation.endDate === null || new Date(vacation.endDate).getTime() > at.getTime();
    if (notExpired) {
      return true;
    }
    // endDate has passed: fall through and evaluate as if vacation were disabled.
  }

  const activeWindows = schedules.filter((schedule) => isActiveAt(schedule, at));
  if (activeWindows.length === 0) {
    return true;
  }

  return activeWindows.every((schedule) => schedule.allowedCategories.includes(categoryId));
}
