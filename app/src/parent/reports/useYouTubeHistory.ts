import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';

// `youtube_view` DeviceEvent.payload contract — this ticket's own addition, no prior ticket
// defines it. T24 (Android accessibility-based YouTube capture, written AFTER this ticket) must
// emit exactly these three fields for this screen to render correctly:
//   { title: string; url: string; watchedAt: string }
export interface YouTubeViewPayload {
  title: string;
  url: string;
  watchedAt: string;
}

export interface YouTubeHistoryEntry {
  id: string;
  title: string;
  url: string;
  watchedAt: string;
}

interface DeviceEventRow {
  id: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}

interface UseYouTubeHistory {
  entries: YouTubeHistoryEntry[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// Server-side filtered (type=eq.youtube_view) and ordered feed, newest first. Rows whose
// payload doesn't match the documented {title,url,watchedAt} contract are skipped defensively
// (same convention as T17's useLocationHistory.ts) rather than crashing the screen; `watchedAt`
// falls back to the device_event's own `occurred_at` if absent from the payload.
export function useYouTubeHistory(childId: string): UseYouTubeHistory {
  const [entries, setEntries] = useState<YouTubeHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('device_event')
        .select('id, payload, occurred_at')
        .eq('child_id', childId)
        .eq('type', 'youtube_view')
        .order('occurred_at', { ascending: false })
        .returns<DeviceEventRow[]>();
      if (fetchError) throw new Error(fetchError.message);

      const mapped: YouTubeHistoryEntry[] = [];
      for (const row of data ?? []) {
        const title = typeof row.payload.title === 'string' ? row.payload.title : null;
        const url = typeof row.payload.url === 'string' ? row.payload.url : null;
        if (!title || !url) continue;
        const watchedAt = typeof row.payload.watchedAt === 'string' ? row.payload.watchedAt : row.occurred_at;
        mapped.push({ id: row.id, title, url, watchedAt });
      }
      setEntries(mapped);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load YouTube history');
    } finally {
      setLoading(false);
    }
  }, [childId]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  return { entries, loading, error, refetch: fetchHistory };
}
