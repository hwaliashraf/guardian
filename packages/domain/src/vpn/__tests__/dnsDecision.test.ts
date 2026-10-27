import type { ContentFilterPolicy } from '../../types';
import { resolveDnsAction } from '../dnsDecision';
import type { BlocklistIndex } from '../types';

function buildPolicy(overrides: Partial<ContentFilterPolicy> = {}): ContentFilterPolicy {
  return {
    categories: {},
    whitelistOnly: false,
    customAllowDomains: [],
    customBlockDomains: [],
    customBlockKeywords: [],
    safeSearchEnforced: false,
    youtubeRestrictedMode: false,
    ...overrides,
  };
}

const blocklist: BlocklistIndex = {
  'evil-ads.example': 'advertisements',
  'nsfw.example': 'adult',
  'tracker.example': 'trackers',
};

describe('resolveDnsAction', () => {
  test('allows a domain with no matching category/list entry', () => {
    expect(resolveDnsAction('example.com', buildPolicy(), blocklist)).toEqual({ action: 'allow', rewriteTo: undefined });
  });

  test('blocks a domain whose category is configured to block', () => {
    const policy = buildPolicy({ categories: { advertisements: 'block' } });
    expect(resolveDnsAction('evil-ads.example', policy, blocklist)).toEqual({
      action: 'block',
      reason: 'category',
      category: 'advertisements',
    });
  });

  test('does not block a blocklisted domain whose category is set to allow', () => {
    const policy = buildPolicy({ categories: { adult: 'allow' } });
    expect(resolveDnsAction('nsfw.example', policy, blocklist)).toEqual({ action: 'allow', rewriteTo: undefined });
  });

  test('does not block a blocklisted domain whose category is entirely absent from policy.categories', () => {
    const policy = buildPolicy({ categories: {} });
    expect(resolveDnsAction('tracker.example', policy, blocklist)).toEqual({ action: 'allow', rewriteTo: undefined });
  });

  test('a blocklist entry also covers its subdomains', () => {
    const policy = buildPolicy({ categories: { adult: 'block' } });
    expect(resolveDnsAction('cdn.nsfw.example', policy, blocklist)).toMatchObject({ action: 'block', category: 'adult' });
  });

  test('customBlockDomains blocks even when the category would otherwise allow', () => {
    const policy = buildPolicy({ categories: { adult: 'allow' }, customBlockDomains: ['nsfw.example'] });
    expect(resolveDnsAction('nsfw.example', policy, blocklist)).toEqual({ action: 'block', reason: 'custom_block' });
  });

  test('customBlockDomains wins even over an overlapping customAllowDomains entry', () => {
    const policy = buildPolicy({ customBlockDomains: ['games.example'], customAllowDomains: ['games.example'] });
    expect(resolveDnsAction('games.example', policy, blocklist)).toEqual({ action: 'block', reason: 'custom_block' });
  });

  test('customAllowDomains overrides a category block', () => {
    const policy = buildPolicy({ categories: { advertisements: 'block' }, customAllowDomains: ['evil-ads.example'] });
    expect(resolveDnsAction('evil-ads.example', policy, blocklist)).toEqual({ action: 'allow', rewriteTo: undefined });
  });

  test('customBlockKeywords blocks any domain containing the keyword as a substring', () => {
    const policy = buildPolicy({ customBlockKeywords: ['casino'] });
    expect(resolveDnsAction('online-casino-games.example', policy, blocklist)).toEqual({
      action: 'block',
      reason: 'keyword',
    });
  });

  describe('whitelistOnly mode', () => {
    test('blocks everything not explicitly in customAllowDomains, even an unlisted/uncategorized domain', () => {
      const policy = buildPolicy({ whitelistOnly: true });
      expect(resolveDnsAction('example.com', policy, blocklist)).toEqual({ action: 'block', reason: 'whitelist_only' });
    });

    test('allows a domain that IS in customAllowDomains', () => {
      const policy = buildPolicy({ whitelistOnly: true, customAllowDomains: ['example.com'] });
      expect(resolveDnsAction('example.com', policy, blocklist)).toEqual({ action: 'allow', rewriteTo: undefined });
    });

    test('customBlockDomains still blocks even under whitelist-only + allow-listed', () => {
      const policy = buildPolicy({
        whitelistOnly: true,
        customAllowDomains: ['example.com'],
        customBlockDomains: ['example.com'],
      });
      expect(resolveDnsAction('example.com', policy, blocklist)).toEqual({ action: 'block', reason: 'custom_block' });
    });
  });

  describe('SafeSearch / YouTube-restricted-mode rewrite', () => {
    test('rewrites google.com to the SafeSearch-enforced host when safeSearchEnforced is true', () => {
      const policy = buildPolicy({ safeSearchEnforced: true });
      expect(resolveDnsAction('www.google.com', policy, blocklist)).toEqual({
        action: 'allow',
        rewriteTo: 'forcesafesearch.google.com',
      });
    });

    test('rewrites bing.com to the strict-mode host when safeSearchEnforced is true', () => {
      const policy = buildPolicy({ safeSearchEnforced: true });
      expect(resolveDnsAction('www.bing.com', policy, blocklist)).toEqual({
        action: 'allow',
        rewriteTo: 'strict.bing.com',
      });
    });

    test('does not rewrite when safeSearchEnforced is false', () => {
      const policy = buildPolicy({ safeSearchEnforced: false });
      expect(resolveDnsAction('www.google.com', policy, blocklist)).toEqual({ action: 'allow', rewriteTo: undefined });
    });

    test('rewrites youtube.com to the restricted-mode host when youtubeRestrictedMode is true', () => {
      const policy = buildPolicy({ youtubeRestrictedMode: true });
      expect(resolveDnsAction('www.youtube.com', policy, blocklist)).toEqual({
        action: 'allow',
        rewriteTo: 'restrict.youtube.com',
      });
    });

    test('never rewrites a domain that is being blocked', () => {
      const policy = buildPolicy({ safeSearchEnforced: true, customBlockDomains: ['www.google.com'] });
      const result = resolveDnsAction('www.google.com', policy, blocklist);
      expect(result.action).toBe('block');
      expect(result.rewriteTo).toBeUndefined();
    });
  });

  test('domain matching is case-insensitive and ignores a trailing dot', () => {
    const policy = buildPolicy({ categories: { adult: 'block' } });
    expect(resolveDnsAction('NSFW.EXAMPLE.', policy, blocklist)).toMatchObject({ action: 'block', category: 'adult' });
  });
});
