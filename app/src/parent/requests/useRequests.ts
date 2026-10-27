import { useCallback, useEffect, useState } from 'react';
import type { ChildRequest, DailyUsageState } from '@guardian/domain';
import { SUPABASE_ANON_KEY } from '@env';
import { FUNCTIONS_URL, supabase } from '../../supabaseClient';

interface ChildRequestRow {
  id: string;
  child_id: string;
  type: ChildRequest['type'];
  payload: Record<string, unknown>;
  status: ChildRequest['status'];
  created_at: string;
  resolved_at: string | null;
}

function rowToChildRequest(row: ChildRequestRow): ChildRequest {
  return {
    id: row.id,
    childId: row.child_id,
    type: row.type,
    payload: row.payload,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

interface UseRequests {
  pending: ChildRequest[];
  resolved: ChildRequest[];
  loading: boolean;
  error: string | null;
  resolving: boolean;
  resolveError: string | null;
  resolve: (id: string, approve: boolean) => Promise<void>;
  refetch: () => Promise<void>;
  /**
   * The resolved `DailyUsageState` an approved `extra_time` request's grant produced (see T19's
   * `applyApprovedExtraTime`/`buildExtraTimeGrant`), keyed by request id. There is no backend
   * `daily_usage` table (`DailyUsageState` is device-local — see LEDGER.md's T19 entry), so this
   * is the one place the computed grant is actually surfaced/consumed rather than discarded;
   * in-memory only (cleared on remount/refetch), shown in the resolved-history row below.
   */
  extraTimeGrants: Record<string, DailyUsageState>;
}

// Family-wide feed (no childId param — mirrors DashboardScreen, T12): RLS's
// child_request_select_parent (T07) already scopes reads to the signed-in parent's own family
// across all their children, so no explicit filter is passed here. Newest-first; the screen
// splits pending vs. resolved by `status`.
export function useRequests(): UseRequests {
  const [requests, setRequests] = useState<ChildRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [extraTimeGrants, setExtraTimeGrants] = useState<Record<string, DailyUsageState>>({});

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('child_request')
        .select('id, child_id, type, payload, status, created_at, resolved_at')
        .order('created_at', { ascending: false })
        .returns<ChildRequestRow[]>();
      if (fetchError) throw new Error(fetchError.message);
      setRequests((data ?? []).map(rowToChildRequest));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load requests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRequests();
  }, [fetchRequests]);

  // Calls T19's exact `POST /requests/:id/resolve` (packages/backend/supabase/functions/
  // requests) — body `{ approve }`, parent's own session token as the bearer, same convention
  // T11/T12/T13 established for calling edge functions. Optimistically moves the item out of
  // the pending list on success rather than waiting on a full refetch.
  const resolve = useCallback(async (id: string, approve: boolean): Promise<void> => {
    setResolving(true);
    setResolveError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error('No active session — please sign in again');

      const res = await fetch(`${FUNCTIONS_URL}/requests/${id}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ approve }),
      });
      const body = (await res.json()) as
        | { request: ChildRequest; dailyUsage?: DailyUsageState }
        | { error: string };
      if (!res.ok) {
        throw new Error('error' in body ? body.error : 'Failed to resolve request');
      }
      const { request: resolvedRequest, dailyUsage } = body as {
        request: ChildRequest;
        dailyUsage?: DailyUsageState;
      };
      setRequests((prev) => prev.map((r) => (r.id === id ? resolvedRequest : r)));
      if (dailyUsage) {
        setExtraTimeGrants((prev) => ({ ...prev, [id]: dailyUsage }));
      }
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : 'Failed to resolve request');
      throw err;
    } finally {
      setResolving(false);
    }
  }, []);

  return {
    pending: requests.filter((r) => r.status === 'pending'),
    resolved: requests.filter((r) => r.status !== 'pending'),
    loading,
    error,
    resolving,
    resolveError,
    resolve,
    refetch: fetchRequests,
    extraTimeGrants,
  };
}
