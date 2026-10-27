import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { hasFeature } from '@guardian/domain';
import type { ParentStackParamList } from '../../navigation/ParentNavigator';
import { useFamily } from '../dashboard/useFamily';
import { useChildLocations } from './useChildLocations';
import { ActiveMapProvider, type MapPin } from './MapProvider';

type Props = NativeStackScreenProps<ParentStackParamList, 'FamilyMap'>;

export default function FamilyMapScreen({ navigation }: Props) {
  const { data: familyData, loading: familyLoading } = useFamily();
  const children = familyData?.children ?? [];
  const childIds = children.map((c) => c.id);
  const { locations, loading: locationsLoading, error } = useChildLocations(childIds);

  if (familyLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const tier = familyData?.tier ?? 'free';

  if (!hasFeature(tier, 'locator')) {
    return (
      <View style={styles.center}>
        <View style={styles.upsellCard} testID="family-map-upsell">
          <Text style={styles.upsellTitle}>Family Map is a Standard+ feature</Text>
          <Text style={styles.upsellBody}>
            Upgrade to see real-time location on a family map and set up geofence alerts.
          </Text>
          <Pressable
            testID="family-map-upsell-cta"
            style={styles.upsellButton}
            onPress={() => navigation.navigate('Paywall')}
          >
            <Text style={styles.upsellButtonText}>Upgrade</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (locationsLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const pins: MapPin[] = children
    .filter((c) => locations[c.id])
    .map((c) => ({ id: c.id, label: c.name, lat: locations[c.id].lat, lng: locations[c.id].lng }));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Family locations</Text>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <ActiveMapProvider pins={pins} />

      <Text style={styles.sectionTitle}>Children</Text>
      {children.map((child) => (
        <View key={child.id} testID={`family-map-child-${child.id}`} style={styles.childRow}>
          <View style={styles.fieldGroup}>
            <Text style={styles.childName}>{child.name}</Text>
            <Text style={styles.helpText}>
              {locations[child.id]
                ? `Last seen ${new Date(locations[child.id].occurredAt).toLocaleString()}`
                : 'No location yet'}
            </Text>
          </View>
          <Pressable
            testID={`family-map-geofences-${child.id}`}
            style={styles.linkButton}
            onPress={() => navigation.navigate('GeofenceEditor', { childId: child.id })}
          >
            <Text style={styles.linkButtonText}>Geofences</Text>
          </Pressable>
          <Pressable
            testID={`family-map-history-${child.id}`}
            style={styles.linkButton}
            onPress={() => navigation.navigate('LocationHistory', { childId: child.id })}
          >
            <Text style={styles.linkButtonText}>History</Text>
          </Pressable>
        </View>
      ))}
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
  childRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#f2f2f2',
    marginTop: 8,
    gap: 8,
  },
  childName: { fontSize: 14, fontWeight: '600' },
  linkButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, backgroundColor: '#1a73e8' },
  linkButtonText: { color: '#fff', fontWeight: '600', fontSize: 12 },
  errorText: { color: '#d92d20' },
  upsellCard: { padding: 20, borderRadius: 12, backgroundColor: '#f2f2f2', gap: 12, maxWidth: 400 },
  upsellTitle: { fontSize: 18, fontWeight: '700' },
  upsellBody: { fontSize: 14, color: '#555' },
  upsellButton: { padding: 14, borderRadius: 8, backgroundColor: '#1a73e8' },
  upsellButtonText: { color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: '600' },
});
