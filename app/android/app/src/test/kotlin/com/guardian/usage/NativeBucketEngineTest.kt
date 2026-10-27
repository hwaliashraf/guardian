package com.guardian.usage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * T24, Requirement 2: real Kotlin unit tests for `NativeBucketEngine.kt`, per the ticket's
 * explicit ask ("Add `NativeBucketEngine` unit tests as **Kotlin** tests — cannot run here, but
 * write them for real"). This is IN ADDITION to `packages/domain/src/buckets/__tests__/
 * nativePortSpec.test.ts` (the TS cross-check against the real `BucketEngine`) — not a
 * substitute for it. Plain JVM tests (`src/test`, not `src/androidTest`): `NativeBucketEngine`
 * has no Android-framework dependency, so no instrumentation/Robolectric is needed, only a JVM —
 * which is exactly what this build environment lacks (see SETUP.md), so this file, like every
 * other Kotlin file in this repo, is written for real but has never actually been run.
 *
 * Rule coverage mirrors `nativePortSpec.test.ts` one-for-one so both suites can be diffed by eye
 * if either the TS engine or this port ever changes.
 */
class NativeBucketEngineTest {

    private val gamesId = "games"
    private val educationId = "education"

    private val policy = NativeBucketEngine.BucketPolicy(
        perCategory = mapOf(
            educationId to NativeBucketEngine.BucketCategoryConfig(
                maxSessionMinutes = 60,
                mandatoryBreakMinutes = 5,
                maxSessionsPerDay = null,
                graceFinishEnabled = false,
            ),
        ),
        default = NativeBucketEngine.BucketCategoryConfig(
            maxSessionMinutes = 45,
            mandatoryBreakMinutes = 15,
            maxSessionsPerDay = 2,
            graceFinishEnabled = true,
        ),
    )

    private val screenTime = NativeBucketEngine.ScreenTimePolicyView(dailyLimitMinutes = 240, weeklyLimitMinutes = 1200)

    private val t0: Long = 1_784_635_200_000L // 2026-07-10T10:00:00.000Z (matches nativePortSpec.test.ts's T0)

    private fun addMinutes(fromMs: Long, minutes: Int): Long = fromMs + minutes * 60_000L

    private fun freshDailyUsage(
        totalMinutesUsed: Double = 0.0,
        perCategoryMinutesUsed: Map<String, Double> = emptyMap(),
        perCategorySessionCount: Map<String, Int> = emptyMap(),
    ) = NativeBucketEngine.DailyUsageState(
        date = "2026-07-10",
        perCategoryMinutesUsed = perCategoryMinutesUsed,
        perCategorySessionCount = perCategorySessionCount,
        totalMinutesUsed = totalMinutesUsed,
    )

    private val allowAll: (String, Long) -> Boolean = { _, _ -> true }

    // --- total daily/weekly cap ---

    @Test
    fun `startSession refuses once the daily total cap is already exhausted`() {
        val result = NativeBucketEngine.startSession(
            policy, screenTime, freshDailyUsage(totalMinutesUsed = 240.0), null, 0.0, gamesId, t0, allowAll,
        )
        assertTrue(result is NativeBucketEngine.StartSessionResult.Refused)
        assertEquals("daily_limit_exhausted", (result as NativeBucketEngine.StartSessionResult.Refused).reason)
    }

    @Test
    fun `startSession refuses once the weekly total cap is already exhausted`() {
        val result = NativeBucketEngine.startSession(
            policy, screenTime, freshDailyUsage(), null, 1200.0, gamesId, t0, allowAll,
        )
        assertTrue(result is NativeBucketEngine.StartSessionResult.Refused)
        assertEquals("weekly_limit_exhausted", (result as NativeBucketEngine.StartSessionResult.Refused).reason)
    }

    // --- max session length ---

    @Test
    fun `mustEnd flips true exactly when elapsed reaches the category cap`() {
        val session = NativeBucketEngine.SessionState(gamesId, isoOf(t0), 0.0, false, false, false)
        assertFalse(NativeBucketEngine.tick(policy, session, addMinutes(t0, 44)).mustEnd)
        assertTrue(NativeBucketEngine.tick(policy, session, addMinutes(t0, 45)).mustEnd)
    }

    @Test
    fun `category override applies instead of the default`() {
        val session = NativeBucketEngine.SessionState(educationId, isoOf(t0), 0.0, false, false, false)
        assertFalse(NativeBucketEngine.tick(policy, session, addMinutes(t0, 45)).mustEnd)
        assertTrue(NativeBucketEngine.tick(policy, session, addMinutes(t0, 60)).mustEnd)
    }

    // --- mandatory break, short pause does not reset ---

    @Test
    fun `startSession refuses with mandatory_break_active while the break window has not elapsed`() {
        val breakState = NativeBucketEngine.BreakState(gamesId, isoOf(t0), 15)
        val result = NativeBucketEngine.startSession(
            policy, screenTime, freshDailyUsage(), breakState, 0.0, gamesId, addMinutes(t0, 5), allowAll,
        )
        assertTrue(result is NativeBucketEngine.StartSessionResult.Refused)
        val refused = result as NativeBucketEngine.StartSessionResult.Refused
        assertEquals("mandatory_break_active", refused.reason)
        assertEquals(10.0, refused.remainingBreakMinutes!!, 0.001)
    }

    @Test
    fun `startSession succeeds once the full mandatory break has genuinely elapsed`() {
        val breakState = NativeBucketEngine.BreakState(gamesId, isoOf(t0), 15)
        val result = NativeBucketEngine.startSession(
            policy, screenTime, freshDailyUsage(), breakState, 0.0, gamesId, addMinutes(t0, 15), allowAll,
        )
        assertTrue(result is NativeBucketEngine.StartSessionResult.Ok)
    }

    @Test
    fun `repeated early startSession attempts during a break never push back its own window`() {
        val breakState = NativeBucketEngine.BreakState(gamesId, isoOf(t0), 15)
        val first = NativeBucketEngine.startSession(
            policy, screenTime, freshDailyUsage(), breakState, 0.0, gamesId, addMinutes(t0, 3), allowAll,
        ) as NativeBucketEngine.StartSessionResult.Refused
        val second = NativeBucketEngine.startSession(
            policy, screenTime, freshDailyUsage(), breakState, 0.0, gamesId, addMinutes(t0, 4), allowAll,
        ) as NativeBucketEngine.StartSessionResult.Refused
        assertEquals(12.0, first.remainingBreakMinutes!!, 0.001)
        assertEquals(11.0, second.remainingBreakMinutes!!, 0.001)
    }

    @Test
    fun `tick elapsed is continuous wall-clock time since session start, unaffected by an unended pause`() {
        val session = NativeBucketEngine.SessionState(gamesId, isoOf(t0), 10.0, false, false, false)
        val afterPause = NativeBucketEngine.tick(policy, session, addMinutes(t0, 12))
        assertEquals(12.0, afterPause.session.elapsedMinutes, 0.001)
    }

    // --- session count cap ---

    @Test
    fun `startSession refuses with session_count_cap_reached once maxSessionsPerDay is hit`() {
        val result = NativeBucketEngine.startSession(
            policy, screenTime, freshDailyUsage(perCategorySessionCount = mapOf(gamesId to 2)), null, 0.0, gamesId, t0, allowAll,
        )
        assertTrue(result is NativeBucketEngine.StartSessionResult.Refused)
        assertEquals("session_count_cap_reached", (result as NativeBucketEngine.StartSessionResult.Refused).reason)
    }

    @Test
    fun `a category with no maxSessionsPerDay configured is never capped by session count`() {
        val result = NativeBucketEngine.startSession(
            policy, screenTime, freshDailyUsage(perCategorySessionCount = mapOf(educationId to 999)), null, 0.0, educationId, t0, allowAll,
        )
        assertTrue(result is NativeBucketEngine.StartSessionResult.Ok)
    }

    // --- 5-min / 1-min warnings ---

    @Test
    fun `fire5MinWarning fires exactly once, at cap-5 to cap`() {
        val session = NativeBucketEngine.SessionState(gamesId, isoOf(t0), 0.0, false, false, false)
        assertFalse(NativeBucketEngine.tick(policy, session, addMinutes(t0, 39)).fire5MinWarning)
        val at40 = NativeBucketEngine.tick(policy, session, addMinutes(t0, 40))
        assertTrue(at40.fire5MinWarning)
        assertFalse(NativeBucketEngine.tick(policy, at40.session, addMinutes(t0, 41)).fire5MinWarning)
    }

    @Test
    fun `fire1MinWarning fires exactly once, at cap-1 to cap`() {
        val session = NativeBucketEngine.SessionState(gamesId, isoOf(t0), 0.0, false, true, false)
        assertFalse(NativeBucketEngine.tick(policy, session, addMinutes(t0, 43)).fire1MinWarning)
        assertTrue(NativeBucketEngine.tick(policy, session, addMinutes(t0, 44)).fire1MinWarning)
    }

    // --- one-time +3min grace finish ---

    @Test
    fun `requestGraceFinish extends the effective cap by GRACE_FINISH_MINUTES`() {
        val session = NativeBucketEngine.SessionState(gamesId, isoOf(t0), 0.0, false, false, false)
        val grace = NativeBucketEngine.requestGraceFinish(policy, session) as NativeBucketEngine.GraceFinishResult.Ok
        assertTrue(grace.session.graceUsed)
        assertEquals(3, NativeBucketEngine.GRACE_FINISH_MINUTES)
        assertFalse(NativeBucketEngine.tick(policy, grace.session, addMinutes(t0, 45)).mustEnd)
        assertTrue(NativeBucketEngine.tick(policy, grace.session, addMinutes(t0, 48)).mustEnd)
    }

    @Test
    fun `requestGraceFinish refuses a second time once already used`() {
        val session = NativeBucketEngine.SessionState(gamesId, isoOf(t0), 0.0, true, false, false)
        val result = NativeBucketEngine.requestGraceFinish(policy, session)
        assertTrue(result is NativeBucketEngine.GraceFinishResult.Refused)
        assertEquals("grace_already_used", (result as NativeBucketEngine.GraceFinishResult.Refused).reason)
    }

    @Test
    fun `requestGraceFinish refuses when the category has grace disabled`() {
        val session = NativeBucketEngine.SessionState(educationId, isoOf(t0), 0.0, false, false, false)
        val result = NativeBucketEngine.requestGraceFinish(policy, session)
        assertTrue(result is NativeBucketEngine.GraceFinishResult.Refused)
        assertEquals("grace_disabled", (result as NativeBucketEngine.GraceFinishResult.Refused).reason)
    }

    // --- category overrides fall back to the policy default ---

    @Test
    fun `a category with no perCategory entry uses policy default`() {
        val ok = NativeBucketEngine.startSession(policy, screenTime, freshDailyUsage(), null, 0.0, "unknown_category", t0, allowAll)
        assertTrue(ok is NativeBucketEngine.StartSessionResult.Ok)

        val capped = NativeBucketEngine.startSession(
            policy, screenTime, freshDailyUsage(perCategorySessionCount = mapOf("unknown_category" to 2)), null, 0.0, "unknown_category", t0, allowAll,
        )
        assertTrue(capped is NativeBucketEngine.StartSessionResult.Refused)
        assertEquals("session_count_cap_reached", (capped as NativeBucketEngine.StartSessionResult.Refused).reason)
    }

    // --- endSession folds elapsed into daily usage and opens the break ---

    @Test
    fun `endSession adds finalElapsed, increments session count, opens a mandatoryBreakMinutes break`() {
        val session = NativeBucketEngine.SessionState(gamesId, isoOf(t0), 44.0, false, true, true)
        val result = NativeBucketEngine.endSession(policy, freshDailyUsage(), session, addMinutes(t0, 45))
        assertEquals(45.0, result.updatedDailyUsage.totalMinutesUsed, 0.001)
        assertEquals(45.0, result.updatedDailyUsage.perCategoryMinutesUsed[gamesId]!!, 0.001)
        assertEquals(1, result.updatedDailyUsage.perCategorySessionCount[gamesId])
        assertEquals(gamesId, result.breakState.categoryId)
        assertEquals(15, result.breakState.requiredMinutes)
    }

    // --- refundMinutes is a floor-at-0 decrement ---

    @Test
    fun `refunding more than used never goes negative`() {
        val refunded = NativeBucketEngine.refundMinutes(
            freshDailyUsage(totalMinutesUsed = 5.0, perCategoryMinutesUsed = mapOf(gamesId to 5.0)), gamesId, 20.0,
        )
        assertEquals(0.0, refunded.totalMinutesUsed, 0.001)
        assertEquals(0.0, refunded.perCategoryMinutesUsed[gamesId]!!, 0.001)
    }

    private fun isoOf(epochMs: Long): String = NativeBucketEngine.isoOf(epochMs)
}
