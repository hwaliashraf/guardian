package com.guardian.nsfw

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Registers `NsfwModule` with React Native. Not in T25's literal file list — same "minimal
 * necessary addition" class as T22/T23/T24/T25's other RN-`Package` files: without it,
 * `NsfwModule` is unreachable dead code. Added to `MainApplication.kt`'s manual package list
 * (autolinking doesn't apply — this isn't a separate npm package).
 *
 * UNVERIFIED — this file cannot be compiled/run in this build environment (see SETUP.md).
 */
class NsfwPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(NsfwModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
