package com.guardian.presence

import android.content.Intent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * React Native bridge for T25's Level 1 (`MotionMonitor`) + Level 2 (`CameraPresenceService`)
 * presence signals. Not in the ticket's literal file-4 list beyond "RN bridge wiring" — mirrors
 * `VpnModule`/`AccessibilityModule`'s established pattern exactly (companion-object `instance`,
 * static `emitX` functions callable from other Kotlin classes,
 * `DeviceEventManagerModule.RCTDeviceEventEmitter` for JS-bound events).
 *
 * **Reuses T23's `"guardianPresenceTick"` event name** (not a new event name) — same reasoning
 * T22/T23 already used for `guardianBlockAttempt`/`guardianTamperDetected`: one JS listener
 * location can subscribe once and merge whichever fields a given tick actually carries, rather
 * than doubling the number of event names for what is semantically the same partial
 * `PresenceSignalSample` (`packages/domain/src/presence/types.ts`). This module's emissions are
 * **also partial** — `emitLevel1Still` only ever carries `level1Still`; `emitLevel2FaceSamples`
 * only ever carries `level2FaceSamples`/`now` — exactly as partial as T23's own
 * `level0Idle`/`foregroundAppCategory`/`now`-only emission.
 *
 * **RISK carried forward, unresolved (see LEDGER.md's T23 entry and this ticket's own report)**:
 * T21's `useLocalBucketEngine.ts` still has zero `NativeEventEmitter`/`DeviceEventEmitter`
 * subscriptions (confirmed by grep) and T24 did not resolve this either (it added its own new
 * unconsumed `guardianSessionWarning` event, same gap class) — so this module's
 * `guardianPresenceTick` emissions, like T23's, are consumed by nobody today. This ticket's own
 * scope (the native module + its bridge) is complete regardless — the gap is purely in a
 * downstream JS consumer this ticket doesn't own, same call T23 and T24 both already made.
 *
 * UNVERIFIED — this file cannot be compiled/run in this build environment (see SETUP.md).
 */
class PresenceModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    init {
        instance = this
    }

    override fun getName(): String = "GuardianPresence"

    private var motionMonitor: MotionMonitor? = null

    @ReactMethod
    fun startMotionMonitor(promise: Promise) {
        if (motionMonitor == null) {
            motionMonitor = MotionMonitor(reactApplicationContext).also { it.start() }
        }
        promise.resolve(true)
    }

    @ReactMethod
    fun stopMotionMonitor(promise: Promise) {
        motionMonitor?.stop()
        motionMonitor = null
        promise.resolve(true)
    }

    /** Fails closed exactly like `CameraPresenceService.onStartCommand`'s own gate — rejecting
     * here (rather than only relying on the service's internal check) lets JS surface a clear
     * reason to the user instead of a silent no-op service start/stop. */
    @ReactMethod
    fun startCameraPresence(promise: Promise) {
        val context = reactApplicationContext
        if (!PresencePolicyGate.level2Enabled) {
            promise.reject("LEVEL2_DISABLED", "Camera presence check is disabled by policy")
            return
        }
        if (!CameraOptIn.isOptedIn(context)) {
            promise.reject("CAMERA_OPT_IN_REQUIRED", "Camera presence check requires on-device opt-in first")
            return
        }
        context.startService(Intent(context, CameraPresenceService::class.java))
        promise.resolve(true)
    }

    @ReactMethod
    fun stopCameraPresence(promise: Promise) {
        val context = reactApplicationContext
        context.stopService(Intent(context, CameraPresenceService::class.java))
        promise.resolve(true)
    }

    @ReactMethod
    fun isCameraOptedIn(promise: Promise) {
        promise.resolve(CameraOptIn.isOptedIn(reactApplicationContext))
    }

    /** RISK — no camera opt-in screen exists anywhere in `app/src/child` today (confirmed by
     * grep). This method exists so a future screen can call it; until one does, this flag can
     * only be flipped by a human calling this bridge method directly. */
    @ReactMethod
    fun setCameraOptIn(optedIn: Boolean, promise: Promise) {
        CameraOptIn.setOptedIn(reactApplicationContext, optedIn)
        promise.resolve(true)
    }

    /** Called by JS whenever a fresh `PresencePolicy` snapshot is available locally (synced from
     * T08) — not wired to any real sync bridge in this ticket's scope, see `PresencePolicyGate`'s
     * and `MotionMonitor`'s RISK notes. Provided for a future ticket to wire up. */
    @ReactMethod
    fun updatePolicy(level2Enabled: Boolean, level2IntervalMinutes: Double, level1ThresholdMinutes: Double, promise: Promise) {
        PresencePolicyGate.updatePolicy(level2Enabled, level2IntervalMinutes)
        MotionMonitor.updateThreshold(level1ThresholdMinutes)
        promise.resolve(true)
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    companion object {
        @Volatile private var instance: PresenceModule? = null

        private fun nowIso(): String {
            val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
            formatter.timeZone = TimeZone.getTimeZone("UTC")
            return formatter.format(Date())
        }

        /** Called by `MotionMonitor`'s tick loop. Partial `PresenceSignalSample` — only ever
         * carries `level1Still`. */
        fun emitLevel1Still(level1Still: Boolean) {
            val map = Arguments.createMap()
            map.putBoolean("level1Still", level1Still)
            instance?.sendEvent("guardianPresenceTick", map)
        }

        /** Called by `CameraPresenceService` after each successful face-detection tick. Partial
         * `PresenceSignalSample` — only ever carries `level2FaceSamples`/`now`. Never carries a
         * frame/image, only the boolean rolling window. */
        fun emitLevel2FaceSamples(samples: List<Boolean>) {
            val array: WritableArray = Arguments.createArray()
            samples.forEach { array.pushBoolean(it) }
            val map = Arguments.createMap()
            map.putArray("level2FaceSamples", array)
            map.putString("now", nowIso())
            instance?.sendEvent("guardianPresenceTick", map)
        }
    }
}
