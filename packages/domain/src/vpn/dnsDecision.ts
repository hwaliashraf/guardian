// T22, Requirement 6: this file is **the verifiable spec of `GuardianVpnService.kt`'s DNS
// filtering decision logic** (Android-native, cannot be built/run/tested in this environment —
// no JVM/Gradle). `DnsDecision.kt` must implement the exact same decision table below; if either
// file changes, update the other by hand — nothing enforces that automatically across the
// Kotlin/TypeScript boundary.
import type { ContentFilterPolicy } from '../types';
import type { BlocklistIndex, DnsAction } from './types';

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.+$/, '');
}

/** True if `domain` equals, or is a subdomain of, any (normalized) entry in `list`. */
function matchesList(domain: string, list: string[]): boolean {
  return list.some((entry) => {
    const normalizedEntry = normalizeDomain(entry);
    return normalizedEntry.length > 0 && (domain === normalizedEntry || domain.endsWith(`.${normalizedEntry}`));
  });
}

/** Exact match first, then walks up parent domains (`a.b.evil.com` -> `b.evil.com` -> `evil.com`
 * -> `com`) so a blocklist entry for a registrable domain also covers its subdomains. */
function lookupBlocklistCategory(domain: string, blocklist: BlocklistIndex): string | undefined {
  let current = domain;
  for (;;) {
    if (blocklist[current]) return blocklist[current];
    const dot = current.indexOf('.');
    if (dot === -1) return undefined;
    current = current.slice(dot + 1);
  }
}

// Representative SafeSearch-enforcement hosts (spec §4's literal examples) — Google/Bing each
// publish an official host that forces safe search regardless of user settings. Not an
// exhaustive per-country-TLD list (e.g. google.co.uk); extend here if a deployment needs it.
const GOOGLE_SEARCH_DOMAINS = ['google.com', 'www.google.com'];
const GOOGLE_SAFE_SEARCH_REWRITE = 'forcesafesearch.google.com';
const BING_SEARCH_DOMAINS = ['bing.com', 'www.bing.com'];
const BING_SAFE_SEARCH_REWRITE = 'strict.bing.com';
// DuckDuckGo's safe-search is a URL query parameter (`&kp=1`), not a dedicated DNS host — there is
// no DNS-level rewrite target for it, so it is intentionally NOT handled here (out of scope for a
// domain-name-only decision function; would need HTTP-layer rewriting, Layer 2/3 territory).
const YOUTUBE_DOMAINS = ['youtube.com', 'www.youtube.com', 'm.youtube.com'];
const YOUTUBE_RESTRICTED_REWRITE = 'restrict.youtube.com';

function safeSearchRewriteFor(domain: string, policy: ContentFilterPolicy): string | undefined {
  if (policy.safeSearchEnforced) {
    if (GOOGLE_SEARCH_DOMAINS.includes(domain)) return GOOGLE_SAFE_SEARCH_REWRITE;
    if (BING_SEARCH_DOMAINS.includes(domain)) return BING_SAFE_SEARCH_REWRITE;
  }
  if (policy.youtubeRestrictedMode && YOUTUBE_DOMAINS.includes(domain)) return YOUTUBE_RESTRICTED_REWRITE;
  return undefined;
}

/**
 * Pure decision table for one DNS query's target domain (spec §4, Layer 1). No I/O — the real
 * blocklist data (downloaded/merged by `BlocklistLoader.kt`) and the child's active `Policy` are
 * supplied by the caller.
 *
 * Precedence (highest first — each rule short-circuits before the next is evaluated):
 * 1. `customBlockDomains` — an explicit parent block always wins, even under whitelist-only mode
 *    or an overlapping `customAllowDomains` entry (a parent who blocked something specific meant
 *    it; the allow-list is for loosening categories, not overriding an explicit block).
 * 2. `whitelistOnly` — if enabled, ONLY domains in `customAllowDomains` are allowed; everything
 *    else is blocked regardless of category configuration (matches `ContentFilterScreen.tsx`'s
 *    (T15) own documented expectation that whitelist-only is "a global override the native
 *    enforcement layer reads" — this is that layer).
 * 3. `customAllowDomains` (whitelist-only OFF) — explicit allow overrides category/keyword
 *    blocking for that one domain.
 * 4. `customBlockKeywords` — substring match against the domain.
 * 5. Category blocklist — `blocklist`'s tagged category for this domain (or nearest parent
 *    domain), blocked only if `policy.categories[category] === 'block'`. A category absent from
 *    `policy.categories` entirely is NOT blocked (matches every other consumer of this field,
 *    e.g. T15's `ContentFilterScreen`, which never assumes an implicit default).
 * 6. Otherwise: allow.
 *
 * SafeSearch/YouTube-restricted-mode CNAME rewriting is layered on top of an ALLOW result only
 * (spec: "force-routes SafeSearch CNAMEs" — you can't rewrite traffic that's being blocked).
 */
export function resolveDnsAction(domain: string, policy: ContentFilterPolicy, blocklist: BlocklistIndex): DnsAction {
  const normalized = normalizeDomain(domain);

  if (matchesList(normalized, policy.customBlockDomains)) {
    return { action: 'block', reason: 'custom_block' };
  }

  if (policy.whitelistOnly) {
    if (!matchesList(normalized, policy.customAllowDomains)) {
      return { action: 'block', reason: 'whitelist_only' };
    }
    return { action: 'allow', rewriteTo: safeSearchRewriteFor(normalized, policy) };
  }

  if (matchesList(normalized, policy.customAllowDomains)) {
    return { action: 'allow', rewriteTo: safeSearchRewriteFor(normalized, policy) };
  }

  const keywordHit = policy.customBlockKeywords.some(
    (keyword) => keyword.trim().length > 0 && normalized.includes(keyword.trim().toLowerCase()),
  );
  if (keywordHit) {
    return { action: 'block', reason: 'keyword' };
  }

  const category = lookupBlocklistCategory(normalized, blocklist);
  if (category && policy.categories[category] === 'block') {
    return { action: 'block', reason: 'category', category };
  }

  return { action: 'allow', rewriteTo: safeSearchRewriteFor(normalized, policy) };
}
