package com.guardian.deviceadmin

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import com.guardian.usage.UsageModule
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/**
 * Spec §3.7: "Uninstall protection (Device Admin)... instant parent alert on uninstall/disable
 * attempt... optional auto-lock device until restored."
 *
 * UNVERIFIED — this file cannot be compiled/run in this build environment (see SETUP.md).
 *
 * **Lifecycle-callback interpretation (documented reconciliation against Android's actual
 * `DeviceAdminReceiver` contract, same class of check T23 did for `onInterrupt`/`onUnbind`)**:
 * `onDisableRequested()` fires when the user attempts to turn admin off in Settings — Android
 * shows the string this method returns as a confirmation warning, so the attempt is still
 * preventable at this point; maps to `uninstall_attempt` (spec §3.3/§3.7's "attempt" wording).
 * `onDisabled()` fires only after the user confirms and admin is actually torn down — nothing
 * left to prevent at that point; maps to `service_disabled`, matching T22/T23's tamper-event
 * naming precedent for "the protection is now actually off."
 *
 * **Intentional two-way package reference**: this file calls into `com.guardian.usage.
 * UsageModule` (to emit tamper events), and `com.guardian.usage.UsageAccountant` separately
 * calls back into this file's companion `lockNow()`. Both packages compile together in the same
 * Gradle module (no multi-module split in this app), so a bidirectional reference between two
 * adjacent feature packages is ordinary Kotlin and not a build-order problem — noted here only
 * because it's easy to mistake for a design smell at a glance.
 */
class GuardianDeviceAdminReceiver : DeviceAdminReceiver() {

    override fun onDisableRequested(context: Context, intent: Intent): CharSequence {
        UsageModule.emitTamperEvent(
            id = UUID.randomUUID().toString(),
            type = "uninstall_attempt",
            occurredAtIso = nowIso(),
        )
        return "Turning this off removes Guardian's uninstall protection and screen-time enforcement."
    }

    override fun onDisabled(context: Context, intent: Intent) {
        UsageModule.emitTamperEvent(
            id = UUID.randomUUID().toString(),
            type = "service_disabled",
            occurredAtIso = nowIso(),
        )
    }

    companion object {
        fun componentName(context: Context): ComponentName =
            ComponentName(context, GuardianDeviceAdminReceiver::class.java)

        fun isActive(context: Context): Boolean {
            val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            return dpm.isAdminActive(componentName(context))
        }

        /**
         * Called both internally (by `UsageAccountant`'s driving loop when
         * `NativeBucketEngine.tick()` reports `mustEnd`) and via `UsageModule.lockDevice()`'s JS
         * bridge method (spec §6: a presence trigger whose `onTrigger` includes `lockScreen` is
         * a JS-side decision — T21 — that calls this through the bridge). No-ops (does not
         * throw) if admin isn't active — `lockNow()` requires it, and there is no way to force
         * activation without the user's one-time Settings consent flow, same class of
         * user-grantable gate as T23's `SYSTEM_ALERT_WINDOW` check.
         */
        fun lockNow(context: Context): Boolean {
            if (!isActive(context)) return false
            val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            dpm.lockNow()
            return true
        }

        private fun nowIso(): String {
            val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
            formatter.timeZone = TimeZone.getTimeZone("UTC")
            return formatter.format(Date())
        }
    }
}
