import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import VacationModeScreen from '../VacationModeScreen';
import { usePolicy } from '../usePolicy';

jest.mock('../usePolicy');

const mockUsePolicy = usePolicy as jest.Mock;

function policyWith(vacation: { enabled: boolean; endDate: string | null }) {
  return {
    id: 'policy-1',
    childId: 'child-1',
    version: 3,
    screenTime: { dailyLimitMinutes: 60, weeklyLimitMinutes: 300, perApp: {}, perCategory: {} },
    buckets: { perCategory: {}, default: { maxSessionMinutes: 30, mandatoryBreakMinutes: 10, graceFinishEnabled: false } },
    schedules: [],
    vacation,
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

const route = { key: 'r', name: 'VacationMode' as const, params: { childId: 'child-1' } };
const navigation = {} as never;

beforeEach(() => {
  jest.clearAllMocks();
});

test('toggle disables the end-date field when off, enables it when on', async () => {
  const policy = policyWith({ enabled: true, endDate: '2026-08-01' });
  mockUsePolicy.mockReturnValue({ policy, loading: false, saving: false, error: null, save: jest.fn(), refetch: jest.fn() });

  await render(<VacationModeScreen route={route} navigation={navigation} />);

  expect(screen.getByTestId('vacation-end-date').props.editable).toBe(true);

  await fireEvent(screen.getByTestId('vacation-toggle'), 'valueChange', false);

  expect(screen.getByTestId('vacation-end-date').props.editable).toBe(false);
});

test('shows the current persisted state: active until <date>', async () => {
  const policy = policyWith({ enabled: true, endDate: '2026-08-01' });
  mockUsePolicy.mockReturnValue({ policy, loading: false, saving: false, error: null, save: jest.fn(), refetch: jest.fn() });

  await render(<VacationModeScreen route={route} navigation={navigation} />);

  expect(screen.getByTestId('vacation-current-state').props.children).toBe('Active until 2026-08-01');
});

test('shows the current persisted state: inactive', async () => {
  const policy = policyWith({ enabled: false, endDate: null });
  mockUsePolicy.mockReturnValue({ policy, loading: false, saving: false, error: null, save: jest.fn(), refetch: jest.fn() });

  await render(<VacationModeScreen route={route} navigation={navigation} />);

  expect(screen.getByTestId('vacation-current-state').props.children).toBe('Inactive');
});

test('save PUTs vacation: { enabled: true, endDate }', async () => {
  const policy = policyWith({ enabled: false, endDate: null });
  const save = jest.fn().mockResolvedValue(policy);
  mockUsePolicy.mockReturnValue({ policy, loading: false, saving: false, error: null, save, refetch: jest.fn() });

  await render(<VacationModeScreen route={route} navigation={navigation} />);

  await fireEvent(screen.getByTestId('vacation-toggle'), 'valueChange', true);
  await fireEvent.changeText(screen.getByTestId('vacation-end-date'), '2026-09-01');
  await fireEvent.press(screen.getByTestId('vacation-save'));

  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({ vacation: { enabled: true, endDate: '2026-09-01' } }),
  );
});

test('save with the toggle off preserves the already-entered endDate (field is disabled, not cleared)', async () => {
  const policy = policyWith({ enabled: true, endDate: '2026-08-01' });
  const save = jest.fn().mockResolvedValue(policy);
  mockUsePolicy.mockReturnValue({ policy, loading: false, saving: false, error: null, save, refetch: jest.fn() });

  await render(<VacationModeScreen route={route} navigation={navigation} />);

  await fireEvent(screen.getByTestId('vacation-toggle'), 'valueChange', false);
  await fireEvent.press(screen.getByTestId('vacation-save'));

  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({ vacation: { enabled: false, endDate: '2026-08-01' } }),
  );
});

test('save with no endDate entered sends endDate: null', async () => {
  const policy = policyWith({ enabled: false, endDate: null });
  const save = jest.fn().mockResolvedValue(policy);
  mockUsePolicy.mockReturnValue({ policy, loading: false, saving: false, error: null, save, refetch: jest.fn() });

  await render(<VacationModeScreen route={route} navigation={navigation} />);

  await fireEvent(screen.getByTestId('vacation-toggle'), 'valueChange', true);
  await fireEvent.press(screen.getByTestId('vacation-save'));

  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({ vacation: { enabled: true, endDate: null } }),
  );
});
