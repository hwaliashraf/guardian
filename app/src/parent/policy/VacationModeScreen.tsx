import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ParentStackParamList } from '../../navigation/ParentNavigator';
import { usePolicy } from './usePolicy';

type Props = NativeStackScreenProps<ParentStackParamList, 'VacationMode'>;

function currentStateLabel(enabled: boolean, endDate: string | null): string {
  if (!enabled) return 'Inactive';
  return endDate ? `Active until ${endDate}` : 'Active (no end date)';
}

export default function VacationModeScreen({ route }: Props) {
  const { childId } = route.params;
  const { policy, loading, saving, error, save } = usePolicy(childId);

  const [enabled, setEnabled] = useState(false);
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    if (!policy) return;
    setEnabled(policy.vacation.enabled);
    setEndDate(policy.vacation.endDate ?? '');
  }, [policy]);

  const handleSave = useCallback(() => {
    if (!policy) return;
    save({ vacation: { enabled, endDate: endDate.trim() ? endDate.trim() : null } }).catch(() => {});
  }, [policy, enabled, endDate, save]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!policy) {
    return (
      <View style={styles.center}>
        <Text>No policy found for this child yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text testID="vacation-current-state" style={styles.currentState}>
        {currentStateLabel(policy.vacation.enabled, policy.vacation.endDate)}
      </Text>

      <View style={styles.row}>
        <Text style={styles.label}>Vacation mode</Text>
        <Switch testID="vacation-toggle" value={enabled} onValueChange={setEnabled} />
      </View>

      <Text style={styles.label}>Auto-restore end date</Text>
      <TextInput
        testID="vacation-end-date"
        style={styles.input}
        editable={enabled}
        placeholder="YYYY-MM-DD"
        value={endDate}
        onChangeText={setEndDate}
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Pressable testID="vacation-save" style={styles.saveButton} onPress={handleSave} disabled={saving}>
        <Text style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  currentState: { fontSize: 16, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 14, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8 },
  errorText: { color: '#d92d20' },
  saveButton: { padding: 16, borderRadius: 8, backgroundColor: '#1a73e8', marginTop: 8 },
  saveButtonText: { color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: '600' },
});
