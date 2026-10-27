package com.guardian.vpn

import android.content.Context
import android.content.pm.PackageManager
import android.provider.Settings
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/**
 * Layer 4 (spec §4): detects common VPN-bypass vectors and reports an unexpected VPN-disable as a
 * tamper signal (T02's `service_disabled` `EventType`).
 *
 * UNVERIFIED — this file cannot be compiled/run in this build environment (see SETUP.md).
 */
object BypassPrevention {

    // A small, known-list of package ids for popular VPN/proxy apps (not exhaustive — a real
    // deployment should periodically refresh this from a maintained source; this is the minimum
    // viable static list for this ticket's scope).
    private val KNOWN_VPN_PROXY_PACKAGES = setOf(
        "com.psiphon3",
        "org.torproject.torbrowser",
        "com.opera.browser", // built-in "free VPN" feature
        "com.nordvpn.android",
        "com.expressvpn.vpn",
        "com.proton.android.protonvpn",
        "com.surfshark.vpnclient.android",
    )

    /** Known public DoH/DoT resolver IPs (spec §4: "maintain a blocklist of public DoH resolver
     * IPs/hosts to also intercept at the TUN layer" — so a bypass attempt via a hardcoded
     * resolver IP is still caught even without parsing TLS SNI). `GuardianVpnService` should drop
     * TCP:443/853 connections whose destination is in this set. Documented, not exhaustive. */
    val KNOWN_DOH_DOT_IPS: Set<String> = setOf(
        "1.1.1.1", "1.0.0.1", // Cloudflare
        "8.8.8.8", "8.8.4.4", // Google
        "9.9.9.9", "149.112.112.112", // Quad9
        "94.140.14.14", "94.140.15.15", // AdGuard
    )

    fun detectInstalledVpnProxyApps(context: Context): List<String> {
        val pm = context.packageManager
        return KNOWN_VPN_PROXY_PACKAGES.filter { pkg ->
            try {
                pm.getPackageInfo(pkg, 0)
                true
            } catch (e: PackageManager.NameNotFoundException) {
                false
            }
        }
    }

    /** True if the device has a manual/private DNS override configured (Android 9+ Private DNS,
     * `Settings.Global.PRIVATE_DNS_MODE` = "hostname"), which could otherwise let DNS bypass this
     * VPN's own interception even while the VPN is active. */
    fun isPrivateDnsOverrideActive(context: Context): Boolean {
        val mode = Settings.Global.getString(context.contentResolver, "private_dns_mode")
        return mode == "hostname"
    }

    private fun nowIso(): String {
        val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        formatter.timeZone = TimeZone.getTimeZone("UTC")
        return formatter.format(Date())
    }

    /**
     * Emits a tamper `DeviceEvent`. T02's `EventType` enum has no dedicated "bypass attempt
     * detected while still running" variant — only `service_disabled` — so every bypass signal
     * this object detects (VPN service stopped unexpectedly, a competing VPN/proxy app found
     * installed, private DNS override enabled) is reported under that same existing type rather
     * than inventing a new one (same reconciled-against-existing-types pattern this repo already
     * uses elsewhere, e.g. T08's contentFilter-to-Feature mapping).
     */
    private fun emitTamperSignal() {
        VpnModule.emitTamperEvent(
            TamperDeviceEvent(id = UUID.randomUUID().toString(), type = "service_disabled", occurredAtIso = nowIso()),
        )
    }

    /**
     * Call from `GuardianVpnService.onDestroy()`/`onRevoke()` on every stop. Emits the tamper
     * signal unless `parentInitiated` is true. The actual gating for a real parent-initiated stop
     * happens in `GuardianVpnService` itself (its `expectedStop`/`revokedByUser` flags, set by
     * `VpnModule.stopVpn()` and `onRevoke()` respectively) — `GuardianVpnService` only calls this
     * function at all when it has already decided the stop counts as tamper, so `parentInitiated`
     * is always its default `false` today; kept as a parameter for a future caller that might want
     * to pass `true` directly instead of skipping the call.
     */
    fun onVpnStopped(context: Context, parentInitiated: Boolean = false) {
        if (parentInitiated) return
        emitTamperSignal()
    }

    /**
     * Call periodically while `GuardianVpnService` is running (see
     * `GuardianVpnService.runBypassCheckLoop`). Emits the tamper signal if a known VPN/proxy app
     * is installed or a private-DNS override is active — either lets DNS traffic bypass this
     * service's own interception, so both are treated as bypass attempts, not just an explicit
     * service stop. Returns true if a signal was emitted (useful for logging/tests).
     */
    fun checkForBypassAttempts(context: Context): Boolean {
        val bypassDetected = detectInstalledVpnProxyApps(context).isNotEmpty() || isPrivateDnsOverrideActive(context)
        if (bypassDetected) emitTamperSignal()
        return bypassDetected
    }
}

/** Minimal Kotlin-side mirror of the one field set this module needs to emit for T02's
 * `DeviceEvent` — the full event (with `deviceId`/`childId`, both only known JS-side) is
 * assembled by whatever listens for `VpnModule`'s `guardianTamperDetected` RN event. */
data class TamperDeviceEvent(val id: String, val type: String, val occurredAtIso: String)
