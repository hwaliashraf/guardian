package com.guardian.usage

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.SharedPreferences
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import com.guardian.deviceadmin.GuardianDeviceAdminReceiver
import org.json.JSONObject

/**
 * Spec §3.7/§7: wraps `UsageStatsManager` to (a) list installed apps for T16's app-management UI
 * and (b) drive `NativeBucketEngine` (this ticket's Kotlin port of T03's `BucketEngine`) against
 * real device usage, locking the device via `GuardianDeviceAdminReceiver.lockNow()` when a
 * session's cap is hit — the local, offline-first enforcement loop spec §7 asks for, running
 * independently of whether T21's JS-side approximation is even alive.
 *
 * UNVERIFIED — this file cannot be compiled/run in this build environment (see SETUP.md).
 *
 * **RISK — no package-name -> content-category mapping exists anywhere in this repo (same gap
 * T23 hit for `foregroundAppCategory`, confirmed again here by grep).** `NativeBucketEngine`
 * needs a `categoryId` to resolve `BucketPolicy.perCategory[categoryId]`. Since this loop cannot
 * determine a real content category for an arbitrary foreground package, ALL native on-device
 * usage is tracked under one synthetic category id (`DEFAULT_CATEGORY_ID`), which deliberately
 * has no `perCategory` override, so `resolveCategoryConfig` always falls through to
 * `policy.default` — i.e. **native enforcement today is one global per-device cap, not
 * per-category caps**, until a real package->category mapping exists (T16/T26 territory). This
 * is a materially bigger limitation than T23's version of the same gap since it affects real
 * enforcement, not just a presence heuristic — flagged plainly, not silently glossed over.
 *
 * **RISK — no policy-sync bridge into this native loop exists** (same already-accepted gap as
 * T22's `GuardianVpnService.updatePolicy()`, which likewise has no RN bridge caller wired to it
 * — confirmed by reading `VpnModule.kt` in full, it exposes no `@ReactMethod` for policy
 * updates). `POLICY`/`SCREEN_TIME` below are hardcoded placeholder defaults, not the real
 * parent-configured `Policy`. `updatePolicy()` is provided (mirroring
 * `GuardianVpnService.updatePolicy`'s exact shape) for a future ticket to wire up the same way
 * T22's equivalent gap would need fixing — not invented new scope, matching existing precedent.
 *
 * **RISK — weekly cap cannot be enforced**: no multi-day persistence exists in this ticket's
 * scope (`SessionStore` only tracks a single day's `DailyUsageState`), so `weeklyMinutesUsed` is
 * always passed as `0.0` to `NativeBucketEngine.startSession` — the weekly-cap rule is ported and
 * correct, but this loop can never actually trigger it. Documented, not silently dropped.
 */
object UsageAccountant {

    data class InstalledApp(val appId: String, val name: String, val storeRating: String?)

    // Placeholder default policy — see the RISK note above. maxSessionsPerDay intentionally
    // unset (no per-day session-count cap enforced natively until a real policy is wired in).
    @Volatile
    var policy: NativeBucketEngine.BucketPolicy = NativeBucketEngine.BucketPolicy(
        perCategory = emptyMap(),
        default = NativeBucketEngine.BucketCategoryConfig(
            maxSessionMinutes = 45,
            mandatoryBreakMinutes = 15,
            maxSessionsPerDay = null,
            graceFinishEnabled = false,
        ),
    )
        private set

    @Volatile
    var screenTime: NativeBucketEngine.ScreenTimePolicyView =
        NativeBucketEngine.ScreenTimePolicyView(dailyLimitMinutes = 180, weeklyLimitMinutes = 1260)
        private set

    /** See the policy-sync RISK note above — provided for a future ticket, no caller wires this
     * up yet, same already-accepted gap class as `GuardianVpnService.updatePolicy`. */
    fun updatePolicy(newPolicy: NativeBucketEngine.BucketPolicy, newScreenTime: NativeBucketEngine.ScreenTimePolicyView) {
        policy = newPolicy
        screenTime = newScreenTime
    }

    const val DEFAULT_CATEGORY_ID = "default"
    private const val POLL_INTERVAL_MS = 30_000L
    private const val FOREGROUND_QUERY_WINDOW_MS = 60_000L

    @Volatile private var pollThread: Thread? = null

    /** Idempotent — safe to call from `getInstalledApps`/`getUsageToday` bridge methods purely
     * to ensure `SessionStore` is initialized, without those read-only calls having the surprising
     * side effect of starting the background enforcement loop (that's `startTracking`'s job). */
    fun ensureInitialized(context: Context) {
        SessionStore.init(context.applicationContext)
    }

    /** Reads today's persisted `DailyUsageState` without driving the enforcement loop — used by
     * `UsageModule.getUsageToday()`. */
    fun peekDailyUsage(context: Context): NativeBucketEngine.DailyUsageState {
        ensureInitialized(context)
        return SessionStore.loadDailyUsage(System.currentTimeMillis())
    }

    fun startTracking(context: Context) {
        if (pollThread != null) return
        ensureInitialized(context)
        pollThread = kotlin.concurrent.thread(name = "GuardianUsagePoll") {
            while (!Thread.currentThread().isInterrupted) {
                try {
                    pollOnce(context.applicationContext)
                } catch (e: Exception) {
                    // Best-effort — must never crash the caller (mirrors T22/T23's precedent for
                    // background-loop exception handling).
                }
                try {
                    Thread.sleep(POLL_INTERVAL_MS)
                } catch (e: InterruptedException) {
                    return@thread
                }
            }
        }
    }

    fun stopTracking() {
        pollThread?.interrupt()
        pollThread = null
    }

    /**
     * One iteration of the enforcement loop. `queryForegroundPackage` gates whether a NEW
     * session starts (real evidence of device usage required — a poll with no detected
     * foreground app, e.g. screen off / no usage access granted, starts nothing). Once a session
     * IS running, ticking it does NOT re-check foreground presence — `NativeBucketEngine.tick()`'s
     * elapsed calculation is continuous wall-clock time by construction (see the caller-contract
     * note in `NativeBucketEngine.kt`), matching T03/T21's own semantics: a session, once
     * started, keeps accruing until explicitly ended (cap reached), never auto-paused by a brief
     * gap in foreground detection — that is exactly the "short pause doesn't reset" rule. Genuine
     * idle-time compensation is a separate mechanism (T04's presence detection + `refundMinutes`),
     * not this engine's job.
     */
    private fun pollOnce(context: Context) {
        val nowMs = System.currentTimeMillis()
        val session = SessionStore.loadSession()
        val breakState = SessionStore.loadBreak()
        val dailyUsage = SessionStore.loadDailyUsage(nowMs)

        if (session == null) {
            if (queryForegroundPackage(context) == null) return // no usage evidence this poll
            when (
                val result = NativeBucketEngine.startSession(
                    policy = policy,
                    screenTime = screenTime,
                    dailyUsage = dailyUsage,
                    breakState = breakState,
                    weeklyMinutesUsed = 0.0, // see the weekly-cap RISK note above
                    categoryId = DEFAULT_CATEGORY_ID,
                    nowMs = nowMs,
                    // T05's schedules engine (isWithinAllowedWindow) is NOT ported/wired into
                    // this native loop — out of this ticket's explicit scope (only T03's bucket
                    // engine was asked to be ported). Always-allow is a documented placeholder,
                    // not a claim that schedule windows are enforced natively.
                    isWithinAllowedWindow = { _, _ -> true },
                )
            ) {
                is NativeBucketEngine.StartSessionResult.Ok -> SessionStore.saveSession(result.session)
                is NativeBucketEngine.StartSessionResult.Refused -> {
                    // Already over a cap (daily/weekly exhausted) with no session to end — lock
                    // immediately rather than silently waiting for a session that will never
                    // start. mandatory_break_active/outside_allowed_window are expected, normal
                    // refusals (not over-cap) and do not warrant a lock.
                    if (result.reason == "daily_limit_exhausted" || result.reason == "weekly_limit_exhausted") {
                        GuardianDeviceAdminReceiver.lockNow(context)
                    }
                }
            }
            return
        }

        val tickResult = NativeBucketEngine.tick(policy, session, nowMs)
        // Reviewer-flagged gap, fixed: tick() computes these but pollOnce previously discarded
        // them — T21's JS equivalent (useLocalBucketEngine) surfaces both to the child UI; this
        // native loop now does too, via the same guardianTamperDetected-sibling event pattern.
        if (tickResult.fire5MinWarning) UsageModule.emitSessionWarning(5)
        if (tickResult.fire1MinWarning) UsageModule.emitSessionWarning(1)

        if (tickResult.mustEnd) {
            GuardianDeviceAdminReceiver.lockNow(context)
            val endResult = NativeBucketEngine.endSession(policy, dailyUsage, tickResult.session, nowMs)
            SessionStore.saveDailyUsage(endResult.updatedDailyUsage)
            SessionStore.saveBreak(endResult.breakState)
            SessionStore.clearSession()
        } else {
            // Only persisted on the non-ending path — clearSession() above already removes the
            // session key when it ends, so writing-then-immediately-clearing on the mustEnd
            // branch (reviewer-flagged redundant I/O) is no longer possible.
            SessionStore.saveSession(tickResult.session)
        }
    }

    // --- Installed apps (spec §3.3, T16's InstalledApp contract) ---

    /**
     * Best-effort: Android's `PackageManager` has no public API for Play Store content ratings
     * at all — `storeRating` is therefore always `null` from this query. The ticket's described
     * fallback ("a manual per-app rating field the parent can set in T16's UI") does not exist
     * yet either — confirmed by reading `AppManagementScreen.tsx`/`useInstalledApps.ts`, both
     * treat `storeRating` as display-only (`?? 'Unrated'}`), no manual-entry UI. **RISK, stated
     * plainly per the ticket's explicit ask**: `AppRulePolicy.blockByStoreRating` filtering is
     * non-functional against real on-device data until either a rating data source or a manual
     * per-app override UI is built (T16/T26 territory, out of this ticket's scope).
     */
    fun getInstalledApps(context: Context): List<InstalledApp> {
        val pm = context.packageManager
        val apps = pm.getInstalledApplications(PackageManager.GET_META_DATA)
        return apps
            .filter { it.flags and ApplicationInfo.FLAG_SYSTEM == 0 } // user-installed apps only, documented choice
            .map { info ->
                InstalledApp(
                    appId = info.packageName,
                    name = pm.getApplicationLabel(info).toString(),
                    storeRating = null,
                )
            }
    }

    // --- Foreground-app polling (best-effort, requires PACKAGE_USAGE_STATS special access) ---

    fun hasUsageAccess(context: Context): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        } else {
            @Suppress("DEPRECATION")
            appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    /** Most recent foreground-app package in the last `FOREGROUND_QUERY_WINDOW_MS`, or `null` if
     * unavailable (no usage access granted, or no foreground event in the window). */
    fun queryForegroundPackage(context: Context): String? {
        if (!hasUsageAccess(context)) return null
        val usageStatsManager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val end = System.currentTimeMillis()
        val begin = end - FOREGROUND_QUERY_WINDOW_MS
        val events = usageStatsManager.queryEvents(begin, end)
        val event = UsageEvents.Event()
        var lastForegroundPackage: String? = null
        val foregroundEventType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            UsageEvents.Event.ACTIVITY_RESUMED
        } else {
            @Suppress("DEPRECATION")
            UsageEvents.Event.MOVE_TO_FOREGROUND
        }
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            if (event.eventType == foregroundEventType) {
                lastForegroundPackage = event.packageName
            }
        }
        return lastForegroundPackage
    }
}

/**
 * Flat `SharedPreferences` + hand-rolled JSON persistence — same avoid-Room/KSP rationale as
 * T22's `BlocklistLoader.kt` ("avoids a KSP/annotation-processor Gradle setup this environment
 * can't verify compiles"). Holds exactly one running session/break/daily-usage triple (this
 * native loop tracks one synthetic `DEFAULT_CATEGORY_ID` bucket only — see the category-mapping
 * RISK note on `UsageAccountant` above).
 */
private object SessionStore {
    private const val PREFS_NAME = "guardian_usage_state"
    private const val KEY_SESSION = "session"
    private const val KEY_BREAK = "break"
    private const val KEY_DAILY_USAGE = "daily_usage"

    @Volatile private var prefs: SharedPreferences? = null

    fun init(context: Context) {
        if (prefs == null) {
            prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        }
    }

    private fun requirePrefs(): SharedPreferences =
        prefs ?: throw IllegalStateException("SessionStore.init(context) must be called before use")

    fun loadSession(): NativeBucketEngine.SessionState? {
        val json = requirePrefs().getString(KEY_SESSION, null) ?: return null
        val obj = JSONObject(json)
        return NativeBucketEngine.SessionState(
            categoryId = obj.getString("categoryId"),
            startedAtIso = obj.getString("startedAtIso"),
            elapsedMinutes = obj.getDouble("elapsedMinutes"),
            graceUsed = obj.getBoolean("graceUsed"),
            warnings5MinFired = obj.getBoolean("warnings5MinFired"),
            warnings1MinFired = obj.getBoolean("warnings1MinFired"),
        )
    }

    fun saveSession(session: NativeBucketEngine.SessionState) {
        val obj = JSONObject()
            .put("categoryId", session.categoryId)
            .put("startedAtIso", session.startedAtIso)
            .put("elapsedMinutes", session.elapsedMinutes)
            .put("graceUsed", session.graceUsed)
            .put("warnings5MinFired", session.warnings5MinFired)
            .put("warnings1MinFired", session.warnings1MinFired)
        requirePrefs().edit().putString(KEY_SESSION, obj.toString()).apply()
    }

    fun clearSession() {
        requirePrefs().edit().remove(KEY_SESSION).apply()
    }

    fun loadBreak(): NativeBucketEngine.BreakState? {
        val json = requirePrefs().getString(KEY_BREAK, null) ?: return null
        val obj = JSONObject(json)
        return NativeBucketEngine.BreakState(
            categoryId = obj.getString("categoryId"),
            startedAtIso = obj.getString("startedAtIso"),
            requiredMinutes = obj.getInt("requiredMinutes"),
        )
    }

    fun saveBreak(breakState: NativeBucketEngine.BreakState) {
        val obj = JSONObject()
            .put("categoryId", breakState.categoryId)
            .put("startedAtIso", breakState.startedAtIso)
            .put("requiredMinutes", breakState.requiredMinutes)
        requirePrefs().edit().putString(KEY_BREAK, obj.toString()).apply()
    }

    /** Resets to a fresh zeroed `DailyUsageState` whenever the persisted date differs from the
     * UTC date of `nowMs` — same "one row per day" model T03's `DailyUsageState` assumes. */
    fun loadDailyUsage(nowMs: Long): NativeBucketEngine.DailyUsageState {
        val today = NativeBucketEngine.isoDateOnly(nowMs)
        val json = requirePrefs().getString(KEY_DAILY_USAGE, null)
        if (json != null) {
            val obj = JSONObject(json)
            if (obj.getString("date") == today) {
                val perCategoryMinutes = obj.getJSONObject("perCategoryMinutesUsed")
                val perCategoryCount = obj.getJSONObject("perCategorySessionCount")
                return NativeBucketEngine.DailyUsageState(
                    date = today,
                    perCategoryMinutesUsed = perCategoryMinutes.keys().asSequence()
                        .associateWith { perCategoryMinutes.getDouble(it) },
                    perCategorySessionCount = perCategoryCount.keys().asSequence()
                        .associateWith { perCategoryCount.getInt(it) },
                    totalMinutesUsed = obj.getDouble("totalMinutesUsed"),
                )
            }
        }
        return NativeBucketEngine.DailyUsageState(
            date = today,
            perCategoryMinutesUsed = emptyMap(),
            perCategorySessionCount = emptyMap(),
            totalMinutesUsed = 0.0,
        )
    }

    fun saveDailyUsage(dailyUsage: NativeBucketEngine.DailyUsageState) {
        val perCategoryMinutes = JSONObject()
        dailyUsage.perCategoryMinutesUsed.forEach { (k, v) -> perCategoryMinutes.put(k, v) }
        val perCategoryCount = JSONObject()
        dailyUsage.perCategorySessionCount.forEach { (k, v) -> perCategoryCount.put(k, v) }
        val obj = JSONObject()
            .put("date", dailyUsage.date)
            .put("perCategoryMinutesUsed", perCategoryMinutes)
            .put("perCategorySessionCount", perCategoryCount)
            .put("totalMinutesUsed", dailyUsage.totalMinutesUsed)
        requirePrefs().edit().putString(KEY_DAILY_USAGE, obj.toString()).apply()
    }
}
