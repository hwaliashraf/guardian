// T23, Requirement 4: this file is **the verifiable spec of `GuardianAccessibilityService.kt`'s
// on-screen-text ad-keyword decision logic** (`AdKeywords.kt`'s `match()` — Android-native,
// cannot be built/run/tested in this environment, no JVM/Gradle). `AdKeywords.kt` must implement
// the exact same matching rule below; if either file changes, update the other by hand — nothing
// enforces that automatically across the Kotlin/TypeScript boundary. Location chosen: this
// module lives in `vpn/` (not a new `tamper/` module, the ticket's other offered option) because
// `vpn/` already establishes the "one pure decision-logic module per native decision-maker"
// pattern via `dnsDecision.ts`/`DnsDecision.kt` — ad-keyword text matching is the same kind of
// content-decision logic (Layer 3 instead of Layer 1). A `tamper/` module would be a worse fit:
// keyword-ad matching isn't tamper-detection (that's the separate `service_disabled` signal this
// same ticket emits elsewhere).

/** A single tunable/extensible ad-keyword pattern (`AdKeywords.kt`'s starter list mirrors this
 * shape). `pattern` is the source of a case-insensitive regular expression. */
export interface AdKeywordPattern {
  id: string;
  pattern: string;
}

export interface AdKeywordMatch {
  patternId: string;
  /** The exact substring of `visibleText` that matched, for logging/debugging. */
  matchedText: string;
}

/**
 * Scans `visibleText` (the accessibility tree's visible on-screen text nodes, one string per
 * node) against `patterns` in list order and returns the first match, or `null` if none of the
 * text matches any pattern. First-match-wins (not all-matches) — mirrors `resolveDnsAction`'s
 * precedence-table style: a single decision is all a block-overlay caller needs, and stopping at
 * the first hit keeps this a cheap per-node-batch check for a service that runs on every
 * `TYPE_WINDOW_CONTENT_CHANGED` event.
 */
export function matchAdKeywords(visibleText: string[], patterns: AdKeywordPattern[]): AdKeywordMatch | null {
  for (const pattern of patterns) {
    if (pattern.pattern.trim().length === 0) continue;
    // A malformed pattern in a tunable list must never crash the caller — on the Kotlin side,
    // an uncaught throw here would be a crashing AccessibilityService (Android disables a
    // repeatedly-crashing service), a materially worse failure mode than "skip one bad pattern."
    let regex: RegExp;
    try {
      regex = new RegExp(pattern.pattern, 'i');
    } catch {
      continue;
    }
    for (const text of visibleText) {
      const found = regex.exec(text);
      if (found) {
        return { patternId: pattern.id, matchedText: found[0] };
      }
    }
  }
  return null;
}
