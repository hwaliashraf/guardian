import { render, screen, fireEvent } from '@testing-library/react-native';
import FamilyMapScreen from '../FamilyMapScreen';
import { useFamily } from '../../dashboard/useFamily';
import { useChildLocations } from '../useChildLocations';

jest.mock('../../dashboard/useFamily');
jest.mock('../useChildLocations');

const mockUseFamily = useFamily as jest.Mock;
const mockUseChildLocations = useChildLocations as jest.Mock;

function familyData(tier: 'free' | 'standard' | 'premium', children: { id: string; name: string }[] = []) {
  return {
    family: { id: 'family-1', name: 'The Guardians', createdAt: '2026-01-01T00:00:00.000Z' },
    tier,
    children: children.map((c) => ({ ...c, familyId: 'family-1', birthdate: '2015-01-01', devices: [] })),
  };
}

const route = { key: 'r', name: 'FamilyMap' as const, params: undefined };
const mockNavigate = jest.fn();
const navigation = { navigate: mockNavigate } as never;

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders an upsell card for a non-entitled (free) tier, not the map', async () => {
  mockUseFamily.mockReturnValue({ data: familyData('free'), loading: false, error: null, refetch: jest.fn() });
  mockUseChildLocations.mockReturnValue({ locations: {}, loading: false, error: null, refetch: jest.fn() });

  await render(<FamilyMapScreen route={route} navigation={navigation} />);

  expect(screen.getByTestId('family-map-upsell')).toBeTruthy();
  expect(screen.queryByTestId('fallback-map-provider')).toBeNull();
});

test('renders a pin per child with a known location, for an entitled (standard) tier', async () => {
  mockUseFamily.mockReturnValue({
    data: familyData('standard', [{ id: 'child-1', name: 'Alice' }, { id: 'child-2', name: 'Bob' }]),
    loading: false,
    error: null,
    refetch: jest.fn(),
  });
  mockUseChildLocations.mockReturnValue({
    locations: { 'child-1': { lat: 40.7128, lng: -74.006, occurredAt: '2026-07-16T10:00:00.000Z' } },
    loading: false,
    error: null,
    refetch: jest.fn(),
  });

  await render(<FamilyMapScreen route={route} navigation={navigation} />);

  expect(screen.getByTestId('fallback-map-provider')).toBeTruthy();
  expect(screen.getByTestId('map-pin-child-1')).toBeTruthy();
  expect(screen.queryByTestId('map-pin-child-2')).toBeNull();
  expect(screen.getByText('No location yet')).toBeTruthy();
});

test('navigating to a child geofences/history screen passes the childId param', async () => {
  mockUseFamily.mockReturnValue({
    data: familyData('standard', [{ id: 'child-1', name: 'Alice' }]),
    loading: false,
    error: null,
    refetch: jest.fn(),
  });
  mockUseChildLocations.mockReturnValue({ locations: {}, loading: false, error: null, refetch: jest.fn() });

  await render(<FamilyMapScreen route={route} navigation={navigation} />);
  await fireEvent.press(screen.getByTestId('family-map-geofences-child-1'));
  await fireEvent.press(screen.getByTestId('family-map-history-child-1'));

  expect(mockNavigate).toHaveBeenCalledWith('GeofenceEditor', { childId: 'child-1' });
  expect(mockNavigate).toHaveBeenCalledWith('LocationHistory', { childId: 'child-1' });
});
