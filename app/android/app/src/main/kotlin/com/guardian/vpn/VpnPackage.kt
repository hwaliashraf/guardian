package com.guardian.vpn

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Registers `VpnModule` with React Native. Not explicitly listed in T22's Requirements, but
 * without it `VpnModule` is unreachable dead code — the minimal necessary completion to make
 * `VpnModule.startVpn()`/etc. actually callable from JS (same class of "minimal necessary
 * addition" precedent as this project's other tickets). Added to `MainApplication.kt`'s manual
 * package list (autolinking doesn't apply — this isn't a separate npm package).
 *
 * UNVERIFIED — this file cannot be compiled/run in this build environment (see SETUP.md).
 */
class VpnPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(VpnModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
