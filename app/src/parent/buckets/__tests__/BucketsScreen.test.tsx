import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import BucketsScreen from '../BucketsScreen';
import { useFamily } from '../../dashboard/useFamily';
import { usePolicy } from '../../policy/usePolicy';

jest.mock('../../dashboard/useFamily');
jest.mock('../../policy/usePolicy');

const mockUseFamily = useFamily as jest.Mock;
const mockUsePolicy = usePolicy as jest.Mock;

function familyData(tier: 'free' | 'standard' | 'premium') {
  return {
    family: { id: 'family-1', name: 'The Guardians', createdAt: '2026-01-01T00:00:00.000Z' },
    tier,
    children: [],
  };
}

function policyWith(buckets: { perCategory: Record<string, unknown>; default: unknown }) {
  return {
    id: 'policy-1',
    childId: 'child-1',
    version: 3,
    screenTime: { dailyLimitMinutes: 60, weeklyLimitMinutes: 300, perApp: {}, perCategory: {} },
    buckets,
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
}

const defaultBucket = { maxSessionMinutes: 45, mandatoryBreakMinutes: 15, graceFinishEnabled: false };

const route = { key: 'r', name: 'Buckets' as const, params: { childId: 'child-1' } };
const navigation = { navigate: jest.fn() } as never;

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders an upsell card for a non-premium tier, not the editor', async () => {
  mockUseFamily.mockReturnValue({ data: familyData('standard'), loading: false, error: null, refetch: jest.fn() });
  mockUsePolicy.mockReturnValue({
    policy: policyWith({ perCategory: {}, default: defaultBucket }),
    loading: false,
    saving: false,
    error: null,
    save: jest.fn(),
    refetch: jest.fn(),
  });

  await render(<BucketsScreen route={route} navigation={navigation} />);

  expect(screen.getByTestId('buckets-upsell')).toBeTruthy();
  expect(screen.queryByTestId('buckets-save')).toBeNull();
});

test('upsell CTA navigates to the Paywall route', async () => {
  const navigate = jest.fn();
  mockUseFamily.mockReturnValue({ data: familyData('free'), loading: false, error: null, refetch: jest.fn() });
  mockUsePolicy.mockReturnValue({
    policy: policyWith({ perCategory: {}, default: defaultBucket }),
    loading: false,
    saving: false,
    error: null,
    save: jest.fn(),
    refetch: jest.fn(),
  });

  await render(<BucketsScreen route={route} navigation={{ navigate } as never} />);
  await fireEvent.press(screen.getByTestId('buckets-upsell-cta'));

  expect(navigate).toHaveBeenCalledWith('Paywall');
});

test('renders the full editor for a premium tier', async () => {
  mockUseFamily.mockReturnValue({ data: familyData('premium'), loading: false, error: null, refetch: jest.fn() });
  mockUsePolicy.mockReturnValue({
    policy: policyWith({ perCategory: { games: defaultBucket }, default: defaultBucket }),
    loading: false,
    saving: false,
    error: null,
    save: jest.fn(),
    refetch: jest.fn(),
  });

  await render(<BucketsScreen route={route} navigation={navigation} />);

  expect(screen.queryByTestId('buckets-upsell')).toBeNull();
  expect(screen.getByTestId('bucket-default-max-session').props.value).toBe('45');
  expect(screen.getByTestId('bucket-row-0-category').props.value).toBe('games');
  expect(screen.getByTestId('buckets-save')).toBeTruthy();
});

test('category override list add/edit/remove round-trips into the save() payload', async () => {
  const save = jest.fn().mockResolvedValue(policyWith({ perCategory: {}, default: defaultBucket }));
  mockUseFamily.mockReturnValue({ data: familyData('premium'), loading: false, error: null, refetch: jest.fn() });
  mockUsePolicy.mockReturnValue({
    policy: policyWith({ perCategory: { games: defaultBucket }, default: defaultBucket }),
    loading: false,
    saving: false,
    error: null,
    save,
    refetch: jest.fn(),
  });

  await render(<BucketsScreen route={route} navigation={navigation} />);

  // Edit the existing "games" override's max session length.
  await fireEvent.changeText(screen.getByTestId('bucket-row-0-max-session'), '60');

  // Add a new override row.
  await fireEvent.press(screen.getByTestId('add-bucket-category'));
  await fireEvent.changeText(screen.getByTestId('bucket-row-1-category'), 'social_media');
  await fireEvent.changeText(screen.getByTestId('bucket-row-1-max-session'), '30');
  await fireEvent.changeText(screen.getByTestId('bucket-row-1-break'), '10');
  await fireEvent.changeText(screen.getByTestId('bucket-row-1-max-sessions'), '3');
  await fireEvent(screen.getByTestId('bucket-row-1-grace'), 'valueChange', true);

  await fireEvent.press(screen.getByTestId('buckets-save'));

  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const payload = save.mock.calls[0][0];
  expect(payload.buckets.default).toEqual(defaultBucket);
  expect(payload.buckets.perCategory.games).toEqual({ ...defaultBucket, maxSessionMinutes: 60 });
  expect(payload.buckets.perCategory.social_media).toEqual({
    maxSessionMinutes: 30,
    mandatoryBreakMinutes: 10,
    maxSessionsPerDay: 3,
    graceFinishEnabled: true,
  });

  // Now remove the "games" override and re-save.
  await fireEvent.press(screen.getByTestId('bucket-row-0-remove'));
  await fireEvent.press(screen.getByTestId('buckets-save'));

  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  const secondPayload = save.mock.calls[1][0];
  expect(secondPayload.buckets.perCategory.games).toBeUndefined();
  expect(secondPayload.buckets.perCategory.social_media).toBeTruthy();
});

test('validation blocks a zero-length mandatory break and does not call save', async () => {
  const save = jest.fn();
  mockUseFamily.mockReturnValue({ data: familyData('premium'), loading: false, error: null, refetch: jest.fn() });
  mockUsePolicy.mockReturnValue({
    policy: policyWith({ perCategory: {}, default: defaultBucket }),
    loading: false,
    saving: false,
    error: null,
    save,
    refetch: jest.fn(),
  });

  await render(<BucketsScreen route={route} navigation={navigation} />);

  // Default row already has a positive max session length (45); zero out its mandatory break.
  await fireEvent.changeText(screen.getByTestId('bucket-default-break'), '0');

  expect(screen.getByTestId('bucket-default-error')).toBeTruthy();
  expect(screen.getByTestId('buckets-validation-error')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('buckets-save'));

  expect(save).not.toHaveBeenCalled();
});

test('fixing the invalid row un-blocks save', async () => {
  const save = jest.fn().mockResolvedValue(policyWith({ perCategory: {}, default: defaultBucket }));
  mockUseFamily.mockReturnValue({ data: familyData('premium'), loading: false, error: null, refetch: jest.fn() });
  mockUsePolicy.mockReturnValue({
    policy: policyWith({ perCategory: {}, default: defaultBucket }),
    loading: false,
    saving: false,
    error: null,
    save,
    refetch: jest.fn(),
  });

  await render(<BucketsScreen route={route} navigation={navigation} />);

  await fireEvent.changeText(screen.getByTestId('bucket-default-break'), '0');
  expect(screen.getByTestId('buckets-validation-error')).toBeTruthy();

  // Zeroing out the max session length instead of the break also makes the row valid again
  // (no session length configured -> no break required).
  await fireEvent.changeText(screen.getByTestId('bucket-default-max-session'), '0');
  expect(screen.queryByTestId('buckets-validation-error')).toBeNull();

  await fireEvent.press(screen.getByTestId('buckets-save'));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
});
