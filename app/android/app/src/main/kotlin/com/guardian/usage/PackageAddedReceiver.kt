package com.guardian.usage

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager

/**
 * Spec §3.3: "New-app-install alerts to the parent." Feeds T16's `InstallAlertsScreen` (already
 * built) via the `new_install` `DeviceEvent.payload` contract T16 set: `{appId, name,
 * storeRating}` — identical to `InstalledApp`. Manifest-registered (not dynamically registered):
 * `ACTION_PACKAGE_ADDED` is one of the broadcasts explicitly exempted from Android 8+'s
 * implicit-broadcast restrictions, so a manifest `<receiver>` still works.
 *
 * UNVERIFIED — this file cannot be compiled/run in this build environment (see SETUP.md).
 */
class PackageAddedReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_PACKAGE_ADDED) return
        // Android fires ACTION_PACKAGE_ADDED again for every update/reinstall of an app the user
        // already had — EXTRA_REPLACING distinguishes "genuinely new install" from "update to an
        // existing app," and only the former is a spec §3.3 "new install" the parent should be
        // alerted about.
        if (intent.getBooleanExtra(Intent.EXTRA_REPLACING, false)) return

        val packageName = intent.data?.schemeSpecificPart ?: return
        val pm = context.packageManager
        val appInfo = try {
            pm.getApplicationInfo(packageName, 0)
        } catch (e: PackageManager.NameNotFoundException) {
            return // app already uninstalled again before this receiver ran — nothing to report
        }
        val name = pm.getApplicationLabel(appInfo).toString()
        // Same best-effort limitation as UsageAccountant.getInstalledApps — see its RISK note.
        InstalledAppsModule.emitNewInstall(appId = packageName, name = name, storeRating = null)
    }
}
