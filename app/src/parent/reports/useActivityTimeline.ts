import { useCallback, useEffect, useState } from 'react';
import type { DeviceEvent, EventType } from '@guardian/domain';
import { supabase } from '../../supabaseClient';

// Spec §3.5's "activity timeline" scope — deliberately excludes location/geofence/presence/
// tamper/new_install event types (T17's/other screens' display territory), matching this
// ticket's Requirements #1 list exactly.
export const TIMELINE_EVENT_TYPES = ['app_usage', 'block_attempt', 'search_query', 'youtube_view'] as const;
export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];
export type TimelineFilter = TimelineEventType | 'all';

const PAGE_SIZE = 20;

interface DeviceEventRow {
  id: string;
  device_id: string;
  child_id: string;
  type: EventType;
  payload: Record<string, unknown>;
  occurred_at: string;
}

function rowToEvent(row: DeviceEventRow): DeviceEvent {
  return {
    id: row.id,
    deviceId: row.device_id,
    childId: row.child_id,
    type: row.type,
    payload: row.payload,
    occurredAt: row.occurred_at,
  };
}

interface UseActivityTimeline {
  events: DeviceEvent[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  refetch: () => Promise<void>;
}

// Chronological (newest-first), server-side filtered + offset/limit-paginated feed — no
// infinite-scroll library, per the ticket. Fetches PAGE_SIZE+1 rows per page and slices off the
// extra one, so `hasMore` is exact rather than the off-by-one-prone
// `returned.length === PAGE_SIZE` heuristic (that heuristic is wrong whenever the total count
// is an exact multiple of PAGE_SIZE).
export function useActivityTimeline(childId: string, filter: TimelineFilter, page: number): UseActivityTimeline {
  const [events, setEvents] = useState<DeviceEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const types: readonly string[] = filter === 'all' ? TIMELINE_EVENT_TYPES : [filter];
      const offset = page * PAGE_SIZE;
      const { data, error: fetchError } = await supabase
        .from('device_event')
        .select('id, device_id, child_id, type, payload, occurred_at')
        .eq('child_id', childId)
        .in('type', types)
        .order('occurred_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE)
        .returns<DeviceEventRow[]>();
      if (fetchError) throw new Error(fetchError.message);

      const rows = data ?? [];
      setHasMore(rows.length > PAGE_SIZE);
      setEvents(rows.slice(0, PAGE_SIZE).map(rowToEvent));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity timeline');
    } finally {
      setLoading(false);
    }
  }, [childId, filter, page]);

  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);

  return { events, loading, error, hasMore, refetch: fetchPage };
}
