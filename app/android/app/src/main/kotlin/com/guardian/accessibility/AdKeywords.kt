package com.guardian.accessibility

/**
 * T23, Requirement 4: Kotlin mirror of `packages/domain/src/vpn/textHeuristic.ts` — that TS file
 * is the verifiable spec of this exact matching rule (this build environment has no JVM, so this
 * file itself cannot be compiled/tested here; keep both files in sync by hand on any change to
 * either — nothing enforces that automatically across the Kotlin/TypeScript boundary).
 *
 * UNVERIFIED — this file cannot be compiled/run in this build environment (see SETUP.md).
 */
object AdKeywords {

    data class AdKeywordPattern(val id: String, val pattern: String)
    data class AdKeywordMatch(val patternId: String, val matchedText: String)

    // Starter list of adult-ad-pattern keywords/regexes (spec §4, Layer 3: "watches on-screen
    // text in third-party apps for adult-ad keyword patterns"). Tunable/extensible — ad networks
    // constantly rotate their copy; this is a minimum-viable starter set, not exhaustive. Mirrors
    // textHeuristic.ts's AdKeywordPattern shape exactly.
    val PATTERNS: List<AdKeywordPattern> = listOf(
        AdKeywordPattern("hot_singles", """hot\s+singles\s+(near|in)\s+you"""),
        AdKeywordPattern("cam_girls", """cam\s?girls?\s+(online|live)"""),
        AdKeywordPattern("hookup", """hookup\s+tonight"""),
        AdKeywordPattern("adult_friend_finder", """adult\s?friend\s?finder"""),
        AdKeywordPattern("onlyfans", """onlyfans"""),
        AdKeywordPattern("live_nude", """live\s+nudes?"""),
        AdKeywordPattern("xxx_explicit", """\bxxx\b"""),
        AdKeywordPattern("meet_singles", """meet\s+(sexy\s+)?singles\s+nearby"""),
        AdKeywordPattern("18_plus_dating", """18\+.{0,20}(dating|chat|cam)"""),
        AdKeywordPattern("escort_ad", """escorts?\s+(near|in)\s+you"""),
    )

    /**
     * Mirrors `textHeuristic.ts`'s `matchAdKeywords` exactly: first-pattern-list-order wins, not
     * all-matches. A malformed pattern (bad regex syntax, possible once this list is ever made
     * remotely tunable) must never crash the caller — an uncaught throw here would crash this
     * `AccessibilityService` (Android disables a repeatedly-crashing service), so construction
     * failures are caught and that pattern is skipped, same as the TS side.
     */
    fun match(visibleText: List<String>, patterns: List<AdKeywordPattern> = PATTERNS): AdKeywordMatch? {
        for (pattern in patterns) {
            if (pattern.pattern.isBlank()) continue
            val regex = try {
                Regex(pattern.pattern, RegexOption.IGNORE_CASE)
            } catch (e: Exception) {
                continue
            }
            for (text in visibleText) {
                val found = regex.find(text)
                if (found != null) return AdKeywordMatch(pattern.id, found.value)
            }
        }
        return null
    }
}
