package com.guardian.usage

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * React Native bridge for `UsageAccountant.getInstalledApps` — Requirement 3, and the real
 * producer T16's `useInstalledApps` hook documented as its future swap-in (its static 7-app
 * fixture stays until a device/emulator is actually paired against this bridge — see SETUP.md).
 *
 * UNVERIFIED — this file cannot be compiled/run in this build environment (see SETUP.md).
 */
class InstalledAppsModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    init {
        instance = this
    }

    override fun getName(): String = "GuardianInstalledApps"

    @ReactMethod
    fun getInstalledApps(promise: Promise) {
        val apps = UsageAccountant.getInstalledApps(reactApplicationContext)
        val array: WritableArray = Arguments.createArray()
        for (app in apps) {
            val map = Arguments.createMap()
            map.putString("appId", app.appId)
            map.putString("name", app.name)
            if (app.storeRating != null) map.putString("storeRating", app.storeRating) else map.putNull("storeRating")
            array.pushMap(map)
        }
        promise.resolve(array)
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    companion object {
        @Volatile private var instance: InstalledAppsModule? = null

        /** Called by `PackageAddedReceiver` on `ACTION_PACKAGE_ADDED`. Payload matches T16's
         * `new_install` `DeviceEvent.payload` contract exactly: `{appId, name, storeRating}`,
         * identical to `InstalledApp` (see `packages/domain/src/types.ts`). */
        fun emitNewInstall(appId: String, name: String, storeRating: String?) {
            val map = Arguments.createMap()
            map.putString("appId", appId)
            map.putString("name", name)
            if (storeRating != null) map.putString("storeRating", storeRating) else map.putNull("storeRating")
            instance?.sendEvent("guardianNewInstall", map)
        }
    }
}
