import { useCallback, useEffect, useState } from 'react';
import type { Policy } from '@guardian/domain';
import { SUPABASE_ANON_KEY } from '@env';
import { FUNCTIONS_URL, supabase } from '../../supabaseClient';

// Same shape as packages/backend/src/policySync.ts's PolicyUpdate — redefined here rather than
// imported (that module is Deno-edge-function-oriented and reaches into packages/domain by
// relative path; app/ consumes @guardian/domain as a normal npm-workspace package, see T12's
// LEDGER entry, so importing across that boundary isn't a fit for one type alias).
export type PolicyUpdate = Partial<Omit<Policy, 'id' | 'childId' | 'version'>>;

interface PolicyRow {
  id: string;
  child_id: string;
  version: number;
  screen_time: Policy['screenTime'];
  buckets: Policy['buckets'];
  schedules: Policy['schedules'];
  vacation: Policy['vacation'];
  content_filter: Policy['contentFilter'];
  app_rules: Policy['appRules'];
  presence: Policy['presence'];
  tamper: Policy['tamper'];
  instant_pause: boolean;
}

function rowToPolicy(row: PolicyRow): Policy {
  return {
    id: row.id,
    childId: row.child_id,
    version: row.version,
    screenTime: row.screen_time,
    buckets: row.buckets,
    schedules: row.schedules,
    vacation: row.vacation,
    contentFilter: row.content_filter,
    appRules: row.app_rules,
    presence: row.presence,
    tamper: row.tamper,
    instantPause: row.instant_pause,
  };
}

interface UsePolicy {
  policy: Policy | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  save: (update: PolicyUpdate) => Promise<Policy>;
  refetch: () => Promise<void>;
}

// Reused by T14/T15/T16 (Usage Buckets / content filtering / app management config screens).
// Read: latest Policy row for childId (RLS's policy_select_parent, T07, restricts this to the
// signed-in parent's own family). Save: optimistic local update, PUT to T08's exact
// `PUT /policy-sync/:childId`, rollback + inline error on failure (network or a gated-403 —
// FeatureGatedError's message already names the feature/tier, so it's shown as-is, never
// swallowed, never left to crash the UI).
export function usePolicy(childId: string): UsePolicy {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPolicy = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('policy')
        .select(
          'id, child_id, version, screen_time, buckets, schedules, vacation, content_filter, app_rules, presence, tamper, instant_pause',
        )
        .eq('child_id', childId)
        .order('version', { ascending: false })
        .limit(1)
        .returns<PolicyRow[]>();
      if (fetchError) throw new Error(fetchError.message);
      setPolicy(data?.[0] ? rowToPolicy(data[0]) : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load policy');
    } finally {
      setLoading(false);
    }
  }, [childId]);

  useEffect(() => {
    void fetchPolicy();
  }, [fetchPolicy]);

  const save = useCallback(
    async (update: PolicyUpdate): Promise<Policy> => {
      if (!policy) throw new Error('No policy loaded yet');
      const previous = policy;
      setPolicy({ ...previous, ...update });
      setSaving(true);
      setError(null);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) throw new Error('No active session — please sign in again');

        const res = await fetch(`${FUNCTIONS_URL}/policy-sync/${childId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(update),
        });
        const body = (await res.json()) as { policy: Policy } | { error: string };
        if (!res.ok) {
          throw new Error('error' in body ? body.error : 'Failed to save policy');
        }
        const persisted = (body as { policy: Policy }).policy;
        setPolicy(persisted);
        return persisted;
      } catch (err) {
        setPolicy(previous);
        const message = err instanceof Error ? err.message : 'Failed to save policy';
        setError(message);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [policy, childId],
  );

  return { policy, loading, saving, error, save, refetch: fetchPolicy };
}
