import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import InstallAlertsScreen from '../InstallAlertsScreen';
import { usePolicy } from '../../policy/usePolicy';
import { useInstallAlerts } from '../useInstallAlerts';

jest.mock('../../policy/usePolicy');
jest.mock('../useInstallAlerts');

const mockUsePolicy = usePolicy as jest.Mock;
const mockUseInstallAlerts = useInstallAlerts as jest.Mock;

function policyWith(appRules: { blockedApps: string[]; allowedApps: string[]; blockByStoreRating: string[] }) {
  return {
    id: 'policy-1',
    childId: 'child-1',
    version: 3,
    screenTime: { dailyLimitMinutes: 60, weeklyLimitMinutes: 300, perApp: {}, perCategory: {} },
    buckets: { perCategory: {}, default: { maxSessionMinutes: 0, mandatoryBreakMinutes: 0, graceFinishEnabled: false } },
    schedules: [],
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
    appRules,
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

const emptyAppRules = { blockedApps: [], allowedApps: [], blockByStoreRating: [] };
const route = { key: 'r', name: 'InstallAlerts' as const, params: { childId: 'child-1' } };
const navigation = {} as never;

const EVENT_1 = {
  id: 'event-1',
  deviceId: 'device-1',
  childId: 'child-1',
  type: 'new_install' as const,
  payload: { appId: 'com.newapp', name: 'New App', storeRating: '17+' },
  occurredAt: '2026-07-14T10:00:00.000Z',
};
const EVENT_2 = {
  id: 'event-2',
  deviceId: 'device-1',
  childId: 'child-1',
  type: 'new_install' as const,
  payload: { appId: 'com.anotherapp', name: 'Another App', storeRating: '4+' },
  occurredAt: '2026-07-13T10:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders the install-alerts feed', async () => {
  mockUseInstallAlerts.mockReturnValue({ events: [EVENT_1, EVENT_2], loading: false, error: null, refetch: jest.fn() });
  mockUsePolicy.mockReturnValue({ policy: policyWith(emptyAppRules), loading: false, saving: false, error: null, save: jest.fn(), refetch: jest.fn() });

  await render(<InstallAlertsScreen route={route} navigation={navigation} />);

  expect(screen.getByTestId('install-alert-event-1')).toBeTruthy();
  expect(screen.getByTestId('install-alert-event-2')).toBeTruthy();
  expect(screen.getByText('New App')).toBeTruthy();
  expect(screen.getByText('Another App')).toBeTruthy();
});

test('shows an empty state when there are no install alerts', async () => {
  mockUseInstallAlerts.mockReturnValue({ events: [], loading: false, error: null, refetch: jest.fn() });
  mockUsePolicy.mockReturnValue({ policy: policyWith(emptyAppRules), loading: false, saving: false, error: null, save: jest.fn(), refetch: jest.fn() });

  await render(<InstallAlertsScreen route={route} navigation={navigation} />);

  expect(screen.getByText('No new-install alerts yet.')).toBeTruthy();
});

test('quick-block action adds the app to blockedApps via the AppRulePolicy save path', async () => {
  const save = jest.fn().mockResolvedValue(policyWith(emptyAppRules));
  mockUseInstallAlerts.mockReturnValue({ events: [EVENT_1], loading: false, error: null, refetch: jest.fn() });
  mockUsePolicy.mockReturnValue({
    policy: policyWith({ blockedApps: [], allowedApps: ['com.newapp'], blockByStoreRating: [] }),
    loading: false,
    saving: false,
    error: null,
    save,
    refetch: jest.fn(),
  });

  await render(<InstallAlertsScreen route={route} navigation={navigation} />);
  await fireEvent.press(screen.getByTestId('install-alert-event-1-block'));

  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const payload = save.mock.calls[0][0].appRules;
  expect(payload.blockedApps).toEqual(['com.newapp']);
  // Mutual exclusivity: removed from allowedApps when blocked.
  expect(payload.allowedApps).toEqual([]);
});

test('quick-block is a no-op (disabled) for an app that is already blocked', async () => {
  const save = jest.fn();
  mockUseInstallAlerts.mockReturnValue({ events: [EVENT_1], loading: false, error: null, refetch: jest.fn() });
  mockUsePolicy.mockReturnValue({
    policy: policyWith({ blockedApps: ['com.newapp'], allowedApps: [], blockByStoreRating: [] }),
    loading: false,
    saving: false,
    error: null,
    save,
    refetch: jest.fn(),
  });

  await render(<InstallAlertsScreen route={route} navigation={navigation} />);

  expect(screen.getByTestId('install-alert-event-1-block').props.accessibilityState?.disabled).toBe(true);
  await fireEvent.press(screen.getByTestId('install-alert-event-1-block'));
  expect(save).not.toHaveBeenCalled();
});
