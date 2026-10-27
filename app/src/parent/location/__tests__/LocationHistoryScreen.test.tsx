import { render, screen, within } from '@testing-library/react-native';
import LocationHistoryScreen from '../LocationHistoryScreen';
import { useFamily } from '../../dashboard/useFamily';
import { useLocationHistory } from '../useLocationHistory';

jest.mock('../../dashboard/useFamily');
jest.mock('../useLocationHistory');

const mockUseFamily = useFamily as jest.Mock;
const mockUseLocationHistory = useLocationHistory as jest.Mock;

function familyData(tier: 'free' | 'standard' | 'premium') {
  return {
    family: { id: 'family-1', name: 'The Guardians', createdAt: '2026-01-01T00:00:00.000Z' },
    tier,
    children: [],
  };
}

const route = { key: 'r', name: 'LocationHistory' as const, params: { childId: 'child-1' } };
const navigation = { navigate: jest.fn() } as never;

const FIXTURE_ENTRIES = [
  { id: 'e1', lat: 40.7128, lng: -74.006, occurredAt: '2026-07-16T10:00:00.000Z' },
  { id: 'e2', lat: 40.71, lng: -74.0, occurredAt: '2026-07-16T08:00:00.000Z' },
  { id: 'e3', lat: 40.7, lng: -73.99, occurredAt: '2026-07-15T09:00:00.000Z' },
];

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders an upsell card for a non-entitled (free) tier, not the history list', async () => {
  mockUseFamily.mockReturnValue({ data: familyData('free'), loading: false, error: null, refetch: jest.fn() });
  mockUseLocationHistory.mockReturnValue({ entries: [], loading: false, error: null, refetch: jest.fn() });

  await render(<LocationHistoryScreen route={route} navigation={navigation} />);

  expect(screen.getByTestId('location-history-upsell')).toBeTruthy();
});

test('groups fixture entries by day, newest day first, entries newest-first within a day', async () => {
  mockUseFamily.mockReturnValue({ data: familyData('standard'), loading: false, error: null, refetch: jest.fn() });
  mockUseLocationHistory.mockReturnValue({ entries: FIXTURE_ENTRIES, loading: false, error: null, refetch: jest.fn() });

  await render(<LocationHistoryScreen route={route} navigation={navigation} />);

  // Assert actual rendered order (not just presence) — a reversed grouping would still pass a
  // plain getByTestId presence check, so query all day-group testIDs in tree order and compare.
  const dayTestIds = screen.getAllByTestId(/^location-history-day-/).map((el) => el.props.testID);
  expect(dayTestIds).toEqual(['location-history-day-2026-07-16', 'location-history-day-2026-07-15']);

  const entryTestIdsWithinNewestDay = within(screen.getByTestId('location-history-day-2026-07-16'))
    .getAllByTestId(/^location-history-entry-/)
    .map((el) => el.props.testID);
  expect(entryTestIdsWithinNewestDay).toEqual(['location-history-entry-e1', 'location-history-entry-e2']);

  expect(screen.getByTestId('location-history-entry-e3')).toBeTruthy();
});

test('shows an empty state when there is no history', async () => {
  mockUseFamily.mockReturnValue({ data: familyData('standard'), loading: false, error: null, refetch: jest.fn() });
  mockUseLocationHistory.mockReturnValue({ entries: [], loading: false, error: null, refetch: jest.fn() });

  await render(<LocationHistoryScreen route={route} navigation={navigation} />);

  expect(screen.getByText('No location history in the last 30 days.')).toBeTruthy();
});
