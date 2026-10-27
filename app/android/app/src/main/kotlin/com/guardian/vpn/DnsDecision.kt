package com.guardian.vpn

/**
 * T22, Requirement 6: Kotlin mirror of `packages/domain/src/vpn/dnsDecision.ts` — that TS file is
 * the verifiable spec of this exact decision table (this build environment has no JVM, so this
 * file itself cannot be compiled/tested here; keep both files in sync by hand on any change to
 * either — nothing enforces that automatically across the Kotlin/TypeScript boundary).
 */

enum class DnsActionKind { ALLOW, BLOCK }

enum class DnsBlockReason { CUSTOM_BLOCK, WHITELIST_ONLY, KEYWORD, CATEGORY }

data class DnsAction(
    val action: DnsActionKind,
    val reason: DnsBlockReason? = null,
    val category: String? = null,
    /** CNAME/rebind target, present only when `action == ALLOW` and SafeSearch/YouTube-restricted
     * forcing applies. Never set alongside a block. */
    val rewriteTo: String? = null,
)

/**
 * Minimal Kotlin-side read model of `ContentFilterPolicy` (`packages/domain/src/types.ts`) — only
 * the fields this decision table reads. The real `Policy` is synced from T08 and cached locally
 * on-device for offline-first enforcement (spec §7); populating this view from that cache is
 * `VpnModule`'s job, not this object's.
 */
data class ContentFilterPolicyView(
    val categories: Map<String, String>, // categoryId -> "block" | "allow"
    val whitelistOnly: Boolean,
    val customAllowDomains: List<String>,
    val customBlockDomains: List<String>,
    val customBlockKeywords: List<String>,
    val safeSearchEnforced: Boolean,
    val youtubeRestrictedMode: Boolean,
)

object DnsDecision {

    // Representative SafeSearch-enforcement hosts (spec §4's literal examples) — Google/Bing each
    // publish an official host that forces safe search regardless of user settings. Not an
    // exhaustive per-country-TLD list (e.g. google.co.uk); extend here if a deployment needs it.
    private val GOOGLE_SEARCH_DOMAINS = setOf("google.com", "www.google.com")
    private const val GOOGLE_SAFE_SEARCH_REWRITE = "forcesafesearch.google.com"
    private val BING_SEARCH_DOMAINS = setOf("bing.com", "www.bing.com")
    private const val BING_SAFE_SEARCH_REWRITE = "strict.bing.com"
    // DuckDuckGo's safe search is a URL query parameter (`&kp=1`), not a dedicated DNS host —
    // there is no DNS-level rewrite target for it, so it is intentionally NOT handled here (same
    // documented scope limit as dnsDecision.ts).
    private val YOUTUBE_DOMAINS = setOf("youtube.com", "www.youtube.com", "m.youtube.com")
    private const val YOUTUBE_RESTRICTED_REWRITE = "restrict.youtube.com"

    private fun normalizeDomain(domain: String): String =
        domain.trim().lowercase().trimEnd('.')

    /** True if `domain` equals, or is a subdomain of, any (normalized) entry in `list`. */
    private fun matchesList(domain: String, list: List<String>): Boolean =
        list.any { entry ->
            val normalizedEntry = normalizeDomain(entry)
            normalizedEntry.isNotEmpty() && (domain == normalizedEntry || domain.endsWith(".$normalizedEntry"))
        }

    /** Exact match first, then walks up parent domains (`a.b.evil.com` -> `b.evil.com` ->
     * `evil.com` -> `com`) so a blocklist entry for a registrable domain also covers subdomains. */
    private fun lookupBlocklistCategory(domain: String, blocklist: Map<String, String>): String? {
        var current = domain
        while (true) {
            blocklist[current]?.let { return it }
            val dot = current.indexOf('.')
            if (dot == -1) return null
            current = current.substring(dot + 1)
        }
    }

    private fun safeSearchRewriteFor(domain: String, policy: ContentFilterPolicyView): String? {
        if (policy.safeSearchEnforced) {
            if (GOOGLE_SEARCH_DOMAINS.contains(domain)) return GOOGLE_SAFE_SEARCH_REWRITE
            if (BING_SEARCH_DOMAINS.contains(domain)) return BING_SAFE_SEARCH_REWRITE
        }
        if (policy.youtubeRestrictedMode && YOUTUBE_DOMAINS.contains(domain)) return YOUTUBE_RESTRICTED_REWRITE
        return null
    }

    /**
     * See `dnsDecision.ts`'s `resolveDnsAction` doc comment for the full precedence-order
     * rationale — this implements the identical decision table:
     * customBlockDomains > whitelistOnly-gate > customAllowDomains > customBlockKeywords >
     * category-blocklist > default-allow, with SafeSearch/YouTube-restricted rewriting layered
     * only on top of an ALLOW result.
     */
    fun resolve(domain: String, policy: ContentFilterPolicyView, blocklist: Map<String, String>): DnsAction {
        val normalized = normalizeDomain(domain)

        if (matchesList(normalized, policy.customBlockDomains)) {
            return DnsAction(DnsActionKind.BLOCK, reason = DnsBlockReason.CUSTOM_BLOCK)
        }

        if (policy.whitelistOnly) {
            if (!matchesList(normalized, policy.customAllowDomains)) {
                return DnsAction(DnsActionKind.BLOCK, reason = DnsBlockReason.WHITELIST_ONLY)
            }
            return DnsAction(DnsActionKind.ALLOW, rewriteTo = safeSearchRewriteFor(normalized, policy))
        }

        if (matchesList(normalized, policy.customAllowDomains)) {
            return DnsAction(DnsActionKind.ALLOW, rewriteTo = safeSearchRewriteFor(normalized, policy))
        }

        val keywordHit = policy.customBlockKeywords.any {
            it.trim().isNotEmpty() && normalized.contains(it.trim().lowercase())
        }
        if (keywordHit) {
            return DnsAction(DnsActionKind.BLOCK, reason = DnsBlockReason.KEYWORD)
        }

        val category = lookupBlocklistCategory(normalized, blocklist)
        if (category != null && policy.categories[category] == "block") {
            return DnsAction(DnsActionKind.BLOCK, reason = DnsBlockReason.CATEGORY, category = category)
        }

        return DnsAction(DnsActionKind.ALLOW, rewriteTo = safeSearchRewriteFor(normalized, policy))
    }
}
