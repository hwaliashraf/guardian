import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';

export interface ChildLocation {
  lat: number;
  lng: number;
  occurredAt: string;
}

interface LocationEventRow {
  child_id: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}

interface UseChildLocations {
  locations: Record<string, ChildLocation>; // childId -> latest known location
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// Each child's most recent `location_update` device_event (T17's own payload convention, no
// prior ticket defines it — same class of new contract as T09's digest.ts `app_usage`/
// `block_attempt` payload conventions: `{lat: number, lng: number}`, matching
// packages/backend/src/geofence.ts's expectation). One query, reduced client-side to the
// newest row per child_id (mirrors vacation-cron's "correctness over a fancier PostgREST
// DISTINCT ON query" precedent, T09) since a family has at most a handful of children.
export function useChildLocations(childIds: string[]): UseChildLocations {
  const [locations, setLocations] = useState<Record<string, ChildLocation>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const idsKey = childIds.join(',');

  const fetchLocations = useCallback(async () => {
    if (childIds.length === 0) {
      setLocations({});
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('device_event')
        .select('child_id, payload, occurred_at')
        .in('child_id', childIds)
        .eq('type', 'location_update')
        .order('occurred_at', { ascending: false })
        .returns<LocationEventRow[]>();
      if (fetchError) throw new Error(fetchError.message);

      const latest: Record<string, ChildLocation> = {};
      for (const row of data ?? []) {
        if (latest[row.child_id]) continue; // already-seen child_id has the newer row (desc order)
        const lat = typeof row.payload.lat === 'number' ? row.payload.lat : null;
        const lng = typeof row.payload.lng === 'number' ? row.payload.lng : null;
        if (lat === null || lng === null) continue;
        latest[row.child_id] = { lat, lng, occurredAt: row.occurred_at };
      }
      setLocations(latest);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load locations');
    } finally {
      setLoading(false);
    }
  }, [idsKey]);

  useEffect(() => {
    void fetchLocations();
  }, [fetchLocations]);

  return { locations, loading, error, refetch: fetchLocations };
}
