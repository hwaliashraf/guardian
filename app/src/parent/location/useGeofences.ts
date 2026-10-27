import { useCallback, useEffect, useState } from 'react';
import type { Geofence } from '@guardian/domain';
import { supabase } from '../../supabaseClient';

interface GeofenceRow {
  id: string;
  child_id: string;
  name: string;
  lat: number;
  lng: number;
  radius_meters: number;
  alert_on_enter: boolean;
  alert_on_leave: boolean;
}

function rowToGeofence(row: GeofenceRow): Geofence {
  return {
    id: row.id,
    childId: row.child_id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    radiusMeters: row.radius_meters,
    alertOnEnter: row.alert_on_enter,
    alertOnLeave: row.alert_on_leave,
  };
}

function geofenceToRow(update: Omit<Geofence, 'id'>): Omit<GeofenceRow, 'id'> {
  return {
    child_id: update.childId,
    name: update.name,
    lat: update.lat,
    lng: update.lng,
    radius_meters: update.radiusMeters,
    alert_on_enter: update.alertOnEnter,
    alert_on_leave: update.alertOnLeave,
  };
}

interface UseGeofences {
  geofences: Geofence[];
  loading: boolean;
  error: string | null;
  create: (geofence: Omit<Geofence, 'id'>) => Promise<Geofence>;
  update: (id: string, geofence: Omit<Geofence, 'id'>) => Promise<Geofence>;
  remove: (id: string) => Promise<void>;
  refetch: () => Promise<void>;
}

const SELECT_COLUMNS = 'id, child_id, name, lat, lng, radius_meters, alert_on_enter, alert_on_leave';

// Direct supabase-js table CRUD (RLS's geofence_*_parent policies, 0006_geofence.sql, scope
// every operation to the signed-in parent's own children) — no edge function needed, unlike
// `policy` (which needs feature-gating/version-bump logic a plain table write doesn't).
export function useGeofences(childId: string): UseGeofences {
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGeofences = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('geofence')
        .select(SELECT_COLUMNS)
        .eq('child_id', childId)
        .returns<GeofenceRow[]>();
      if (fetchError) throw new Error(fetchError.message);
      setGeofences((data ?? []).map(rowToGeofence));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load geofences');
    } finally {
      setLoading(false);
    }
  }, [childId]);

  useEffect(() => {
    void fetchGeofences();
  }, [fetchGeofences]);

  const create = useCallback(
    async (geofence: Omit<Geofence, 'id'>): Promise<Geofence> => {
      const { data, error: insertError } = await supabase
        .from('geofence')
        .insert(geofenceToRow(geofence))
        .select(SELECT_COLUMNS)
        .returns<GeofenceRow[]>();
      if (insertError) throw new Error(insertError.message);
      const created = rowToGeofence(data![0]);
      setGeofences((prev) => [...prev, created]);
      return created;
    },
    [],
  );

  const update = useCallback(
    async (id: string, geofence: Omit<Geofence, 'id'>): Promise<Geofence> => {
      const { data, error: updateError } = await supabase
        .from('geofence')
        .update(geofenceToRow(geofence))
        .eq('id', id)
        .select(SELECT_COLUMNS)
        .returns<GeofenceRow[]>();
      if (updateError) throw new Error(updateError.message);
      const updated = rowToGeofence(data![0]);
      setGeofences((prev) => prev.map((g) => (g.id === id ? updated : g)));
      return updated;
    },
    [],
  );

  const remove = useCallback(async (id: string): Promise<void> => {
    const { error: deleteError } = await supabase.from('geofence').delete().eq('id', id);
    if (deleteError) throw new Error(deleteError.message);
    setGeofences((prev) => prev.filter((g) => g.id !== id));
  }, []);

  return { geofences, loading, error, create, update, remove, refetch: fetchGeofences };
}
