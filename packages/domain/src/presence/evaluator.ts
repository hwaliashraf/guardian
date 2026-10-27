import type { DeviceEvent, PresencePolicy } from '../types';
import type { PresenceDecision, PresenceSignalSample } from './types';
import { CONTENT_CATEGORIES } from '../contentCategories';

const MINUTE_MS = 60_000;

/** Minutes elapsed between two ISO timestamps, floored at 0 (never negative). */
function minutesSince(fromIso: string, toIso: string): number {
  const diffMs = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return diffMs <= 0 ? 0 : diffMs / MINUTE_MS;
}

/** Level 2 requires two consecutive `false` (no-face) entries at the end of the window. */
function isLevel2Triggered(samples: boolean[]): boolean {
  if (samples.length < 2) return false;
  return samples[samples.length - 1] === false && samples[samples.length - 2] === false;
}

/**
 * Dependency-free id generator (no `id` input is available to this pure function; avoids
 * pulling in Node's `crypto` builtin or a new uuid dependency purely for this one field).
 */
function generateEventId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Content categories where sustained no-touch input is expected/legitimate (video playback),
 * so Level 0 must additionally require the "Still watching?" prompt to time out before
 * treating idleness as abandonment. Non-video categories (e.g. games) trigger on idle alone.
 *
 * Reconciled against T15's canonical `CONTENT_CATEGORIES` list (was a 3-id local placeholder —
 * `'video'`/`'youtube'` were never real category ids, only `'video_streaming'` is): derived
 * from the real list rather than re-hardcoded, so this can never silently drift from it again.
 */
const VIDEO_LIKE_CATEGORIES = new Set(
  CONTENT_CATEGORIES.filter((c) => c.id === 'video_streaming').map((c) => c.id),
);

/**
 * T21 addition: exposes the same video-like classification `evaluatePresence` uses internally,
 * so a caller (the child app's `useLocalBucketEngine`, T21) can decide whether to show the
 * "Still watching?" prompt UI at all for the current foreground category, without re-declaring
 * a second copy of `VIDEO_LIKE_CATEGORIES` that could drift from this one (the exact class of
 * risk this file's own LEDGER entry already flags for T15's canonical category list).
 */
export function isVideoLikeCategory(categoryId: string): boolean {
  return VIDEO_LIKE_CATEGORIES.has(categoryId);
}

function thresholdFor(policy: PresencePolicy, level: 0 | 1 | 2): number {
  if (level === 0) return policy.thresholdMinutes.level0;
  if (level === 1) return policy.thresholdMinutes.level1;
  return policy.thresholdMinutes.level2;
}

/**
 * Pure presence/attention signal-ladder policy decision (spec §6). Sensors are native (T25)
 * and produce the booleans in `PresenceSignalSample` upstream; this function only decides
 * whether a trigger fires, at which level, and how many minutes to refund — no I/O, no timers.
 *
 * Deviations from the ticket's literal 3-param signature (`policy, sample, sessionStartedAt`),
 * documented per SCRATCH.md:
 * - `deviceId`/`childId` params added: the required `event` (a `DeviceEvent` reused from T02)
 *   has mandatory `id`/`childId`/`deviceId` fields that nothing else in scope supplies. Same
 *   category as T03's documented `weeklyMinutesUsed` minimal-necessary-addition.
 * - `event.id` is generated with a small dependency-free helper (see `generateEventId`).
 *
 * Level 0 trigger condition: `level0Idle && (!VIDEO_LIKE_CATEGORIES.has(foregroundAppCategory)
 * || stillPromptTimedOut)`. Idle input alone is the base rule for any watched app; the "Still
 * watching?" prompt-timeout gate only applies when the foreground app is video-like content,
 * where sustained no-touch is expected/legitimate and must not false-trigger until the prompt
 * has been shown and timed out with no response (see `VIDEO_LIKE_CATEGORIES` above).
 */
export function evaluatePresence(
  policy: PresencePolicy,
  sample: PresenceSignalSample,
  sessionStartedAt: string,
  deviceId: string,
  childId: string,
): PresenceDecision {
  let level: 0 | 1 | 2 | undefined;

  if (
    policy.level0Enabled &&
    sample.level0Idle &&
    (!VIDEO_LIKE_CATEGORIES.has(sample.foregroundAppCategory) || sample.stillPromptTimedOut)
  ) {
    level = 0;
  } else if (policy.level1Enabled && sample.level1Still) {
    level = 1;
  } else if (policy.level2Enabled && isLevel2Triggered(sample.level2FaceSamples)) {
    level = 2;
  }

  if (level === undefined) {
    return { triggered: false, minutesToRefund: 0 };
  }

  // Refund only the idle tail (time since the threshold was crossed), never the attentive time
  // leading up to it.
  const elapsedMinutes = minutesSince(sessionStartedAt, sample.now);
  const idleTailMinutes = Math.max(0, elapsedMinutes - thresholdFor(policy, level));
  const minutesToRefund = policy.refundAbandonedMinutes ? idleTailMinutes : 0;

  const event: DeviceEvent = {
    id: generateEventId(),
    deviceId,
    childId,
    type: 'presence_trigger',
    payload: { level, minutesRefunded: minutesToRefund },
    occurredAt: sample.now,
  };

  return {
    triggered: true,
    level,
    action: policy.onTrigger,
    minutesToRefund,
    event,
  };
}
