package com.guardian.presence

/**
 * In-memory `PresencePolicy` (spec §6) snapshot this native layer needs to gate/pace Level 2.
 * **RISK — no policy-sync bridge into this native loop, same already-accepted class of gap as
 * T22's `GuardianVpnService.updatePolicy()`/T24's `UsageAccountant.updatePolicy()`** (confirmed by
 * reading both — neither exposes a real sync path from T08 either): `level2Enabled` defaults to
 * `false` (fail-closed — camera surveillance must never be on by default) and
 * `level2IntervalMinutes` is a hardcoded placeholder, not the real parent-configured value.
 * `updatePolicy` is provided for a future ticket to wire up, not new scope, matching existing
 * precedent.
 */
object PresencePolicyGate {
    @Volatile var level2Enabled: Boolean = false
        private set

    // Native-side placeholder only (matches this repo's test-fixture threshold value of 5) —
    // ticket's literal Requirement 2 reuses PresencePolicy.thresholdMinutes.level2 as both the
    // camera sampling cadence and (JS-side, T04) the Level-2 trigger threshold.
    @Volatile var level2IntervalMinutes: Double = 5.0
        private set

    val level2IntervalMs: Long get() = (level2IntervalMinutes * 60_000).toLong()

    fun updatePolicy(level2Enabled: Boolean, level2IntervalMinutes: Double) {
        this.level2Enabled = level2Enabled
        this.level2IntervalMinutes = level2IntervalMinutes
    }
}
