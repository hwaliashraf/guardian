import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import SchedulesScreen from '../SchedulesScreen';
import { usePolicy } from '../usePolicy';

jest.mock('../usePolicy');

const mockUsePolicy = usePolicy as jest.Mock;

const homeworkEntry = {
  id: 'sched-1',
  type: 'homework' as const,
  daysOfWeek: [1, 2, 3, 4, 5],
  startTime: '15:00',
  endTime: '17:00',
  allowedCategories: ['education'],
};

function policyWith(schedules: unknown[]) {
  return {
    id: 'policy-1',
    childId: 'child-1',
    version: 3,
    screenTime: { dailyLimitMinutes: 60, weeklyLimitMinutes: 300, perApp: {}, perCategory: {} },
    buckets: { perCategory: {}, default: { maxSessionMinutes: 30, mandatoryBreakMinutes: 10, graceFinishEnabled: false } },
    schedules,
    vacation: { enabled: false, endDate: null },
    contentFilter: {
      categories: {},
      whitelistOnly: false,
      customAllowDomains: [],
      customBlockDomains: [],
      customBlockKeywords: [],
      safeSearchEnforced: false,
      youtubeRestrictedMode: false,
    },
    appRules: { blockedApps: [], allowedApps: [], blockByStoreRating: [] },
    presence: {
      level0Enabled: false,
      level1Enabled: false,
      level2Enabled: false,
      thresholdMinutes: { level0: 0, level1: 0, level2: 0 },
      onTrigger: 'pauseTimer' as const,
      refundAbandonedMinutes: false,
      notifyParentOnTrigger: true as const,
    },
    tamper: {
      alertOnUninstallAttempt: false,
      alertOnServiceDisabled: false,
      autoLockUntilRestored: false,
      pinRequired: false,
    },
    instantPause: false,
  };
}

const route = { key: 'r', name: 'Schedules' as const, params: { childId: 'child-1' } };
const navigation = {} as never;

beforeEach(() => {
  jest.clearAllMocks();
});

test('round-trips add/edit/remove into the exact save() payload', async () => {
  const policy = policyWith([homeworkEntry]);
  const save = jest.fn().mockResolvedValue(policy);
  mockUsePolicy.mockReturnValue({ policy, loading: false, saving: false, error: null, save, refetch: jest.fn() });

  await render(<SchedulesScreen route={route} navigation={navigation} />);

  // Edit the existing homework entry's end time.
  await fireEvent.changeText(screen.getByTestId('schedule-row-sched-1-end'), '17:30');

  // Add a mealtime entry, then edit its times and days.
  await fireEvent.press(screen.getByTestId('add-routine-mealtime'));
  const mealtimeRows = screen.queryAllByText('Mealtime');
  expect(mealtimeRows.length).toBeGreaterThan(0);

  await fireEvent.press(screen.getByTestId('schedules-save'));

  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const payload = save.mock.calls[0][0];
  expect(payload.schedules).toHaveLength(2);
  expect(payload.schedules[0]).toMatchObject({ id: 'sched-1', endTime: '17:30' });
  expect(payload.schedules[1]).toMatchObject({ type: 'mealtime', daysOfWeek: [] });

  // Now remove the original homework entry and re-save.
  await fireEvent.press(screen.getByTestId('schedule-row-sched-1-remove'));
  await fireEvent.press(screen.getByTestId('schedules-save'));

  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  const secondPayload = save.mock.calls[1][0];
  expect(secondPayload.schedules).toHaveLength(1);
  expect(secondPayload.schedules[0]).toMatchObject({ type: 'mealtime' });
});

test('adding a category to a schedule and toggling a day updates the entry', async () => {
  const policy = policyWith([homeworkEntry]);
  const save = jest.fn().mockResolvedValue(policy);
  mockUsePolicy.mockReturnValue({ policy, loading: false, saving: false, error: null, save, refetch: jest.fn() });

  await render(<SchedulesScreen route={route} navigation={navigation} />);

  // Toggle off Monday (day index 1).
  await fireEvent.press(screen.getByTestId('schedule-row-sched-1-day-1'));

  await fireEvent.changeText(screen.getByTestId('schedule-row-sched-1-category-draft'), 'gaming');
  await fireEvent.press(screen.getByTestId('schedule-row-sched-1-category-add'));

  await fireEvent.press(screen.getByTestId('schedules-save'));

  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const payload = save.mock.calls[0][0];
  expect(payload.schedules[0].daysOfWeek).toEqual([2, 3, 4, 5]);
  expect(payload.schedules[0].allowedCategories).toEqual(['education', 'gaming']);
});

test('two-bedtime-entries pattern: weekday and weekend rows are added and labeled distinctly', async () => {
  const policy = policyWith([]);
  const save = jest.fn().mockResolvedValue(policy);
  mockUsePolicy.mockReturnValue({ policy, loading: false, saving: false, error: null, save, refetch: jest.fn() });

  await render(<SchedulesScreen route={route} navigation={navigation} />);

  await fireEvent.press(screen.getByTestId('add-weekday-bedtime'));
  await fireEvent.press(screen.getByTestId('add-weekend-bedtime'));

  expect(screen.getByText('Weekday bedtime')).toBeTruthy();
  expect(screen.getByText('Weekend bedtime')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('schedules-save'));

  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const payload = save.mock.calls[0][0];
  expect(payload.schedules).toHaveLength(2);
  const weekday = payload.schedules.find((s: { daysOfWeek: number[] }) =>
    JSON.stringify(s.daysOfWeek) === JSON.stringify([1, 2, 3, 4, 5]),
  );
  const weekend = payload.schedules.find((s: { daysOfWeek: number[] }) =>
    JSON.stringify(s.daysOfWeek) === JSON.stringify([0, 6]),
  );
  expect(weekday).toBeTruthy();
  expect(weekend).toBeTruthy();
  expect(weekday.type).toBe('bedtime');
  expect(weekend.type).toBe('bedtime');
  expect(weekday.id).not.toBe(weekend.id);
});
