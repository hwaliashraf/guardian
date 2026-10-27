import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { CONTENT_CATEGORIES, getAgeBasedPreset } from '@guardian/domain';
import ContentFilterScreen from '../ContentFilterScreen';
import { useFamily } from '../../dashboard/useFamily';
import { usePolicy } from '../../policy/usePolicy';

jest.mock('../../dashboard/useFamily');
jest.mock('../../policy/usePolicy');

const mockUseFamily = useFamily as jest.Mock;
const mockUsePolicy = usePolicy as jest.Mock;

function familyData(birthdate: string) {
  return {
    family: { id: 'family-1', name: 'The Guardians', createdAt: '2026-01-01T00:00:00.000Z' },
    tier: 'standard' as const,
    children: [{ id: 'child-1', familyId: 'family-1', name: 'Alice', birthdate, devices: [] }],
  };
}

function emptyContentFilter() {
  return {
    categories: {},
    whitelistOnly: false,
    customAllowDomains: [],
    customBlockDomains: [],
    customBlockKeywords: [],
    safeSearchEnforced: false,
    youtubeRestrictedMode: false,
  };
}

function policyWith(contentFilter: ReturnType<typeof emptyContentFilter>) {
  return {
    id: 'policy-1',
    childId: 'child-1',
    version: 3,
    screenTime: { dailyLimitMinutes: 60, weeklyLimitMinutes: 300, perApp: {}, perCategory: {} },
    buckets: { perCategory: {}, default: { maxSessionMinutes: 0, mandatoryBreakMinutes: 0, graceFinishEnabled: false } },
    schedules: [],
    vacation: { enabled: false, endDate: null },
    contentFilter,
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

const route = { key: 'r', name: 'ContentFilter' as const, params: { childId: 'child-1' } };
const navigation = {} as never;

// ContentFilterScreen calls deriveAgeTier(birthdate) with no explicit `asOf` (matches the
// ticket's literal spec), which defaults to `new Date()` — compute fixture birthdates relative
// to the real "now" at test-run time (not a hardcoded absolute date) so age-tier assertions
// stay correct no matter when this suite actually runs, without needing fake timers (which risk
// interacting badly with this RTL version's async render/fireEvent internals).
function birthdateYearsAgo(years: number): string {
  const now = new Date();
  return new Date(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()).toISOString().slice(0, 10);
}
const PRETEEN_BIRTHDATE = birthdateYearsAgo(11);

beforeEach(() => {
  jest.clearAllMocks();
});

test('category grid covers all 32 CONTENT_CATEGORIES ids', async () => {
  mockUseFamily.mockReturnValue({ data: familyData(PRETEEN_BIRTHDATE), loading: false, error: null, refetch: jest.fn() });
  mockUsePolicy.mockReturnValue({
    policy: policyWith(emptyContentFilter()),
    loading: false,
    saving: false,
    error: null,
    save: jest.fn(),
    refetch: jest.fn(),
  });

  await render(<ContentFilterScreen route={route} navigation={navigation} />);

  expect(CONTENT_CATEGORIES.length).toBe(32);
  for (const category of CONTENT_CATEGORIES) {
    expect(screen.getByTestId(`category-${category.id}`)).toBeTruthy();
  }
});

test('age-preset applied correctly per age tier when no existing categories are configured', async () => {
  // PRETEEN_BIRTHDATE is computed as ~11 years before the real "now" -> preteen tier.
  mockUseFamily.mockReturnValue({ data: familyData(PRETEEN_BIRTHDATE), loading: false, error: null, refetch: jest.fn() });
  const save = jest.fn().mockResolvedValue(policyWith(emptyContentFilter()));
  mockUsePolicy.mockReturnValue({
    policy: policyWith(emptyContentFilter()),
    loading: false,
    saving: false,
    error: null,
    save,
    refetch: jest.fn(),
  });

  await render(<ContentFilterScreen route={route} navigation={navigation} />);
  await fireEvent.press(screen.getByTestId('content-filter-save'));

  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const payload = save.mock.calls[0][0];
  expect(payload.contentFilter.categories).toEqual(getAgeBasedPreset('preteen'));
});

test('does not overwrite an already-configured categories map with the age preset', async () => {
  const existingCategories = getAgeBasedPreset('teen'); // deliberately different from the child's real tier
  mockUseFamily.mockReturnValue({ data: familyData(PRETEEN_BIRTHDATE), loading: false, error: null, refetch: jest.fn() });
  const save = jest.fn().mockResolvedValue(policyWith(emptyContentFilter()));
  mockUsePolicy.mockReturnValue({
    policy: policyWith({ ...emptyContentFilter(), categories: existingCategories }),
    loading: false,
    saving: false,
    error: null,
    save,
    refetch: jest.fn(),
  });

  await render(<ContentFilterScreen route={route} navigation={navigation} />);
  await fireEvent.press(screen.getByTestId('content-filter-save'));

  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0].contentFilter.categories).toEqual(existingCategories);
});

test('applies the age preset even when useFamily resolves after usePolicy (race regression)', async () => {
  // usePolicy resolves first (policy loaded, empty categories); useFamily/birthdate resolves
  // on a later render. The preset-seeding effect must not permanently skip seeding just
  // because childBirthdate was undefined the first time the effect ran.
  mockUseFamily.mockReturnValue({ data: null, loading: true, error: null, refetch: jest.fn() });
  const save = jest.fn().mockResolvedValue(policyWith(emptyContentFilter()));
  mockUsePolicy.mockReturnValue({
    policy: policyWith(emptyContentFilter()),
    loading: false,
    saving: false,
    error: null,
    save,
    refetch: jest.fn(),
  });

  const view = await render(<ContentFilterScreen route={route} navigation={navigation} />);

  // Still loading (family data not resolved yet) — spinner, no save button.
  expect(screen.queryByTestId('content-filter-save')).toBeNull();

  mockUseFamily.mockReturnValue({ data: familyData(PRETEEN_BIRTHDATE), loading: false, error: null, refetch: jest.fn() });
  await view.rerender(<ContentFilterScreen route={route} navigation={navigation} />);

  await fireEvent.press(screen.getByTestId('content-filter-save'));

  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0].contentFilter.categories).toEqual(getAgeBasedPreset('preteen'));
});

test('whitelist-only mode shows the stricter-mode banner and disables category toggles', async () => {
  mockUseFamily.mockReturnValue({ data: familyData(PRETEEN_BIRTHDATE), loading: false, error: null, refetch: jest.fn() });
  mockUsePolicy.mockReturnValue({
    policy: policyWith(emptyContentFilter()),
    loading: false,
    saving: false,
    error: null,
    save: jest.fn(),
    refetch: jest.fn(),
  });

  await render(<ContentFilterScreen route={route} navigation={navigation} />);

  expect(screen.queryByTestId('content-filter-whitelist-banner')).toBeNull();
  expect(screen.getByTestId('category-adult').props.accessibilityState?.disabled).toBeFalsy();

  await fireEvent(screen.getByTestId('content-filter-whitelist-only'), 'valueChange', true);

  expect(screen.getByTestId('content-filter-whitelist-banner')).toBeTruthy();
  expect(screen.getByTestId('category-adult').props.accessibilityState?.disabled).toBe(true);
});

test('custom domain/keyword lists add/remove round-trip into the save() payload', async () => {
  const save = jest.fn().mockResolvedValue(policyWith(emptyContentFilter()));
  mockUseFamily.mockReturnValue({ data: familyData(PRETEEN_BIRTHDATE), loading: false, error: null, refetch: jest.fn() });
  mockUsePolicy.mockReturnValue({
    policy: policyWith(emptyContentFilter()),
    loading: false,
    saving: false,
    error: null,
    save,
    refetch: jest.fn(),
  });

  await render(<ContentFilterScreen route={route} navigation={navigation} />);

  await fireEvent.changeText(screen.getByTestId('content-filter-block-domains-draft'), 'bad-site.com');
  await fireEvent.press(screen.getByTestId('content-filter-block-domains-add'));
  await fireEvent.changeText(screen.getByTestId('content-filter-block-keywords-draft'), 'gore');
  await fireEvent.press(screen.getByTestId('content-filter-block-keywords-add'));
  await fireEvent.changeText(screen.getByTestId('content-filter-allow-domains-draft'), 'school.edu');
  await fireEvent.press(screen.getByTestId('content-filter-allow-domains-add'));

  await fireEvent.press(screen.getByTestId('content-filter-save'));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0].contentFilter.customBlockDomains).toEqual(['bad-site.com']);
  expect(save.mock.calls[0][0].contentFilter.customBlockKeywords).toEqual(['gore']);
  expect(save.mock.calls[0][0].contentFilter.customAllowDomains).toEqual(['school.edu']);

  // Now remove the blocked domain and re-save.
  await fireEvent.press(screen.getByTestId('content-filter-block-domains-chip-bad-site.com'));
  await fireEvent.press(screen.getByTestId('content-filter-save'));

  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1][0].contentFilter.customBlockDomains).toEqual([]);
});

test('SafeSearch and YouTube-restricted toggles save correctly', async () => {
  const save = jest.fn().mockResolvedValue(policyWith(emptyContentFilter()));
  mockUseFamily.mockReturnValue({ data: familyData(PRETEEN_BIRTHDATE), loading: false, error: null, refetch: jest.fn() });
  mockUsePolicy.mockReturnValue({
    policy: policyWith(emptyContentFilter()),
    loading: false,
    saving: false,
    error: null,
    save,
    refetch: jest.fn(),
  });

  await render(<ContentFilterScreen route={route} navigation={navigation} />);

  await fireEvent(screen.getByTestId('content-filter-safe-search'), 'valueChange', true);
  await fireEvent(screen.getByTestId('content-filter-youtube-restricted'), 'valueChange', true);
  await fireEvent.press(screen.getByTestId('content-filter-save'));

  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0].contentFilter.safeSearchEnforced).toBe(true);
  expect(save.mock.calls[0][0].contentFilter.youtubeRestrictedMode).toBe(true);
});
