import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';

export interface LocationHistoryEntry {
  id: string;
  lat: number;
  lng: number;
  occurredAt: string;
}

interface LocationEventRow {
  id: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}

interface UseLocationHistory {
  entries: LocationHistoryEntry[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// 30-day (default) `location_update` history for one child, newest first — server-side filtered
// (`type=eq.location_update`, `occurred_at >= cutoff`) and ordered, same pattern as
// useInstallAlerts.ts. RLS's device_event_select_parent (T07) scopes this to the signed-in
// parent's own family. Rows missing a valid {lat,lng} payload (see useChildLocations.ts's same
// convention) are skipped defensively rather than crashing the screen.
export function useLocationHistory(childId: string, days = 30): UseLocationHistory {
  const [entries, setEntries] = useState<LocationHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const { data, error: fetchError } = await supabase
        .from('device_event')
        .select('id, payload, occurred_at')
        .eq('child_id', childId)
        .eq('type', 'location_update')
        .gte('occurred_at', cutoff)
        .order('occurred_at', { ascending: false })
        .returns<LocationEventRow[]>();
      if (fetchError) throw new Error(fetchError.message);

      const mapped: LocationHistoryEntry[] = [];
      for (const row of data ?? []) {
        const lat = typeof row.payload.lat === 'number' ? row.payload.lat : null;
        const lng = typeof row.payload.lng === 'number' ? row.payload.lng : null;
        if (lat === null || lng === null) continue;
        mapped.push({ id: row.id, lat, lng, occurredAt: row.occurred_at });
      }
      setEntries(mapped);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load location history');
    } finally {
      setLoading(false);
    }
  }, [childId, days]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  return { entries, loading, error, refetch: fetchHistory };
}
