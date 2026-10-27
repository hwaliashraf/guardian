import { render, screen } from '@testing-library/react-native';
import WeeklyDigestScreen from '../WeeklyDigestScreen';
import { useLatestDigest } from '../useLatestDigest';

jest.mock('../useLatestDigest');

const mockUseLatestDigest = useLatestDigest as jest.Mock;

const route = { key: 'r', name: 'WeeklyDigest' as const, params: { childId: 'child-1' } };
const navigation = {} as never;

const FIXTURE_DIGEST = {
  id: 'digest-1',
  childId: 'child-1',
  weekStart: '2026-07-13',
  summary: {
    totalsByCategory: { games: 120, education: 30 },
    blockAttemptCount: 4,
    topBlockedDomains: [
      { domain: 'blocked1.example', count: 3 },
      { domain: 'blocked2.example', count: 1 },
    ],
    youtubeViewCount: 7,
  },
  sentAt: '2026-07-14T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders a fixture DigestSummary correctly', async () => {
  mockUseLatestDigest.mockReturnValue({ digest: FIXTURE_DIGEST, loading: false, error: null, refetch: jest.fn() });

  await render(<WeeklyDigestScreen route={route} navigation={navigation} />);

  expect(screen.getByText('Week of 2026-07-13')).toBeTruthy();

  const games = screen.getByTestId('digest-category-games');
  expect(games).toBeTruthy();
  expect(games.props.children).toBeDefined();
  expect(screen.getByText('games')).toBeTruthy();
  expect(screen.getByText('120 min')).toBeTruthy();
  expect(screen.getByText('education')).toBeTruthy();
  expect(screen.getByText('30 min')).toBeTruthy();

  expect(screen.getByTestId('digest-block-attempt-count')).toBeTruthy();
  expect(screen.getByText('4')).toBeTruthy();
  expect(screen.getByTestId('digest-youtube-count')).toBeTruthy();
  expect(screen.getByText('7')).toBeTruthy();

  expect(screen.getByText('blocked1.example')).toBeTruthy();
  expect(screen.getByText('3')).toBeTruthy();
  expect(screen.getByText('blocked2.example')).toBeTruthy();
});

test('shows an empty state when there is no digest yet', async () => {
  mockUseLatestDigest.mockReturnValue({ digest: null, loading: false, error: null, refetch: jest.fn() });

  await render(<WeeklyDigestScreen route={route} navigation={navigation} />);

  expect(screen.getByText('No weekly digest yet.')).toBeTruthy();
});

test('shows an empty state for zero-category, zero-domain digest without crashing', async () => {
  mockUseLatestDigest.mockReturnValue({
    digest: {
      ...FIXTURE_DIGEST,
      summary: { totalsByCategory: {}, blockAttemptCount: 0, topBlockedDomains: [], youtubeViewCount: 0 },
    },
    loading: false,
    error: null,
    refetch: jest.fn(),
  });

  await render(<WeeklyDigestScreen route={route} navigation={navigation} />);

  expect(screen.getByText('No usage recorded.')).toBeTruthy();
  expect(screen.getByText('None.')).toBeTruthy();
});
