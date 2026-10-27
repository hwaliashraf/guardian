import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ParentStackParamList } from '../../navigation/ParentNavigator';
import { useYouTubeHistory } from './useYouTubeHistory';

type Props = NativeStackScreenProps<ParentStackParamList, 'YouTubeHistory'>;

export default function YouTubeHistoryScreen({ route }: Props) {
  const { childId } = route.params;
  const { entries, loading, error } = useYouTubeHistory(childId);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {entries.length === 0 ? (
        <Text style={styles.helpText}>No YouTube activity yet.</Text>
      ) : (
        entries.map((entry) => (
          <Pressable
            key={entry.id}
            testID={`youtube-entry-${entry.id}`}
            style={styles.row}
            onPress={() => Linking.openURL(entry.url)}
          >
            <Text style={styles.rowTitle}>{entry.title}</Text>
            <Text style={styles.rowUrl}>{entry.url}</Text>
            <Text style={styles.helpText}>{new Date(entry.watchedAt).toLocaleString()}</Text>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  helpText: { fontSize: 13, color: '#555' },
  row: { padding: 12, borderRadius: 8, backgroundColor: '#f2f2f2', marginTop: 8, gap: 2 },
  rowTitle: { fontSize: 14, fontWeight: '600' },
  rowUrl: { fontSize: 12, color: '#1a73e8' },
  errorText: { color: '#d92d20' },
});
