// T09: pure weekly-digest math. No I/O — importable by both the Jest suite
// (packages/backend/src/__tests__/digest.test.ts) and the Deno edge function
// (packages/backend/supabase/functions/digest-cron/index.ts), same dual-runtime pattern T08
// established for policySync.ts (see that file's header comment for the full rationale).
import type { DeviceEvent } from '../../domain/src/types.ts';
import type { PushDispatchPayload } from './policySync.ts';

export interface DigestSummary {
  totalsByCategory: Record<string, number>; // categoryId -> minutes, from app_usage events
  blockAttemptCount: number;
  topBlockedDomains: { domain: string; count: number }[]; // sorted desc by count, top 5
  youtubeViewCount: number;
}

const TOP_BLOCKED_DOMAINS_LIMIT = 5;

// `DeviceEvent.payload` is untyped (Record<string, unknown> — T02). This ticket's own
// interpretation of the fields it needs (no prior ticket established a category/domain
// convention beyond scripts/smoke.ts's `{ appId, minutes }` app_usage example, which has no
// category): `app_usage` payload MAY carry `categoryId` (matching the buckets engine's
// `categoryId` convention, T03) plus a numeric `minutes`; absent categoryId buckets under
// 'uncategorized'. `block_attempt` payload carries a `domain` string.
function isWithinWeek(event: DeviceEvent, weekStart: Date, weekEnd: Date): boolean {
  const occurredAt = new Date(event.occurredAt).getTime();
  return occurredAt >= weekStart.getTime() && occurredAt < weekEnd.getTime();
}

/**
 * Computes a child's weekly activity digest from a (possibly unfiltered, multi-child,
 * multi-week) event list — filtering by childId and the [weekStart, weekStart+7d) window is
 * part of this function's own contract, so callers (the DB-querying edge function, or a test
 * fixture) don't have to pre-filter correctly themselves.
 */
export function buildWeeklyDigest(events: DeviceEvent[], childId: string, weekStart: Date): DigestSummary {
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const weekEvents = events.filter((e) => e.childId === childId && isWithinWeek(e, weekStart, weekEnd));

  const totalsByCategory: Record<string, number> = {};
  let blockAttemptCount = 0;
  let youtubeViewCount = 0;
  const blockedDomainCounts = new Map<string, number>();

  for (const event of weekEvents) {
    if (event.type === 'app_usage') {
      const categoryId = typeof event.payload.categoryId === 'string' ? event.payload.categoryId : 'uncategorized';
      const minutes = typeof event.payload.minutes === 'number' ? event.payload.minutes : 0;
      totalsByCategory[categoryId] = (totalsByCategory[categoryId] ?? 0) + minutes;
    } else if (event.type === 'block_attempt') {
      blockAttemptCount += 1;
      const domain = typeof event.payload.domain === 'string' ? event.payload.domain : null;
      if (domain) blockedDomainCounts.set(domain, (blockedDomainCounts.get(domain) ?? 0) + 1);
    } else if (event.type === 'youtube_view') {
      youtubeViewCount += 1;
    }
  }

  const topBlockedDomains = [...blockedDomainCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_BLOCKED_DOMAINS_LIMIT)
    .map(([domain, count]) => ({ domain, count }));

  return { totalsByCategory, blockAttemptCount, topBlockedDomains, youtubeViewCount };
}

export function buildWeeklyDigestPushPayload(childId: string, weekStart: Date): PushDispatchPayload {
  return {
    title: 'Weekly activity digest ready',
    body: "This week's activity summary for your child is ready to view.",
    data: { type: 'weekly_digest', childId, weekStart: weekStart.toISOString().slice(0, 10) },
    priority: 'normal',
  };
}
