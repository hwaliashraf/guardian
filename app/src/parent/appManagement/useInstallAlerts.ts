import { useCallback, useEffect, useState } from 'react';
import type { DeviceEvent } from '@guardian/domain';
import { supabase } from '../../supabaseClient';

interface DeviceEventRow {
  id: string;
  device_id: string;
  child_id: string;
  type: DeviceEvent['type'];
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

interface UseInstallAlerts {
  events: DeviceEvent[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// Feed of `new_install` DeviceEvents for a child, newest first (server-side filtered/ordered,
// RLS's device_event_select_parent scopes reads to the signed-in parent's own family, T07).
// Payload shape contract (T16's own addition — no prior ticket defines it): `{appId, name,
// storeRating}`, matching packages/domain/src/types.ts's `InstalledApp`. T24's future
// PackageAddedReceiver.kt must emit exactly this shape to feed this screen correctly.
export function useInstallAlerts(childId: string): UseInstallAlerts {
  const [events, setEvents] = useState<DeviceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('device_event')
        .select('id, device_id, child_id, type, payload, occurred_at')
        .eq('child_id', childId)
        .eq('type', 'new_install')
        .order('occurred_at', { ascending: false })
        .returns<DeviceEventRow[]>();
      if (fetchError) throw new Error(fetchError.message);
      setEvents((data ?? []).map(rowToEvent));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load install alerts');
    } finally {
      setLoading(false);
    }
  }, [childId]);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  return { events, loading, error, refetch: fetchEvents };
}
