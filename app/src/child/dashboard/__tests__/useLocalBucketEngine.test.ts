import { act, renderHook } from '@testing-library/react-native';
import type { DailyUsageState, Policy } from '@guardian/domain';
import { useLocalBucketEngine, type DeviceIdentity } from '../useLocalBucketEngine';

const identity: DeviceIdentity = { deviceId: 'device-1', childId: 'child-1', deviceToken: 'token-1' };

function buildPolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    id: 'policy-1',
    childId: 'child-1',
    version: 1,
    screenTime: { dailyLimitMinutes: 500, weeklyLimitMinutes: 3000, perApp: {}, perCategory: {} },
    buckets: {
      perCategory: {
        video_streaming: { maxSessionMinutes: 60, mandatoryBreakMinutes: 15, graceFinishEnabled: false },
        gaming: { maxSessionMinutes: 10, mandatoryBreakMinutes: 5, graceFinishEnabled: false },
      },
      default: { maxSessionMinutes: 30, mandatoryBreakMinutes: 10, graceFinishEnabled: false },
    },
    schedules: [
      { id: 'sch_bedtime', type: 'bedtime', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: '21:00', endTime: '07:00', allowedCategories: [] },
    ],
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
      level0Enabled: true,
      level1Enabled: false,
      level2Enabled: false,
      thresholdMinutes: { level0: 2, level1: 5, level2: 5 },
      onTrigger: 'pauseTimer',
      refundAbandonedMinutes: true,
      notifyParentOnTrigger: true,
    },
    tamper: { alertOnUninstallAttempt: true, alertOnServiceDisabled: true, autoLockUntilRestored: false, pinRequired: false },
    instantPause: false,
    ...overrides,
  };
}

function buildUsage(overrides: Partial<DailyUsageState> = {}): DailyUsageState {
  return {
    date: '2026-01-01',
    perCategoryMinutesUsed: {},
    perCategorySessionCount: {},
    totalMinutesUsed: 0,
    ...overrides,
  };
}

describe('useLocalBucketEngine', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Local-time components (not an ISO/UTC string) — same convention T05's own tests use, so
    // this doesn't depend on the machine's timezone: 2026-01-15 12:00 local, outside the
    // fixture's 21:00-07:00 bedtime window.
    jest.setSystemTime(new Date(2026, 0, 15, 12, 0, 0));
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test('reflects a fixture policy/usage state correctly', async () => {
    const policy = buildPolicy();
    const usage = buildUsage({ totalMinutesUsed: 120, perCategoryMinutesUsed: { gaming: 120 } });
    const { result } = await renderHook(() => useLocalBucketEngine(policy, usage, 'gaming', identity));

    await act(async () => {
      jest.advanceTimersByTime(1000); // starts the session
    });
    await act(async () => {
      jest.advanceTimersByTime(1000); // one real tick() against the now-active session
    });

    expect(result.current.remainingMinutesToday).toBe(500 - 120);
    expect(result.current.session).not.toBeNull();
    expect(result.current.blockedReason).toBeNull();
    expect(result.current.remainingSessionMinutes).toBeCloseTo(10, 1); // gaming's maxSessionMinutes
    expect(result.current.nextBreakMinutes).toBe(5); // gaming's mandatoryBreakMinutes
    expect(result.current.scheduleMessage).toBe('Bedtime starts at 9:00 PM');
  });

  test('fires the 5-min and then 1-min warning banners at the right tick, then ends the session at cap', async () => {
    const policy = buildPolicy();
    const usage = buildUsage();
    const { result } = await renderHook(() => useLocalBucketEngine(policy, usage, 'gaming', identity)); // maxSessionMinutes: 10

    await act(async () => {
      jest.advanceTimersByTime(1000); // session starts
    });
    expect(result.current.show5MinWarning).toBe(false);
    expect(result.current.show1MinWarning).toBe(false);

    await act(async () => {
      jest.advanceTimersByTime(5 * 60 * 1000); // elapsed ~5 min: enters [cap-5, cap) = [5,10)
    });
    expect(result.current.show5MinWarning).toBe(true);
    expect(result.current.show1MinWarning).toBe(false);

    await act(async () => {
      jest.advanceTimersByTime(4 * 60 * 1000); // elapsed ~9 min: enters [cap-1, cap) = [9,10)
    });
    expect(result.current.show1MinWarning).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(2 * 60 * 1000); // past the 10-min cap: tick() reports mustEnd
    });
    // Caller contract: endSession only ever called when tick() reports mustEnd — verified here by
    // the session actually ending (cleared + usage folded in) exactly at the cap, never earlier.
    expect(result.current.session).toBeNull();
    expect(result.current.blockedReason).toBe('mandatory_break_active');
    expect(result.current.dailyUsage.totalMinutesUsed).toBeGreaterThanOrEqual(10);
    expect(result.current.show5MinWarning).toBe(false); // reset once the session ends
  });

  test('Still-Watching timeout triggers a presence pause+refund end-to-end through the hook (T03+T04+T05+T21)', async () => {
    const policy = buildPolicy();
    const usage = buildUsage({ totalMinutesUsed: 50, perCategoryMinutesUsed: { video_streaming: 50 } });
    const { result } = await renderHook(() => useLocalBucketEngine(policy, usage, 'video_streaming', identity));

    await act(async () => {
      jest.advanceTimersByTime(1000); // session starts
    });

    // Idle threshold (level0: 2 min) crossed with no activity — video-like category, so the
    // modal must appear rather than triggering immediately.
    await act(async () => {
      jest.advanceTimersByTime(2 * 60 * 1000);
    });
    expect(result.current.stillWatching.visible).toBe(true);
    expect(result.current.stillWatching.secondsRemaining).toBe(30);
    expect(result.current.dailyUsage.totalMinutesUsed).toBe(50); // no refund yet — just showing the prompt

    // Let the 30s countdown fully elapse with no response.
    await act(async () => {
      jest.advanceTimersByTime(30 * 1000);
    });

    expect(result.current.stillWatching.visible).toBe(false);
    // Refund = elapsedSessionMinutes - level0 threshold, at the moment the timeout fired: the
    // prompt appeared exactly at the 2-min threshold and ran a further 30s (0.5 min) with no
    // response, so elapsed-since-session-start at the trigger instant is exactly 2.5 min.
    const expectedRefund = 2.5 - 2;
    expect(result.current.dailyUsage.totalMinutesUsed).toBeCloseTo(50 - expectedRefund, 5);
    expect(result.current.dailyUsage.perCategoryMinutesUsed.video_streaming).toBeCloseTo(50 - expectedRefund, 5);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/event-ingest'),
      expect.objectContaining({ method: 'POST' }),
    );
    const [, requestInit] = (globalThis.fetch as jest.Mock).mock.calls[0];
    const postedEvents = JSON.parse(requestInit.body as string) as { type: string; childId: string; deviceId: string }[];
    expect(postedEvents).toHaveLength(1);
    expect(postedEvents[0]).toMatchObject({ type: 'presence_trigger', childId: 'child-1', deviceId: 'device-1' });
  });

  test('responding "Yes" to the Still-Watching prompt resets the idle clock and never triggers a refund', async () => {
    const policy = buildPolicy();
    const usage = buildUsage({ totalMinutesUsed: 50, perCategoryMinutesUsed: { video_streaming: 50 } });
    const { result } = await renderHook(() => useLocalBucketEngine(policy, usage, 'video_streaming', identity));

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await act(async () => {
      jest.advanceTimersByTime(2 * 60 * 1000);
    });
    expect(result.current.stillWatching.visible).toBe(true);

    await act(async () => {
      result.current.respondStillWatching();
    });
    expect(result.current.stillWatching.visible).toBe(false);

    // Advance well past the original 30s window — no trigger should ever fire since activity reset.
    await act(async () => {
      jest.advanceTimersByTime(35 * 1000);
    });
    expect(result.current.stillWatching.visible).toBe(false);
    expect(result.current.dailyUsage.totalMinutesUsed).toBe(50);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('a non-video idle category triggers presence immediately, without ever showing the modal', async () => {
    const policy = buildPolicy();
    const usage = buildUsage({ totalMinutesUsed: 50, perCategoryMinutesUsed: { gaming: 50 } });
    const { result } = await renderHook(() => useLocalBucketEngine(policy, usage, 'gaming', identity));

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await act(async () => {
      jest.advanceTimersByTime(2 * 60 * 1000); // crosses the level0 idle threshold
    });

    expect(result.current.stillWatching.visible).toBe(false); // never shown for a non-video category
    // Fires immediately at the threshold-crossing tick (tail is ~0 there, unlike the video path's
    // extra 30s countdown) — the distinguishing behavior under test is that it fires at all
    // without ever going through the modal, matching T04's reviewer-fixed video-gating rule.
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/event-ingest'),
      expect.objectContaining({ method: 'POST' }),
    );
    const [, requestInit] = (globalThis.fetch as jest.Mock).mock.calls[0];
    const postedEvents = JSON.parse(requestInit.body as string) as { type: string }[];
    expect(postedEvents[0]).toMatchObject({ type: 'presence_trigger' });
  });
});
