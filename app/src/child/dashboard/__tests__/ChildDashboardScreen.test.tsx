import { render, screen, fireEvent } from '@testing-library/react-native';
import ChildDashboardScreen from '../ChildDashboardScreen';
import { useLocalBucketEngine } from '../useLocalBucketEngine';

jest.mock('../useLocalBucketEngine');

const mockUseLocalBucketEngine = useLocalBucketEngine as jest.Mock;

const identity = { deviceId: 'device-1', childId: 'child-1', deviceToken: 'token-1' };

// Opaque to the screen itself — it's only ever forwarded into the (mocked) hook untouched — but
// still needs to structurally satisfy `Policy`/`DailyUsageState` for the route prop to typecheck.
const fixturePolicy = {
  id: 'policy-1',
  childId: 'child-1',
  version: 1,
  screenTime: { dailyLimitMinutes: 100, weeklyLimitMinutes: 600, perApp: {}, perCategory: {} },
  buckets: { perCategory: {}, default: { maxSessionMinutes: 10, mandatoryBreakMinutes: 5, graceFinishEnabled: false } },
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
  tamper: { alertOnUninstallAttempt: false, alertOnServiceDisabled: false, autoLockUntilRestored: false, pinRequired: false },
  instantPause: false,
};
const fixtureUsage = { date: '2026-01-01', perCategoryMinutesUsed: {}, perCategorySessionCount: {}, totalMinutesUsed: 0 };
const routeParams = { policy: fixturePolicy, initialUsage: fixtureUsage, categoryId: 'gaming', identity };
const route = { key: 'k', name: 'Dashboard' as const, params: routeParams };

function baseEngineState() {
  return {
    dailyUsage: { date: '2026-01-01', perCategoryMinutesUsed: {}, perCategorySessionCount: {}, totalMinutesUsed: 20 },
    remainingMinutesToday: 80,
    session: { categoryId: 'gaming', startedAt: '2026-01-01T00:00:00.000Z', elapsedMinutes: 1, graceUsed: false, warnings5MinFired: false, warnings1MinFired: false },
    remainingSessionMinutes: 9,
    blockedReason: null,
    remainingBreakMinutes: undefined,
    nextBreakMinutes: 5,
    show5MinWarning: false,
    show1MinWarning: false,
    scheduleMessage: 'Bedtime starts at 9:00 PM',
    stillWatching: { visible: false, secondsRemaining: 30 },
    respondStillWatching: jest.fn(),
    recordActivity: jest.fn(),
    pendingEventCount: 0,
  };
}

const navigate = jest.fn();
const navigation = { navigate } as never;

beforeEach(() => {
  jest.clearAllMocks();
});

test('shows time left today, session remaining, next break, and the schedule message', async () => {
  mockUseLocalBucketEngine.mockReturnValue(baseEngineState());

  await render(<ChildDashboardScreen route={route} navigation={navigation} />);

  expect(screen.getByTestId('remaining-today')).toHaveTextContent('Time left today: 80 min');
  expect(screen.getByTestId('remaining-session')).toHaveTextContent('Session remaining: 9 min');
  expect(screen.getByTestId('next-break')).toHaveTextContent('Next break: 5 min');
  expect(screen.getByTestId('schedule-message')).toHaveTextContent('Bedtime starts at 9:00 PM');
});

test('shows the blocked reason (with remaining break minutes) instead of session-remaining when no session is active', async () => {
  mockUseLocalBucketEngine.mockReturnValue({
    ...baseEngineState(),
    session: null,
    blockedReason: 'mandatory_break_active',
    remainingBreakMinutes: 4.2,
  });

  await render(<ChildDashboardScreen route={route} navigation={navigation} />);

  expect(screen.queryByTestId('remaining-session')).toBeNull();
  expect(screen.getByTestId('blocked-reason')).toHaveTextContent('On a break — 5 min left');
});

test('fires the 5-min and 1-min warning banners from hook state', async () => {
  mockUseLocalBucketEngine.mockReturnValue({ ...baseEngineState(), show5MinWarning: true });
  await render(<ChildDashboardScreen route={route} navigation={navigation} />);
  expect(screen.getByTestId('warning-5min')).toHaveTextContent('5 minutes left');
  expect(screen.queryByTestId('warning-1min')).toBeNull();

  mockUseLocalBucketEngine.mockReturnValue({ ...baseEngineState(), show5MinWarning: true, show1MinWarning: true });
  await render(<ChildDashboardScreen route={route} navigation={navigation} />);
  expect(screen.getByTestId('warning-1min')).toHaveTextContent("1 minute left — time to wrap up!");
});

test('shows the Still Watching modal when the hook reports it visible', async () => {
  mockUseLocalBucketEngine.mockReturnValue({
    ...baseEngineState(),
    stillWatching: { visible: true, secondsRemaining: 12 },
  });

  await render(<ChildDashboardScreen route={route} navigation={navigation} />);

  expect(screen.getByTestId('still-watching-modal')).toBeTruthy();
  expect(screen.getByText('Respond within 12s or this session pauses.')).toBeTruthy();
});

test('navigates to the Request screen with identity + current dailyUsage', async () => {
  const engineState = baseEngineState();
  mockUseLocalBucketEngine.mockReturnValue(engineState);

  await render(<ChildDashboardScreen route={route} navigation={navigation} />);
  fireEvent.press(screen.getByTestId('make-request-button'));

  expect(navigate).toHaveBeenCalledWith('Request', { identity, currentDailyUsage: engineState.dailyUsage });
});
