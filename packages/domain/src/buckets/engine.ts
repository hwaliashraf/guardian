// T19: `.ts`-extensioned relative imports (T08's dual-runtime pattern — see LEDGER.md T08 entry)
// so packages/backend's requests.ts can import this file directly (bypassing the domain
// barrel/zod) for both Jest and the Deno edge-function runtime.
import type { BucketCategoryConfig, BucketPolicy, ScreenTimePolicy } from '../types.ts';
import type { BreakState, DailyUsageState, SessionState } from './types.ts';

const MINUTE_MS = 60_000;

/** Minutes elapsed between an ISO timestamp and `to`, floored at 0 (never negative). */
function minutesBetween(fromIso: string, to: Date): number {
  const diffMs = to.getTime() - new Date(fromIso).getTime();
  return diffMs <= 0 ? 0 : diffMs / MINUTE_MS;
}

function resolveCategoryConfig(policy: BucketPolicy, categoryId: string): BucketCategoryConfig {
  return policy.perCategory[categoryId] ?? policy.default;
}

/** Once-per-session grace finish extension (spec §5). */
export const GRACE_FINISH_MINUTES = 3;

export type StartSessionRefusalReason =
  | 'daily_limit_exhausted'
  | 'weekly_limit_exhausted'
  | 'session_count_cap_reached'
  | 'mandatory_break_active'
  | 'outside_allowed_window';

export type StartSessionResult =
  | { ok: true; session: SessionState }
  | { ok: false; reason: StartSessionRefusalReason; remainingBreakMinutes?: number };

export interface TickResult {
  session: SessionState;
  fire5MinWarning: boolean;
  fire1MinWarning: boolean;
  mustEnd: boolean;
  remainingMinutes: number;
}

export type GraceFinishRefusalReason = 'no_active_session' | 'grace_disabled' | 'grace_already_used';

export type GraceFinishResult =
  | { ok: true; session: SessionState }
  | { ok: false; reason: GraceFinishRefusalReason };

export interface EndSessionResult {
  updatedDailyUsage: DailyUsageState;
  break: BreakState;
}

/**
 * Pure Usage Buckets engine (spec §5). Every method is a pure transform: it reads the state
 * given to the constructor and returns new state / a result, never mutating `this`. Callers
 * (T04/T08) are responsible for persisting the returned state and constructing a fresh
 * `BucketEngine` for the next call.
 *
 * Design note on the mandatory-break rule ("a break shorter than the mandatory duration does
 * not reset the session clock, resuming early does not grant a fresh full session"): this is
 * implemented by making `startSession`'s break-active refusal a pure read of the *original*
 * `BreakState.startedAt` + `requiredMinutes` — repeated early `startSession` attempts during
 * the break never push back or extend that window, so the break's own clock cannot be reset by
 * spamming attempts, and no fresh session is ever granted until the full required break has
 * genuinely elapsed since the original session ended.
 */
export class BucketEngine {
  constructor(
    private readonly policy: BucketPolicy,
    private readonly screenTime: ScreenTimePolicy,
    private readonly dailyUsage: DailyUsageState,
    private readonly session: SessionState | null,
    private readonly breakState: BreakState | null,
    /**
     * Minutes already used this week across all categories. `DailyUsageState` (per this
     * ticket's scope) only tracks a single day, so weekly-limit enforcement (spec §5) needs
     * this additional rolling total from the caller (e.g. summed across the week's persisted
     * `DailyUsageState` rows by the backend) rather than a new persisted weekly-state shape
     * invented here. Defaults to 0 (no weekly usage yet) when not supplied.
     */
    private readonly weeklyMinutesUsed: number = 0,
  ) {}

  startSession(
    categoryId: string,
    now: Date,
    isWithinAllowedWindow: (categoryId: string, atTime: Date) => boolean,
  ): StartSessionResult {
    const config = resolveCategoryConfig(this.policy, categoryId);

    if (this.dailyUsage.totalMinutesUsed >= this.screenTime.dailyLimitMinutes) {
      return { ok: false, reason: 'daily_limit_exhausted' };
    }
    if (this.weeklyMinutesUsed >= this.screenTime.weeklyLimitMinutes) {
      return { ok: false, reason: 'weekly_limit_exhausted' };
    }
    if (
      config.maxSessionsPerDay !== undefined &&
      (this.dailyUsage.perCategorySessionCount[categoryId] ?? 0) >= config.maxSessionsPerDay
    ) {
      return { ok: false, reason: 'session_count_cap_reached' };
    }
    if (this.breakState && this.breakState.categoryId === categoryId) {
      const remaining = this.breakState.requiredMinutes - minutesBetween(this.breakState.startedAt, now);
      if (remaining > 0) {
        return { ok: false, reason: 'mandatory_break_active', remainingBreakMinutes: remaining };
      }
    }
    if (!isWithinAllowedWindow(categoryId, now)) {
      return { ok: false, reason: 'outside_allowed_window' };
    }

    return {
      ok: true,
      session: {
        categoryId,
        startedAt: now.toISOString(),
        elapsedMinutes: 0,
        graceUsed: false,
        warnings5MinFired: false,
        warnings1MinFired: false,
      },
    };
  }

  tick(now: Date): TickResult {
    if (!this.session) {
      throw new Error('BucketEngine.tick: no active session');
    }
    const config = resolveCategoryConfig(this.policy, this.session.categoryId);
    const effectiveCap = config.maxSessionMinutes + (this.session.graceUsed ? GRACE_FINISH_MINUTES : 0);
    const elapsed = minutesBetween(this.session.startedAt, now);

    const fire5MinWarning =
      !this.session.warnings5MinFired && elapsed >= effectiveCap - 5 && elapsed < effectiveCap;
    const fire1MinWarning =
      !this.session.warnings1MinFired && elapsed >= effectiveCap - 1 && elapsed < effectiveCap;
    const mustEnd = elapsed >= effectiveCap;

    return {
      session: {
        ...this.session,
        elapsedMinutes: elapsed,
        warnings5MinFired: this.session.warnings5MinFired || fire5MinWarning,
        warnings1MinFired: this.session.warnings1MinFired || fire1MinWarning,
      },
      fire5MinWarning,
      fire1MinWarning,
      mustEnd,
      remainingMinutes: Math.max(0, effectiveCap - elapsed),
    };
  }

  requestGraceFinish(now: Date): GraceFinishResult {
    void now; // accepted for interface symmetry with the other time-taking engine methods
    if (!this.session) {
      return { ok: false, reason: 'no_active_session' };
    }
    const config = resolveCategoryConfig(this.policy, this.session.categoryId);
    if (!config.graceFinishEnabled) {
      return { ok: false, reason: 'grace_disabled' };
    }
    if (this.session.graceUsed) {
      return { ok: false, reason: 'grace_already_used' };
    }
    return { ok: true, session: { ...this.session, graceUsed: true } };
  }

  endSession(now: Date): EndSessionResult {
    if (!this.session) {
      throw new Error('BucketEngine.endSession: no active session');
    }
    const config = resolveCategoryConfig(this.policy, this.session.categoryId);
    const categoryId = this.session.categoryId;
    const finalElapsed = Math.max(this.session.elapsedMinutes, minutesBetween(this.session.startedAt, now));

    const updatedDailyUsage: DailyUsageState = {
      ...this.dailyUsage,
      totalMinutesUsed: this.dailyUsage.totalMinutesUsed + finalElapsed,
      perCategoryMinutesUsed: {
        ...this.dailyUsage.perCategoryMinutesUsed,
        [categoryId]: (this.dailyUsage.perCategoryMinutesUsed[categoryId] ?? 0) + finalElapsed,
      },
      perCategorySessionCount: {
        ...this.dailyUsage.perCategorySessionCount,
        [categoryId]: (this.dailyUsage.perCategorySessionCount[categoryId] ?? 0) + 1,
      },
    };

    return {
      updatedDailyUsage,
      break: {
        categoryId,
        startedAt: now.toISOString(),
        requiredMinutes: config.mandatoryBreakMinutes,
      },
    };
  }

  /**
   * Mechanical refund primitive (spec §6 presence-detection refund); policy decision is T04's.
   * `now` is accepted for interface symmetry with the other engine methods / future audit
   * trail use (e.g. rejecting a refund against a stale date); the floor-at-0 decrement itself
   * doesn't need it today.
   */
  refundMinutes(categoryId: string, minutes: number, now: Date): DailyUsageState {
    void now;
    const currentCategoryMinutes = this.dailyUsage.perCategoryMinutesUsed[categoryId] ?? 0;
    return {
      ...this.dailyUsage,
      totalMinutesUsed: Math.max(0, this.dailyUsage.totalMinutesUsed - minutes),
      perCategoryMinutesUsed: {
        ...this.dailyUsage.perCategoryMinutesUsed,
        [categoryId]: Math.max(0, currentCategoryMinutes - minutes),
      },
    };
  }

  /**
   * Merges two `DailyUsageState`s for the same child/date after an offline period (spec §5,
   * multi-device). Conservative merge strategy (design choice, documented per the ticket):
   * without per-event timestamps neither snapshot can tell how much of the other's usage
   * genuinely overlapped in wall-clock time, so we additively sum both sides rather than take
   * max() — additive is the conservative direction for a *parental control* product, since it
   * assumes MORE usage happened, never less, and can therefore never grant back time beyond
   * what was actually used or double-subtract remaining time below zero. The one clamp applied
   * is the overall daily ceiling (`ScreenTimePolicy.dailyLimitMinutes`).
   *
   * Invariant: `sum(perCategoryMinutesUsed) === totalMinutesUsed` must hold on the returned
   * state, matching every other method on this class. To preserve that invariant under
   * clamping, the total and each category's summed minutes are NOT capped independently
   * (that can inflate the per-category sum far past the clamped total — see reviewer finding
   * on this ticket). Instead: compute the additive total and additive per-category sums
   * uncapped first; if the additive total exceeds `dailyLimitMinutes`, scale every category's
   * summed minutes down by the same factor (`dailyLimitMinutes / additiveTotal`) so the
   * post-clamp per-category sum exactly equals the clamped total.
   */
  reconcileOffline(localSnapshot: DailyUsageState, remoteSnapshot: DailyUsageState): DailyUsageState {
    if (localSnapshot.date !== remoteSnapshot.date) {
      throw new Error(
        `BucketEngine.reconcileOffline: snapshot date mismatch (${localSnapshot.date} vs ${remoteSnapshot.date})`,
      );
    }
    const dailyLimit = this.screenTime.dailyLimitMinutes;

    const categoryIds = new Set([
      ...Object.keys(localSnapshot.perCategoryMinutesUsed),
      ...Object.keys(remoteSnapshot.perCategoryMinutesUsed),
    ]);
    const summedPerCategoryMinutesUsed: Record<string, number> = {};
    for (const categoryId of categoryIds) {
      summedPerCategoryMinutesUsed[categoryId] =
        (localSnapshot.perCategoryMinutesUsed[categoryId] ?? 0) +
        (remoteSnapshot.perCategoryMinutesUsed[categoryId] ?? 0);
    }

    const additiveTotal = localSnapshot.totalMinutesUsed + remoteSnapshot.totalMinutesUsed;
    const totalMinutesUsed = Math.min(additiveTotal, dailyLimit);
    // Uniform scale-down factor so sum(perCategoryMinutesUsed) === totalMinutesUsed after
    // clamping; 1 (no-op) when the additive total is already within the daily limit.
    const scale = additiveTotal > dailyLimit ? dailyLimit / additiveTotal : 1;
    const perCategoryMinutesUsed: Record<string, number> = {};
    for (const categoryId of categoryIds) {
      perCategoryMinutesUsed[categoryId] = summedPerCategoryMinutesUsed[categoryId] * scale;
    }

    const sessionCountIds = new Set([
      ...Object.keys(localSnapshot.perCategorySessionCount),
      ...Object.keys(remoteSnapshot.perCategorySessionCount),
    ]);
    const perCategorySessionCount: Record<string, number> = {};
    for (const categoryId of sessionCountIds) {
      perCategorySessionCount[categoryId] =
        (localSnapshot.perCategorySessionCount[categoryId] ?? 0) +
        (remoteSnapshot.perCategorySessionCount[categoryId] ?? 0);
    }

    return {
      date: localSnapshot.date,
      perCategoryMinutesUsed,
      perCategorySessionCount,
      totalMinutesUsed,
    };
  }
}

/**
 * T19 addition: a parent-approved "extra time" `ChildRequest` grants `minutes` back to
 * `categoryId` for the given day. Free function (not a `BucketEngine` method) since the caller
 * (packages/backend's requests edge function) has no other reason to construct a full engine
 * instance — same floor-at-0 decrement shape as `BucketEngine.refundMinutes`, applied to both
 * the category and the running total.
 */
export function applyApprovedExtraTime(
  dailyUsage: DailyUsageState,
  categoryId: string,
  minutes: number,
): DailyUsageState {
  const currentCategoryMinutes = dailyUsage.perCategoryMinutesUsed[categoryId] ?? 0;
  return {
    ...dailyUsage,
    totalMinutesUsed: Math.max(0, dailyUsage.totalMinutesUsed - minutes),
    perCategoryMinutesUsed: {
      ...dailyUsage.perCategoryMinutesUsed,
      [categoryId]: Math.max(0, currentCategoryMinutes - minutes),
    },
  };
}
