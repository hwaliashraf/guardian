import type { DeviceEvent } from '../../../domain/src/types';
import { buildWeeklyDigest, buildWeeklyDigestPushPayload } from '../digest';

const WEEK_START = new Date('2026-07-06T00:00:00.000Z'); // Monday
const CHILD = 'child-1';

let nextId = 1;
function event(overrides: Partial<DeviceEvent> = {}): DeviceEvent {
  return {
    id: `event-${nextId++}`,
    deviceId: 'device-1',
    childId: CHILD,
    type: 'app_usage',
    payload: {},
    occurredAt: '2026-07-07T12:00:00.000Z', // Tuesday, within the week
    ...overrides,
  };
}

describe('buildWeeklyDigest', () => {
  it('sums app_usage minutes by categoryId', () => {
    const events = [
      event({ type: 'app_usage', payload: { categoryId: 'games', minutes: 30 } }),
      event({ type: 'app_usage', payload: { categoryId: 'games', minutes: 15 } }),
      event({ type: 'app_usage', payload: { categoryId: 'social', minutes: 10 } }),
    ];
    const digest = buildWeeklyDigest(events, CHILD, WEEK_START);
    expect(digest.totalsByCategory).toEqual({ games: 45, social: 10 });
  });

  it('buckets app_usage events with no categoryId under uncategorized', () => {
    const events = [event({ type: 'app_usage', payload: { appId: 'com.example.game', minutes: 10 } })];
    const digest = buildWeeklyDigest(events, CHILD, WEEK_START);
    expect(digest.totalsByCategory).toEqual({ uncategorized: 10 });
  });

  it('counts block_attempt events and ranks top blocked domains desc by count', () => {
    const events = [
      event({ type: 'block_attempt', payload: { domain: 'a.com' } }),
      event({ type: 'block_attempt', payload: { domain: 'a.com' } }),
      event({ type: 'block_attempt', payload: { domain: 'b.com' } }),
    ];
    const digest = buildWeeklyDigest(events, CHILD, WEEK_START);
    expect(digest.blockAttemptCount).toBe(3);
    expect(digest.topBlockedDomains).toEqual([
      { domain: 'a.com', count: 2 },
      { domain: 'b.com', count: 1 },
    ]);
  });

  it('caps topBlockedDomains at 5 entries', () => {
    const events = Array.from({ length: 6 }, (_, i) =>
      event({ type: 'block_attempt', payload: { domain: `d${i}.com` } }),
    );
    const digest = buildWeeklyDigest(events, CHILD, WEEK_START);
    expect(digest.topBlockedDomains).toHaveLength(5);
    expect(digest.blockAttemptCount).toBe(6);
  });

  it('counts youtube_view events', () => {
    const events = [event({ type: 'youtube_view' }), event({ type: 'youtube_view' })];
    const digest = buildWeeklyDigest(events, CHILD, WEEK_START);
    expect(digest.youtubeViewCount).toBe(2);
  });

  it('ignores events for other children', () => {
    const events = [
      event({ childId: 'other-child', type: 'app_usage', payload: { categoryId: 'games', minutes: 100 } }),
    ];
    const digest = buildWeeklyDigest(events, CHILD, WEEK_START);
    expect(digest.totalsByCategory).toEqual({});
  });

  it('ignores events outside the [weekStart, weekStart+7d) window', () => {
    const beforeWeek = event({ occurredAt: '2026-07-05T23:59:59.000Z', type: 'youtube_view' });
    const onWeekEnd = event({ occurredAt: '2026-07-13T00:00:00.000Z', type: 'youtube_view' }); // exclusive boundary
    const justInside = event({ occurredAt: '2026-07-06T00:00:00.000Z', type: 'youtube_view' });
    const digest = buildWeeklyDigest([beforeWeek, onWeekEnd, justInside], CHILD, WEEK_START);
    expect(digest.youtubeViewCount).toBe(1);
  });

  it('ignores event types not tracked by the digest (e.g. new_install)', () => {
    const events = [event({ type: 'new_install' })];
    const digest = buildWeeklyDigest(events, CHILD, WEEK_START);
    expect(digest).toEqual({
      totalsByCategory: {},
      blockAttemptCount: 0,
      topBlockedDomains: [],
      youtubeViewCount: 0,
    });
  });

  it('returns an all-zero summary for an empty event list', () => {
    const digest = buildWeeklyDigest([], CHILD, WEEK_START);
    expect(digest).toEqual({
      totalsByCategory: {},
      blockAttemptCount: 0,
      topBlockedDomains: [],
      youtubeViewCount: 0,
    });
  });
});

describe('buildWeeklyDigestPushPayload', () => {
  it('builds a normal-priority weekly_digest payload carrying childId + ISO weekStart date', () => {
    const payload = buildWeeklyDigestPushPayload(CHILD, WEEK_START);
    expect(payload.priority).toBe('normal');
    expect(payload.data).toEqual({ type: 'weekly_digest', childId: CHILD, weekStart: '2026-07-06' });
  });
});
