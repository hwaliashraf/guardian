import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import RequestsInboxScreen from '../RequestsInboxScreen';
import { useRequests } from '../useRequests';

jest.mock('../useRequests');

const mockUseRequests = useRequests as jest.Mock;

const PENDING_EXTRA_TIME = {
  id: 'req-1',
  childId: 'child-1',
  type: 'extra_time' as const,
  payload: { categoryId: 'games', minutes: 15 },
  status: 'pending' as const,
  createdAt: '2026-07-16T10:00:00.000Z',
  resolvedAt: null,
};

const RESOLVED_UNBLOCK = {
  id: 'req-2',
  childId: 'child-1',
  type: 'unblock' as const,
  payload: { scope: 'app', target: 'com.example.app' },
  status: 'approved' as const,
  createdAt: '2026-07-15T10:00:00.000Z',
  resolvedAt: '2026-07-15T11:00:00.000Z',
};

function baseHookState(overrides: Partial<ReturnType<typeof useRequests>> = {}) {
  return {
    pending: [],
    resolved: [],
    loading: false,
    error: null,
    resolving: false,
    resolveError: null,
    resolve: jest.fn(),
    refetch: jest.fn(),
    extraTimeGrants: {},
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders pending requests with approve/deny actions', async () => {
  mockUseRequests.mockReturnValue(baseHookState({ pending: [PENDING_EXTRA_TIME] }));

  await render(<RequestsInboxScreen />);

  expect(screen.getByTestId('request-req-1')).toBeTruthy();
  expect(screen.getByText('Extra time')).toBeTruthy();
  expect(screen.getByTestId('request-req-1-approve')).toBeTruthy();
  expect(screen.getByTestId('request-req-1-deny')).toBeTruthy();
});

test('shows empty states when there are no pending or resolved requests', async () => {
  mockUseRequests.mockReturnValue(baseHookState());

  await render(<RequestsInboxScreen />);

  expect(screen.getByText('No pending requests.')).toBeTruthy();
  expect(screen.getByText('No resolved requests yet.')).toBeTruthy();
});

test('resolved items render in the history section, not pending', async () => {
  mockUseRequests.mockReturnValue(baseHookState({ resolved: [RESOLVED_UNBLOCK] }));

  await render(<RequestsInboxScreen />);

  expect(screen.getByTestId('request-history-req-2')).toBeTruthy();
  expect(screen.getByText(/Approved/)).toBeTruthy();
  expect(screen.queryByTestId('request-req-2')).toBeNull();
});

test('approve button calls resolve(id, true)', async () => {
  const resolve = jest.fn().mockResolvedValue(undefined);
  mockUseRequests.mockReturnValue(baseHookState({ pending: [PENDING_EXTRA_TIME], resolve }));

  await render(<RequestsInboxScreen />);
  await fireEvent.press(screen.getByTestId('request-req-1-approve'));

  await waitFor(() => expect(resolve).toHaveBeenCalledWith('req-1', true));
});

test('deny button calls resolve(id, false)', async () => {
  const resolve = jest.fn().mockResolvedValue(undefined);
  mockUseRequests.mockReturnValue(baseHookState({ pending: [PENDING_EXTRA_TIME], resolve }));

  await render(<RequestsInboxScreen />);
  await fireEvent.press(screen.getByTestId('request-req-1-deny'));

  await waitFor(() => expect(resolve).toHaveBeenCalledWith('req-1', false));
});

test('an approved extra_time request shows the post-grant usage from extraTimeGrants', async () => {
  const resolvedExtraTime = { ...PENDING_EXTRA_TIME, status: 'approved' as const, resolvedAt: '2026-07-16T10:05:00.000Z' };
  mockUseRequests.mockReturnValue(
    baseHookState({
      resolved: [resolvedExtraTime],
      extraTimeGrants: {
        'req-1': {
          date: '2026-07-16',
          perCategoryMinutesUsed: { games: 40 },
          perCategorySessionCount: { games: 2 },
          totalMinutesUsed: 70,
        },
      },
    }),
  );

  await render(<RequestsInboxScreen />);

  expect(screen.getByText(/games: 40 min used today after grant/)).toBeTruthy();
});
