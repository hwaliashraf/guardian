package com.guardian.presence

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.SystemClock
import com.guardian.accessibility.ForegroundAppTracker
import kotlin.concurrent.thread
import kotlin.math.sqrt

/**
 * Level 1 (spec §6): accelerometer/gyroscope stillness-for-N-minutes detection. Emits the
 * `level1Still` boolean half of `PresenceSignalSample`
 * (`packages/domain/src/presence/types.ts`) into the shared presence bridge via `PresenceModule`.
 *
 * UNVERIFIED — this file cannot be compiled/run in this build environment (see SETUP.md).
 *
 * **Gating on "a game category is foreground" (Requirement 1's literal wording) — RISK, same
 * class as T23's/T24's already-flagged gap**: no real package-name -> content-category mapping
 * exists anywhere in this repo (confirmed by grep), so this monitor cannot know a real `'gaming'`
 * category id (`contentCategories.ts`) is foreground. It uses `ForegroundAppTracker.categoryFor`
 * (the same coarse 2-way heuristic T23 uses for `foregroundAppCategory`) inverted as the closest
 * available approximation: stillness detection runs whenever the foreground app is NOT the
 * `"video_streaming"` category, since sustained no-motion during video playback is expected and
 * legitimate (the same reasoning `evaluator.ts`'s `VIDEO_LIKE_CATEGORIES` gate already encodes for
 * Level 0), while sustained no-motion during any non-video app (games included) is the signal
 * Level 1 exists to catch. This is an approximation, not a real category match, until a real
 * package->category mapping exists (T16/T26 territory).
 *
 * **Threshold — RISK, same "no policy-sync bridge" class as T22's `GuardianVpnService.
 * updatePolicy`/T24's `UsageAccountant.updatePolicy`**: the real threshold is
 * `PresencePolicy.thresholdMinutes.level1`, parent-configured and synced from T08. This native
 * loop has no policy-sync mechanism in this ticket's scope, so `STILL_THRESHOLD_MS_PLACEHOLDER`
 * is a hardcoded placeholder (5 minutes, matching this repo's test fixtures) — `updateThreshold`
 * is provided for a future ticket to wire up, not new scope, matching existing precedent.
 */
class MotionMonitor(private val context: Context) : SensorEventListener {

    private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    private var tickThread: Thread? = null

    @Volatile private var lastSignificantMotionAtMs: Long = SystemClock.elapsedRealtime()

    fun start() {
        val manager = sensorManager ?: return
        manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let {
            manager.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL)
        }
        manager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)?.let {
            manager.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL)
        }
        lastSignificantMotionAtMs = SystemClock.elapsedRealtime()
        tickThread = thread(name = "GuardianMotionTick") {
            while (!Thread.currentThread().isInterrupted) {
                try {
                    emitLevel1Tick()
                } catch (e: Exception) {
                    // Best-effort — must never crash the monitor over one bad tick.
                }
                try {
                    Thread.sleep(TICK_INTERVAL_MS)
                } catch (e: InterruptedException) {
                    return@thread
                }
            }
        }
    }

    fun stop() {
        sensorManager?.unregisterListener(this)
        tickThread?.interrupt()
        tickThread = null
    }

    override fun onSensorChanged(event: SensorEvent) {
        val magnitude = sqrt(
            event.values[0] * event.values[0] +
                event.values[1] * event.values[1] +
                event.values[2] * event.values[2],
        )
        val motionDetected = when (event.sensor.type) {
            // Accelerometer includes gravity (~9.8 m/s^2 at rest) — compare deviation from that
            // baseline, not raw magnitude, so holding a still device doesn't register as motion.
            Sensor.TYPE_ACCELEROMETER -> kotlin.math.abs(magnitude - EARTH_GRAVITY) > ACCELEROMETER_MOTION_THRESHOLD
            Sensor.TYPE_GYROSCOPE -> magnitude > GYROSCOPE_MOTION_THRESHOLD
            else -> false
        }
        if (motionDetected) {
            lastSignificantMotionAtMs = SystemClock.elapsedRealtime()
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    private fun emitLevel1Tick() {
        val foregroundIsGameLike = ForegroundAppTracker.categoryFor(ForegroundAppTracker.currentPackageName) != "video_streaming"
        val stillMs = SystemClock.elapsedRealtime() - lastSignificantMotionAtMs
        val level1Still = foregroundIsGameLike && stillMs >= stillThresholdMsPlaceholder
        PresenceModule.emitLevel1Still(level1Still)
    }

    companion object {
        private const val TICK_INTERVAL_MS = 15_000L

        // Native-side placeholder only — see class doc comment for why this isn't the real
        // PresencePolicy.thresholdMinutes.level1.
        @Volatile private var stillThresholdMsPlaceholder = 5 * 60 * 1000L

        private const val EARTH_GRAVITY = 9.80665f // SensorManager.GRAVITY_EARTH's literal value
        private const val ACCELEROMETER_MOTION_THRESHOLD = 0.8f
        private const val GYROSCOPE_MOTION_THRESHOLD = 0.15f

        /** Called by `PresenceModule` whenever a fresh `PresencePolicy.thresholdMinutes.level1`
         * snapshot is available locally — not wired to any real sync bridge in this ticket's
         * scope (see class doc comment's RISK note). */
        fun updateThreshold(minutes: Double) {
            stillThresholdMsPlaceholder = (minutes * 60_000).toLong()
        }
    }
}
