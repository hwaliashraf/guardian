import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Geofence } from '@guardian/domain';
import { hasFeature } from '@guardian/domain';
import type { ParentStackParamList } from '../../navigation/ParentNavigator';
import { useFamily } from '../dashboard/useFamily';
import { useGeofences } from './useGeofences';
import { ActiveMapProvider, type MapPin } from './MapProvider';

type Props = NativeStackScreenProps<ParentStackParamList, 'GeofenceEditor'>;

interface FormState {
  name: string;
  lat: string;
  lng: string;
  radiusMeters: string;
  alertOnEnter: boolean;
  alertOnLeave: boolean;
}

const EMPTY_FORM: FormState = { name: '', lat: '', lng: '', radiusMeters: '150', alertOnEnter: true, alertOnLeave: true };

// Rejects blank/garbage input before it ever reaches `create`/`update` — an unvalidated NaN or
// Null Island (0,0) geofence would silently never trigger (evaluateGeofences' distance
// comparisons are always false against NaN) with no feedback to the parent. Mirrors
// BucketsScreen.tsx's isRowValid/allValid pattern (this repo's established validate-before-save
// shape for a numeric-fields form).
function isFormValid(form: FormState): boolean {
  // `Number('')` is `0`, not `NaN` — an untouched/blank field must be rejected by its own
  // non-empty check below, never allowed to coerce into a falsely-valid 0.
  if (form.lat.trim().length === 0 || form.lng.trim().length === 0 || form.radiusMeters.trim().length === 0) {
    return false;
  }
  const lat = Number(form.lat);
  const lng = Number(form.lng);
  const radius = Number(form.radiusMeters);
  return (
    form.name.trim().length > 0 &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180 &&
    Number.isFinite(radius) &&
    radius > 0
  );
}

function geofenceToForm(g: Geofence): FormState {
  return {
    name: g.name,
    lat: String(g.lat),
    lng: String(g.lng),
    radiusMeters: String(g.radiusMeters),
    alertOnEnter: g.alertOnEnter,
    alertOnLeave: g.alertOnLeave,
  };
}

// Fallback map has no tap gesture (see MapProvider.tsx) — "picking a center point" is reading
// coordinates off the pins/list rendered above (existing geofences, and FamilyMapScreen's own
// child-location list) and entering them as plain numeric fields here.
export default function GeofenceEditorScreen({ route, navigation }: Props) {
  const { childId } = route.params;
  const { data: familyData, loading: familyLoading } = useFamily();
  const { geofences, loading: geofencesLoading, error, create, update, remove } = useGeofences(childId);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formValid = useMemo(() => isFormValid(form), [form]);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSaveError(null);
  }, []);

  const startEdit = useCallback((g: Geofence) => {
    setEditingId(g.id);
    setForm(geofenceToForm(g));
    setSaveError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!isFormValid(form)) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        childId,
        name: form.name.trim(),
        lat: Number(form.lat),
        lng: Number(form.lng),
        radiusMeters: Number(form.radiusMeters),
        alertOnEnter: form.alertOnEnter,
        alertOnLeave: form.alertOnLeave,
      };
      if (editingId) {
        await update(editingId, payload);
      } else {
        await create(payload);
      }
      resetForm();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save geofence');
    } finally {
      setSaving(false);
    }
  }, [childId, form, editingId, update, create, resetForm]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await remove(id);
        // Reset the form only if it was pointed at the geofence just deleted (avoid clearing
        // in-progress edits of a different, unrelated geofence).
        if (editingId === id) resetForm();
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Failed to delete geofence');
      }
    },
    [remove, editingId, resetForm],
  );

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
        <View style={styles.upsellCard} testID="geofence-editor-upsell">
          <Text style={styles.upsellTitle}>Geofences are a Standard+ feature</Text>
          <Text style={styles.upsellBody}>Upgrade to set up location-based enter/leave alerts.</Text>
          <Pressable
            testID="geofence-editor-upsell-cta"
            style={styles.upsellButton}
            onPress={() => navigation.navigate('Paywall')}
          >
            <Text style={styles.upsellButtonText}>Upgrade</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (geofencesLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const pins: MapPin[] = geofences.map((g) => ({ id: g.id, label: g.name, lat: g.lat, lng: g.lng }));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <ActiveMapProvider pins={pins} />

      <Text style={styles.sectionTitle}>Geofences</Text>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {geofences.map((g) => (
        <View key={g.id} testID={`geofence-row-${g.id}`} style={styles.row}>
          <View style={styles.fieldGroup}>
            <Text style={styles.rowName}>{g.name}</Text>
            <Text style={styles.helpText}>
              {g.radiusMeters}m radius · enter {g.alertOnEnter ? 'on' : 'off'} · leave {g.alertOnLeave ? 'on' : 'off'}
            </Text>
          </View>
          <Pressable testID={`geofence-edit-${g.id}`} style={styles.smallButton} onPress={() => startEdit(g)}>
            <Text style={styles.smallButtonText}>Edit</Text>
          </Pressable>
          <Pressable testID={`geofence-delete-${g.id}`} style={styles.smallButtonDanger} onPress={() => handleDelete(g.id)}>
            <Text style={styles.smallButtonText}>Delete</Text>
          </Pressable>
        </View>
      ))}

      <Text style={styles.sectionTitle}>{editingId ? 'Edit geofence' : 'New geofence'}</Text>
      <TextInput
        testID="geofence-form-name"
        style={styles.input}
        placeholder="Name"
        value={form.name}
        onChangeText={(name) => setForm((f) => ({ ...f, name }))}
      />
      <TextInput
        testID="geofence-form-lat"
        style={styles.input}
        placeholder="Latitude"
        keyboardType="numeric"
        value={form.lat}
        onChangeText={(lat) => setForm((f) => ({ ...f, lat }))}
      />
      <TextInput
        testID="geofence-form-lng"
        style={styles.input}
        placeholder="Longitude"
        keyboardType="numeric"
        value={form.lng}
        onChangeText={(lng) => setForm((f) => ({ ...f, lng }))}
      />
      <TextInput
        testID="geofence-form-radius"
        style={styles.input}
        placeholder="Radius (meters)"
        keyboardType="numeric"
        value={form.radiusMeters}
        onChangeText={(radiusMeters) => setForm((f) => ({ ...f, radiusMeters }))}
      />
      <View style={styles.toggleRow}>
        <Text>Alert on enter</Text>
        <Switch
          testID="geofence-form-alert-enter"
          value={form.alertOnEnter}
          onValueChange={(alertOnEnter) => setForm((f) => ({ ...f, alertOnEnter }))}
        />
      </View>
      <View style={styles.toggleRow}>
        <Text>Alert on leave</Text>
        <Switch
          testID="geofence-form-alert-leave"
          value={form.alertOnLeave}
          onValueChange={(alertOnLeave) => setForm((f) => ({ ...f, alertOnLeave }))}
        />
      </View>
      {!formValid ? (
        <Text testID="geofence-form-validation-error" style={styles.errorText}>
          Enter a name, a latitude between -90 and 90, a longitude between -180 and 180, and a
          radius greater than 0.
        </Text>
      ) : null}
      {saveError ? <Text style={styles.errorText}>{saveError}</Text> : null}
      <Pressable
        testID="geofence-form-save"
        style={styles.saveButton}
        onPress={handleSave}
        disabled={saving || !formValid}
      >
        <Text style={styles.saveButtonText}>{saving ? 'Saving…' : editingId ? 'Update geofence' : 'Add geofence'}</Text>
      </Pressable>
      {editingId ? (
        <Pressable testID="geofence-form-cancel" style={styles.smallButton} onPress={resetForm}>
          <Text style={styles.smallButtonText}>Cancel edit</Text>
        </Pressable>
      ) : null}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#f2f2f2',
    marginTop: 8,
    gap: 8,
  },
  rowName: { fontSize: 14, fontWeight: '600' },
  smallButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, backgroundColor: '#1a73e8' },
  smallButtonDanger: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, backgroundColor: '#d92d20' },
  smallButtonText: { color: '#fff', fontWeight: '600', fontSize: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, marginTop: 8 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  errorText: { color: '#d92d20' },
  saveButton: { padding: 16, borderRadius: 8, backgroundColor: '#1a73e8', marginTop: 16 },
  saveButtonText: { color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: '600' },
  upsellCard: { padding: 20, borderRadius: 12, backgroundColor: '#f2f2f2', gap: 12, maxWidth: 400 },
  upsellTitle: { fontSize: 18, fontWeight: '700' },
  upsellBody: { fontSize: 14, color: '#555' },
  upsellButton: { padding: 14, borderRadius: 8, backgroundColor: '#1a73e8' },
  upsellButtonText: { color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: '600' },
});
