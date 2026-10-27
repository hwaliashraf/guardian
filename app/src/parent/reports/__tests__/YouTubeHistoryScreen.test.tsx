import { render, screen } from '@testing-library/react-native';
import YouTubeHistoryScreen from '../YouTubeHistoryScreen';
import { useYouTubeHistory } from '../useYouTubeHistory';

jest.mock('../useYouTubeHistory');

const mockUseYouTubeHistory = useYouTubeHistory as jest.Mock;

const route = { key: 'r', name: 'YouTubeHistory' as const, params: { childId: 'child-1' } };
const navigation = {} as never;

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders title/link for fixture payloads matching the documented {title,url,watchedAt} shape', async () => {
  mockUseYouTubeHistory.mockReturnValue({
    entries: [
      { id: 'e1', title: 'Learning colors', url: 'https://youtube.com/watch?v=abc123', watchedAt: '2026-07-16T10:00:00.000Z' },
      { id: 'e2', title: 'Minecraft tutorial', url: 'https://youtube.com/watch?v=def456', watchedAt: '2026-07-15T10:00:00.000Z' },
    ],
    loading: false,
    error: null,
    refetch: jest.fn(),
  });

  await render(<YouTubeHistoryScreen route={route} navigation={navigation} />);

  expect(screen.getByText('Learning colors')).toBeTruthy();
  expect(screen.getByText('https://youtube.com/watch?v=abc123')).toBeTruthy();
  expect(screen.getByText('Minecraft tutorial')).toBeTruthy();
  expect(screen.getByText('https://youtube.com/watch?v=def456')).toBeTruthy();
});

test('shows an empty state when there is no YouTube history', async () => {
  mockUseYouTubeHistory.mockReturnValue({ entries: [], loading: false, error: null, refetch: jest.fn() });

  await render(<YouTubeHistoryScreen route={route} navigation={navigation} />);

  expect(screen.getByText('No YouTube activity yet.')).toBeTruthy();
});
