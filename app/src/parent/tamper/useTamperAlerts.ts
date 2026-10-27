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

const TAMPER_EVENT_TYPES: DeviceEvent['type'][] = ['uninstall_attempt', 'service_disabled'];

interface UseTamperAlerts {
  events: DeviceEvent[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// Feed of uninstall_attempt/service_disabled DeviceEvents for a child, newest first
// (server-side filtered/ordered via `.in('type', ...)`, RLS's device_event_select_parent scopes
// reads to the signed-in parent's own family, T07) — same pattern T16's useInstallAlerts.ts
// established for a single-type feed, extended to two types here. Real producers (T22's
// BypassPrevention.kt, T23's onUnbind, T24's onDisableRequested/onDisabled) are already built
// and out of this ticket's scope (display + policy-toggle only).
export function useTamperAlerts(childId: string): UseTamperAlerts {
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
        .in('type', TAMPER_EVENT_TYPES)
        .order('occurred_at', { ascending: false })
        .returns<DeviceEventRow[]>();
      if (fetchError) throw new Error(fetchError.message);
      setEvents((data ?? []).map(rowToEvent));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tamper alerts');
    } finally {
      setLoading(false);
    }
  }, [childId]);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  return { events, loading, error, refetch: fetchEvents };
}
