import { useState } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react-native';
import type { Geofence } from '@guardian/domain';
import GeofenceEditorScreen from '../GeofenceEditorScreen';
import { useFamily } from '../../dashboard/useFamily';
import { useGeofences } from '../useGeofences';

jest.mock('../../dashboard/useFamily');
jest.mock('../useGeofences');

const mockUseFamily = useFamily as jest.Mock;
const mockUseGeofences = useGeofences as jest.Mock;

function familyData(tier: 'free' | 'standard' | 'premium') {
  return {
    family: { id: 'family-1', name: 'The Guardians', createdAt: '2026-01-01T00:00:00.000Z' },
    tier,
    children: [],
  };
}

const route = { key: 'r', name: 'GeofenceEditor' as const, params: { childId: 'child-1' } };
const navigation = { navigate: jest.fn() } as never;

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders an upsell card for a non-entitled (free) tier, not the editor', async () => {
  mockUseFamily.mockReturnValue({ data: familyData('free'), loading: false, error: null, refetch: jest.fn() });
  mockUseGeofences.mockReturnValue({
    geofences: [],
    loading: false,
    error: null,
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    refetch: jest.fn(),
  });

  await render(<GeofenceEditorScreen route={route} navigation={navigation} />);

  expect(screen.getByTestId('geofence-editor-upsell')).toBeTruthy();
  expect(screen.queryByTestId('geofence-form-save')).toBeNull();
});

test('create -> edit -> delete round-trip', async () => {
  mockUseFamily.mockReturnValue({ data: familyData('standard'), loading: false, error: null, refetch: jest.fn() });

  // Mirrors the real useGeofences hook's own React state (not just a plain closure variable) so
  // that create/update/delete genuinely trigger a re-render the same way the real hook's
  // internal setGeofences does — independent of GeofenceEditorScreen's own local form state.
  const create = jest.fn();
  const update = jest.fn();
  const remove = jest.fn();
  mockUseGeofences.mockImplementation(() => {
    const [geofences, setGeofences] = useState<Geofence[]>([]);

    create.mockImplementation(async (payload: Omit<Geofence, 'id'>) => {
      const created: Geofence = { ...payload, id: 'gf-1' };
      setGeofences((prev) => [...prev, created]);
      return created;
    });
    update.mockImplementation(async (id: string, payload: Omit<Geofence, 'id'>) => {
      const updated: Geofence = { ...payload, id };
      setGeofences((prev) => prev.map((g) => (g.id === id ? updated : g)));
      return updated;
    });
    remove.mockImplementation(async (id: string) => {
      setGeofences((prev) => prev.filter((g) => g.id !== id));
    });

    return { geofences, loading: false, error: null, create, update, remove, refetch: jest.fn() };
  });

  await render(<GeofenceEditorScreen route={route} navigation={navigation} />);

  // Create.
  await fireEvent.changeText(screen.getByTestId('geofence-form-name'), 'Home');
  await fireEvent.changeText(screen.getByTestId('geofence-form-lat'), '40.7128');
  await fireEvent.changeText(screen.getByTestId('geofence-form-lng'), '-74.006');
  await fireEvent.changeText(screen.getByTestId('geofence-form-radius'), '200');
  await fireEvent.press(screen.getByTestId('geofence-form-save'));

  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(create.mock.calls[0][0]).toEqual({
    childId: 'child-1',
    name: 'Home',
    lat: 40.7128,
    lng: -74.006,
    radiusMeters: 200,
    alertOnEnter: true,
    alertOnLeave: true,
  });
  await waitFor(() => expect(screen.getByTestId('geofence-row-gf-1')).toBeTruthy());

  // Edit.
  await fireEvent.press(screen.getByTestId('geofence-edit-gf-1'));
  expect(screen.getByTestId('geofence-form-name').props.value).toBe('Home');
  await fireEvent.changeText(screen.getByTestId('geofence-form-name'), 'Home (updated)');
  await fireEvent.press(screen.getByTestId('geofence-form-save'));

  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update.mock.calls[0][0]).toBe('gf-1');
  expect(update.mock.calls[0][1]).toEqual(expect.objectContaining({ name: 'Home (updated)' }));
  await waitFor(() =>
    expect(within(screen.getByTestId('geofence-row-gf-1')).getByText('Home (updated)')).toBeTruthy(),
  );

  // Delete.
  await fireEvent.press(screen.getByTestId('geofence-delete-gf-1'));

  await waitFor(() => expect(remove).toHaveBeenCalledWith('gf-1'));
  await waitFor(() => expect(screen.queryByTestId('geofence-row-gf-1')).toBeNull());
});

test('blank/invalid form fields disable Save and never call create (no silent Null Island geofence)', async () => {
  mockUseFamily.mockReturnValue({ data: familyData('standard'), loading: false, error: null, refetch: jest.fn() });
  const create = jest.fn();
  mockUseGeofences.mockReturnValue({
    geofences: [],
    loading: false,
    error: null,
    create,
    update: jest.fn(),
    remove: jest.fn(),
    refetch: jest.fn(),
  });

  await render(<GeofenceEditorScreen route={route} navigation={navigation} />);

  // Blank name/lat/lng — Save is disabled, a validation message is shown, and pressing it
  // (RTL fires onPress even on a "disabled" Pressable in this RN test renderer) never reaches
  // the create() call.
  expect(screen.getByTestId('geofence-form-validation-error')).toBeTruthy();
  expect(screen.getByTestId('geofence-form-save').props.accessibilityState?.disabled).toBe(true);
  await fireEvent.press(screen.getByTestId('geofence-form-save'));
  expect(create).not.toHaveBeenCalled();

  // Out-of-range latitude is also rejected.
  await fireEvent.changeText(screen.getByTestId('geofence-form-name'), 'Home');
  await fireEvent.changeText(screen.getByTestId('geofence-form-lat'), '200');
  await fireEvent.changeText(screen.getByTestId('geofence-form-lng'), '-74.006');
  await fireEvent.changeText(screen.getByTestId('geofence-form-radius'), '200');
  expect(screen.getByTestId('geofence-form-validation-error')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('geofence-form-save'));
  expect(create).not.toHaveBeenCalled();

  // Fixing the latitude makes the form valid, the error disappears, and Save now works.
  await fireEvent.changeText(screen.getByTestId('geofence-form-lat'), '40.7128');
  expect(screen.queryByTestId('geofence-form-validation-error')).toBeNull();
  await fireEvent.press(screen.getByTestId('geofence-form-save'));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
});

test('a filled name with blank lat/lng is rejected, not silently coerced to Null Island (0,0)', async () => {
  // Regression test: `Number('')` is `0`, not `NaN` — a naive Number.isFinite-only check would
  // treat an untouched lat/lng field as the valid coordinate 0. Only the name field is filled
  // in here; lat/lng are left exactly as EMPTY_FORM leaves them (blank strings) — radius already
  // defaults to '150' in EMPTY_FORM, so this isolates the lat/lng blank-string case specifically.
  mockUseFamily.mockReturnValue({ data: familyData('standard'), loading: false, error: null, refetch: jest.fn() });
  const create = jest.fn();
  mockUseGeofences.mockReturnValue({
    geofences: [],
    loading: false,
    error: null,
    create,
    update: jest.fn(),
    remove: jest.fn(),
    refetch: jest.fn(),
  });

  await render(<GeofenceEditorScreen route={route} navigation={navigation} />);

  await fireEvent.changeText(screen.getByTestId('geofence-form-name'), 'Home');
  expect(screen.getByTestId('geofence-form-validation-error')).toBeTruthy();
  expect(screen.getByTestId('geofence-form-save').props.accessibilityState?.disabled).toBe(true);
  await fireEvent.press(screen.getByTestId('geofence-form-save'));
  expect(create).not.toHaveBeenCalled();
});
