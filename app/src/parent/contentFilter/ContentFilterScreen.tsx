import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CONTENT_CATEGORIES, deriveAgeTier, getAgeBasedPreset } from '@guardian/domain';
import type { ParentStackParamList } from '../../navigation/ParentNavigator';
import { useFamily } from '../dashboard/useFamily';
import { usePolicy } from '../policy/usePolicy';

type Props = NativeStackScreenProps<ParentStackParamList, 'ContentFilter'>;

function StringListEditor({
  testIDPrefix,
  items,
  onAdd,
  onRemove,
  placeholder,
}: {
  testIDPrefix: string;
  items: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState('');

  const handleAdd = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed || items.includes(trimmed)) return;
    onAdd(trimmed);
    setDraft('');
  }, [draft, items, onAdd]);

  return (
    <View style={styles.fieldGroup}>
      <View style={styles.chipWrap}>
        {items.map((item) => (
          <Pressable key={item} testID={`${testIDPrefix}-chip-${item}`} onPress={() => onRemove(item)}>
            <Text style={styles.chip}>{item} ×</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.row}>
        <TextInput
          testID={`${testIDPrefix}-draft`}
          style={[styles.input, styles.rowInput]}
          placeholder={placeholder}
          value={draft}
          onChangeText={setDraft}
        />
        <Pressable testID={`${testIDPrefix}-add`} onPress={handleAdd}>
          <Text style={styles.addText}>Add</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function ContentFilterScreen({ route }: Props) {
  const { childId } = route.params;
  const { data: familyData, loading: familyLoading } = useFamily();
  const { policy, loading: policyLoading, saving, error, save } = usePolicy(childId);

  const [categories, setCategories] = useState<Record<string, 'block' | 'allow'>>({});
  const [whitelistOnly, setWhitelistOnly] = useState(false);
  const [customAllowDomains, setCustomAllowDomains] = useState<string[]>([]);
  const [customBlockDomains, setCustomBlockDomains] = useState<string[]>([]);
  const [customBlockKeywords, setCustomBlockKeywords] = useState<string[]>([]);
  const [safeSearchEnforced, setSafeSearchEnforced] = useState(false);
  const [youtubeRestrictedMode, setYoutubeRestrictedMode] = useState(false);

  const childBirthdate = familyData?.children.find((c) => c.id === childId)?.birthdate;

  useEffect(() => {
    if (!policy) return;
    const cf = policy.contentFilter;
    const hasExistingCategories = Object.keys(cf.categories).length > 0;
    if (!hasExistingCategories && childBirthdate) {
      // No ContentFilterPolicy configured yet for this child — pre-populate from the
      // age-based preset rather than leaving every category unset.
      setCategories(getAgeBasedPreset(deriveAgeTier(childBirthdate)));
    } else {
      setCategories(cf.categories);
    }
    setWhitelistOnly(cf.whitelistOnly);
    setCustomAllowDomains(cf.customAllowDomains);
    setCustomBlockDomains(cf.customBlockDomains);
    setCustomBlockKeywords(cf.customBlockKeywords);
    setSafeSearchEnforced(cf.safeSearchEnforced);
    setYoutubeRestrictedMode(cf.youtubeRestrictedMode);
    // `childBirthdate` is included: `useFamily`/`usePolicy` resolve independently, so `policy`
    // can become non-null before `childBirthdate` does — without this dep, that race would
    // permanently skip the age-preset seed (the effect only re-runs when a dep changes). Safe
    // to re-run once birthdate resolves: `hasExistingCategories` still correctly no-ops once
    // real categories exist, and `childBirthdate` never changes again after it first resolves.
  }, [policy, childBirthdate]);

  const toggleCategory = useCallback((id: string) => {
    setCategories((prev) => ({ ...prev, [id]: prev[id] === 'block' ? 'allow' : 'block' }));
  }, []);

  const handleSave = useCallback(() => {
    if (!policy) return;
    save({
      contentFilter: {
        categories,
        whitelistOnly,
        customAllowDomains,
        customBlockDomains,
        customBlockKeywords,
        safeSearchEnforced,
        youtubeRestrictedMode,
      },
    }).catch(() => {});
  }, [
    policy,
    categories,
    whitelistOnly,
    customAllowDomains,
    customBlockDomains,
    customBlockKeywords,
    safeSearchEnforced,
    youtubeRestrictedMode,
    save,
  ]);

  if (familyLoading || policyLoading) {
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
      <View style={styles.row}>
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Whitelist-only mode</Text>
          <Text style={styles.helpText}>
            Stricter mode: every category is blocked except sites you explicitly add to Allowed
            domains below. Category toggles below have no effect while this is on.
          </Text>
        </View>
        <Switch
          testID="content-filter-whitelist-only"
          value={whitelistOnly}
          onValueChange={setWhitelistOnly}
        />
      </View>
      {whitelistOnly ? (
        <Text testID="content-filter-whitelist-banner" style={styles.whitelistBanner}>
          Whitelist-only mode is ON — only domains in "Allowed domains" below are reachable.
        </Text>
      ) : null}

      <Text style={styles.sectionTitle}>Categories</Text>
      <View style={styles.categoryGrid}>
        {CONTENT_CATEGORIES.map((category) => {
          const blocked = categories[category.id] === 'block';
          return (
            <Pressable
              key={category.id}
              testID={`category-${category.id}`}
              style={[styles.categoryCell, blocked && styles.categoryCellBlocked]}
              disabled={whitelistOnly}
              onPress={() => toggleCategory(category.id)}
            >
              <Text style={styles.categoryLabel}>{category.label}</Text>
              <Text style={styles.categoryState}>{blocked ? 'Blocked' : 'Allowed'}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.sectionTitle}>Allowed domains</Text>
      <StringListEditor
        testIDPrefix="content-filter-allow-domains"
        items={customAllowDomains}
        onAdd={(value) => setCustomAllowDomains((prev) => [...prev, value])}
        onRemove={(value) => setCustomAllowDomains((prev) => prev.filter((d) => d !== value))}
        placeholder="example.com"
      />

      <Text style={styles.sectionTitle}>Blocked domains</Text>
      <StringListEditor
        testIDPrefix="content-filter-block-domains"
        items={customBlockDomains}
        onAdd={(value) => setCustomBlockDomains((prev) => [...prev, value])}
        onRemove={(value) => setCustomBlockDomains((prev) => prev.filter((d) => d !== value))}
        placeholder="example.com"
      />

      <Text style={styles.sectionTitle}>Blocked keywords</Text>
      <StringListEditor
        testIDPrefix="content-filter-block-keywords"
        items={customBlockKeywords}
        onAdd={(value) => setCustomBlockKeywords((prev) => [...prev, value])}
        onRemove={(value) => setCustomBlockKeywords((prev) => prev.filter((k) => k !== value))}
        placeholder="keyword"
      />

      <View style={styles.row}>
        <Text style={styles.label}>Enforce SafeSearch (Google/Bing/DuckDuckGo)</Text>
        <Switch
          testID="content-filter-safe-search"
          value={safeSearchEnforced}
          onValueChange={setSafeSearchEnforced}
        />
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>YouTube Restricted Mode</Text>
        <Switch
          testID="content-filter-youtube-restricted"
          value={youtubeRestrictedMode}
          onValueChange={setYoutubeRestrictedMode}
        />
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Pressable
        testID="content-filter-save"
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  fieldGroup: { gap: 4, flex: 1 },
  label: { fontSize: 14, fontWeight: '600' },
  helpText: { fontSize: 13, color: '#555' },
  whitelistBanner: { color: '#b45309', fontWeight: '600' },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 16 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryCell: { padding: 8, borderRadius: 6, backgroundColor: '#e0e0e0', minWidth: 120 },
  categoryCellBlocked: { backgroundColor: '#fca5a5' },
  categoryLabel: { fontSize: 13, fontWeight: '600' },
  categoryState: { fontSize: 12, color: '#333' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8 },
  rowInput: { flex: 1 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 4, backgroundColor: '#e0e0e0' },
  addText: { color: '#1a73e8' },
  errorText: { color: '#d92d20' },
  saveButton: { padding: 16, borderRadius: 8, backgroundColor: '#1a73e8', marginTop: 16 },
  saveButtonText: { color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: '600' },
});
