import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChildRequest, RequestType, RoutineType } from '@guardian/domain';
import { SUPABASE_ANON_KEY } from '@env';
import type { ChildStackParamList } from '../../navigation/ChildNavigator';
import { FUNCTIONS_URL } from '../../supabaseClient';

type Props = NativeStackScreenProps<ChildStackParamList, 'Request'>;

const REQUEST_TYPE_LABEL: Record<RequestType, string> = {
  extra_time: 'Extra time',
  unblock: 'Unblock',
  schedule_change: 'Schedule change',
};

const ROUTINE_TYPES: RoutineType[] = ['homework', 'bedtime', 'mealtime', 'school', 'custom'];

// Matches SchedulesScreen.tsx's own id convention (app/src/parent/policy/SchedulesScreen.tsx) —
// a small dependency-free generator, same class as presence/evaluator.ts's `generateEventId`.
function generateScheduleId(): string {
  return `sch_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Child-side form for spec §3.6's request flow: extra_time / unblock / schedule_change, posted
 * to T19's `POST /requests` (child device's own forwarded identity — see T19's LEDGER: no
 * device-JWT-minting/RLS path is verified end-to-end yet, so `identity.deviceToken` is used as
 * the bearer exactly as the real flow intends, even though this hasn't been exercised against a
 * live device JWT any more than T19's own edge function has).
 *
 * The pending list below is session-local only (requests created during this app session) — T07's
 * carried-forward RISK (no device-scoped SELECT policy on `child_request`) means the child app
 * cannot read back a request's resolution across restarts; fixing that needs a backend/RLS
 * change, which is outside this ticket's `app/`-only scope. Documented, not silently worked
 * around.
 */
export default function RequestScreen({ route }: Props) {
  const { identity, currentDailyUsage } = route.params;

  const [type, setType] = useState<RequestType>('extra_time');
  const [categoryId, setCategoryId] = useState('');
  const [minutes, setMinutes] = useState('15');
  const [unblockScope, setUnblockScope] = useState<'app' | 'domain'>('domain');
  const [unblockTarget, setUnblockTarget] = useState('');
  const [routineType, setRoutineType] = useState<RoutineType>('custom');
  const [startTime, setStartTime] = useState('15:00');
  const [endTime, setEndTime] = useState('17:00');
  const [allowedCategories, setAllowedCategories] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<ChildRequest[]>([]);

  const buildPayload = useCallback((): Record<string, unknown> | null => {
    if (type === 'extra_time') {
      if (!categoryId.trim() || !currentDailyUsage) return null;
      const parsedMinutes = Number(minutes);
      if (!Number.isFinite(parsedMinutes) || parsedMinutes <= 0) return null;
      return { categoryId: categoryId.trim(), minutes: parsedMinutes, currentDailyUsage };
    }
    if (type === 'unblock') {
      if (!unblockTarget.trim()) return null;
      return { scope: unblockScope, target: unblockTarget.trim() };
    }
    // schedule_change
    if (!startTime.trim() || !endTime.trim()) return null;
    return {
      schedule: {
        id: generateScheduleId(),
        type: routineType,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: startTime.trim(),
        endTime: endTime.trim(),
        allowedCategories: allowedCategories
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
      },
    };
  }, [type, categoryId, minutes, currentDailyUsage, unblockScope, unblockTarget, routineType, startTime, endTime, allowedCategories]);

  const submit = useCallback(async () => {
    const payload = buildPayload();
    if (!payload) {
      setError('Please fill in the required fields.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${FUNCTIONS_URL}/requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${identity.deviceToken}`,
        },
        body: JSON.stringify({ childId: identity.childId, type, payload }),
      });
      const body = (await res.json()) as { request: ChildRequest } | { error: string };
      if (!res.ok) {
        throw new Error('error' in body ? body.error : 'Failed to create request');
      }
      const { request } = body as { request: ChildRequest };
      setRequests((prev) => [request, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create request');
    } finally {
      setSubmitting(false);
    }
  }, [buildPayload, identity, type]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Ask your parent</Text>

      <View style={styles.typeRow}>
        {(Object.keys(REQUEST_TYPE_LABEL) as RequestType[]).map((t) => (
          <Pressable
            key={t}
            testID={`type-${t}`}
            style={[styles.typeButton, type === t ? styles.typeButtonActive : null]}
            onPress={() => setType(t)}
          >
            <Text style={type === t ? styles.typeButtonTextActive : styles.typeButtonText}>
              {REQUEST_TYPE_LABEL[t]}
            </Text>
          </Pressable>
        ))}
      </View>

      {type === 'extra_time' ? (
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Category</Text>
          <TextInput testID="extra-time-category" style={styles.input} value={categoryId} onChangeText={setCategoryId} placeholder="games" />
          <Text style={styles.label}>Minutes</Text>
          <TextInput
            testID="extra-time-minutes"
            style={styles.input}
            value={minutes}
            onChangeText={setMinutes}
            keyboardType="numeric"
          />
        </View>
      ) : null}

      {type === 'unblock' ? (
        <View style={styles.fieldGroup}>
          <View style={styles.typeRow}>
            <Pressable testID="unblock-scope-app" style={[styles.typeButton, unblockScope === 'app' ? styles.typeButtonActive : null]} onPress={() => setUnblockScope('app')}>
              <Text style={unblockScope === 'app' ? styles.typeButtonTextActive : styles.typeButtonText}>App</Text>
            </Pressable>
            <Pressable testID="unblock-scope-domain" style={[styles.typeButton, unblockScope === 'domain' ? styles.typeButtonActive : null]} onPress={() => setUnblockScope('domain')}>
              <Text style={unblockScope === 'domain' ? styles.typeButtonTextActive : styles.typeButtonText}>Website</Text>
            </Pressable>
          </View>
          <Text style={styles.label}>{unblockScope === 'app' ? 'App id' : 'Domain'}</Text>
          <TextInput testID="unblock-target" style={styles.input} value={unblockTarget} onChangeText={setUnblockTarget} />
        </View>
      ) : null}

      {type === 'schedule_change' ? (
        <View style={styles.fieldGroup}>
          <View style={styles.typeRow}>
            {ROUTINE_TYPES.map((rt) => (
              <Pressable
                key={rt}
                testID={`routine-${rt}`}
                style={[styles.typeButton, routineType === rt ? styles.typeButtonActive : null]}
                onPress={() => setRoutineType(rt)}
              >
                <Text style={routineType === rt ? styles.typeButtonTextActive : styles.typeButtonText}>{rt}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.label}>Start (HH:mm)</Text>
          <TextInput testID="schedule-start" style={styles.input} value={startTime} onChangeText={setStartTime} />
          <Text style={styles.label}>End (HH:mm)</Text>
          <TextInput testID="schedule-end" style={styles.input} value={endTime} onChangeText={setEndTime} />
          <Text style={styles.label}>Allowed categories (comma-separated)</Text>
          <TextInput testID="schedule-allowed" style={styles.input} value={allowedCategories} onChangeText={setAllowedCategories} />
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Pressable testID="submit-request" style={styles.submitButton} onPress={() => submit()} disabled={submitting}>
        <Text style={styles.submitButtonText}>{submitting ? 'Sending…' : 'Send request'}</Text>
      </Pressable>

      <Text style={styles.heading}>Pending</Text>
      {requests.length === 0 ? <Text>No requests sent yet.</Text> : null}
      {requests.map((request) => (
        <View key={request.id} testID={`pending-request-${request.id}`} style={styles.pendingCard}>
          <Text style={styles.pendingType}>{REQUEST_TYPE_LABEL[request.type]}</Text>
          <Text style={styles.helpText}>{request.status}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 10 },
  heading: { fontSize: 18, fontWeight: '700', marginTop: 12 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, backgroundColor: '#f2f2f2' },
  typeButtonActive: { backgroundColor: '#2e6ef7' },
  typeButtonText: { color: '#222' },
  typeButtonTextActive: { color: '#fff', fontWeight: '600' },
  fieldGroup: { gap: 6 },
  label: { fontSize: 13, color: '#555' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8 },
  errorText: { color: '#d92d20' },
  submitButton: { backgroundColor: '#12b76a', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  submitButtonText: { color: '#fff', fontWeight: '600' },
  pendingCard: { padding: 12, borderRadius: 8, backgroundColor: '#f8f8f8', gap: 2 },
  pendingType: { fontSize: 14, fontWeight: '600' },
  helpText: { fontSize: 13, color: '#555' },
});
