import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BucketCategoryConfig } from '@guardian/domain';
import { hasFeature } from '@guardian/domain';
import type { ParentStackParamList } from '../../navigation/ParentNavigator';
import { useFamily } from '../dashboard/useFamily';
import { usePolicy } from '../policy/usePolicy';

interface CategoryRow {
  categoryId: string;
  maxSessionMinutes: string;
  mandatoryBreakMinutes: string;
  maxSessionsPerDay: string;
  graceFinishEnabled: boolean;
}

function configToRow(categoryId: string, config: BucketCategoryConfig): CategoryRow {
  return {
    categoryId,
    maxSessionMinutes: String(config.maxSessionMinutes),
    mandatoryBreakMinutes: String(config.mandatoryBreakMinutes),
    maxSessionsPerDay: config.maxSessionsPerDay !== undefined ? String(config.maxSessionsPerDay) : '',
    graceFinishEnabled: config.graceFinishEnabled,
  };
}

function rowToConfig(row: CategoryRow): BucketCategoryConfig {
  const maxSessionsPerDay = row.maxSessionsPerDay.trim() ? Number(row.maxSessionsPerDay) || 0 : undefined;
  return {
    maxSessionMinutes: Number(row.maxSessionMinutes) || 0,
    mandatoryBreakMinutes: Number(row.mandatoryBreakMinutes) || 0,
    ...(maxSessionsPerDay !== undefined ? { maxSessionsPerDay } : {}),
    graceFinishEnabled: row.graceFinishEnabled,
  };
}

// Mandatory break must be > 0 whenever a max session length is configured — a break of 0
// minutes would let a session restart the instant it "ends", defeating the mandatory-break
// rule entirely (see packages/domain/src/buckets, T03).
function isRowValid(row: CategoryRow): boolean {
  const maxSession = Number(row.maxSessionMinutes) || 0;
  const mandatoryBreak = Number(row.mandatoryBreakMinutes) || 0;
  return maxSession <= 0 || mandatoryBreak > 0;
}

type Props = NativeStackScreenProps<ParentStackParamList, 'Buckets'>;

export default function BucketsScreen({ route, navigation }: Props) {
  const { childId } = route.params;
  const { data: familyData, loading: familyLoading } = useFamily();
  const { policy, loading: policyLoading, saving, error, save } = usePolicy(childId);

  const [defaultRow, setDefaultRow] = useState<CategoryRow>(
    configToRow('default', {
      maxSessionMinutes: 0,
      mandatoryBreakMinutes: 0,
      graceFinishEnabled: false,
    }),
  );
  const [overrides, setOverrides] = useState<CategoryRow[]>([]);

  useEffect(() => {
    if (!policy) return;
    setDefaultRow(configToRow('default', policy.buckets.default));
    setOverrides(
      Object.entries(policy.buckets.perCategory).map(([categoryId, config]) => configToRow(categoryId, config)),
    );
  }, [policy]);

  const addOverride = useCallback(() => {
    setOverrides((prev) => [
      ...prev,
      configToRow('', { maxSessionMinutes: 0, mandatoryBreakMinutes: 0, graceFinishEnabled: false }),
    ]);
  }, []);

  const updateOverride = useCallback((index: number, patch: Partial<CategoryRow>) => {
    setOverrides((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }, []);

  const removeOverride = useCallback((index: number) => {
    setOverrides((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const allValid = useMemo(
    () => isRowValid(defaultRow) && overrides.every(isRowValid),
    [defaultRow, overrides],
  );

  const handleSave = useCallback(() => {
    if (!policy || !allValid) return;
    const perCategory: Record<string, BucketCategoryConfig> = {};
    for (const row of overrides) {
      const categoryId = row.categoryId.trim();
      if (categoryId) perCategory[categoryId] = rowToConfig(row);
    }
    save({ buckets: { default: rowToConfig(defaultRow), perCategory } }).catch(() => {});
  }, [policy, allValid, defaultRow, overrides, save]);

  if (familyLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const tier = familyData?.tier ?? 'free';

  if (!hasFeature(tier, 'usage_buckets')) {
    return (
      <View style={styles.center}>
        <View style={styles.upsellCard} testID="buckets-upsell">
          <Text style={styles.upsellTitle}>Usage Buckets is a Premium feature</Text>
          <Text style={styles.upsellBody}>
            Upgrade to Premium to set per-category session limits, mandatory breaks, and grace
            finish for your child's devices.
          </Text>
          <Pressable
            testID="buckets-upsell-cta"
            style={styles.upsellButton}
            onPress={() => navigation.navigate('Paywall')}
          >
            <Text style={styles.upsellButtonText}>Upgrade to Premium</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (policyLoading) {
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
      <Text style={styles.helpText}>
        A break shorter than the mandatory length doesn't reset your child's session — resuming
        early continues the same session, it doesn't grant a fresh one.
      </Text>
      <Text style={styles.helpText}>
        Grace finish gives a one-time +3 minute extension per session when enabled (fixed by
        design — not configurable).
      </Text>

      <Text style={styles.sectionTitle}>Default (applies to categories with no override)</Text>
      <CategoryRowEditor
        testIDPrefix="bucket-default"
        row={defaultRow}
        onChange={(patch) => setDefaultRow((prev) => ({ ...prev, ...patch }))}
      />

      <Text style={styles.sectionTitle}>Category overrides</Text>
      {overrides.map((row, index) => (
        <View key={index} testID={`bucket-row-${index}`} style={styles.overrideCard}>
          <TextInput
            testID={`bucket-row-${index}-category`}
            style={styles.input}
            placeholder="Category id"
            value={row.categoryId}
            onChangeText={(text) => updateOverride(index, { categoryId: text })}
          />
          <CategoryRowEditor
            testIDPrefix={`bucket-row-${index}`}
            row={row}
            onChange={(patch) => updateOverride(index, patch)}
          />
          <Pressable testID={`bucket-row-${index}-remove`} onPress={() => removeOverride(index)}>
            <Text style={styles.removeText}>Remove</Text>
          </Pressable>
        </View>
      ))}
      <Pressable testID="add-bucket-category" onPress={addOverride}>
        <Text style={styles.addText}>+ Add category override</Text>
      </Pressable>

      {!allValid ? (
        <Text testID="buckets-validation-error" style={styles.errorText}>
          Mandatory break must be greater than 0 whenever a max session length is set.
        </Text>
      ) : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Pressable
        testID="buckets-save"
        style={styles.saveButton}
        onPress={handleSave}
        disabled={saving || !allValid}
      >
        <Text style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save'}</Text>
      </Pressable>
    </ScrollView>
  );
}

function CategoryRowEditor({
  testIDPrefix,
  row,
  onChange,
}: {
  testIDPrefix: string;
  row: CategoryRow;
  onChange: (patch: Partial<CategoryRow>) => void;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>Max session length (minutes)</Text>
      <TextInput
        testID={`${testIDPrefix}-max-session`}
        style={styles.input}
        keyboardType="number-pad"
        value={row.maxSessionMinutes}
        onChangeText={(text) => onChange({ maxSessionMinutes: text })}
      />
      <Text style={styles.label}>Mandatory break (minutes)</Text>
      <TextInput
        testID={`${testIDPrefix}-break`}
        style={styles.input}
        keyboardType="number-pad"
        value={row.mandatoryBreakMinutes}
        onChangeText={(text) => onChange({ mandatoryBreakMinutes: text })}
      />
      {!isRowValid(row) ? (
        <Text testID={`${testIDPrefix}-error`} style={styles.errorText}>
          Mandatory break must be &gt; 0 when a max session length is set.
        </Text>
      ) : null}
      <Text style={styles.label}>Max sessions per day (optional)</Text>
      <TextInput
        testID={`${testIDPrefix}-max-sessions`}
        style={styles.input}
        keyboardType="number-pad"
        value={row.maxSessionsPerDay}
        onChangeText={(text) => onChange({ maxSessionsPerDay: text })}
      />
      <View style={styles.row}>
        <Text style={styles.label}>Grace finish (+3 min, once per session)</Text>
        <Switch
          testID={`${testIDPrefix}-grace`}
          value={row.graceFinishEnabled}
          onValueChange={(value) => onChange({ graceFinishEnabled: value })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  helpText: { fontSize: 13, color: '#555' },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 16 },
  fieldGroup: { gap: 4 },
  label: { fontSize: 14, fontWeight: '600', marginTop: 4 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  overrideCard: { padding: 12, borderRadius: 8, backgroundColor: '#f2f2f2', gap: 4, marginTop: 8 },
  removeText: { color: '#d92d20' },
  addText: { color: '#1a73e8', marginTop: 8 },
  errorText: { color: '#d92d20' },
  saveButton: { padding: 16, borderRadius: 8, backgroundColor: '#1a73e8', marginTop: 16 },
  saveButtonText: { color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: '600' },
  upsellCard: { padding: 20, borderRadius: 12, backgroundColor: '#f2f2f2', gap: 12, maxWidth: 400 },
  upsellTitle: { fontSize: 18, fontWeight: '700' },
  upsellBody: { fontSize: 14, color: '#555' },
  upsellButton: { padding: 14, borderRadius: 8, backgroundColor: '#1a73e8' },
  upsellButtonText: { color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: '600' },
});
