import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { hasFeature } from '@guardian/domain';
import type { ParentStackParamList } from '../../navigation/ParentNavigator';
import { useFamily } from '../dashboard/useFamily';
import { usePolicy } from '../policy/usePolicy';
import { useInstalledApps } from './useInstalledApps';

const RATING_TIERS = ['4+', '9+', '12+', '17+', 'Mature'] as const;
const DEFAULT_BLOCKED_RATINGS = new Set<string>(['17+', 'Mature']);

type Props = NativeStackScreenProps<ParentStackParamList, 'AppManagement'>;

export default function AppManagementScreen({ route, navigation }: Props) {
  const { childId } = route.params;
  const { data: familyData, loading: familyLoading } = useFamily();
  const { policy, loading: policyLoading, saving, error, save } = usePolicy(childId);
  const { apps: installedApps, loading: appsLoading, error: appsError } = useInstalledApps(childId);

  const [decisions, setDecisions] = useState<Record<string, 'block' | 'allow'>>({});
  const [ratingBlocks, setRatingBlocks] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!policy) return;
    const blocked = new Set(policy.appRules.blockedApps);
    const nextDecisions: Record<string, 'block' | 'allow'> = {};
    for (const app of installedApps) {
      nextDecisions[app.appId] = blocked.has(app.appId) ? 'block' : 'allow';
    }
    setDecisions(nextDecisions);

    const hasExistingRatingConfig = policy.appRules.blockByStoreRating.length > 0;
    const configuredRatings = new Set(policy.appRules.blockByStoreRating);
    const nextRatingBlocks: Record<string, boolean> = {};
    for (const rating of RATING_TIERS) {
      nextRatingBlocks[rating] = hasExistingRatingConfig
        ? configuredRatings.has(rating)
        : DEFAULT_BLOCKED_RATINGS.has(rating);
    }
    setRatingBlocks(nextRatingBlocks);
  }, [policy, installedApps]);

  const toggleApp = useCallback((appId: string) => {
    setDecisions((prev) => ({ ...prev, [appId]: prev[appId] === 'block' ? 'allow' : 'block' }));
  }, []);

  const toggleRating = useCallback((rating: string) => {
    setRatingBlocks((prev) => ({ ...prev, [rating]: !prev[rating] }));
  }, []);

  const handleSave = useCallback(() => {
    if (!policy) return;
    // Preserve any blocked/allowed entries for apps not currently shown (e.g. previously
    // blocked apps no longer in the installed-app fixture/list) — only apps actually visible
    // here get their decision rebuilt, so nothing outside this screen's view is silently lost.
    const shownAppIds = new Set(installedApps.map((a) => a.appId));
    const preservedBlocked = policy.appRules.blockedApps.filter((id) => !shownAppIds.has(id));
    const preservedAllowed = policy.appRules.allowedApps.filter((id) => !shownAppIds.has(id));
    const newBlocked = installedApps.filter((a) => decisions[a.appId] === 'block').map((a) => a.appId);
    const newAllowed = installedApps.filter((a) => decisions[a.appId] !== 'block').map((a) => a.appId);
    const blockByStoreRating = RATING_TIERS.filter((r) => ratingBlocks[r]);

    const blockedApps = [...preservedBlocked, ...newBlocked];
    // Defensive final invariant guard, not just "correct by construction": `newBlocked`/
    // `newAllowed` can never overlap (built from one complementary filter over the same list),
    // but `preservedBlocked`/`preservedAllowed` come from whatever the existing policy already
    // had — if that was ever inconsistent (pre-T16 state, a manual DB edit), blocked wins.
    const blockedSet = new Set(blockedApps);
    const allowedApps = [...preservedAllowed, ...newAllowed].filter((id) => !blockedSet.has(id));

    save({
      appRules: { blockedApps, allowedApps, blockByStoreRating },
    }).catch(() => {});
  }, [policy, installedApps, decisions, ratingBlocks, save]);

  if (familyLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const tier = familyData?.tier ?? 'free';

  if (!hasFeature(tier, 'app_blocker')) {
    return (
      <View style={styles.center}>
        <View style={styles.upsellCard} testID="app-management-upsell">
          <Text style={styles.upsellTitle}>App Management is a Standard+ feature</Text>
          <Text style={styles.upsellBody}>
            Upgrade to block or allow individual apps and preemptively block by store rating.
          </Text>
          <Pressable
            testID="app-management-upsell-cta"
            style={styles.upsellButton}
            onPress={() => navigation.navigate('Paywall')}
          >
            <Text style={styles.upsellButtonText}>Upgrade</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (policyLoading || appsLoading) {
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
      <Text style={styles.sectionTitle}>Block by store rating</Text>
      <Text style={styles.helpText}>
        Apps rated at a checked tier are blocked by default, even before you review them below.
      </Text>
      <View style={styles.chipWrap}>
        {RATING_TIERS.map((rating) => (
          <Pressable
            key={rating}
            testID={`rating-${rating}`}
            style={[styles.ratingChip, ratingBlocks[rating] && styles.ratingChipActive]}
            onPress={() => toggleRating(rating)}
          >
            <Text style={ratingBlocks[rating] ? styles.ratingChipTextActive : styles.ratingChipText}>
              {rating}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Installed apps</Text>
      {appsError ? <Text style={styles.errorText}>{appsError}</Text> : null}
      {installedApps.map((app) => {
        const blocked = decisions[app.appId] === 'block';
        return (
          <View key={app.appId} testID={`app-row-${app.appId}`} style={styles.appRow}>
            <View style={styles.fieldGroup}>
              <Text style={styles.appName}>{app.name}</Text>
              <Text style={styles.helpText}>
                {app.storeRating ?? 'Unrated'} · {blocked ? 'Blocked' : 'Allowed'}
              </Text>
            </View>
            <Switch
              testID={`app-row-${app.appId}-toggle`}
              value={blocked}
              onValueChange={() => toggleApp(app.appId)}
            />
          </View>
        );
      })}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Pressable
        testID="app-management-save"
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
  sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 16 },
  helpText: { fontSize: 13, color: '#555' },
  fieldGroup: { gap: 2, flex: 1 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ratingChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, backgroundColor: '#e0e0e0' },
  ratingChipActive: { backgroundColor: '#d92d20' },
  ratingChipText: { color: '#333', fontWeight: '600' },
  ratingChipTextActive: { color: '#fff', fontWeight: '600' },
  appRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: 8, backgroundColor: '#f2f2f2', marginTop: 8, gap: 8 },
  appName: { fontSize: 14, fontWeight: '600' },
  errorText: { color: '#d92d20' },
  saveButton: { padding: 16, borderRadius: 8, backgroundColor: '#1a73e8', marginTop: 16 },
  saveButtonText: { color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: '600' },
  upsellCard: { padding: 20, borderRadius: 12, backgroundColor: '#f2f2f2', gap: 12, maxWidth: 400 },
  upsellTitle: { fontSize: 18, fontWeight: '700' },
  upsellBody: { fontSize: 14, color: '#555' },
  upsellButton: { padding: 14, borderRadius: 8, backgroundColor: '#1a73e8' },
  upsellButtonText: { color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: '600' },
});
