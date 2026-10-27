import type { ComponentType } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export interface MapPin {
  id: string;
  label: string;
  lat: number;
  lng: number;
}

export interface MapProviderProps {
  pins: MapPin[];
}

export type MapProvider = ComponentType<MapProviderProps>;

// Real interactive map rendering needs a Maps API key this environment doesn't have (see
// SETUP.md's "Maps provider" section) — this fallback renders the exact same `pins` a real
// provider would receive, just as a plain list under a static placeholder, so
// FamilyMapScreen/GeofenceEditorScreen are real and testable today. Swap point: replace
// `ActiveMapProvider` below with a `react-native-maps`-backed component of the same
// `MapProviderProps` shape — no consumer of `ActiveMapProvider` needs to change.
export const FallbackMapProvider: MapProvider = ({ pins }) => (
  <View style={styles.container} testID="fallback-map-provider">
    <View style={styles.placeholder} testID="fallback-map-placeholder">
      <Text style={styles.placeholderText}>Map view unavailable — showing locations as a list</Text>
    </View>
    {pins.length === 0 ? (
      <Text style={styles.emptyText}>No locations to show yet.</Text>
    ) : (
      pins.map((pin) => (
        <View key={pin.id} testID={`map-pin-${pin.id}`} style={styles.pinRow}>
          <Text style={styles.pinLabel}>{pin.label}</Text>
          <Text style={styles.pinCoords}>
            {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
          </Text>
        </View>
      ))
    )}
  </View>
);

// T17 swap point (see SETUP.md "Maps provider"): once a Google Maps API key is provisioned,
// replace this with a `react-native-maps`-backed MapProvider component.
export const ActiveMapProvider: MapProvider = FallbackMapProvider;

const styles = StyleSheet.create({
  container: { gap: 8 },
  placeholder: {
    height: 120,
    borderRadius: 8,
    backgroundColor: '#e0e0e0',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  placeholderText: { color: '#555', textAlign: 'center' },
  emptyText: { color: '#555' },
  pinRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 12, borderRadius: 8, backgroundColor: '#f2f2f2' },
  pinLabel: { fontWeight: '600' },
  pinCoords: { color: '#555' },
});
