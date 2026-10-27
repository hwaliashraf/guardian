import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Feature, Tier } from '@guardian/domain';
import { TIER_DEVICE_LIMIT, TIER_FEATURES } from '@guardian/domain';

const TIER_ORDER: Tier[] = ['free', 'standard', 'premium'];
const TIER_LABEL: Record<Tier, string> = { free: 'Free', standard: 'Standard', premium: 'Premium' };

// Display labels only — does not affect which features belong to which tier (that's
// TIER_FEATURES itself, rendered directly below via `.map()`, never hand-copied here). Adding a
// new Feature to the union (packages/domain/src/tiers/features.ts) forces this map to be
// extended too (Record<Feature, string> exhaustiveness), so it can't silently go stale.
const FEATURE_LABEL: Record<Feature, string> = {
  website_blocker: 'Website blocker',
  instant_pause: 'Instant pause',
  app_blocker: 'App blocker',
  schedules: 'Schedules & routines',
  screen_time: 'Screen time limits',
  locator: 'Family locator',
  vpn_shield: 'VPN adult-ad shield',
  usage_buckets: 'Usage buckets',
  presence_detection: 'Presence detection',
  per_app_limits: 'Per-app time limits',
  priority_support: 'Priority support',
};

function handleContactUs() {
  // Placeholder only — no real payment/subscription processing. Adding a payment provider is a
  // new vendor dependency (an escalation decision, per CLAUDE.md), out of this ticket's scope by
  // its own explicit instruction. A real implementation would deep-link to a checkout flow or
  // open a support channel; this just surfaces contact info.
  Alert.alert('Contact us to upgrade', 'Email support@guardian.example to upgrade your family plan.');
}

/**
 * Spec §3.8 (tiers). Every gated screen's upsell CTA (`BucketsScreen`/`AppManagementScreen`/
 * `FamilyMapScreen`/`GeofenceEditorScreen`/`LocationHistoryScreen`, T14/T16/T17) already calls
 * `navigation.navigate('Paywall')` — this screen is that destination. Renders the 3-tier table
 * directly from T06's `TIER_FEATURES`/`TIER_DEVICE_LIMIT` exports (`.map()` over the real
 * objects, no per-tier JSX enumerating features by hand) so it structurally cannot drift from
 * the actual gating logic those hooks (`hasFeature`) and the backend (`assertFeature`,
 * `packages/backend/src/policySync.ts`) enforce.
 */
export default function PaywallScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Choose your plan</Text>
      {TIER_ORDER.map((tier) => (
        <View key={tier} testID={`paywall-tier-${tier}`} style={styles.tierCard}>
          <Text style={styles.tierName}>{TIER_LABEL[tier]}</Text>
          <Text testID={`paywall-tier-${tier}-device-limit`} style={styles.deviceLimit}>
            Up to {TIER_DEVICE_LIMIT[tier]} device{TIER_DEVICE_LIMIT[tier] === 1 ? '' : 's'}
          </Text>
          {TIER_FEATURES[tier].map((feature) => (
            <Text key={feature} testID={`paywall-tier-${tier}-feature-${feature}`} style={styles.featureRow}>
              ✓ {FEATURE_LABEL[feature]}
            </Text>
          ))}
        </View>
      ))}
      <Pressable testID="paywall-contact-us" style={styles.ctaButton} onPress={handleContactUs}>
        <Text style={styles.ctaButtonText}>Contact us to upgrade</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 16 },
  heading: { fontSize: 20, fontWeight: '700' },
  tierCard: { padding: 16, borderRadius: 12, backgroundColor: '#f2f2f2', gap: 6 },
  tierName: { fontSize: 17, fontWeight: '700' },
  deviceLimit: { fontSize: 13, color: '#555' },
  featureRow: { fontSize: 14 },
  ctaButton: { padding: 16, borderRadius: 8, backgroundColor: '#1a73e8', marginTop: 8 },
  ctaButtonText: { color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: '600' },
});
