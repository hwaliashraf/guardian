import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import ScreenTimeScreen from '../ScreenTimeScreen';
import { usePolicy } from '../usePolicy';

jest.mock('../usePolicy');

const mockUsePolicy = usePolicy as jest.Mock;

const basePolicy = {
  id: 'policy-1',
  childId: 'child-1',
  version: 3,
  screenTime: {
    dailyLimitMinutes: 60,
    weeklyLimitMinutes: 300,
    perApp: { 'app-tiktok': 15 },
    perCategory: { social_media: 30 },
  },
  buckets: { perCategory: {}, default: { maxSessionMinutes: 30, mandatoryBreakMinutes: 10, graceFinishEnabled: false } },
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
  tamper: {
    alertOnUninstallAttempt: false,
    alertOnServiceDisabled: false,
    autoLockUntilRestored: false,
    pinRequired: false,
  },
  instantPause: false,
};

const route = { key: 'r', name: 'ScreenTime' as const, params: { childId: 'child-1' } };
const navigation = {} as never;

beforeEach(() => {
  jest.clearAllMocks();
});

test('saves the expected partial-policy shape, preserving perApp untouched', async () => {
  const save = jest.fn().mockResolvedValue(basePolicy);
  mockUsePolicy.mockReturnValue({ policy: basePolicy, loading: false, saving: false, error: null, save, refetch: jest.fn() });

  await render(<ScreenTimeScreen route={route} navigation={navigation} />);

  await fireEvent.changeText(screen.getByTestId('screen-time-daily'), '45');
  await fireEvent.changeText(screen.getByTestId('screen-time-weekly'), '200');
  await fireEvent.changeText(screen.getByTestId('category-row-0-minutes'), '40');
  await fireEvent.press(screen.getByTestId('add-category-row'));
  await fireEvent.changeText(screen.getByTestId('category-row-1-id'), 'games');
  await fireEvent.changeText(screen.getByTestId('category-row-1-minutes'), '20');

  await fireEvent.press(screen.getByTestId('screen-time-save'));

  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({
      screenTime: {
        dailyLimitMinutes: 45,
        weeklyLimitMinutes: 200,
        perApp: { 'app-tiktok': 15 },
        perCategory: { social_media: 40, games: 20 },
      },
    }),
  );
});

test('removing a category row excludes it from the saved perCategory shape', async () => {
  const save = jest.fn().mockResolvedValue(basePolicy);
  mockUsePolicy.mockReturnValue({ policy: basePolicy, loading: false, saving: false, error: null, save, refetch: jest.fn() });

  await render(<ScreenTimeScreen route={route} navigation={navigation} />);

  await fireEvent.press(screen.getByTestId('category-row-0-remove'));
  await fireEvent.press(screen.getByTestId('screen-time-save'));

  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({
      screenTime: {
        dailyLimitMinutes: 60,
        weeklyLimitMinutes: 300,
        perApp: { 'app-tiktok': 15 },
        perCategory: {},
      },
    }),
  );
});

test('renders a gated-403-style error inline instead of crashing', async () => {
  mockUsePolicy.mockReturnValue({
    policy: basePolicy,
    loading: false,
    saving: false,
    error: 'Feature "per_app_limits" requires the "premium" tier or higher',
    save: jest.fn(),
    refetch: jest.fn(),
  });

  await render(<ScreenTimeScreen route={route} navigation={navigation} />);

  expect(await screen.findByText('Feature "per_app_limits" requires the "premium" tier or higher')).toBeTruthy();
});

test('shows a loading indicator while policy is loading', async () => {
  mockUsePolicy.mockReturnValue({ policy: null, loading: true, saving: false, error: null, save: jest.fn(), refetch: jest.fn() });

  await render(<ScreenTimeScreen route={route} navigation={navigation} />);

  expect(screen.queryByTestId('screen-time-save')).toBeNull();
});

test('shows an empty state when no policy exists yet for the child', async () => {
  mockUsePolicy.mockReturnValue({ policy: null, loading: false, saving: false, error: null, save: jest.fn(), refetch: jest.fn() });

  await render(<ScreenTimeScreen route={route} navigation={navigation} />);

  expect(screen.getByText('No policy found for this child yet.')).toBeTruthy();
});
