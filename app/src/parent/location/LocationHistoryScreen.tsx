import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { hasFeature } from '@guardian/domain';
import type { ParentStackParamList } from '../../navigation/ParentNavigator';
import { useFamily } from '../dashboard/useFamily';
import { useLocationHistory, type LocationHistoryEntry } from './useLocationHistory';

type Props = NativeStackScreenProps<ParentStackParamList, 'LocationHistory'>;

interface DayGroup {
  day: string;
  entries: LocationHistoryEntry[];
}

// `entries` arrives newest-first from the hook (server-side ordered) — a Map preserves
// first-insertion order, so grouping by day (YYYY-MM-DD slice of the ISO timestamp) yields
// newest-day-first groups, with each group's own entries already newest-first too.
function groupByDay(entries: LocationHistoryEntry[]): DayGroup[] {
  const groups = new Map<string, LocationHistoryEntry[]>();
  for (const entry of entries) {
    const day = entry.occurredAt.slice(0, 10);
    const existing = groups.get(day);
    if (existing) existing.push(entry);
    else groups.set(day, [entry]);
  }
  return [...groups.entries()].map(([day, dayEntries]) => ({ day, entries: dayEntries }));
}

const HISTORY_DAYS = 30;

export default function LocationHistoryScreen({ route, navigation }: Props) {
  const { childId } = route.params;
  const { data: familyData, loading: familyLoading } = useFamily();
  const { entries, loading: historyLoading, error } = useLocationHistory(childId, HISTORY_DAYS);

  if (familyLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const tier = familyData?.tier ?? 'free';

  if (!hasFeature(tier, 'locator')) {
    return (
      <View style={styles.center}>
        <View style={styles.upsellCard} testID="location-history-upsell">
          <Text style={styles.upsellTitle}>Location History is a Standard+ feature</Text>
          <Text style={styles.upsellBody}>Upgrade to see up to 30 days of location history.</Text>
          <Pressable
            testID="location-history-upsell-cta"
            style={styles.upsellButton}
            onPress={() => navigation.navigate('Paywall')}
          >
            <Text style={styles.upsellButtonText}>Upgrade</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (historyLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const groups = groupByDay(entries);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {groups.length === 0 ? <Text style={styles.helpText}>No location history in the last 30 days.</Text> : null}
      {groups.map(({ day, entries: dayEntries }) => (
        <View key={day} testID={`location-history-day-${day}`} style={styles.dayGroup}>
          <Text style={styles.dayHeading}>{day}</Text>
          {dayEntries.map((entry) => (
            <View key={entry.id} testID={`location-history-entry-${entry.id}`} style={styles.entryRow}>
              <Text style={styles.entryTime}>{new Date(entry.occurredAt).toLocaleTimeString()}</Text>
              <Text style={styles.entryCoords}>
                {entry.lat.toFixed(5)}, {entry.lng.toFixed(5)}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  helpText: { fontSize: 13, color: '#555' },
  dayGroup: { gap: 4, marginTop: 12 },
  dayHeading: { fontSize: 14, fontWeight: '700' },
  entryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#f2f2f2',
  },
  entryTime: { color: '#333' },
  entryCoords: { color: '#555' },
  errorText: { color: '#d92d20' },
  upsellCard: { padding: 20, borderRadius: 12, backgroundColor: '#f2f2f2', gap: 12, maxWidth: 400 },
  upsellTitle: { fontSize: 18, fontWeight: '700' },
  upsellBody: { fontSize: 14, color: '#555' },
  upsellButton: { padding: 14, borderRadius: 8, backgroundColor: '#1a73e8' },
  upsellButtonText: { color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: '600' },
});
