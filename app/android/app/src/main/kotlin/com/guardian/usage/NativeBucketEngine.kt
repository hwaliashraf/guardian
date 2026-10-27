package com.guardian.usage

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * T24, Requirement 2: Kotlin port of `packages/domain/src/buckets/engine.ts`'s `BucketEngine` —
 * that TS file (T03) is the source of truth; `packages/domain/src/buckets/__tests__/
 * nativePortSpec.test.ts` is the canonical, runnable cross-check that the rule table restated
 * here did not drift from it (it asserts against the REAL `BucketEngine`, not a copy). This file
 * itself cannot be compiled/tested in this build environment (no JVM) — see LEDGER.md's T24 entry.
 * Keep both files in sync by hand; nothing enforces that automatically across the boundary.
 *
 * **Rule table restated in full (per the ticket's explicit ask), copied from `engine.ts`'s
 * actual logic, not just its doc comments:**
 * - `startSession` refuses, in order: daily total cap reached -> weekly total cap reached ->
 *   session-count cap reached (only if `maxSessionsPerDay` is configured for the category) ->
 *   mandatory break still active for this category (computed from the break's ORIGINAL
 *   `startedAt`, never pushed back by repeated early attempts) -> outside the allowed schedule
 *   window (injected predicate). Otherwise returns a fresh session (`elapsedMinutes = 0`).
 * - `tick` computes `elapsed` as continuous wall-clock minutes since `session.startedAt` —
 *   **never reset by a pause**; this is what makes "a short break doesn't reset the session
 *   clock" true by construction. `effectiveCap = category.maxSessionMinutes + (graceUsed ? 3 :
 *   0)`. Fires the 5-min warning once when `elapsed` enters `[effectiveCap-5, effectiveCap)`;
 *   the 1-min warning once when `elapsed` enters `[effectiveCap-1, effectiveCap)`; `mustEnd`
 *   when `elapsed >= effectiveCap`.
 * - `requestGraceFinish` grants the one-time +3min extension (consumed by `tick`'s
 *   `effectiveCap`) unless the category has grace disabled or it was already used this session.
 * - `endSession` folds `finalElapsed = max(session.elapsedMinutes, continuous-elapsed-at-now)`
 *   into `dailyUsage.totalMinutesUsed`/`perCategoryMinutesUsed[categoryId]`, increments
 *   `perCategorySessionCount[categoryId]` by 1, and opens a new mandatory break
 *   (`requiredMinutes = category.mandatoryBreakMinutes`).
 * - `refundMinutes` is a floor-at-0 decrement of both the category and the running total.
 * - Category config resolution: `policy.perCategory[categoryId] ?? policy.default`.
 *
 * **Caller contract (T03's LEDGER entry, T21's patch, and this ticket's own "Caller contract"
 * section — restated once more since this is the ONE other real caller of `endSession`)**:
 * `endSession` must be invoked ONLY when `tick(now).mustEnd == true` (or another
 * affirmatively-classified qualifying break) — never on a trivial screen-off/app-background
 * blip. `UsageAccountant`'s driving loop (this ticket) honors this exactly.
 *
 * **NOT ported, out of this ticket's scope (documented, not silently dropped)**:
 * `reconcileOffline` (multi-device offline merge — no multi-device reconciliation driver exists
 * on this native loop, which is the single on-device running state, not a remote snapshot to
 * merge) and `applyApprovedExtraTime` (parent-approval grant, backend/T19 territory, no
 * analogous native caller).
 *
 * **Kotlin typing note**: TS's single `number` type is mapped here to `Double` for
 * time/minute-derived quantities (`elapsedMinutes`, `remainingMinutes`,
 * `remainingBreakMinutes`) and `Int` for count/config quantities
 * (`maxSessionMinutes`/`mandatoryBreakMinutes`/`maxSessionsPerDay`/session counts) — a
 * Kotlin-specific typing decision, not a behavioral difference from the TS source.
 */
object NativeBucketEngine {

    data class BucketCategoryConfig(
        val maxSessionMinutes: Int,
        val mandatoryBreakMinutes: Int,
        val maxSessionsPerDay: Int? = null,
        val graceFinishEnabled: Boolean,
    )

    data class BucketPolicy(
        val perCategory: Map<String, BucketCategoryConfig>,
        val default: BucketCategoryConfig,
    )

    /** Only the two fields this engine actually reads from the real `ScreenTimePolicy`. */
    data class ScreenTimePolicyView(val dailyLimitMinutes: Int, val weeklyLimitMinutes: Int)

    data class SessionState(
        val categoryId: String,
        val startedAtIso: String,
        val elapsedMinutes: Double,
        val graceUsed: Boolean,
        val warnings5MinFired: Boolean,
        val warnings1MinFired: Boolean,
    )

    data class BreakState(val categoryId: String, val startedAtIso: String, val requiredMinutes: Int)

    data class DailyUsageState(
        val date: String,
        val perCategoryMinutesUsed: Map<String, Double>,
        val perCategorySessionCount: Map<String, Int>,
        val totalMinutesUsed: Double,
    )

    const val GRACE_FINISH_MINUTES = 3

    sealed class StartSessionResult {
        data class Ok(val session: SessionState) : StartSessionResult()
        data class Refused(val reason: String, val remainingBreakMinutes: Double? = null) : StartSessionResult()
    }

    data class TickResult(
        val session: SessionState,
        val fire5MinWarning: Boolean,
        val fire1MinWarning: Boolean,
        val mustEnd: Boolean,
        val remainingMinutes: Double,
    )

    sealed class GraceFinishResult {
        data class Ok(val session: SessionState) : GraceFinishResult()
        data class Refused(val reason: String) : GraceFinishResult()
    }

    data class EndSessionResult(val updatedDailyUsage: DailyUsageState, val breakState: BreakState)

    private val ISO_FORMAT = ThreadLocal.withInitial {
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
    }

    fun nowIso(): String = ISO_FORMAT.get()!!.format(Date())

    /** "YYYY-MM-DD" (UTC) for `epochMs` — used by `SessionStore` to key one `DailyUsageState`
     * per day, matching `DailyUsageState.date`'s documented format. */
    fun isoDateOnly(epochMs: Long): String = ISO_FORMAT.get()!!.format(Date(epochMs)).substring(0, 10)

    /** Full ISO-8601 UTC timestamp for `epochMs`, same format `nowIso()`/`startSession`/
     * `endSession` use for `startedAtIso` — exposed publicly so `NativeBucketEngineTest.kt`
     * (this ticket's Kotlin unit tests) can construct fixture `SessionState`/`BreakState` values
     * without duplicating the date-format string. */
    fun isoOf(epochMs: Long): String = ISO_FORMAT.get()!!.format(Date(epochMs))

    private fun parseIso(iso: String): Long = ISO_FORMAT.get()!!.parse(iso)?.time
        ?: throw IllegalArgumentException("NativeBucketEngine: unparseable ISO timestamp '$iso'")

    /** Mirrors `minutesBetween`: floored at 0, never negative. */
    private fun minutesBetween(fromIso: String, toMs: Long): Double {
        val diffMs = toMs - parseIso(fromIso)
        return if (diffMs <= 0) 0.0 else diffMs / 60_000.0
    }

    private fun resolveCategoryConfig(policy: BucketPolicy, categoryId: String): BucketCategoryConfig =
        policy.perCategory[categoryId] ?: policy.default

    fun startSession(
        policy: BucketPolicy,
        screenTime: ScreenTimePolicyView,
        dailyUsage: DailyUsageState,
        breakState: BreakState?,
        /** Minutes already used this week — same caller-supplied-rolling-total contract as T03's
         * `BucketEngine` constructor param (see `UsageAccountant.kt`'s doc comment for how this
         * native loop sources/defaults it, since no multi-day persistence is built in this
         * ticket's scope). */
        weeklyMinutesUsed: Double,
        categoryId: String,
        nowMs: Long,
        isWithinAllowedWindow: (String, Long) -> Boolean,
    ): StartSessionResult {
        val config = resolveCategoryConfig(policy, categoryId)

        if (dailyUsage.totalMinutesUsed >= screenTime.dailyLimitMinutes) {
            return StartSessionResult.Refused("daily_limit_exhausted")
        }
        if (weeklyMinutesUsed >= screenTime.weeklyLimitMinutes) {
            return StartSessionResult.Refused("weekly_limit_exhausted")
        }
        val maxSessionsPerDay = config.maxSessionsPerDay
        if (maxSessionsPerDay != null && (dailyUsage.perCategorySessionCount[categoryId] ?: 0) >= maxSessionsPerDay) {
            return StartSessionResult.Refused("session_count_cap_reached")
        }
        if (breakState != null && breakState.categoryId == categoryId) {
            val remaining = breakState.requiredMinutes - minutesBetween(breakState.startedAtIso, nowMs)
            if (remaining > 0) {
                return StartSessionResult.Refused("mandatory_break_active", remainingBreakMinutes = remaining)
            }
        }
        if (!isWithinAllowedWindow(categoryId, nowMs)) {
            return StartSessionResult.Refused("outside_allowed_window")
        }

        return StartSessionResult.Ok(
            SessionState(
                categoryId = categoryId,
                startedAtIso = isoOf(nowMs),
                elapsedMinutes = 0.0,
                graceUsed = false,
                warnings5MinFired = false,
                warnings1MinFired = false,
            ),
        )
    }

    fun tick(policy: BucketPolicy, session: SessionState, nowMs: Long): TickResult {
        val config = resolveCategoryConfig(policy, session.categoryId)
        val effectiveCap = config.maxSessionMinutes + (if (session.graceUsed) GRACE_FINISH_MINUTES else 0)
        val elapsed = minutesBetween(session.startedAtIso, nowMs)

        val fire5MinWarning = !session.warnings5MinFired && elapsed >= effectiveCap - 5 && elapsed < effectiveCap
        val fire1MinWarning = !session.warnings1MinFired && elapsed >= effectiveCap - 1 && elapsed < effectiveCap
        val mustEnd = elapsed >= effectiveCap

        return TickResult(
            session = session.copy(
                elapsedMinutes = elapsed,
                warnings5MinFired = session.warnings5MinFired || fire5MinWarning,
                warnings1MinFired = session.warnings1MinFired || fire1MinWarning,
            ),
            fire5MinWarning = fire5MinWarning,
            fire1MinWarning = fire1MinWarning,
            mustEnd = mustEnd,
            remainingMinutes = maxOf(0.0, effectiveCap - elapsed),
        )
    }

    fun requestGraceFinish(policy: BucketPolicy, session: SessionState): GraceFinishResult {
        val config = resolveCategoryConfig(policy, session.categoryId)
        if (!config.graceFinishEnabled) return GraceFinishResult.Refused("grace_disabled")
        if (session.graceUsed) return GraceFinishResult.Refused("grace_already_used")
        return GraceFinishResult.Ok(session.copy(graceUsed = true))
    }

    fun endSession(policy: BucketPolicy, dailyUsage: DailyUsageState, session: SessionState, nowMs: Long): EndSessionResult {
        val config = resolveCategoryConfig(policy, session.categoryId)
        val categoryId = session.categoryId
        val finalElapsed = maxOf(session.elapsedMinutes, minutesBetween(session.startedAtIso, nowMs))

        val updatedDailyUsage = dailyUsage.copy(
            totalMinutesUsed = dailyUsage.totalMinutesUsed + finalElapsed,
            perCategoryMinutesUsed = dailyUsage.perCategoryMinutesUsed +
                (categoryId to (dailyUsage.perCategoryMinutesUsed[categoryId] ?: 0.0) + finalElapsed),
            perCategorySessionCount = dailyUsage.perCategorySessionCount +
                (categoryId to (dailyUsage.perCategorySessionCount[categoryId] ?: 0) + 1),
        )

        return EndSessionResult(
            updatedDailyUsage = updatedDailyUsage,
            breakState = BreakState(
                categoryId = categoryId,
                startedAtIso = isoOf(nowMs),
                requiredMinutes = config.mandatoryBreakMinutes,
            ),
        )
    }

    fun refundMinutes(dailyUsage: DailyUsageState, categoryId: String, minutes: Double): DailyUsageState {
        val currentCategoryMinutes = dailyUsage.perCategoryMinutesUsed[categoryId] ?: 0.0
        return dailyUsage.copy(
            totalMinutesUsed = maxOf(0.0, dailyUsage.totalMinutesUsed - minutes),
            perCategoryMinutesUsed = dailyUsage.perCategoryMinutesUsed +
                (categoryId to maxOf(0.0, currentCategoryMinutes - minutes)),
        )
    }
}
