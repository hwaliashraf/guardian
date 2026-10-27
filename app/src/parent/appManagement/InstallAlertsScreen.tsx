import { useCallback } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { InstalledApp } from '@guardian/domain';
import type { ParentStackParamList } from '../../navigation/ParentNavigator';
import { usePolicy } from '../policy/usePolicy';
import { useInstallAlerts } from './useInstallAlerts';

type Props = NativeStackScreenProps<ParentStackParamList, 'InstallAlerts'>;

// Extracts the {appId, name, storeRating} contract this ticket defines for a `new_install`
// DeviceEvent's payload (see useInstallAlerts.ts / packages/domain's InstalledApp comment).
// Defensive against a malformed/missing payload (e.g. a future producer that doesn't match the
// contract exactly) — degrades to placeholder text instead of crashing the feed.
function payloadToApp(payload: Record<string, unknown>): InstalledApp {
  return {
    appId: typeof payload.appId === 'string' ? payload.appId : '',
    name: typeof payload.name === 'string' ? payload.name : 'Unknown app',
    storeRating: typeof payload.storeRating === 'string' ? payload.storeRating : null,
  };
}

export default function InstallAlertsScreen({ route }: Props) {
  const { childId } = route.params;
  const { events, loading: eventsLoading, error: eventsError } = useInstallAlerts(childId);
  const { policy, saving, error: saveError, save } = usePolicy(childId);

  const blockApp = useCallback(
    (appId: string) => {
      if (!policy || !appId) return;
      if (policy.appRules.blockedApps.includes(appId)) return; // already blocked, no-op
      save({
        appRules: {
          ...policy.appRules,
          blockedApps: [...policy.appRules.blockedApps, appId],
          allowedApps: policy.appRules.allowedApps.filter((id) => id !== appId),
        },
      }).catch(() => {});
    },
    [policy, save],
  );

  if (eventsLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {eventsError ? <Text style={styles.errorText}>{eventsError}</Text> : null}
      {events.length === 0 ? <Text>No new-install alerts yet.</Text> : null}
      {events.map((event) => {
        const app = payloadToApp(event.payload);
        const alreadyBlocked = policy?.appRules.blockedApps.includes(app.appId) ?? false;
        return (
          <View key={event.id} testID={`install-alert-${event.id}`} style={styles.card}>
            <View style={styles.fieldGroup}>
              <Text style={styles.appName}>{app.name}</Text>
              <Text style={styles.helpText}>
                {app.storeRating ?? 'Unrated'} · {new Date(event.occurredAt).toLocaleString()}
              </Text>
            </View>
            <Pressable
              testID={`install-alert-${event.id}-block`}
              style={styles.blockButton}
              onPress={() => blockApp(app.appId)}
              disabled={saving || alreadyBlocked || !policy}
            >
              <Text style={styles.blockButtonText}>{alreadyBlocked ? 'Blocked' : 'Block this app'}</Text>
            </Pressable>
          </View>
        );
      })}
      {saveError ? <Text style={styles.errorText}>{saveError}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: 8, backgroundColor: '#f2f2f2', gap: 8 },
  fieldGroup: { gap: 2, flex: 1 },
  appName: { fontSize: 14, fontWeight: '600' },
  helpText: { fontSize: 13, color: '#555' },
  blockButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, backgroundColor: '#d92d20' },
  blockButtonText: { color: '#fff', fontWeight: '600' },
  errorText: { color: '#d92d20' },
});
