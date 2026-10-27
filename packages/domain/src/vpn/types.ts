/**
 * Types for the Layer-1 DNS filter's pure decision logic (spec §4). `GuardianVpnService.kt`'s
 * TUN packet loop (T22, Android-native, unverifiable in this environment — no JVM) is the real
 * consumer; this TS module (`dnsDecision.ts`) is the verifiable spec of that Kotlin logic's
 * intended behavior — see that file's own header comment. Kotlin's `DnsDecision.kt` must
 * implement the exact same decision table as `dnsDecision.ts`; keep both in sync by hand.
 */

/** Domain (fully-qualified, lowercase, no trailing dot) -> canonical category id (T15's
 * `CONTENT_CATEGORIES` ids, e.g. 'adult', 'advertisements', 'trackers') the merged
 * StevenBlack+OISD+HaGeZi blocklist tags it with. Built/refreshed by `BlocklistLoader.kt`. */
export type BlocklistIndex = Record<string, string>;

export type DnsBlockReason = 'custom_block' | 'whitelist_only' | 'keyword' | 'category';

export interface DnsAction {
  action: 'allow' | 'block';
  /** Present only when `action === 'block'`. */
  reason?: DnsBlockReason;
  /** The blocklist category that caused the block, only when `reason === 'category'`. */
  category?: string;
  /**
   * CNAME/rebind target to resolve+return instead of the original domain's real address —
   * present only when `action === 'allow'` and SafeSearch/YouTube-restricted-mode forcing
   * applies (spec §4: "force-routes SafeSearch CNAMEs"). Never set alongside a block.
   */
  rewriteTo?: string;
}
