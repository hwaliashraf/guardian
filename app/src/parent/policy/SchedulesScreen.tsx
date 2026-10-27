import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RoutineType, SchedulePolicy } from '@guardian/domain';
import type { ParentStackParamList } from '../../navigation/ParentNavigator';
import { usePolicy } from './usePolicy';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_DAYS = [1, 2, 3, 4, 5];
const WEEKEND_DAYS = [0, 6];
const ADDABLE_TYPES: RoutineType[] = ['homework', 'mealtime', 'school', 'custom'];

function sameDaySet(a: number[], b: number[]): boolean {
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  return sortedA.length === sortedB.length && sortedA.every((d, i) => d === sortedB[i]);
}

// Per T05's documented convention: weekday/weekend sleep is two separate `bedtime` rows, not
// one row with special-cased days — the UI labels each row by its daysOfWeek set instead of
// exposing the raw RoutineType so a parent never has to think about the list abstraction.
function scheduleLabel(entry: SchedulePolicy): string {
  if (entry.type === 'bedtime') {
    if (sameDaySet(entry.daysOfWeek, WEEKDAY_DAYS)) return 'Weekday bedtime';
    if (sameDaySet(entry.daysOfWeek, WEEKEND_DAYS)) return 'Weekend bedtime';
    return 'Bedtime';
  }
  return entry.type.charAt(0).toUpperCase() + entry.type.slice(1);
}

function generateScheduleId(): string {
  return `sch_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

type Props = NativeStackScreenProps<ParentStackParamList, 'Schedules'>;

export default function SchedulesScreen({ route }: Props) {
  const { childId } = route.params;
  const { policy, loading, saving, error, save } = usePolicy(childId);

  const [schedules, setSchedules] = useState<SchedulePolicy[]>([]);
  const [categoryDraft, setCategoryDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!policy) return;
    setSchedules(policy.schedules);
  }, [policy]);

  const addEntry = useCallback((entry: SchedulePolicy) => {
    setSchedules((prev) => [...prev, entry]);
  }, []);

  const addWeekdayBedtime = useCallback(() => {
    addEntry({
      id: generateScheduleId(),
      type: 'bedtime',
      daysOfWeek: [...WEEKDAY_DAYS],
      startTime: '21:00',
      endTime: '07:00',
      allowedCategories: [],
    });
  }, [addEntry]);

  const addWeekendBedtime = useCallback(() => {
    addEntry({
      id: generateScheduleId(),
      type: 'bedtime',
      daysOfWeek: [...WEEKEND_DAYS],
      startTime: '22:00',
      endTime: '08:00',
      allowedCategories: [],
    });
  }, [addEntry]);

  const addRoutine = useCallback(
    (type: RoutineType) => {
      addEntry({
        id: generateScheduleId(),
        type,
        daysOfWeek: [],
        startTime: '00:00',
        endTime: '00:00',
        allowedCategories: [],
      });
    },
    [addEntry],
  );

  const updateEntry = useCallback((id: string, patch: Partial<SchedulePolicy>) => {
    setSchedules((prev) => prev.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }, []);

  const removeEntry = useCallback((id: string) => {
    setSchedules((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const toggleDay = useCallback(
    (entry: SchedulePolicy, day: number) => {
      const daysOfWeek = entry.daysOfWeek.includes(day)
        ? entry.daysOfWeek.filter((d) => d !== day)
        : [...entry.daysOfWeek, day].sort((a, b) => a - b);
      updateEntry(entry.id, { daysOfWeek });
    },
    [updateEntry],
  );

  const addAllowedCategory = useCallback(
    (entry: SchedulePolicy) => {
      const categoryId = (categoryDraft[entry.id] ?? '').trim();
      if (!categoryId || entry.allowedCategories.includes(categoryId)) return;
      updateEntry(entry.id, { allowedCategories: [...entry.allowedCategories, categoryId] });
      setCategoryDraft((prev) => ({ ...prev, [entry.id]: '' }));
    },
    [categoryDraft, updateEntry],
  );

  const removeAllowedCategory = useCallback(
    (entry: SchedulePolicy, categoryId: string) => {
      updateEntry(entry.id, {
        allowedCategories: entry.allowedCategories.filter((c) => c !== categoryId),
      });
    },
    [updateEntry],
  );

  const handleSave = useCallback(() => {
    save({ schedules }).catch(() => {});
  }, [schedules, save]);

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
      {schedules.map((entry) => (
        <View key={entry.id} style={styles.card} testID={`schedule-row-${entry.id}`}>
          <Text style={styles.cardTitle}>{scheduleLabel(entry)}</Text>

          <View style={styles.dayRow}>
            {DAY_LABELS.map((label, day) => {
              const active = entry.daysOfWeek.includes(day);
              return (
                <Pressable
                  key={day}
                  testID={`schedule-row-${entry.id}-day-${day}`}
                  style={[styles.dayChip, active && styles.dayChipActive]}
                  onPress={() => toggleDay(entry, day)}
                >
                  <Text style={active ? styles.dayChipTextActive : styles.dayChipText}>{label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.row}>
            <TextInput
              testID={`schedule-row-${entry.id}-start`}
              style={[styles.input, styles.rowInput]}
              value={entry.startTime}
              onChangeText={(text) => updateEntry(entry.id, { startTime: text })}
              placeholder="HH:mm"
            />
            <TextInput
              testID={`schedule-row-${entry.id}-end`}
              style={[styles.input, styles.rowInput]}
              value={entry.endTime}
              onChangeText={(text) => updateEntry(entry.id, { endTime: text })}
              placeholder="HH:mm"
            />
          </View>

          <Text style={styles.label}>Allowed categories</Text>
          <View style={styles.chipWrap}>
            {entry.allowedCategories.map((categoryId) => (
              <Pressable
                key={categoryId}
                testID={`schedule-row-${entry.id}-category-${categoryId}`}
                onPress={() => removeAllowedCategory(entry, categoryId)}
              >
                <Text style={styles.chip}>{categoryId} ×</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.row}>
            <TextInput
              testID={`schedule-row-${entry.id}-category-draft`}
              style={[styles.input, styles.rowInput]}
              placeholder="Category id"
              value={categoryDraft[entry.id] ?? ''}
              onChangeText={(text) => setCategoryDraft((prev) => ({ ...prev, [entry.id]: text }))}
            />
            <Pressable
              testID={`schedule-row-${entry.id}-category-add`}
              onPress={() => addAllowedCategory(entry)}
            >
              <Text style={styles.addText}>Add</Text>
            </Pressable>
          </View>

          <Pressable testID={`schedule-row-${entry.id}-remove`} onPress={() => removeEntry(entry.id)}>
            <Text style={styles.removeText}>Remove schedule</Text>
          </Pressable>
        </View>
      ))}

      <Text style={styles.sectionTitle}>Add a schedule</Text>
      <View style={styles.chipWrap}>
        <Pressable testID="add-weekday-bedtime" onPress={addWeekdayBedtime}>
          <Text style={styles.addText}>+ Weekday bedtime</Text>
        </Pressable>
        <Pressable testID="add-weekend-bedtime" onPress={addWeekendBedtime}>
          <Text style={styles.addText}>+ Weekend bedtime</Text>
        </Pressable>
        {ADDABLE_TYPES.map((type) => (
          <Pressable key={type} testID={`add-routine-${type}`} onPress={() => addRoutine(type)}>
            <Text style={styles.addText}>+ {type.charAt(0).toUpperCase() + type.slice(1)}</Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Pressable
        testID="schedules-save"
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
  content: { padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { padding: 12, borderRadius: 8, backgroundColor: '#f2f2f2', gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 8 },
  label: { fontSize: 14, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowInput: { flex: 1 },
  dayRow: { flexDirection: 'row', gap: 4 },
  dayChip: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 4, backgroundColor: '#e0e0e0' },
  dayChipActive: { backgroundColor: '#1a73e8' },
  dayChipText: { color: '#333' },
  dayChipTextActive: { color: '#fff' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 4, backgroundColor: '#e0e0e0' },
  removeText: { color: '#d92d20' },
  addText: { color: '#1a73e8' },
  errorText: { color: '#d92d20', marginTop: 8 },
  saveButton: { padding: 16, borderRadius: 8, backgroundColor: '#1a73e8', marginTop: 8 },
  saveButtonText: { color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: '600' },
});
