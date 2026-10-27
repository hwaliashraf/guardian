import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import TamperAlertsScreen from '../TamperAlertsScreen';
import { usePolicy } from '../../policy/usePolicy';
import { useTamperAlerts } from '../useTamperAlerts';

jest.mock('../../policy/usePolicy');
jest.mock('../useTamperAlerts');

const mockUsePolicy = usePolicy as jest.Mock;
const mockUseTamperAlerts = useTamperAlerts as jest.Mock;

function policyWith(tamper: {
  alertOnUninstallAttempt: boolean;
  alertOnServiceDisabled: boolean;
  autoLockUntilRestored: boolean;
  pinRequired: boolean;
}) {
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
    tamper,
    instantPause: false,
  };
}

const emptyTamper = {
  alertOnUninstallAttempt: false,
  alertOnServiceDisabled: false,
  autoLockUntilRestored: false,
  pinRequired: false,
};
const route = { key: 'r', name: 'TamperAlerts' as const, params: { childId: 'child-1' } };
const navigation = {} as never;

const UNINSTALL_EVENT = {
  id: 'event-1',
  deviceId: 'device-1',
  childId: 'child-1',
  type: 'uninstall_attempt' as const,
  payload: { service: 'Device Admin' },
  occurredAt: '2026-07-14T10:00:00.000Z',
};
const DISABLED_EVENT = {
  id: 'event-2',
  deviceId: 'device-1',
  childId: 'child-1',
  type: 'service_disabled' as const,
  payload: { service: 'Accessibility' },
  occurredAt: '2026-07-13T10:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders both tamper event types, newest first as returned by the hook', async () => {
  mockUseTamperAlerts.mockReturnValue({
    events: [UNINSTALL_EVENT, DISABLED_EVENT],
    loading: false,
    error: null,
    refetch: jest.fn(),
  });
  mockUsePolicy.mockReturnValue({ policy: policyWith(emptyTamper), loading: false, saving: false, error: null, save: jest.fn(), refetch: jest.fn() });

  await render(<TamperAlertsScreen route={route} navigation={navigation} />);

  expect(screen.getByTestId('tamper-alert-event-1')).toBeTruthy();
  expect(screen.getByTestId('tamper-alert-event-2')).toBeTruthy();
  expect(screen.getByText('Uninstall attempted')).toBeTruthy();
  expect(screen.getByText('Protection service disabled')).toBeTruthy();
});

test('shows an empty state when there are no tamper alerts', async () => {
  mockUseTamperAlerts.mockReturnValue({ events: [], loading: false, error: null, refetch: jest.fn() });
  mockUsePolicy.mockReturnValue({ policy: policyWith(emptyTamper), loading: false, saving: false, error: null, save: jest.fn(), refetch: jest.fn() });

  await render(<TamperAlertsScreen route={route} navigation={navigation} />);

  expect(screen.getByText('No tamper alerts yet.')).toBeTruthy();
});

test('save PUTs the toggled tamper settings, preserving the other tamper fields untouched', async () => {
  const save = jest.fn().mockResolvedValue(policyWith(emptyTamper));
  mockUseTamperAlerts.mockReturnValue({ events: [], loading: false, error: null, refetch: jest.fn() });
  mockUsePolicy.mockReturnValue({
    policy: policyWith({ ...emptyTamper, alertOnUninstallAttempt: true }),
    loading: false,
    saving: false,
    error: null,
    save,
    refetch: jest.fn(),
  });

  await render(<TamperAlertsScreen route={route} navigation={navigation} />);

  await fireEvent(screen.getByTestId('tamper-auto-lock-toggle'), 'valueChange', true);
  await fireEvent(screen.getByTestId('tamper-pin-required-toggle'), 'valueChange', true);
  await fireEvent.press(screen.getByTestId('tamper-save'));

  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({
      tamper: {
        alertOnUninstallAttempt: true,
        alertOnServiceDisabled: false,
        autoLockUntilRestored: true,
        pinRequired: true,
      },
    }),
  );
});

test('reflects the persisted toggle state on load', async () => {
  mockUseTamperAlerts.mockReturnValue({ events: [], loading: false, error: null, refetch: jest.fn() });
  mockUsePolicy.mockReturnValue({
    policy: policyWith({ ...emptyTamper, autoLockUntilRestored: true, pinRequired: true }),
    loading: false,
    saving: false,
    error: null,
    save: jest.fn(),
    refetch: jest.fn(),
  });

  await render(<TamperAlertsScreen route={route} navigation={navigation} />);

  expect(screen.getByTestId('tamper-auto-lock-toggle').props.value).toBe(true);
  expect(screen.getByTestId('tamper-pin-required-toggle').props.value).toBe(true);
});
