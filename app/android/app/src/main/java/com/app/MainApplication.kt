package com.app

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.guardian.accessibility.AccessibilityPackage
import com.guardian.nsfw.NsfwPackage
import com.guardian.presence.PresencePackage
import com.guardian.usage.UsagePackage
import com.guardian.vpn.VpnPackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
          add(VpnPackage()) // T22: Layer-1 VPN DNS filter bridge (com.guardian.vpn)
          add(AccessibilityPackage()) // T23: AccessibilityService bridge (com.guardian.accessibility)
          add(UsagePackage()) // T24: Device Admin/UsageStats bridge (com.guardian.usage)
          add(PresencePackage()) // T25: Motion/CameraX presence bridge (com.guardian.presence)
          add(NsfwPackage()) // T25: TFLite NSFW classifier bridge (com.guardian.nsfw)
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
