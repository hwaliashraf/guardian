import type { ContentFilterPolicy } from '../../types';
import { buildContentBlockerRules } from '../contentBlockerRules';

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

describe('buildContentBlockerRules', () => {
  test('an unconfigured policy produces no rules', () => {
    expect(buildContentBlockerRules(buildPolicy())).toEqual([]);
  });

  test('customBlockDomains produces a block rule matching the domain and its subdomains', () => {
    const rules = buildContentBlockerRules(buildPolicy({ customBlockDomains: ['evil.example'] }));
    expect(rules).toEqual([
      {
        trigger: {
          'url-filter': '^https?://([a-z0-9-]+\\.)*evil\\.example([:/?#]|$)',
          'url-filter-is-case-sensitive': false,
        },
        action: { type: 'block' },
      },
    ]);
  });

  test('customBlockDomains normalizes case, whitespace, and trailing dots', () => {
    const rules = buildContentBlockerRules(buildPolicy({ customBlockDomains: [' EVIL.example. '] }));
    expect(rules[0].trigger['url-filter']).toContain('evil\\.example');
  });

  test('empty-string entries in customBlockDomains are skipped', () => {
    expect(buildContentBlockerRules(buildPolicy({ customBlockDomains: ['  '] }))).toEqual([]);
  });

  test('customBlockKeywords produces a substring block rule', () => {
    const rules = buildContentBlockerRules(buildPolicy({ customBlockKeywords: ['gambling'] }));
    expect(rules).toEqual([
      {
        trigger: { 'url-filter': 'gambling', 'url-filter-is-case-sensitive': false },
        action: { type: 'block' },
      },
    ]);
  });

  test('customAllowDomains (whitelist-only OFF) produces an ignore-previous-rules exception after keyword blocks', () => {
    const rules = buildContentBlockerRules(
      buildPolicy({ customBlockKeywords: ['news'], customAllowDomains: ['news.example'] }),
    );
    expect(rules).toHaveLength(2);
    expect(rules[0].action).toEqual({ type: 'block' });
    expect(rules[1]).toEqual({
      trigger: {
        'url-filter': '^https?://([a-z0-9-]+\\.)*news\\.example([:/?#]|$)',
        'url-filter-is-case-sensitive': false,
      },
      action: { type: 'ignore-previous-rules' },
    });
  });

  test('a domain in both customBlockDomains and customAllowDomains stays blocked (explicit block wins)', () => {
    const rules = buildContentBlockerRules(
      buildPolicy({ customBlockDomains: ['evil.example'], customAllowDomains: ['evil.example'] }),
    );
    expect(rules).toEqual([
      {
        trigger: {
          'url-filter': '^https?://([a-z0-9-]+\\.)*evil\\.example([:/?#]|$)',
          'url-filter-is-case-sensitive': false,
        },
        action: { type: 'block' },
      },
    ]);
  });

  test('whitelistOnly emits a block-all rule followed by ignore-previous-rules exceptions for allowed domains', () => {
    const rules = buildContentBlockerRules(
      buildPolicy({ whitelistOnly: true, customAllowDomains: ['khan-academy.example'] }),
    );
    expect(rules).toEqual([
      { trigger: { 'url-filter': '.*', 'url-filter-is-case-sensitive': false }, action: { type: 'block' } },
      {
        trigger: {
          'url-filter': '^https?://([a-z0-9-]+\\.)*khan-academy\\.example([:/?#]|$)',
          'url-filter-is-case-sensitive': false,
        },
        action: { type: 'ignore-previous-rules' },
      },
    ]);
  });

  test('whitelistOnly ignores customBlockKeywords entirely (everything is already blocked by default)', () => {
    const rules = buildContentBlockerRules(
      buildPolicy({ whitelistOnly: true, customBlockKeywords: ['gambling'], customAllowDomains: ['safe.example'] }),
    );
    expect(rules.map((r) => r.trigger['url-filter'])).not.toContain('gambling');
  });

  test('whitelistOnly still blocks a domain present in both customBlockDomains and customAllowDomains', () => {
    const rules = buildContentBlockerRules(
      buildPolicy({ whitelistOnly: true, customBlockDomains: ['sneaky.example'], customAllowDomains: ['sneaky.example'] }),
    );
    // explicit block rule + block-all rule, but no ignore-previous-rules exception for sneaky.example
    expect(rules.filter((r) => r.action.type === 'ignore-previous-rules')).toEqual([]);
  });

  test('domain triggers escape regex-special characters', () => {
    const rules = buildContentBlockerRules(buildPolicy({ customBlockDomains: ['a+b.example'] }));
    expect(rules[0].trigger['url-filter']).toContain('a\\+b\\.example');
  });

  test('covers all 32 CONTENT_CATEGORIES ids gracefully (category rules are intentionally not expanded)', () => {
    // Category blocking is server-side (DNSFilterManager's DoH resolver), not this function's job —
    // a policy with every category blocked still produces zero rules from categories alone.
    const categories: Record<string, 'block' | 'allow'> = {};
    for (const id of ['adult', 'pornography', 'gambling', 'gaming']) categories[id] = 'block';
    expect(buildContentBlockerRules(buildPolicy({ categories }))).toEqual([]);
  });
});
