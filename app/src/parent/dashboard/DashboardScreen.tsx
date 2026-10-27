import { useCallback } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { TIER_DEVICE_LIMIT } from '@guardian/domain';
import { useFamily, type ChildWithDevices } from './useFamily';
import { useInstantPause } from './useInstantPause';

function ChildCard({ child, deviceLimit }: { child: ChildWithDevices; deviceLimit: number }) {
  return (
    <View style={styles.card} testID={`child-card-${child.id}`}>
      <Text style={styles.childName}>{child.name}</Text>
      <Text>
        {child.devices.length} / {deviceLimit} devices
      </Text>
      {/* Real value wired in T14/T21 (buckets query) — never fabricate a number here. */}
      <Text>Remaining time today: —</Text>
    </View>
  );
}

export default function DashboardScreen() {
  const { data, loading, error } = useFamily();
  const { pauseAll, loading: pausing, error: pauseError } = useInstantPause();

  const confirmAndPause = useCallback(() => {
    if (!data) return;
    const familyId = data.family.id;
    // Household-wide lock — must not fire on a stray tap, so a confirmation dialog gates the
    // actual call.
    Alert.alert(
      'Pause all devices?',
      'This immediately locks every device in the family until you resume.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Pause All',
          style: 'destructive',
          onPress: () => {
            // pauseAll rethrows after recording the error in hook state (see useInstantPause.ts)
            // — the error is already surfaced via `pauseError` below, so this catch only
            // prevents an unhandled promise rejection; it must not re-surface the error again.
            pauseAll(familyId).catch(() => {});
          },
        },
      ],
    );
  }, [data, pauseAll]);

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

  if (!data) {
    return (
      <View style={styles.center}>
        <Text>No family found for this account.</Text>
      </View>
    );
  }

  const deviceLimit = TIER_DEVICE_LIMIT[data.tier];

  return (
    <View style={styles.container}>
      {data.children.map(child => (
        <ChildCard key={child.id} child={child} deviceLimit={deviceLimit} />
      ))}
      <Pressable
        accessibilityRole="button"
        testID="pause-all-button"
        style={styles.pauseButton}
        onPress={confirmAndPause}
        disabled={pausing}
      >
        <Text style={styles.pauseButtonText}>
          {pausing ? 'Pausing…' : 'Pause All Devices'}
        </Text>
      </Pressable>
      {pauseError ? <Text style={styles.errorText}>{pauseError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { padding: 16, borderRadius: 8, backgroundColor: '#f2f2f2', gap: 4 },
  childName: { fontSize: 18, fontWeight: '600' },
  pauseButton: { padding: 16, borderRadius: 8, backgroundColor: '#d92d20' },
  pauseButtonText: { color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: '600' },
  errorText: { color: '#d92d20' },
});
