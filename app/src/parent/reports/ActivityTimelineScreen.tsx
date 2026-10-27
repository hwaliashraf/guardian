import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { DeviceEvent } from '@guardian/domain';
import type { ParentStackParamList } from '../../navigation/ParentNavigator';
import { TIMELINE_EVENT_TYPES, useActivityTimeline, type TimelineFilter } from './useActivityTimeline';

type Props = NativeStackScreenProps<ParentStackParamList, 'ActivityTimeline'>;

const FILTERS: TimelineFilter[] = ['all', ...TIMELINE_EVENT_TYPES];

const FILTER_LABELS: Record<TimelineFilter, string> = {
  all: 'All',
  app_usage: 'App usage',
  block_attempt: 'Blocked',
  search_query: 'Searches',
  youtube_view: 'YouTube',
};

function summarizeEvent(event: DeviceEvent): string {
  switch (event.type) {
    case 'app_usage': {
      const appId = typeof event.payload.appId === 'string' ? event.payload.appId : 'an app';
      const minutes = typeof event.payload.minutes === 'number' ? event.payload.minutes : null;
      return minutes !== null ? `${appId} — ${minutes} min` : appId;
    }
    case 'block_attempt': {
      const domain = typeof event.payload.domain === 'string' ? event.payload.domain : 'a site';
      return `Blocked: ${domain}`;
    }
    case 'search_query': {
      const query = typeof event.payload.query === 'string' ? event.payload.query : '';
      return query ? `Searched: "${query}"` : 'Search';
    }
    case 'youtube_view': {
      const title = typeof event.payload.title === 'string' ? event.payload.title : 'a video';
      return `Watched: ${title}`;
    }
    default:
      return event.type;
  }
}

export default function ActivityTimelineScreen({ route }: Props) {
  const { childId } = route.params;
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const [page, setPage] = useState(0);
  const { events, loading, error, hasMore } = useActivityTimeline(childId, filter, page);

  // A filter change invalidates the current page's offset into the previous (differently
  // scoped) result set — always jump back to page 0 when switching filters.
  const changeFilter = useCallback((next: TimelineFilter) => {
    setFilter(next);
    setPage(0);
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.chipWrap}>
        {FILTERS.map((f) => (
          <Pressable
            key={f}
            testID={`timeline-filter-${f}`}
            style={[styles.filterChip, filter === f && styles.filterChipActive]}
            onPress={() => changeFilter(f)}
          >
            <Text style={filter === f ? styles.filterChipTextActive : styles.filterChipText}>{FILTER_LABELS[f]}</Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : events.length === 0 ? (
        <Text style={styles.helpText}>No activity for this filter yet.</Text>
      ) : (
        events.map((event) => (
          <View key={event.id} testID={`timeline-event-${event.id}`} style={styles.row}>
            <Text style={styles.rowText}>{summarizeEvent(event)}</Text>
            <Text style={styles.helpText}>{new Date(event.occurredAt).toLocaleString()}</Text>
          </View>
        ))
      )}

      <View style={styles.pagerRow}>
        <Pressable
          testID="timeline-prev"
          style={[styles.pagerButton, page === 0 && styles.pagerButtonDisabled]}
          onPress={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
        >
          <Text style={styles.pagerButtonText}>Previous</Text>
        </Pressable>
        <Pressable
          testID="timeline-next"
          style={[styles.pagerButton, !hasMore && styles.pagerButtonDisabled]}
          onPress={() => setPage((p) => p + 1)}
          disabled={!hasMore}
        >
          <Text style={styles.pagerButtonText}>Next</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  helpText: { fontSize: 13, color: '#555' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, backgroundColor: '#e0e0e0' },
  filterChipActive: { backgroundColor: '#1a73e8' },
  filterChipText: { color: '#333', fontWeight: '600' },
  filterChipTextActive: { color: '#fff', fontWeight: '600' },
  row: { padding: 12, borderRadius: 8, backgroundColor: '#f2f2f2', marginTop: 8, gap: 2 },
  rowText: { fontSize: 14, fontWeight: '600' },
  errorText: { color: '#d92d20' },
  pagerRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, gap: 8 },
  pagerButton: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#1a73e8' },
  pagerButtonDisabled: { backgroundColor: '#ccc' },
  pagerButtonText: { color: '#fff', textAlign: 'center', fontWeight: '600' },
});
