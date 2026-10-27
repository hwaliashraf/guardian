import { matchAdKeywords, type AdKeywordPattern } from '../textHeuristic';

const patterns: AdKeywordPattern[] = [
  { id: 'onlyfans', pattern: 'onlyfans' },
  { id: 'hot_singles', pattern: 'hot\\s+singles' },
];

describe('matchAdKeywords', () => {
  test('returns null when no pattern matches any visible text', () => {
    expect(matchAdKeywords(['Settings', 'Wi-Fi'], patterns)).toBeNull();
  });

  test('returns the matching pattern id and exact matched substring', () => {
    expect(matchAdKeywords(['Check out my OnlyFans page'], patterns)).toEqual({
      patternId: 'onlyfans',
      matchedText: 'OnlyFans',
    });
  });

  test('matching is case-insensitive', () => {
    expect(matchAdKeywords(['HOT   SINGLES near you'], patterns)?.patternId).toBe('hot_singles');
  });

  test('first pattern in list order wins, even if a later pattern also matches an earlier text', () => {
    const texts = ['Hot singles nearby', 'Join OnlyFans today'];
    // 'onlyfans' is patterns[0]; it matches texts[1], not texts[0] — pattern order still wins over text order.
    expect(matchAdKeywords(texts, patterns)?.patternId).toBe('onlyfans');
  });

  test('skips a pattern with an empty/whitespace-only string, does not match everything', () => {
    const withEmpty: AdKeywordPattern[] = [{ id: 'blank', pattern: '   ' }, ...patterns];
    expect(matchAdKeywords(['just a normal sentence'], withEmpty)).toBeNull();
  });

  test('skips a malformed regex pattern instead of throwing', () => {
    const malformed: AdKeywordPattern[] = [{ id: 'broken', pattern: '(unterminated' }, ...patterns];
    expect(() => matchAdKeywords(['Check out my OnlyFans page'], malformed)).not.toThrow();
    expect(matchAdKeywords(['Check out my OnlyFans page'], malformed)?.patternId).toBe('onlyfans');
  });

  test('returns null for an empty patterns list', () => {
    expect(matchAdKeywords(['anything'], [])).toBeNull();
  });

  test('returns null for empty visible text, regardless of patterns', () => {
    expect(matchAdKeywords([], patterns)).toBeNull();
  });

  test('regex-syntax patterns work, not just literal substrings', () => {
    expect(
      matchAdKeywords(['live nudes tonight only'], [{ id: 'live_nude', pattern: 'live\\s+nudes?' }])?.matchedText,
    ).toBe('live nudes');
  });
});
