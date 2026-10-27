import { useCallback, useEffect, useState } from 'react';
import type { Child, Device, Family, Tier } from '@guardian/domain';
import { supabase } from '../../supabaseClient';

export interface ChildWithDevices extends Child {
  devices: Device[];
}

export interface FamilyData {
  family: Family;
  children: ChildWithDevices[];
  // Defaults to 'free' when no Subscription row exists yet (T10's signup handler creates
  // Family+Parent only, no Subscription) — the lowest/safest tier, never fabricated upward.
  tier: Tier;
}

interface UseFamily {
  data: FamilyData | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

interface DeviceRow {
  id: string;
  child_id: string;
  platform: Device['platform'];
  name: string;
  registered_at: string;
}

interface ChildRow {
  id: string;
  family_id: string;
  name: string;
  birthdate: string;
  device: DeviceRow[] | null;
}

interface FamilyRow {
  id: string;
  name: string;
  created_at: string;
  child: ChildRow[] | null;
}

interface SubscriptionRow {
  family_id: string;
  tier: Tier;
  device_limit: number;
}

function mapDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    childId: row.child_id,
    platform: row.platform,
    name: row.name,
    registeredAt: row.registered_at,
  };
}

function mapChild(row: ChildRow): ChildWithDevices {
  return {
    id: row.id,
    familyId: row.family_id,
    name: row.name,
    birthdate: row.birthdate,
    devices: (row.device ?? []).map(mapDevice),
  };
}

// Fetches the signed-in parent's Family + Child list + each child's Device list (one embedded
// PostgREST select) and current Subscription.tier (separate query — a family<->subscription
// embed's cardinality, one-to-one via a PK/FK, isn't worth guessing when a second plain query
// is simple and unambiguous). RLS (T07's parent-scoped policies) restricts every table read to
// the signed-in parent's own family; no explicit parent/family id filter is passed here.
export function useFamily(): UseFamily {
  const [data, setData] = useState<FamilyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFamily = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: familyRows, error: familyError } = await supabase
        .from('family')
        .select(
          'id, name, created_at, child(id, family_id, name, birthdate, device(id, child_id, platform, name, registered_at))',
        )
        .returns<FamilyRow[]>();
      if (familyError) throw new Error(familyError.message);

      const familyRow = familyRows?.[0];
      if (!familyRow) {
        setData(null);
        return;
      }

      const { data: subscriptionRows, error: subscriptionError } = await supabase
        .from('subscription')
        .select('family_id, tier, device_limit')
        .eq('family_id', familyRow.id)
        .returns<SubscriptionRow[]>();
      if (subscriptionError) throw new Error(subscriptionError.message);

      setData({
        family: { id: familyRow.id, name: familyRow.name, createdAt: familyRow.created_at },
        children: (familyRow.child ?? []).map(mapChild),
        tier: subscriptionRows?.[0]?.tier ?? 'free',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load family');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFamily();
  }, [fetchFamily]);

  return { data, loading, error, refetch: fetchFamily };
}
