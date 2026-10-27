package com.guardian.usage

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.guardian.deviceadmin.GuardianDeviceAdminReceiver

/**
 * React Native bridge for Layer 4 usage accounting + lock enforcement (spec §3.7/§7). Mirrors
 * `VpnModule.kt`/`AccessibilityModule.kt`'s established pattern (companion-object `instance`,
 * static `emitX` functions, `DeviceEventManagerModule.RCTDeviceEventEmitter`). Reuses T22/T23's
 * `"guardianTamperDetected"` RN event name for this layer's own tamper detections (same
 * `EventType`s, `uninstall_attempt`/`service_disabled`, just a third source layer) — one JS
 * listener location can subscribe once and branch on payload shape/source if needed.
 *
 * UNVERIFIED — this file cannot be compiled/run in this build environment (see SETUP.md).
 */
class UsageModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    init {
        instance = this
    }

    override fun getName(): String = "GuardianUsage"

    /** Starts/stops `UsageAccountant`'s background enforcement loop — minimal necessary addition
     * beyond the ticket's literal 3-method list (same class as T22/T23's `VpnModule.startVpn`/
     * `GuardianAccessibilityService`'s own lifecycle): without a way to start it, the loop this
     * ticket requires never runs. Mirrors `VpnModule.startVpn`/`stopVpn`'s resolve-boolean shape. */
    @ReactMethod
    fun startTracking(promise: Promise) {
        UsageAccountant.startTracking(reactApplicationContext)
        promise.resolve(true)
    }

    @ReactMethod
    fun stopTracking(promise: Promise) {
        UsageAccountant.stopTracking()
        promise.resolve(true)
    }

    /** Requirement 3: `getUsageToday()`. Returns today's persisted `DailyUsageState` (native
     * loop's own running total — see `UsageAccountant`'s category-mapping RISK note; this is a
     * single global-per-device figure, not broken down by real content category). */
    @ReactMethod
    fun getUsageToday(promise: Promise) {
        val dailyUsage = UsageAccountant.peekDailyUsage(reactApplicationContext)
        val map = Arguments.createMap()
        map.putString("date", dailyUsage.date)
        map.putDouble("totalMinutesUsed", dailyUsage.totalMinutesUsed)
        promise.resolve(map)
    }

    /** Requirement 3: `lockDevice()` — spec §6's "a presence trigger whose `onTrigger` includes
     * `lockScreen`" is a JS-side decision (T21's `evaluatePresence`); this is the bridge call
     * that carries it out. Resolves `false` (does not reject) when Device Admin isn't active —
     * a user-grantable gate, not an error condition, same pattern as T23's overlay-permission
     * check. */
    @ReactMethod
    fun lockDevice(promise: Promise) {
        promise.resolve(GuardianDeviceAdminReceiver.lockNow(reactApplicationContext))
    }

    @ReactMethod
    fun isDeviceAdminActive(promise: Promise) {
        promise.resolve(GuardianDeviceAdminReceiver.isActive(reactApplicationContext))
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    companion object {
        @Volatile private var instance: UsageModule? = null

        /** Called by `GuardianDeviceAdminReceiver` on `onDisableRequested`/`onDisabled`. */
        fun emitTamperEvent(id: String, type: String, occurredAtIso: String) {
            val map = Arguments.createMap()
            map.putString("id", id)
            map.putString("type", type)
            map.putString("occurredAt", occurredAtIso)
            instance?.sendEvent("guardianTamperDetected", map)
        }

        /** Called by `UsageAccountant.pollOnce` when `NativeBucketEngine.tick()` reports
         * `fire5MinWarning`/`fire1MinWarning` — reviewer-flagged gap, fixed: these were computed
         * but previously discarded. `minutesRemaining` is 5 or 1, matching T21's JS-side
         * `show5MinWarning`/`show1MinWarning` naming intent. */
        fun emitSessionWarning(minutesRemaining: Int) {
            val map = Arguments.createMap()
            map.putInt("minutesRemaining", minutesRemaining)
            instance?.sendEvent("guardianSessionWarning", map)
        }
    }
}
