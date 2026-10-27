import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import RequestScreen from '../RequestScreen';

const identity = { deviceId: 'device-1', childId: 'child-1', deviceToken: 'token-1' };
const currentDailyUsage = {
  date: '2026-01-01',
  perCategoryMinutesUsed: { games: 40 },
  perCategorySessionCount: { games: 2 },
  totalMinutesUsed: 40,
};
const route = { key: 'k', name: 'Request' as const, params: { identity, currentDailyUsage } };
const navigation = {} as never;

beforeEach(() => {
  jest.clearAllMocks();
  (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn();
});

test('request creation round-trips to a pending item', async () => {
  const created = {
    id: 'req-1',
    childId: 'child-1',
    type: 'extra_time',
    payload: { categoryId: 'games', minutes: 15, currentDailyUsage },
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    resolvedAt: null,
  };
  (globalThis.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ request: created }) });

  await render(<RequestScreen route={route} navigation={navigation} />);

  expect(screen.getByText('No requests sent yet.')).toBeTruthy();

  await fireEvent.changeText(screen.getByTestId('extra-time-category'), 'games');
  await fireEvent.changeText(screen.getByTestId('extra-time-minutes'), '15');
  await fireEvent.press(screen.getByTestId('submit-request'));

  await waitFor(() => expect(screen.getByTestId('pending-request-req-1')).toBeTruthy());
  expect(screen.getByTestId('pending-request-req-1')).toHaveTextContent(/pending/);
  expect(screen.queryByText('No requests sent yet.')).toBeNull();

  expect(globalThis.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/requests'),
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
    }),
  );
  const [, requestInit] = (globalThis.fetch as jest.Mock).mock.calls[0];
  const body = JSON.parse(requestInit.body as string);
  expect(body).toEqual({
    childId: 'child-1',
    type: 'extra_time',
    payload: { categoryId: 'games', minutes: 15, currentDailyUsage },
  });
});

test('surfaces an error and does not add a pending item when the request fails', async () => {
  (globalThis.fetch as jest.Mock).mockResolvedValue({ ok: false, json: async () => ({ error: 'gated feature' }) });

  await render(<RequestScreen route={route} navigation={navigation} />);

  await fireEvent.changeText(screen.getByTestId('extra-time-category'), 'games');
  await fireEvent.press(screen.getByTestId('submit-request'));

  expect(await screen.findByText('gated feature')).toBeTruthy();
  expect(screen.getByText('No requests sent yet.')).toBeTruthy();
});

test('switching to unblock and schedule_change shows their own fields', async () => {
  await render(<RequestScreen route={route} navigation={navigation} />);

  await fireEvent.press(screen.getByTestId('type-unblock'));
  expect(screen.getByTestId('unblock-target')).toBeTruthy();
  expect(screen.queryByTestId('extra-time-category')).toBeNull();

  await fireEvent.press(screen.getByTestId('type-schedule_change'));
  expect(screen.getByTestId('schedule-start')).toBeTruthy();
  expect(screen.getByTestId('schedule-end')).toBeTruthy();
});
