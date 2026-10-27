package com.guardian.accessibility

import android.os.SystemClock

/**
 * Shared in-process singleton IPC surface between `GuardianAccessibilityService` (this ticket,
 * T23) and T24's future usage-accounting component — both run in the same app process, so no
 * cross-process broadcast is needed. Chosen over `LocalBroadcastManager` (the ticket's other
 * offered option): that API is officially deprecated (AndroidX docs recommend direct in-process
 * calls instead), and a plain `object` with `@Volatile` fields is simpler and synchronous (no
 * Intent serialization/dispatch latency) — same pattern class as `VpnModule`'s companion-object
 * `instance` field (T22). **T24 (and any other future in-process consumer) should read
 * `currentPackageName`/`lastForegroundChangeAtMs`/`lastInputActivityAtMs` directly from this
 * object rather than re-deriving them.**
 *
 * UNVERIFIED — this file cannot be compiled/run in this build environment (see SETUP.md).
 */
object ForegroundAppTracker {

    @Volatile
    var currentPackageName: String? = null
        private set

    @Volatile
    var lastForegroundChangeAtMs: Long = SystemClock.elapsedRealtime()
        private set

    // Initialized to "now" (not 0L/uninitialized) so the very first idle-duration computation
    // a presence tick makes is ~0, never a huge bogus value from an epoch-zero default.
    @Volatile
    var lastInputActivityAtMs: Long = SystemClock.elapsedRealtime()
        private set

    fun onForegroundChanged(packageName: String?) {
        currentPackageName = packageName
        lastForegroundChangeAtMs = SystemClock.elapsedRealtime()
    }

    fun onInputActivity() {
        lastInputActivityAtMs = SystemClock.elapsedRealtime()
    }

    // Extensible; YouTube Kids/TV are out of scope this pass, documented not hidden. Moved here
    // (T25) from `GuardianAccessibilityService`'s private companion so this one shared singleton
    // is the single source of truth for both that service and T25's `MotionMonitor` — avoids the
    // exact list-drift risk this repo elsewhere guards against (see `evaluator.ts`'s
    // `VIDEO_LIKE_CATEGORIES`/`isVideoLikeCategory` doc comment for the same class of concern).
    private val YOUTUBE_PACKAGE_IDS = setOf("com.google.android.youtube")

    /**
     * Coarse 2-way `foregroundAppCategory` heuristic (`"video_streaming"` vs `"other"`) — **not**
     * a real package-name -> content-category mapping (confirmed by grep: none exists anywhere in
     * this repo, T16/T26 territory, same gap flagged in T23's and T24's LEDGER entries). This
     * covers the one distinction `evaluator.ts`'s Level-0 video-gating actually branches on
     * (`VIDEO_LIKE_CATEGORIES`). T25 additionally uses this as an approximation for "is a
     * game-like (non-video) app foreground" — see `MotionMonitor`'s RISK note, since the domain
     * model's real `'gaming'` category id (`contentCategories.ts`) has no package mapping to it.
     */
    fun categoryFor(packageName: String?): String =
        if (packageName != null && packageName in YOUTUBE_PACKAGE_IDS) "video_streaming" else "other"
}
