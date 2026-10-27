import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ParentStackParamList } from '../../navigation/ParentNavigator';
import { useLatestDigest } from './useLatestDigest';

type Props = NativeStackScreenProps<ParentStackParamList, 'WeeklyDigest'>;

export default function WeeklyDigestScreen({ route }: Props) {
  const { childId } = route.params;
  const { digest, loading, error } = useLatestDigest(childId);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (!digest) {
    return (
      <View style={styles.center}>
        <Text style={styles.helpText}>No weekly digest yet.</Text>
      </View>
    );
  }

  const { summary } = digest;
  const categoryEntries = Object.entries(summary.totalsByCategory);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Week of {digest.weekStart}</Text>

      <Text style={styles.sectionTitle}>Usage by category</Text>
      {categoryEntries.length === 0 ? (
        <Text style={styles.helpText}>No usage recorded.</Text>
      ) : (
        categoryEntries.map(([category, minutes]) => (
          <View key={category} testID={`digest-category-${category}`} style={styles.row}>
            <Text style={styles.rowText}>{category}</Text>
            <Text style={styles.helpText}>{minutes} min</Text>
          </View>
        ))
      )}

      <Text style={styles.sectionTitle}>This week at a glance</Text>
      <View testID="digest-block-attempt-count" style={styles.row}>
        <Text style={styles.rowText}>Blocked attempts</Text>
        <Text style={styles.helpText}>{summary.blockAttemptCount}</Text>
      </View>
      <View testID="digest-youtube-count" style={styles.row}>
        <Text style={styles.rowText}>YouTube views</Text>
        <Text style={styles.helpText}>{summary.youtubeViewCount}</Text>
      </View>

      <Text style={styles.sectionTitle}>Top blocked domains</Text>
      {summary.topBlockedDomains.length === 0 ? (
        <Text style={styles.helpText}>None.</Text>
      ) : (
        summary.topBlockedDomains.map(({ domain, count }) => (
          <View key={domain} testID={`digest-domain-${domain}`} style={styles.row}>
            <Text style={styles.rowText}>{domain}</Text>
            <Text style={styles.helpText}>{count}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 16 },
  helpText: { fontSize: 13, color: '#555' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#f2f2f2',
    marginTop: 8,
  },
  rowText: { fontSize: 14, fontWeight: '600' },
  errorText: { color: '#d92d20' },
});
