import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import AppManagementScreen from '../AppManagementScreen';
import { useFamily } from '../../dashboard/useFamily';
import { usePolicy } from '../../policy/usePolicy';
import { useInstalledApps } from '../useInstalledApps';

jest.mock('../../dashboard/useFamily');
jest.mock('../../policy/usePolicy');
jest.mock('../useInstalledApps');

const mockUseFamily = useFamily as jest.Mock;
const mockUsePolicy = usePolicy as jest.Mock;
const mockUseInstalledApps = useInstalledApps as jest.Mock;

const FIXTURE_APPS = [
  { appId: 'com.tiktok.android', name: 'TikTok', storeRating: '12+' },
  { appId: 'com.discord', name: 'Discord', storeRating: '17+' },
];

function familyData(tier: 'free' | 'standard' | 'premium') {
  return {
    family: { id: 'family-1', name: 'The Guardians', createdAt: '2026-01-01T00:00:00.000Z' },
    tier,
    children: [],
  };
}

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
const route = { key: 'r', name: 'AppManagement' as const, params: { childId: 'child-1' } };
const navigation = { navigate: jest.fn() } as never;

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders an upsell card for a non-standard (free) tier, not the editor', async () => {
  mockUseFamily.mockReturnValue({ data: familyData('free'), loading: false, error: null, refetch: jest.fn() });
  mockUsePolicy.mockReturnValue({ policy: policyWith(emptyAppRules), loading: false, saving: false, error: null, save: jest.fn(), refetch: jest.fn() });
  mockUseInstalledApps.mockReturnValue({ apps: FIXTURE_APPS, loading: false, error: null, refetch: jest.fn() });

  await render(<AppManagementScreen route={route} navigation={navigation} />);

  expect(screen.getByTestId('app-management-upsell')).toBeTruthy();
  expect(screen.queryByTestId('app-management-save')).toBeNull();
});

test('rating quick-block defaults to 17+ and Mature checked when unconfigured', async () => {
  const save = jest.fn().mockResolvedValue(policyWith(emptyAppRules));
  mockUseFamily.mockReturnValue({ data: familyData('standard'), loading: false, error: null, refetch: jest.fn() });
  mockUsePolicy.mockReturnValue({ policy: policyWith(emptyAppRules), loading: false, saving: false, error: null, save, refetch: jest.fn() });
  mockUseInstalledApps.mockReturnValue({ apps: FIXTURE_APPS, loading: false, error: null, refetch: jest.fn() });

  await render(<AppManagementScreen route={route} navigation={navigation} />);
  await fireEvent.press(screen.getByTestId('app-management-save'));

  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0].appRules.blockByStoreRating.sort()).toEqual(['17+', 'Mature']);
});

test('does not re-apply the rating default once already configured', async () => {
  mockUseFamily.mockReturnValue({ data: familyData('standard'), loading: false, error: null, refetch: jest.fn() });
  const save = jest.fn().mockResolvedValue(policyWith(emptyAppRules));
  mockUsePolicy.mockReturnValue({
    policy: policyWith({ blockedApps: [], allowedApps: [], blockByStoreRating: ['4+'] }),
    loading: false,
    saving: false,
    error: null,
    save,
    refetch: jest.fn(),
  });
  mockUseInstalledApps.mockReturnValue({ apps: FIXTURE_APPS, loading: false, error: null, refetch: jest.fn() });

  await render(<AppManagementScreen route={route} navigation={navigation} />);
  await fireEvent.press(screen.getByTestId('app-management-save'));

  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0].appRules.blockByStoreRating).toEqual(['4+']);
});

test('toggling an app updates blockedApps/allowedApps, mutually exclusive', async () => {
  const save = jest.fn().mockResolvedValue(policyWith(emptyAppRules));
  mockUseFamily.mockReturnValue({ data: familyData('standard'), loading: false, error: null, refetch: jest.fn() });
  mockUsePolicy.mockReturnValue({
    policy: policyWith({ blockedApps: [], allowedApps: [], blockByStoreRating: ['17+', 'Mature'] }),
    loading: false,
    saving: false,
    error: null,
    save,
    refetch: jest.fn(),
  });
  mockUseInstalledApps.mockReturnValue({ apps: FIXTURE_APPS, loading: false, error: null, refetch: jest.fn() });

  await render(<AppManagementScreen route={route} navigation={navigation} />);

  // Block TikTok (toggle on); Discord stays allowed (default).
  await fireEvent(screen.getByTestId('app-row-com.tiktok.android-toggle'), 'valueChange', true);
  await fireEvent.press(screen.getByTestId('app-management-save'));

  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const payload = save.mock.calls[0][0].appRules;
  expect(payload.blockedApps).toEqual(['com.tiktok.android']);
  expect(payload.allowedApps).toEqual(['com.discord']);
  // Mutual exclusivity: no app id appears in both lists.
  const overlap = payload.blockedApps.filter((id: string) => payload.allowedApps.includes(id));
  expect(overlap).toEqual([]);
});

test('toggling an already-blocked app back to allowed moves it between lists (still mutually exclusive)', async () => {
  const save = jest.fn().mockResolvedValue(policyWith(emptyAppRules));
  mockUseFamily.mockReturnValue({ data: familyData('standard'), loading: false, error: null, refetch: jest.fn() });
  mockUsePolicy.mockReturnValue({
    policy: policyWith({ blockedApps: ['com.discord'], allowedApps: [], blockByStoreRating: ['17+', 'Mature'] }),
    loading: false,
    saving: false,
    error: null,
    save,
    refetch: jest.fn(),
  });
  mockUseInstalledApps.mockReturnValue({ apps: FIXTURE_APPS, loading: false, error: null, refetch: jest.fn() });

  await render(<AppManagementScreen route={route} navigation={navigation} />);

  expect(screen.getByTestId('app-row-com.discord-toggle').props.value).toBe(true);
  await fireEvent(screen.getByTestId('app-row-com.discord-toggle'), 'valueChange', false);
  await fireEvent.press(screen.getByTestId('app-management-save'));

  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const payload = save.mock.calls[0][0].appRules;
  expect(payload.blockedApps).toEqual([]);
  expect(payload.allowedApps).toEqual(['com.tiktok.android', 'com.discord']);
});

test('preserves blocked/allowed entries for apps not in the current installed-app list', async () => {
  const save = jest.fn().mockResolvedValue(policyWith(emptyAppRules));
  mockUseFamily.mockReturnValue({ data: familyData('standard'), loading: false, error: null, refetch: jest.fn() });
  mockUsePolicy.mockReturnValue({
    policy: policyWith({ blockedApps: ['com.old.uninstalled.app'], allowedApps: [], blockByStoreRating: ['17+', 'Mature'] }),
    loading: false,
    saving: false,
    error: null,
    save,
    refetch: jest.fn(),
  });
  mockUseInstalledApps.mockReturnValue({ apps: FIXTURE_APPS, loading: false, error: null, refetch: jest.fn() });

  await render(<AppManagementScreen route={route} navigation={navigation} />);
  await fireEvent.press(screen.getByTestId('app-management-save'));

  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0].appRules.blockedApps).toContain('com.old.uninstalled.app');
});

test('defensively de-duplicates a pre-existing inconsistent policy (an id in both lists) — blocked wins', async () => {
  const save = jest.fn().mockResolvedValue(policyWith(emptyAppRules));
  mockUseFamily.mockReturnValue({ data: familyData('standard'), loading: false, error: null, refetch: jest.fn() });
  mockUsePolicy.mockReturnValue({
    // Deliberately inconsistent fixture: 'com.legacy.app' present in BOTH lists, not shown in
    // the current installed-app list — simulates pre-T16/manually-edited data.
    policy: policyWith({
      blockedApps: ['com.legacy.app'],
      allowedApps: ['com.legacy.app'],
      blockByStoreRating: ['17+', 'Mature'],
    }),
    loading: false,
    saving: false,
    error: null,
    save,
    refetch: jest.fn(),
  });
  mockUseInstalledApps.mockReturnValue({ apps: FIXTURE_APPS, loading: false, error: null, refetch: jest.fn() });

  await render(<AppManagementScreen route={route} navigation={navigation} />);
  await fireEvent.press(screen.getByTestId('app-management-save'));

  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const payload = save.mock.calls[0][0].appRules;
  expect(payload.blockedApps).toContain('com.legacy.app');
  expect(payload.allowedApps).not.toContain('com.legacy.app');
});
