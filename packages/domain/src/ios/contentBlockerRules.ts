import type { ContentFilterPolicy } from '../types';

/**
 * T26, Requirement 2: this file is the verifiable spec of what
 * `app/ios/Guardian/DNSFilter/GuardianContentBlocker`'s Safari Content Blocker extension
 * enforces — same relationship `vpn/dnsDecision.ts` (T22) has to Android's `DnsDecision.kt`.
 * Unlike `dnsDecision.ts`, a Safari content blocker is a static, declarative JSON ruleset (no
 * per-query callback) evaluated by WebKit itself, so this function can only express what's
 * expressible as WebKit trigger/action rules against `ContentFilterPolicy` alone:
 * `customBlockDomains`, `customBlockKeywords`, and `whitelistOnly` + `customAllowDomains`.
 *
 * Category-level blocking (`policy.categories`) is intentionally NOT expanded into per-domain
 * rules here — that would require embedding the full merged StevenBlack+OISD+HaGeZi domain→
 * category index (an Android/`BlocklistLoader.kt`-only runtime artifact) into a bundled,
 * infrequently-refreshed browser extension, and this function's single-arg signature
 * (`policy` only, no blocklist index) makes that explicitly out of scope. On iOS, category
 * blocking is instead enforced server-side by the DoH resolver `DNSFilterManager.swift` points
 * the whole device's DNS at (see that file) — this content blocker is a defense-in-depth,
 * in-browser layer on top of that, limited to the parent's own explicit lists. This split is an
 * intentional, spec-acknowledged platform capability gap (spec §2.1's "reduced companion set"),
 * not a bug.
 *
 * Precedence (mirrors `dnsDecision.ts`'s table as closely as a static ruleset allows):
 * 1. `customBlockDomains` — always emitted as an explicit block rule, even under whitelist-only
 *    mode (redundant with the block-all rule in that mode, but keeps intent explicit).
 * 2. `whitelistOnly` — if enabled, a block-all rule is emitted first, then an
 *    `ignore-previous-rules` exception per `customAllowDomains` entry — EXCEPT entries also
 *    present in `customBlockDomains`, so an explicit block still wins over a whitelist entry
 *    (matches `dnsDecision.ts` rule 1 always beating rule 2).
 * 3. `customBlockKeywords` (whitelist-only OFF only — under whitelist-only everything is already
 *    blocked by default) — substring match against the full request URL. Note this is broader
 *    than `dnsDecision.ts`'s keyword match (domain-only): a content blocker's `url-filter`
 *    matches the whole URL, not just the hostname — documented deviation, not a bug.
 * 4. `customAllowDomains` (whitelist-only OFF) — `ignore-previous-rules` exception per domain,
 *    appended after the keyword-block rules so it can override a keyword match for that domain;
 *    excludes any domain also in `customBlockDomains` (block still wins).
 * 5. Otherwise: WebKit's own default (allow) applies — no rule needed.
 *
 * No SafeSearch/YouTube-restricted-mode CNAME rewriting here — a content blocker can only
 * block/hide, not rewrite a DNS answer; that remains `DNSFilterManager.swift`/the DoH resolver's
 * job (same as `dnsDecision.ts`'s `rewriteTo`).
 */

interface ContentBlockerTrigger {
  'url-filter': string;
  'url-filter-is-case-sensitive': boolean;
}

interface ContentBlockerAction {
  type: 'block' | 'ignore-previous-rules';
}

interface ContentBlockerRule {
  trigger: ContentBlockerTrigger;
  action: ContentBlockerAction;
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.+$/, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Matches `domain` itself or any subdomain, in either http or https, host-boundary-anchored
 * (won't match `notdomain.com` as a false-positive substring of `domain.com`). */
function domainTrigger(domain: string): ContentBlockerTrigger {
  const escaped = escapeRegExp(normalizeDomain(domain));
  return {
    'url-filter': `^https?://([a-z0-9-]+\\.)*${escaped}([:/?#]|$)`,
    'url-filter-is-case-sensitive': false,
  };
}

function keywordTrigger(keyword: string): ContentBlockerTrigger {
  return {
    'url-filter': escapeRegExp(keyword.trim().toLowerCase()),
    'url-filter-is-case-sensitive': false,
  };
}

const BLOCK_ALL_TRIGGER: ContentBlockerTrigger = {
  'url-filter': '.*',
  'url-filter-is-case-sensitive': false,
};

export function buildContentBlockerRules(policy: ContentFilterPolicy): object[] {
  const rules: ContentBlockerRule[] = [];

  const blockedDomains = policy.customBlockDomains.map(normalizeDomain).filter((d) => d.length > 0);
  const blockedDomainSet = new Set(blockedDomains);

  for (const domain of blockedDomains) {
    rules.push({ trigger: domainTrigger(domain), action: { type: 'block' } });
  }

  if (policy.whitelistOnly) {
    rules.push({ trigger: BLOCK_ALL_TRIGGER, action: { type: 'block' } });

    for (const domain of policy.customAllowDomains.map(normalizeDomain)) {
      if (domain.length === 0 || blockedDomainSet.has(domain)) continue;
      rules.push({ trigger: domainTrigger(domain), action: { type: 'ignore-previous-rules' } });
    }

    return rules;
  }

  for (const keyword of policy.customBlockKeywords) {
    if (keyword.trim().length === 0) continue;
    rules.push({ trigger: keywordTrigger(keyword), action: { type: 'block' } });
  }

  for (const domain of policy.customAllowDomains.map(normalizeDomain)) {
    if (domain.length === 0 || blockedDomainSet.has(domain)) continue;
    rules.push({ trigger: domainTrigger(domain), action: { type: 'ignore-previous-rules' } });
  }

  return rules;
}
