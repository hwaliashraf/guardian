import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { DeviceEvent } from '@guardian/domain';
import type { ParentStackParamList } from '../../navigation/ParentNavigator';
import { usePolicy } from '../policy/usePolicy';
import { useTamperAlerts } from './useTamperAlerts';

type Props = NativeStackScreenProps<ParentStackParamList, 'TamperAlerts'>;

const EVENT_LABEL: Record<string, string> = {
  uninstall_attempt: 'Uninstall attempted',
  service_disabled: 'Protection service disabled',
};

// device_event's payload for these two types isn't given a fixed contract by any prior ticket
// (T22-T24's native producers vary what they include) — defensively falls back to a generic
// label rather than assuming a specific field exists.
function serviceLabel(event: DeviceEvent): string {
  const service = event.payload.service;
  return typeof service === 'string' ? service : 'Unknown service';
}

/**
 * Spec §3.7 (tamper resistance): "instant parent alert on uninstall/disable attempt... optional
 * auto-lock device until restored... PIN-protected settings on the child device." Feed of
 * `uninstall_attempt`/`service_disabled` DeviceEvents (real-time dispatched by T09's
 * event-ingest, produced natively by T22/T23/T24 — display + policy-toggle only here, per this
 * ticket's explicit "Out of scope") plus the two policy toggles that actually control the
 * response: `TamperPolicy.autoLockUntilRestored` and `pinRequired`.
 */
export default function TamperAlertsScreen({ route }: Props) {
  const { childId } = route.params;
  const { events, loading: eventsLoading, error: eventsError } = useTamperAlerts(childId);
  const { policy, loading: policyLoading, saving, error: saveError, save } = usePolicy(childId);

  const [autoLockUntilRestored, setAutoLockUntilRestored] = useState(false);
  const [pinRequired, setPinRequired] = useState(false);

  useEffect(() => {
    if (!policy) return;
    setAutoLockUntilRestored(policy.tamper.autoLockUntilRestored);
    setPinRequired(policy.tamper.pinRequired);
  }, [policy]);

  const handleSave = useCallback(() => {
    if (!policy) return;
    save({ tamper: { ...policy.tamper, autoLockUntilRestored, pinRequired } }).catch(() => {});
  }, [policy, autoLockUntilRestored, pinRequired, save]);

  if (eventsLoading || policyLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Tamper alerts</Text>
      {eventsError ? <Text style={styles.errorText}>{eventsError}</Text> : null}
      {events.length === 0 ? <Text>No tamper alerts yet.</Text> : null}
      {events.map((event) => (
        <View key={event.id} testID={`tamper-alert-${event.id}`} style={styles.card}>
          <Text style={styles.alertType}>{EVENT_LABEL[event.type] ?? event.type}</Text>
          <Text style={styles.helpText}>
            {serviceLabel(event)} · {new Date(event.occurredAt).toLocaleString()}
          </Text>
        </View>
      ))}

      {policy ? (
        <>
          <Text style={styles.heading}>Response settings</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Auto-lock device until restored</Text>
            <Switch
              testID="tamper-auto-lock-toggle"
              value={autoLockUntilRestored}
              onValueChange={setAutoLockUntilRestored}
            />
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Require PIN for settings on child device</Text>
            <Switch testID="tamper-pin-required-toggle" value={pinRequired} onValueChange={setPinRequired} />
          </View>

          {saveError ? <Text style={styles.errorText}>{saveError}</Text> : null}

          <Pressable testID="tamper-save" style={styles.saveButton} onPress={handleSave} disabled={saving}>
            <Text style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        </>
      ) : (
        <Text>No policy found for this child yet.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 18, fontWeight: '700' },
  card: { padding: 12, borderRadius: 8, backgroundColor: '#f2f2f2', gap: 4 },
  alertType: { fontSize: 14, fontWeight: '600', color: '#d92d20' },
  helpText: { fontSize: 13, color: '#555' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 14, fontWeight: '600', flex: 1, paddingRight: 8 },
  errorText: { color: '#d92d20' },
  saveButton: { padding: 16, borderRadius: 8, backgroundColor: '#1a73e8', marginTop: 8 },
  saveButtonText: { color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: '600' },
});
