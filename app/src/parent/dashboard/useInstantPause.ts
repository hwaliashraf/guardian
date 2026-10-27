import { useCallback, useState } from 'react';
import { SUPABASE_ANON_KEY } from '@env';
import { FUNCTIONS_URL, supabase } from '../../supabaseClient';

interface InstantPauseResult {
  childrenPaused: number;
  devicesNotified: number;
}

interface UseInstantPause {
  pauseAll: (familyId: string) => Promise<InstantPauseResult>;
  loading: boolean;
  error: string | null;
}

// Calls T08's exact `POST /policy-sync/instant-pause` (packages/backend/supabase/functions/
// policy-sync) — body `{ familyId }`, parent's own session token as the bearer (RLS-scoped,
// same convention T11's useSignUp/usePairDevice established for calling edge functions).
export function useInstantPause(): UseInstantPause {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pauseAll = useCallback(async (familyId: string): Promise<InstantPauseResult> => {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        const message = 'No active session — please sign in again';
        setError(message);
        throw new Error(message);
      }

      const res = await fetch(`${FUNCTIONS_URL}/policy-sync/instant-pause`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ familyId }),
      });
      const body = (await res.json()) as InstantPauseResult | { error: string };
      if (!res.ok) {
        const message = 'error' in body ? body.error : 'Instant pause failed';
        setError(message);
        throw new Error(message);
      }
      return body as InstantPauseResult;
    } finally {
      setLoading(false);
    }
  }, []);

  return { pauseAll, loading, error };
}
