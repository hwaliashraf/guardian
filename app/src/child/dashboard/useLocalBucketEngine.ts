import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BucketEngine,
  evaluatePresence,
  isActiveAt,
  isVideoLikeCategory,
  isWithinAllowedWindow,
  type BreakState,
  type DailyUsageState,
  type DeviceEvent,
  type Policy,
  type PresenceSignalSample,
  type RoutineType,
  type SchedulePolicy,
  type SessionState,
  type StartSessionRefusalReason,
} from '@guardian/domain';
import { SUPABASE_ANON_KEY } from '@env';
import { FUNCTIONS_URL } from '../../supabaseClient';

const TICK_INTERVAL_MS = 1000;
const STILL_WATCHING_SECONDS = 30;

/**
 * Identity fields nothing else in this ticket's literal `useLocalBucketEngine(policy,
 * initialUsage)` signature supplies but which are required to post a `DeviceEvent` (needs
 * `deviceId`/`childId`, same class of minimal-necessary-addition T04's `evaluatePresence` made)
 * and to authenticate that POST (`deviceToken` — no device-JWT persistence mechanism exists yet;
 * T11's `PairDeviceScreen` is still a stub and is out of this ticket's `app/src/child/dashboard/`
 * scope to build). Bundled as one object since the three always travel together.
 */
export interface DeviceIdentity {
  deviceId: string;
  childId: string;
  deviceToken: string;
}

const ROUTINE_LABELS: Record<RoutineType, string> = {
  homework: 'Homework time',
  bedtime: 'Bedtime',
  mealtime: 'Mealtime',
  school: 'School hours',
  custom: 'Scheduled quiet time',
};

function formatHHmm(hhmm: string): string {
  const [hours, minutes] = hhmm.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${minutes.toString().padStart(2, '0')} ${period}`;
}

function combineDateAndTimeToday(anchor: Date, hhmm: string): Date {
  const [hours, minutes] = hhmm.split(':').map(Number);
  const out = new Date(anchor);
  out.setHours(hours, minutes, 0, 0);
  return out;
}

/**
 * Plain-language description of whatever `SchedulePolicy` window is currently restricting (or
 * will next restrict) `categoryId` — e.g. "Bedtime is active until 7:00 AM" / "Bedtime starts at
 * 9:00 PM" (spec §5's literal example). Reuses T05's exported `isActiveAt` for the currently-
 * active check (its midnight-crossing handling is not re-derived here); "next starts today" is a
 * same-calendar-day comparison only, not itself midnight-crossing-sensitive.
 */
function describeScheduleWindow(schedules: SchedulePolicy[], categoryId: string, now: Date): string | null {
  const restricting = schedules.filter((schedule) => !schedule.allowedCategories.includes(categoryId));

  const active = restricting.find((schedule) => isActiveAt(schedule, now));
  if (active) {
    return `${ROUTINE_LABELS[active.type]} is active until ${formatHHmm(active.endTime)}`;
  }

  const todayDow = now.getDay();
  const upcoming = restricting
    .filter((schedule) => schedule.daysOfWeek.includes(todayDow))
    .map((schedule) => ({ schedule, start: combineDateAndTimeToday(now, schedule.startTime) }))
    .filter(({ start }) => start.getTime() > now.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  if (upcoming.length > 0) {
    const { schedule } = upcoming[0];
    return `${ROUTINE_LABELS[schedule.type]} starts at ${formatHHmm(schedule.startTime)}`;
  }

  return null;
}

interface TickState {
  dailyUsage: DailyUsageState;
  session: SessionState | null;
  breakState: BreakState | null;
  blockedReason: StartSessionRefusalReason | null;
  remainingBreakMinutes?: number;
  remainingSessionMinutes: number;
  show5MinWarning: boolean;
  show1MinWarning: boolean;
  scheduleMessage: string | null;
  stillWatchingVisible: boolean;
  stillWatchingSecondsRemaining: number;
}

export interface UseLocalBucketEngineResult {
  dailyUsage: DailyUsageState;
  remainingMinutesToday: number;
  session: SessionState | null;
  remainingSessionMinutes: number;
  blockedReason: StartSessionRefusalReason | null;
  remainingBreakMinutes?: number;
  nextBreakMinutes: number;
  show5MinWarning: boolean;
  show1MinWarning: boolean;
  scheduleMessage: string | null;
  stillWatching: { visible: boolean; secondsRemaining: number };
  respondStillWatching: () => void;
  recordActivity: () => void;
  pendingEventCount: number;
}

/**
 * JS-side ticking baseline (spec §7's offline-first requirement; the real native foreground-
 * service timer arrives in T24) wrapping T03's `BucketEngine`, T05's `isWithinAllowedWindow`, and
 * T04's `evaluatePresence` — none of their signatures are modified by this hook.
 *
 * Caller contract honored (see T21.md's "Caller contract for BucketEngine.endSession"):
 * `endSession` is invoked ONLY when a tick's `mustEnd` is `true` — never for the still-watching
 * countdown, backgrounding, or any other trivial pause, all of which just keep ticking the same
 * `SessionState` (its `elapsedMinutes` is wall-clock-since-`startedAt`, so it never needs a
 * special no-op path).
 *
 * `categoryId`/`identity` are minimal necessary additions beyond the ticket's literal 2-arg
 * signature — see this file's `DeviceIdentity` doc comment.
 *
 * Level 0 (idle) presence is approximated by `recordActivity()` (wired by the screen to root-view
 * touches) resetting a `lastActivityAt` timestamp compared against `policy.presence.
 * thresholdMinutes.level0` each tick. Level 1 (motion)/Level 2 (camera) require native sensors
 * this environment doesn't have (T25) — this hook always passes `level1Still: false` and
 * `level2FaceSamples: []`, so those levels can never spuriously trigger; T24/T25 supply the real
 * signals later.
 */
export function useLocalBucketEngine(
  policy: Policy,
  initialUsage: DailyUsageState,
  categoryId: string,
  identity: DeviceIdentity,
): UseLocalBucketEngineResult {
  const [state, setState] = useState<TickState>(() => ({
    dailyUsage: initialUsage,
    session: null,
    breakState: null,
    blockedReason: null,
    remainingBreakMinutes: undefined,
    remainingSessionMinutes: 0,
    show5MinWarning: false,
    show1MinWarning: false,
    scheduleMessage: describeScheduleWindow(policy.schedules, categoryId, new Date()),
    stillWatchingVisible: false,
    stillWatchingSecondsRemaining: STILL_WATCHING_SECONDS,
  }));

  const lastActivityAtRef = useRef<number>(Date.now());
  const stillPromptTimedOutRef = useRef(false);
  const presenceHandledRef = useRef(false);
  const eventQueueRef = useRef<DeviceEvent[]>([]);
  const [pendingEventCount, setPendingEventCount] = useState(0);
  const flushingRef = useRef(false);

  const flushEventQueue = useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    try {
      while (eventQueueRef.current.length > 0) {
        const [next, ...rest] = eventQueueRef.current;
        try {
          const res = await fetch(`${FUNCTIONS_URL}/event-ingest`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${identity.deviceToken}`,
            },
            body: JSON.stringify([next]),
          });
          if (!res.ok) throw new Error(`event-ingest returned ${res.status}`);
          eventQueueRef.current = rest;
          setPendingEventCount(eventQueueRef.current.length);
        } catch {
          // Offline or server error: leave this (and any later) event queued, retry on the next
          // flush (called again on the next tick) — simple in-memory queue-and-retry per the
          // ticket, no persistent offline-sync engine (that's T03's `reconcileOffline`, T08/T09's
          // territory, already built).
          break;
        }
      }
    } finally {
      flushingRef.current = false;
    }
  }, [identity.deviceToken]);

  const enqueueEvent = useCallback(
    (event: DeviceEvent) => {
      eventQueueRef.current = [...eventQueueRef.current, event];
      setPendingEventCount(eventQueueRef.current.length);
      void flushEventQueue();
    },
    [flushEventQueue],
  );

  const handleActivity = useCallback(() => {
    lastActivityAtRef.current = Date.now();
    stillPromptTimedOutRef.current = false;
    presenceHandledRef.current = false;
    setState((prev) =>
      prev.stillWatchingVisible
        ? { ...prev, stillWatchingVisible: false, stillWatchingSecondsRemaining: STILL_WATCHING_SECONDS }
        : prev,
    );
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      void flushEventQueue();

      setState((prev) => {
        let { dailyUsage, session, breakState, blockedReason, remainingBreakMinutes } = prev;
        let show5MinWarning = prev.show5MinWarning;
        let show1MinWarning = prev.show1MinWarning;
        let remainingSessionMinutes = prev.remainingSessionMinutes;

        const isWithinWindow = (catId: string, atTime: Date) =>
          isWithinAllowedWindow(policy.schedules, policy.vacation, catId, atTime);

        if (!session) {
          const engine = new BucketEngine(policy.buckets, policy.screenTime, dailyUsage, null, breakState);
          const result = engine.startSession(categoryId, now, isWithinWindow);
          if (result.ok) {
            session = result.session;
            blockedReason = null;
            remainingBreakMinutes = undefined;
            show5MinWarning = false;
            show1MinWarning = false;
            remainingSessionMinutes = 0;
            // A fresh session means the child just engaged — the idle clock (and any pending
            // still-watching state) restarts with it, so it tracks time-since-session-start the
            // same way evaluatePresence's own refund math does (`minutesSince(sessionStartedAt,
            // now)`), rather than drifting from whatever instant the hook happened to mount at.
            lastActivityAtRef.current = now.getTime();
            stillPromptTimedOutRef.current = false;
            presenceHandledRef.current = false;
          } else {
            blockedReason = result.reason;
            remainingBreakMinutes = result.remainingBreakMinutes;
          }
        } else {
          const engine = new BucketEngine(policy.buckets, policy.screenTime, dailyUsage, session, breakState);
          const tick = engine.tick(now);
          if (tick.mustEnd) {
            const ended = engine.endSession(now);
            dailyUsage = ended.updatedDailyUsage;
            breakState = ended.break;
            session = null;
            blockedReason = null;
            show5MinWarning = false;
            show1MinWarning = false;
            remainingSessionMinutes = 0;
          } else {
            session = tick.session;
            show5MinWarning = tick.session.warnings5MinFired;
            show1MinWarning = tick.session.warnings1MinFired;
            remainingSessionMinutes = tick.remainingMinutes;
          }
        }

        // --- Level 0 presence check (idle) — only meaningful while a session is running. ---
        let stillWatchingVisible = prev.stillWatchingVisible;
        let stillWatchingSecondsRemaining = prev.stillWatchingSecondsRemaining;

        if (session && policy.presence.level0Enabled) {
          if (stillWatchingVisible) {
            stillWatchingSecondsRemaining -= 1;
            if (stillWatchingSecondsRemaining <= 0) {
              stillWatchingVisible = false;
              stillPromptTimedOutRef.current = true;
            }
          }

          const idleMinutes = (now.getTime() - lastActivityAtRef.current) / 60_000;
          const idleThresholdCrossed = idleMinutes >= policy.presence.thresholdMinutes.level0;
          const videoLike = isVideoLikeCategory(categoryId);

          if (idleThresholdCrossed && !presenceHandledRef.current) {
            if (videoLike && !stillWatchingVisible && !stillPromptTimedOutRef.current) {
              stillWatchingVisible = true;
              stillWatchingSecondsRemaining = STILL_WATCHING_SECONDS;
            } else if (!videoLike || stillPromptTimedOutRef.current) {
              const sample: PresenceSignalSample = {
                level0Idle: true,
                stillPromptTimedOut: stillPromptTimedOutRef.current,
                level1Still: false,
                level2FaceSamples: [],
                foregroundAppCategory: categoryId,
                now: now.toISOString(),
              };
              const decision = evaluatePresence(
                policy.presence,
                sample,
                session.startedAt,
                identity.deviceId,
                identity.childId,
              );
              if (decision.triggered) {
                presenceHandledRef.current = true;
                const refundEngine = new BucketEngine(policy.buckets, policy.screenTime, dailyUsage, session, breakState);
                dailyUsage = refundEngine.refundMinutes(categoryId, decision.minutesToRefund, now);
                if (decision.event) enqueueEvent(decision.event);
              }
            }
          }
        } else {
          stillWatchingVisible = false;
          stillWatchingSecondsRemaining = STILL_WATCHING_SECONDS;
        }

        return {
          dailyUsage,
          session,
          breakState,
          blockedReason,
          remainingBreakMinutes,
          remainingSessionMinutes,
          show5MinWarning,
          show1MinWarning,
          scheduleMessage: describeScheduleWindow(policy.schedules, categoryId, now),
          stillWatchingVisible,
          stillWatchingSecondsRemaining,
        };
      });
    }, TICK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [policy, categoryId, identity.deviceId, identity.childId, enqueueEvent, flushEventQueue]);

  const nextBreakMinutes = useMemo(
    () => (policy.buckets.perCategory[categoryId] ?? policy.buckets.default).mandatoryBreakMinutes,
    [policy.buckets, categoryId],
  );

  const remainingMinutesToday = Math.max(0, policy.screenTime.dailyLimitMinutes - state.dailyUsage.totalMinutesUsed);

  return {
    dailyUsage: state.dailyUsage,
    remainingMinutesToday,
    session: state.session,
    remainingSessionMinutes: state.remainingSessionMinutes,
    blockedReason: state.blockedReason,
    remainingBreakMinutes: state.remainingBreakMinutes,
    nextBreakMinutes,
    show5MinWarning: state.show5MinWarning,
    show1MinWarning: state.show1MinWarning,
    scheduleMessage: state.scheduleMessage,
    stillWatching: { visible: state.stillWatchingVisible, secondsRemaining: state.stillWatchingSecondsRemaining },
    respondStillWatching: handleActivity,
    recordActivity: handleActivity,
    pendingEventCount,
  };
}
