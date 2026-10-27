package com.guardian.presence

import java.util.Collections

/**
 * Small rolling window of `CameraPresenceService`'s per-tick face-detected booleans, feeding
 * `PresenceSignalSample.level2FaceSamples` (`packages/domain/src/presence/types.ts`).
 * `evaluatePresence`'s `isLevel2Triggered` only ever looks at the last two entries, so this window
 * only needs to retain a handful — bounded so it can never grow unbounded across a long-running
 * service lifetime. Holds booleans only — never a frame, `Bitmap`, or any other camera data.
 */
object FaceWindow {
    private const val MAX_SIZE = 10
    private val samples = Collections.synchronizedList(mutableListOf<Boolean>())

    fun append(faceDetected: Boolean) {
        synchronized(samples) {
            samples.add(faceDetected)
            while (samples.size > MAX_SIZE) samples.removeAt(0)
        }
    }

    fun snapshot(): List<Boolean> = synchronized(samples) { samples.toList() }

    fun clear() = synchronized(samples) { samples.clear() }
}
