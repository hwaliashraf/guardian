import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ParentStackParamList } from '../../navigation/ParentNavigator';
import { usePolicy } from './usePolicy';

interface CategoryRow {
  categoryId: string;
  minutes: string;
}

type Props = NativeStackScreenProps<ParentStackParamList, 'ScreenTime'>;

export default function ScreenTimeScreen({ route }: Props) {
  const { childId } = route.params;
  const { policy, loading, saving, error, save } = usePolicy(childId);

  const [daily, setDaily] = useState('0');
  const [weekly, setWeekly] = useState('0');
  const [rows, setRows] = useState<CategoryRow[]>([]);

  // Resyncs local form state whenever `policy` changes (initial load, and again after a
  // successful save — the persisted values match what was just submitted, so this never
  // visibly disrupts an in-progress edit).
  useEffect(() => {
    if (!policy) return;
    setDaily(String(policy.screenTime.dailyLimitMinutes));
    setWeekly(String(policy.screenTime.weeklyLimitMinutes));
    setRows(
      Object.entries(policy.screenTime.perCategory).map(([categoryId, minutes]) => ({
        categoryId,
        minutes: String(minutes),
      })),
    );
  }, [policy]);

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, { categoryId: '', minutes: '0' }]);
  }, []);

  const updateRow = useCallback((index: number, patch: Partial<CategoryRow>) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }, []);

  const removeRow = useCallback((index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSave = useCallback(() => {
    if (!policy) return;
    const perCategory: Record<string, number> = {};
    for (const row of rows) {
      const categoryId = row.categoryId.trim();
      if (categoryId) perCategory[categoryId] = Number(row.minutes) || 0;
    }
    // perApp is preserved untouched — this screen doesn't edit per-app limits (that's a
    // separate surface); sending screenTime replaces the whole sub-object server-side, so
    // omitting perApp here would silently wipe it.
    save({
      screenTime: {
        ...policy.screenTime,
        dailyLimitMinutes: Number(daily) || 0,
        weeklyLimitMinutes: Number(weekly) || 0,
        perCategory,
      },
    }).catch(() => {});
  }, [policy, rows, daily, weekly, save]);

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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Daily limit (minutes)</Text>
      <TextInput
        testID="screen-time-daily"
        style={styles.input}
        keyboardType="number-pad"
        value={daily}
        onChangeText={setDaily}
      />

      <Text style={styles.label}>Weekly limit (minutes)</Text>
      <TextInput
        testID="screen-time-weekly"
        style={styles.input}
        keyboardType="number-pad"
        value={weekly}
        onChangeText={setWeekly}
      />

      <Text style={styles.sectionTitle}>Per-category limits</Text>
      {rows.map((row, index) => (
        <View key={index} style={styles.row} testID={`category-row-${index}`}>
          <TextInput
            testID={`category-row-${index}-id`}
            style={[styles.input, styles.rowInput]}
            placeholder="Category id"
            value={row.categoryId}
            onChangeText={(text) => updateRow(index, { categoryId: text })}
          />
          <TextInput
            testID={`category-row-${index}-minutes`}
            style={[styles.input, styles.rowInput]}
            keyboardType="number-pad"
            value={row.minutes}
            onChangeText={(text) => updateRow(index, { minutes: text })}
          />
          <Pressable testID={`category-row-${index}-remove`} onPress={() => removeRow(index)}>
            <Text style={styles.removeText}>Remove</Text>
          </Pressable>
        </View>
      ))}
      <Pressable testID="add-category-row" onPress={addRow}>
        <Text style={styles.addText}>+ Add category</Text>
      </Pressable>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Pressable
        testID="screen-time-save"
        style={styles.saveButton}
        onPress={handleSave}
        disabled={saving}
      >
        <Text style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 14, fontWeight: '600', marginTop: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 16 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowInput: { flex: 1 },
  removeText: { color: '#d92d20' },
  addText: { color: '#1a73e8', marginTop: 4 },
  errorText: { color: '#d92d20', marginTop: 8 },
  saveButton: { padding: 16, borderRadius: 8, backgroundColor: '#1a73e8', marginTop: 16 },
  saveButtonText: { color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: '600' },
});
