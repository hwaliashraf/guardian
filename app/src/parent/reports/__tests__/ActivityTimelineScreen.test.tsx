import { render, screen, fireEvent } from '@testing-library/react-native';
import ActivityTimelineScreen from '../ActivityTimelineScreen';
import { useActivityTimeline } from '../useActivityTimeline';

jest.mock('../useActivityTimeline', () => {
  const actual = jest.requireActual('../useActivityTimeline');
  return { ...actual, useActivityTimeline: jest.fn() };
});

const mockUseActivityTimeline = useActivityTimeline as jest.Mock;

const route = { key: 'r', name: 'ActivityTimeline' as const, params: { childId: 'child-1' } };
const navigation = {} as never;

const APP_USAGE_EVENT = {
  id: 'e1',
  deviceId: 'device-1',
  childId: 'child-1',
  type: 'app_usage' as const,
  payload: { appId: 'com.roblox.client', minutes: 30 },
  occurredAt: '2026-07-16T10:00:00.000Z',
};
const BLOCK_EVENT = {
  id: 'e2',
  deviceId: 'device-1',
  childId: 'child-1',
  type: 'block_attempt' as const,
  payload: { domain: 'example.com' },
  occurredAt: '2026-07-16T09:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders events for the current (default "all") filter', async () => {
  mockUseActivityTimeline.mockReturnValue({
    events: [APP_USAGE_EVENT, BLOCK_EVENT],
    loading: false,
    error: null,
    hasMore: false,
    refetch: jest.fn(),
  });

  await render(<ActivityTimelineScreen route={route} navigation={navigation} />);

  expect(screen.getByTestId('timeline-event-e1')).toBeTruthy();
  expect(screen.getByTestId('timeline-event-e2')).toBeTruthy();
  expect(mockUseActivityTimeline).toHaveBeenLastCalledWith('child-1', 'all', 0);
});

test('selecting a filter chip re-queries the hook with that type and resets to page 0', async () => {
  mockUseActivityTimeline.mockReturnValue({
    events: [BLOCK_EVENT],
    loading: false,
    error: null,
    hasMore: false,
    refetch: jest.fn(),
  });

  await render(<ActivityTimelineScreen route={route} navigation={navigation} />);
  await fireEvent.press(screen.getByTestId('timeline-filter-block_attempt'));

  expect(mockUseActivityTimeline).toHaveBeenLastCalledWith('child-1', 'block_attempt', 0);
});

test('pressing Next advances the page; Next is disabled when hasMore is false', async () => {
  mockUseActivityTimeline.mockReturnValue({
    events: [APP_USAGE_EVENT],
    loading: false,
    error: null,
    hasMore: true,
    refetch: jest.fn(),
  });

  await render(<ActivityTimelineScreen route={route} navigation={navigation} />);

  expect(screen.getByTestId('timeline-prev').props.accessibilityState?.disabled).toBe(true);
  expect(screen.getByTestId('timeline-next').props.accessibilityState?.disabled).toBeFalsy();

  await fireEvent.press(screen.getByTestId('timeline-next'));
  expect(mockUseActivityTimeline).toHaveBeenLastCalledWith('child-1', 'all', 1);
});

test('shows an empty state when there is no activity for the current filter', async () => {
  mockUseActivityTimeline.mockReturnValue({ events: [], loading: false, error: null, hasMore: false, refetch: jest.fn() });

  await render(<ActivityTimelineScreen route={route} navigation={navigation} />);

  expect(screen.getByText('No activity for this filter yet.')).toBeTruthy();
});
