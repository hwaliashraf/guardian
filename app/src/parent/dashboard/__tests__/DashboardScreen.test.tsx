import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import DashboardScreen from '../DashboardScreen';
import { useFamily } from '../useFamily';
import { useInstantPause } from '../useInstantPause';

jest.mock('../useFamily');
jest.mock('../useInstantPause');

const mockUseFamily = useFamily as jest.Mock;
const mockUseInstantPause = useInstantPause as jest.Mock;

const familyData = {
  family: { id: 'family-1', name: 'The Guardians', createdAt: '2026-01-01T00:00:00.000Z' },
  tier: 'standard' as const,
  children: [
    {
      id: 'child-1',
      familyId: 'family-1',
      name: 'Alice',
      birthdate: '2015-01-01',
      devices: [{ id: 'device-1', childId: 'child-1', platform: 'ios' as const, name: "Alice's iPhone", registeredAt: '2026-01-01T00:00:00.000Z' }],
    },
    {
      id: 'child-2',
      familyId: 'family-1',
      name: 'Bob',
      birthdate: '2017-01-01',
      devices: [],
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders one card per child with device count vs TIER_DEVICE_LIMIT', async () => {
  mockUseFamily.mockReturnValue({ data: familyData, loading: false, error: null, refetch: jest.fn() });
  mockUseInstantPause.mockReturnValue({ pauseAll: jest.fn(), loading: false, error: null });

  await render(<DashboardScreen />);

  expect(screen.getByTestId('child-card-child-1')).toBeTruthy();
  expect(screen.getByTestId('child-card-child-2')).toBeTruthy();
  expect(screen.getByText('Alice')).toBeTruthy();
  expect(screen.getByText('Bob')).toBeTruthy();
  // standard tier -> TIER_DEVICE_LIMIT.standard === 10 (packages/domain/src/tiers/features.ts)
  expect(screen.getByText('1 / 10 devices')).toBeTruthy();
  expect(screen.getByText('0 / 10 devices')).toBeTruthy();
  expect(screen.getAllByText('Remaining time today: —')).toHaveLength(2);
});

test('pause button requires confirmation before calling the endpoint', async () => {
  const pauseAll = jest.fn().mockResolvedValue({ childrenPaused: 2, devicesNotified: 1 });
  mockUseFamily.mockReturnValue({ data: familyData, loading: false, error: null, refetch: jest.fn() });
  mockUseInstantPause.mockReturnValue({ pauseAll, loading: false, error: null });
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

  await render(<DashboardScreen />);
  fireEvent.press(screen.getByTestId('pause-all-button'));

  // Pressing the button alone must NOT call the endpoint — only opens the confirmation dialog.
  expect(alertSpy).toHaveBeenCalledTimes(1);
  expect(pauseAll).not.toHaveBeenCalled();

  // Simulate the user confirming: invoke the destructive button's onPress from the captured
  // Alert.alert call (RN's Alert has no real UI in the test renderer).
  const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
  const confirmButton = buttons.find(b => b.text === 'Pause All');
  confirmButton?.onPress?.();

  await waitFor(() => expect(pauseAll).toHaveBeenCalledWith('family-1'));
});

test('does not produce an unhandled rejection when instant-pause fails', async () => {
  // Regression test (reviewer-caught): pauseAll rethrows after recording the error in hook
  // state (see useInstantPause.ts) — the confirm handler must catch it, or every real-world
  // pause failure becomes an unhandled promise rejection.
  const pauseAll = jest.fn().mockRejectedValue(new Error('network down'));
  mockUseFamily.mockReturnValue({ data: familyData, loading: false, error: null, refetch: jest.fn() });
  mockUseInstantPause.mockReturnValue({ pauseAll, loading: false, error: null });
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

  await render(<DashboardScreen />);
  fireEvent.press(screen.getByTestId('pause-all-button'));
  const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
  buttons.find(b => b.text === 'Pause All')?.onPress?.();

  // If the rejection were unhandled, Jest fails this test with an unhandled-rejection error —
  // reaching the assertion below cleanly is itself the regression check.
  await waitFor(() => expect(pauseAll).toHaveBeenCalledWith('family-1'));
});

test('renders the pauseError message from useInstantPause', async () => {
  mockUseFamily.mockReturnValue({ data: familyData, loading: false, error: null, refetch: jest.fn() });
  mockUseInstantPause.mockReturnValue({ pauseAll: jest.fn(), loading: false, error: 'instant pause failed' });

  await render(<DashboardScreen />);

  expect(await screen.findByText('instant pause failed')).toBeTruthy();
});

test('shows a loading indicator while family data is loading', async () => {
  mockUseFamily.mockReturnValue({ data: null, loading: true, error: null, refetch: jest.fn() });
  mockUseInstantPause.mockReturnValue({ pauseAll: jest.fn(), loading: false, error: null });

  await render(<DashboardScreen />);

  expect(screen.queryByTestId('pause-all-button')).toBeNull();
});

test('surfaces family fetch errors instead of swallowing them', async () => {
  mockUseFamily.mockReturnValue({ data: null, loading: false, error: 'network down', refetch: jest.fn() });
  mockUseInstantPause.mockReturnValue({ pauseAll: jest.fn(), loading: false, error: null });

  await render(<DashboardScreen />);

  expect(await screen.findByText('network down')).toBeTruthy();
});
