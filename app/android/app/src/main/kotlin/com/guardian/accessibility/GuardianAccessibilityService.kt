package com.guardian.accessibility

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.media.AudioManager
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import kotlin.concurrent.thread

/**
 * Layer 3 (spec §4): "The accessibility service watches on-screen text in third-party apps for
 * adult-ad keyword patterns; on match, the screen is covered with a block overlay and the event
 * is logged." Also sources spec §6's Level 0 presence signal (foreground-app + input-activity
 * observation) and spec §3.5's YouTube video-history capture, and the accessibility half of spec
 * §3.7's tamper alert.
 *
 * UNVERIFIED: this file cannot be compiled or run in this build environment (no JVM/Gradle — see
 * SETUP.md's "Java / Android SDK" section). Written as complete, real Kotlin, not a stub.
 *
 * **Lifecycle-callback interpretation (stated plainly, a documented reconciliation against
 * Android's actual platform semantics, not the ticket's literal wording)**: the ticket's
 * Requirement 3 says to treat "`onInterrupt()`/service-disabled callbacks" as the tamper signal.
 * Per Android's documented `AccessibilityService` contract, `onInterrupt()` means "the system
 * wants you to stop giving feedback right now" (e.g. during rapid navigation) — it fires during
 * completely normal operation and is never followed by teardown, so treating it as a "service
 * disabled" tamper signal would produce false-positive tamper events during ordinary use. This
 * file implements `onInterrupt()` as a required-by-the-abstract-class no-op and instead treats
 * `onUnbind()` (this service's `VpnService.onRevoke()` analogue — called when the user turns the
 * service off in Accessibility settings, or the system otherwise unbinds it) as the real
 * disable-detection point, guarded by a `tamperReported` flag against double-emission exactly
 * like T22's reviewer-caught `revokedByUser` fix for `GuardianVpnService`.
 */
class GuardianAccessibilityService : AccessibilityService() {

    // See class doc above: onUnbind(), not onInterrupt(), is the real tamper signal. Reset in
    // onServiceConnected() so a future disable (after a reconnect) is still detectable.
    @Volatile private var tamperReported = false

    private var presenceTickThread: Thread? = null

    // Debounce state for YouTube capture — content-changed events fire repeatedly while a single
    // video plays; avoid re-emitting a youtube_view event for the same video every scan.
    @Volatile private var lastEmittedYouTubeTitle: String? = null
    @Volatile private var lastEmittedYouTubeAtMs: Long = 0L

    // Throttle for the (potentially expensive) node-tree scan — TYPE_WINDOW_CONTENT_CHANGED can
    // fire many times per second during scrolling/animation.
    @Volatile private var lastScanAtMs: Long = 0L

    private var audioManager: AudioManager? = null

    override fun onServiceConnected() {
        super.onServiceConnected()
        tamperReported = false
        audioManager = getSystemService(AUDIO_SERVICE) as? AudioManager
        startPresenceTickLoop()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                ForegroundAppTracker.onForegroundChanged(event.packageName?.toString())
                ForegroundAppTracker.onInputActivity()
                val currentPackage = ForegroundAppTracker.currentPackageName
                if (currentPackage != null && !isKnownYouTubePackage(currentPackage)) {
                    // Left an app that may have had an active block overlay — clear it. hide()
                    // is a no-op if nothing is showing.
                    BlockOverlayView.hide()
                }
                runScanPipeline()
            }
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> runScanPipeline()
            AccessibilityEvent.TYPE_VIEW_SCROLLED,
            AccessibilityEvent.TYPE_VIEW_CLICKED,
            AccessibilityEvent.TYPE_VIEW_FOCUSED,
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED,
            -> ForegroundAppTracker.onInputActivity()
        }
    }

    /** Required abstract override. Not the tamper signal — see class doc comment. */
    override fun onInterrupt() {
        // No-op: onInterrupt() fires during normal operation (system asking this service to stop
        // giving feedback momentarily), not on disable. Intentionally does not emit anything.
    }

    override fun onUnbind(intent: Intent?): Boolean {
        if (!tamperReported) {
            tamperReported = true
            AccessibilityModule.emitTamperEvent(
                TamperDeviceEvent(id = UUID.randomUUID().toString(), type = "service_disabled", occurredAtIso = nowIso()),
            )
        }
        presenceTickThread?.interrupt()
        BlockOverlayView.hide()
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        // Does not independently emit tamper — onUnbind() already owns that (mirrors T22's lesson
        // that only one call site should own a tamper emit; a bare onDestroy() without a
        // preceding onUnbind() is normal process-lifecycle churn, not necessarily tamper).
        presenceTickThread?.interrupt()
        super.onDestroy()
    }

    // --- Scan pipeline (ad-keyword block + YouTube capture) ---

    private fun runScanPipeline() {
        val now = SystemClock.elapsedRealtime()
        if (now - lastScanAtMs < SCAN_THROTTLE_MS) return
        lastScanAtMs = now

        val root = rootInActiveWindow ?: return
        try {
            val visibleText = collectVisibleText(root)

            val currentPackage = ForegroundAppTracker.currentPackageName
            if (currentPackage != null && isKnownYouTubePackage(currentPackage)) {
                attemptYouTubeCapture(root, visibleText)
            } else {
                val match = AdKeywords.match(visibleText)
                if (match != null) {
                    BlockOverlayView.show(applicationContext, "Reason: ${match.patternId}")
                    AccessibilityModule.emitBlockAttempt(match.patternId, match.matchedText, currentPackage)
                }
            }
        } finally {
            // `root` is used by both collectVisibleText() and (on the YouTube path)
            // findYouTubeTitle() below — its lifecycle belongs to this caller, recycled exactly
            // once here after every use, not inside either helper (recycling it inside
            // collectVisibleText() and then reusing it in findYouTubeTitle() would be a
            // use-after-recycle on the same node).
            @Suppress("DEPRECATION")
            root.recycle()
        }
    }

    /**
     * BFS (not recursion, to avoid stack-depth issues on deep trees) over the visible node tree.
     * `MAX_TRAVERSAL_NODES` is a real, necessary safeguard: content-changed events can fire on a
     * pathological/very large node graph, and an unbounded walk is a real ANR risk for a service
     * that must return from `onAccessibilityEvent` promptly. Does not recycle `root` — see
     * `runScanPipeline`'s `finally` block, which owns that.
     */
    private fun collectVisibleText(root: AccessibilityNodeInfo, maxNodes: Int = MAX_TRAVERSAL_NODES): List<String> {
        val out = mutableListOf<String>()
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        var visited = 0
        while (queue.isNotEmpty() && visited < maxNodes) {
            val node = queue.removeFirst()
            visited++
            if (node.isVisibleToUser) {
                node.text?.toString()?.let { if (it.isNotBlank()) out.add(it) }
                node.contentDescription?.toString()?.let { if (it.isNotBlank()) out.add(it) }
            }
            for (i in 0 until node.childCount) {
                node.getChild(i)?.let { queue.add(it) }
            }
            @Suppress("DEPRECATION")
            if (node !== root) node.recycle() // no-op on API 33+, still correct on this app's minSdk 24
        }
        return out
    }

    // --- YouTube capture (spec §3.5) ---

    /**
     * Best-effort, inherently version-fragile: YouTube's internal `viewIdResourceName`s are not
     * a public API and change across app releases. `TITLE_NODE_ID_CANDIDATES` is a starter,
     * tunable list (same "starter, not exhaustive" framing as `AdKeywords.PATTERNS`) — a real
     * deployment needs to keep this updated by hand against the installed YouTube app version.
     * Never fabricates a fake `watch?v=` URL: if no literal video id is found in visible text, the
     * emitted `url` is a search-results link for the extracted title (still honest, still useful
     * to a parent) rather than an invented watch URL that would silently look correct and be
     * wrong. If no title node is found at all, skips emitting entirely for this scan — a missed
     * capture is preferable to a row with an empty/placeholder title in the parent's history view.
     */
    private fun attemptYouTubeCapture(root: AccessibilityNodeInfo, visibleText: List<String>) {
        val title = findYouTubeTitle(root) ?: return

        val now = SystemClock.elapsedRealtime()
        if (title == lastEmittedYouTubeTitle && now - lastEmittedYouTubeAtMs < YOUTUBE_CAPTURE_DEBOUNCE_MS) return

        val videoId = visibleText.asSequence()
            .mapNotNull { VIDEO_ID_REGEX.find(it) }
            .map { it.groupValues[1] }
            .firstOrNull()
        val url = if (videoId != null) {
            "https://www.youtube.com/watch?v=$videoId"
        } else {
            "https://www.youtube.com/results?search_query=" + java.net.URLEncoder.encode(title, "UTF-8")
        }

        lastEmittedYouTubeTitle = title
        lastEmittedYouTubeAtMs = now
        // Exact contract from T18 (restated in this ticket): { title, url, watchedAt }.
        AccessibilityModule.emitYouTubeView(title, url, nowIso())
    }

    private fun findYouTubeTitle(root: AccessibilityNodeInfo): String? {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        var visited = 0
        var result: String? = null
        while (queue.isNotEmpty() && visited < MAX_TRAVERSAL_NODES) {
            val node = queue.removeFirst()
            visited++
            if (result == null && node.viewIdResourceName in TITLE_NODE_ID_CANDIDATES) {
                val text = node.text?.toString()
                if (!text.isNullOrBlank()) result = text
            }
            for (i in 0 until node.childCount) {
                node.getChild(i)?.let { queue.add(it) }
            }
            @Suppress("DEPRECATION")
            if (node !== root) node.recycle()
        }
        return result
    }

    private fun isKnownYouTubePackage(packageName: String): Boolean =
        ForegroundAppTracker.categoryFor(packageName) == "video_streaming"

    // --- Presence-tick loop (spec §6 Level 0) ---

    private fun startPresenceTickLoop() {
        presenceTickThread = thread(name = "GuardianPresenceTick") {
            while (!Thread.currentThread().isInterrupted) {
                try {
                    emitPresenceTick()
                } catch (e: Exception) {
                    // Best-effort — must never crash the service.
                }
                try {
                    Thread.sleep(PRESENCE_TICK_INTERVAL_MS)
                } catch (e: InterruptedException) {
                    return@thread
                }
            }
        }
    }

    /**
     * Emits a **partial** presence sample — this native layer only ever fills
     * `level0Idle`/`foregroundAppCategory`/`now` (see `AccessibilityModule.emitPresenceTick`'s
     * doc comment; `level1Still`/`level2FaceSamples` are T24/T25's territory).
     *
     * `level0Idle` uses a hardcoded placeholder idle threshold (`IDLE_THRESHOLD_MS_PLACEHOLDER`),
     * NOT the parent-configured `PresencePolicy.thresholdMinutes.level0` — this native layer has
     * no policy-sync mechanism in this ticket's scope, so it cannot know the real threshold.
     * Documented as an approximation, distinct from the T21 partial-sample-merge RISK (see
     * LEDGER.md's T23 entry): T21's own JS-side `level0Idle` remains the authoritative source
     * since it does read the real policy.
     *
     * Audio-activity signal: sourced from `AudioManager.isMusicActive()` (non-invasive polling),
     * NOT from actually requesting audio focus via `AudioManager.OnAudioFocusChangeListener` —
     * a documented interpretation call departing from the ticket's literal-named API, not a
     * silent deviation. Requesting focus (even `AUDIOFOCUS_GAIN_TRANSIENT`) would itself
     * interrupt/duck the very audio this signal is trying to passively observe, which is
     * self-defeating for a presence heuristic whose whole point is "is the child still watching,
     * don't interfere." `isMusicActive()` reports whether any app is playing audio through the
     * media stream without owning or perturbing anything — the correct passive signal source.
     */
    private fun emitPresenceTick() {
        val idleMs = SystemClock.elapsedRealtime() - ForegroundAppTracker.lastInputActivityAtMs
        val audioActive = audioManager?.isMusicActive == true
        val level0Idle = idleMs >= IDLE_THRESHOLD_MS_PLACEHOLDER && !audioActive

        val foregroundAppCategory = ForegroundAppTracker.categoryFor(ForegroundAppTracker.currentPackageName)

        AccessibilityModule.emitPresenceTick(
            PartialPresenceSample(level0Idle = level0Idle, foregroundAppCategory = foregroundAppCategory, now = nowIso()),
        )
    }

    companion object {
        // T25: YOUTUBE_PACKAGE_IDS moved to `ForegroundAppTracker.categoryFor` — single source of
        // truth shared with `MotionMonitor`, see that object's doc comment.

        // Starter, tunable candidate list of YouTube's internal title-node resource ids —
        // version-fragile by nature, see attemptYouTubeCapture()'s doc comment.
        private val TITLE_NODE_ID_CANDIDATES = setOf(
            "com.google.android.youtube:id/player_video_title",
            "com.google.android.youtube:id/title",
        )

        private val VIDEO_ID_REGEX = Regex("""(?:v=|youtu\.be/|/shorts/)([A-Za-z0-9_-]{11})""")

        private const val PRESENCE_TICK_INTERVAL_MS = 15_000L
        private const val SCAN_THROTTLE_MS = 400L
        private const val MAX_TRAVERSAL_NODES = 400
        private const val YOUTUBE_CAPTURE_DEBOUNCE_MS = 10_000L
        // Native-side placeholder only — see emitPresenceTick()'s doc comment for why this isn't
        // the real PresencePolicy.thresholdMinutes.level0.
        private const val IDLE_THRESHOLD_MS_PLACEHOLDER = 2 * 60 * 1000L

        private fun nowIso(): String {
            val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
            formatter.timeZone = TimeZone.getTimeZone("UTC")
            return formatter.format(Date())
        }
    }
}
