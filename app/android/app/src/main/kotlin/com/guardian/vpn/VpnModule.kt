package com.guardian.vpn

import android.content.Intent
import android.net.VpnService
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * React Native bridge for Layer 1 (spec §4). Exposes `startVpn`/`stopVpn`/`isActive`/
 * `refreshBlocklist` to JS and emits RN events for block-attempt and tamper signals so the
 * app/'s TypeScript side can turn them into real `DeviceEvent`s (T02 shape) and post them through
 * T09's `event-ingest` the same way every other device-originated event does.
 *
 * UNVERIFIED — this file cannot be compiled/run in this build environment (see SETUP.md).
 */
class VpnModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    init {
        instance = this
    }

    override fun getName(): String = "GuardianVpn"

    /** JS must first launch the `Intent` from `VpnService.prepare()` (via
     * `startActivityForResult`) if the user hasn't already granted VPN permission — this method
     * only starts the service once that permission is already in place, rejecting otherwise so
     * JS can react (show the system consent dialog) instead of silently no-op-ing. */
    @ReactMethod
    fun startVpn(promise: Promise) {
        val context = reactApplicationContext
        val prepareIntent = VpnService.prepare(context)
        if (prepareIntent != null) {
            promise.reject("VPN_PERMISSION_REQUIRED", "VpnService.prepare() returned a consent intent")
            return
        }
        GuardianVpnService.expectedStop = false
        context.startService(Intent(context, GuardianVpnService::class.java))
        BlocklistRefreshWorker.schedule(context) // Requirement 2: idempotent (KEEP policy) — safe every start
        promise.resolve(true)
    }

    @ReactMethod
    fun stopVpn(promise: Promise) {
        val context = reactApplicationContext
        GuardianVpnService.expectedStop = true
        context.stopService(Intent(context, GuardianVpnService::class.java))
        promise.resolve(true)
    }

    @ReactMethod
    fun isActive(promise: Promise) {
        promise.resolve(GuardianVpnService.isRunning)
    }

    @ReactMethod
    fun refreshBlocklist(promise: Promise) {
        Thread {
            try {
                val count = BlocklistLoader.refresh(reactApplicationContext)
                promise.resolve(count)
            } catch (e: Exception) {
                promise.reject("BLOCKLIST_REFRESH_FAILED", e)
            }
        }.start()
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    companion object {
        @Volatile private var instance: VpnModule? = null

        /** Called by `GuardianVpnService`'s packet loop on every blocked query — emits a
         * `block_attempt`-shaped RN event (T02's `EventType`). No-op if the RN bridge isn't
         * currently attached (module not yet initialized). */
        fun emitBlockAttempt(domain: String, category: String?) {
            val map = Arguments.createMap()
            map.putString("domain", domain)
            if (category != null) map.putString("category", category)
            instance?.sendEvent("guardianBlockAttempt", map)
        }

        /** Called by `BypassPrevention` when the VPN stops outside parent action. */
        fun emitTamperEvent(event: TamperDeviceEvent) {
            val map = Arguments.createMap()
            map.putString("id", event.id)
            map.putString("type", event.type)
            map.putString("occurredAt", event.occurredAtIso)
            instance?.sendEvent("guardianTamperDetected", map)
        }
    }
}
