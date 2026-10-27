package com.guardian.usage

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Registers `InstalledAppsModule` + `UsageModule` with React Native. Not in the ticket's literal
 * file list — same "minimal necessary addition" class as T22's `VpnPackage.kt`/T23's
 * `AccessibilityPackage.kt`: without it, neither bridge module is reachable from JS. One package
 * for both modules (rather than two) since they're the same feature area (usage
 * accounting/enforcement) and `ReactPackage.createNativeModules` already returns a list.
 *
 * UNVERIFIED — this file cannot be compiled/run in this build environment (see SETUP.md).
 */
class UsagePackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(InstalledAppsModule(reactContext), UsageModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
