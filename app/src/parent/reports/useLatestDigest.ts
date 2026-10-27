import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';

// Mirrors packages/backend/src/digest.ts's DigestSummary shape — redefined here rather than
// imported (that module is Deno-edge-function-oriented and reaches into packages/domain by
// relative path; app/ consumes @guardian/domain as a normal npm-workspace package). Same
// redefine-don't-cross-the-boundary precedent as usePolicy.ts's PolicyUpdate (T12) and
// geofence.ts's payload conventions (T17).
export interface DigestSummary {
  totalsByCategory: Record<string, number>;
  blockAttemptCount: number;
  topBlockedDomains: { domain: string; count: number }[];
  youtubeViewCount: number;
}

export interface Digest {
  id: string;
  childId: string;
  weekStart: string;
  summary: DigestSummary;
  sentAt: string;
}

interface DigestRow {
  id: string;
  child_id: string;
  week_start: string;
  summary: DigestSummary;
  sent_at: string;
}

function rowToDigest(row: DigestRow): Digest {
  return {
    id: row.id,
    childId: row.child_id,
    weekStart: row.week_start,
    summary: row.summary,
    sentAt: row.sent_at,
  };
}

interface UseLatestDigest {
  digest: Digest | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// Latest (highest week_start) `digest` row for a child (RLS's digest_select_parent, T09, scopes
// this to the signed-in parent's own family). `digest` rows are written only by digest-cron
// (T09) — no parent/device write policy exists, so this hook is read-only, same as
// useFamily.ts's family/child/device reads.
export function useLatestDigest(childId: string): UseLatestDigest {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDigest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('digest')
        .select('id, child_id, week_start, summary, sent_at')
        .eq('child_id', childId)
        .order('week_start', { ascending: false })
        .limit(1)
        .returns<DigestRow[]>();
      if (fetchError) throw new Error(fetchError.message);
      setDigest(data?.[0] ? rowToDigest(data[0]) : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load weekly digest');
    } finally {
      setLoading(false);
    }
  }, [childId]);

  useEffect(() => {
    void fetchDigest();
  }, [fetchDigest]);

  return { digest, loading, error, refetch: fetchDigest };
}
