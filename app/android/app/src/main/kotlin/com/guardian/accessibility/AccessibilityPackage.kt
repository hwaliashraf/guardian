package com.guardian.accessibility

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Registers `AccessibilityModule` with React Native. Not in T23's literal file list, same
 * "minimal necessary addition" as T22's `VpnPackage.kt` — without it `AccessibilityModule` is
 * unreachable dead code. Added to `MainApplication.kt`'s manual package list (autolinking doesn't
 * apply — this isn't a separate npm package).
 *
 * UNVERIFIED — this file cannot be compiled/run in this build environment (see SETUP.md).
 */
class AccessibilityPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(AccessibilityModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
