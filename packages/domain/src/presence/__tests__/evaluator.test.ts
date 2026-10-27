import type { PresencePolicy } from '../../types';
import { evaluatePresence } from '../evaluator';
import type { PresenceSignalSample } from '../types';
import { CONTENT_CATEGORIES } from '../../contentCategories';

const DEVICE_ID = 'device-1';
const CHILD_ID = 'child-1';
const SESSION_STARTED_AT = '2026-07-10T10:00:00.000Z';

function freshPolicy(overrides: Partial<PresencePolicy> = {}): PresencePolicy {
  return {
    level0Enabled: true,
    level1Enabled: true,
    level2Enabled: true,
    thresholdMinutes: { level0: 5, level1: 5, level2: 5 },
    onTrigger: 'pauseTimer',
    refundAbandonedMinutes: true,
    notifyParentOnTrigger: true,
    ...overrides,
  };
}

function freshSample(overrides: Partial<PresenceSignalSample> = {}): PresenceSignalSample {
  return {
    level0Idle: false,
    stillPromptTimedOut: false,
    level1Still: false,
    level2FaceSamples: [],
    foregroundAppCategory: 'games',
    now: SESSION_STARTED_AT,
    ...overrides,
  };
}

function evaluate(policy: PresencePolicy, sample: PresenceSignalSample) {
  return evaluatePresence(policy, sample, SESSION_STARTED_AT, DEVICE_ID, CHILD_ID);
}

// Context rule -> test mapping:
// - "Level 0 ... no touch ... -> dim -> warning -> lock/pause" (base rule, any watched app) =>
//   'idle alone DOES trigger for a non-video category (games) ...'
// - "Still watching? prompt timeout counts as abandonment" (video-only gate) =>
//   'Level 0 triggers alone ...' and 'idle alone without the prompt timing out does not
//   trigger for video content ...'
// - "Level 1: accelerometer/gyroscope stillness ... implies abandonment" => 'Level 1 triggers'
// - "Level 2: two consecutive no-face boolean samples -> pause timer + lock" =>
//   'Level 2 requires two consecutive false samples' (both tests)
// - "Each level is independently toggleable" => 'disabled level never triggers'
// - "Refund: ... only the idle tail" => 'refund minutes calculation only counts idle tail'
// - "notifyParentOnTrigger real-time push on every trigger" / typed event =>
//   'emits a presence_trigger DeviceEvent ...' (asserted inline on every triggering test)
// - "lowest-numbered triggered level" => 'multiple levels triggering simultaneously'

describe('evaluatePresence — Level 0', () => {
  test('Level 0 triggers alone (others disabled) on idle + still-watching prompt timeout', () => {
    const policy = freshPolicy({ level1Enabled: false, level2Enabled: false });
    const sample = freshSample({ level0Idle: true, stillPromptTimedOut: true });

    const decision = evaluate(policy, sample);

    expect(decision.triggered).toBe(true);
    expect(decision.level).toBe(0);
    expect(decision.action).toBe('pauseTimer');
    expect(decision.event).toMatchObject({
      type: 'presence_trigger',
      deviceId: DEVICE_ID,
      childId: CHILD_ID,
      occurredAt: sample.now,
      payload: { level: 0 },
    });
  });

  test('idle alone without the prompt timing out does not trigger for video content (prompt timeout is the abandonment gate for video)', () => {
    const policy = freshPolicy({ level1Enabled: false, level2Enabled: false });
    const sample = freshSample({
      level0Idle: true,
      stillPromptTimedOut: false,
      foregroundAppCategory: 'video_streaming',
    });

    const decision = evaluate(policy, sample);

    expect(decision.triggered).toBe(false);
    expect(decision.minutesToRefund).toBe(0);
  });

  test('idle alone DOES trigger for a non-video category (games) with no prompt involved', () => {
    const policy = freshPolicy({ level1Enabled: false, level2Enabled: false });
    const sample = freshSample({
      level0Idle: true,
      stillPromptTimedOut: false,
      foregroundAppCategory: 'games',
    });

    const decision = evaluate(policy, sample);

    expect(decision.triggered).toBe(true);
    expect(decision.level).toBe(0);
    expect(decision.event).toMatchObject({ type: 'presence_trigger', payload: { level: 0 } });
  });

  // T15 reconciliation: the video-like gate id(s) used by evaluatePresence must be real
  // CONTENT_CATEGORIES entries, not the pre-T15 placeholder ('video'/'youtube' were never real
  // ids). This, combined with the 'video_streaming' test above (still correctly gated) and the
  // 'games' test above (a non-video id still triggers on idle alone), confirms the reconciled
  // id gates correctly end to end.
  test('the video-like gate id matches a real CONTENT_CATEGORIES entry (T15 reconciliation)', () => {
    expect(CONTENT_CATEGORIES.some((c) => c.id === 'video_streaming')).toBe(true);
  });

  test('disabled Level 0 never triggers even though the raw signal says idle + prompt timed out', () => {
    const policy = freshPolicy({ level0Enabled: false, level1Enabled: false, level2Enabled: false });
    const sample = freshSample({ level0Idle: true, stillPromptTimedOut: true });

    const decision = evaluate(policy, sample);

    expect(decision.triggered).toBe(false);
  });
});

describe('evaluatePresence — Level 1', () => {
  test('Level 1 triggers alone (others disabled) on device-motion stillness', () => {
    const policy = freshPolicy({ level0Enabled: false, level2Enabled: false });
    const sample = freshSample({ level1Still: true });

    const decision = evaluate(policy, sample);

    expect(decision.triggered).toBe(true);
    expect(decision.level).toBe(1);
    expect(decision.event).toMatchObject({ type: 'presence_trigger', payload: { level: 1 } });
  });

  test('disabled Level 1 never triggers even though the raw signal says still', () => {
    const policy = freshPolicy({ level0Enabled: false, level1Enabled: false, level2Enabled: false });
    const sample = freshSample({ level1Still: true });

    const decision = evaluate(policy, sample);

    expect(decision.triggered).toBe(false);
  });
});

describe('evaluatePresence — Level 2', () => {
  test('one trailing false sample alone does not trigger', () => {
    const policy = freshPolicy({ level0Enabled: false, level1Enabled: false });
    const sample = freshSample({ level2FaceSamples: [true, true, false] });

    const decision = evaluate(policy, sample);

    expect(decision.triggered).toBe(false);
  });

  test('two consecutive trailing false samples trigger Level 2', () => {
    const policy = freshPolicy({ level0Enabled: false, level1Enabled: false });
    const sample = freshSample({ level2FaceSamples: [true, false, false] });

    const decision = evaluate(policy, sample);

    expect(decision.triggered).toBe(true);
    expect(decision.level).toBe(2);
    expect(decision.event).toMatchObject({ type: 'presence_trigger', payload: { level: 2 } });
  });

  test('disabled Level 2 never triggers even though the raw signal says no face for two samples', () => {
    const policy = freshPolicy({ level0Enabled: false, level1Enabled: false, level2Enabled: false });
    const sample = freshSample({ level2FaceSamples: [false, false] });

    const decision = evaluate(policy, sample);

    expect(decision.triggered).toBe(false);
  });
});

describe('evaluatePresence — refund minutes', () => {
  test('refund only counts the idle tail (elapsed since threshold crossed), not the full session', () => {
    const policy = freshPolicy({
      level1Enabled: false,
      level2Enabled: false,
      thresholdMinutes: { level0: 5, level1: 5, level2: 5 },
    });
    // Session has been running 20 minutes total; threshold is 5 -> idle tail should be 15.
    const now = new Date(new Date(SESSION_STARTED_AT).getTime() + 20 * 60_000).toISOString();
    const sample = freshSample({ level0Idle: true, stillPromptTimedOut: true, now });

    const decision = evaluate(policy, sample);

    expect(decision.triggered).toBe(true);
    expect(decision.minutesToRefund).toBe(15);
  });

  test('refundAbandonedMinutes: false suppresses the refund even though a trigger fires', () => {
    const policy = freshPolicy({
      level1Enabled: false,
      level2Enabled: false,
      refundAbandonedMinutes: false,
    });
    const now = new Date(new Date(SESSION_STARTED_AT).getTime() + 20 * 60_000).toISOString();
    const sample = freshSample({ level0Idle: true, stillPromptTimedOut: true, now });

    const decision = evaluate(policy, sample);

    expect(decision.triggered).toBe(true);
    expect(decision.minutesToRefund).toBe(0);
  });

  test('a non-triggering sample never reports minutes to refund', () => {
    const policy = freshPolicy();
    const sample = freshSample();

    const decision = evaluate(policy, sample);

    expect(decision.triggered).toBe(false);
    expect(decision.minutesToRefund).toBe(0);
    expect(decision.event).toBeUndefined();
  });
});

describe('evaluatePresence — simultaneous triggers', () => {
  test('when multiple levels trigger at once, the lowest-numbered level wins for level/event, action is policy.onTrigger', () => {
    const policy = freshPolicy({ onTrigger: 'both' });
    const sample = freshSample({
      level0Idle: true,
      stillPromptTimedOut: true,
      level1Still: true,
      level2FaceSamples: [false, false],
    });

    const decision = evaluate(policy, sample);

    expect(decision.triggered).toBe(true);
    expect(decision.level).toBe(0);
    expect(decision.action).toBe('both');
    expect(decision.event).toMatchObject({ payload: { level: 0 } });
  });
});
