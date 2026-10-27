package com.guardian.accessibility

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.text.TextUtils
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * React Native bridge for Layer 3 (spec §4). Not in T23's literal file list — same "minimal
 * necessary addition" class as T22's `VpnPackage.kt`: without it, `GuardianAccessibilityService`
 * has no way to hand its detections to JS at all. Mirrors `VpnModule.kt`'s established pattern
 * exactly (companion-object `instance`, static `emitX` functions callable from other Kotlin
 * objects, `DeviceEventManagerModule.RCTDeviceEventEmitter` for JS-bound events).
 *
 * Reuses T22's `"guardianBlockAttempt"`/`"guardianTamperDetected"` RN event names for this
 * service's own block-attempt/tamper detections (both are semantically the same `EventType`,
 * `block_attempt`/`service_disabled`, just sourced from a different layer) — one JS listener
 * location can subscribe once per event name and branch on payload shape/source if needed,
 * rather than doubling the number of event names for no behavioral difference.
 *
 * UNVERIFIED — this file cannot be compiled/run in this build environment (see SETUP.md).
 */
class AccessibilityModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    init {
        instance = this
    }

    override fun getName(): String = "GuardianAccessibility"

    /** Lets JS check whether the user has this service turned on (spec §3.7: "alert if ...
     * accessibility service ... is turned off" needs a way to ask directly, not only rely on the
     * `service_disabled` tamper event firing after the fact — e.g. for an onboarding/settings
     * screen's live status display). */
    @ReactMethod
    fun isServiceEnabled(promise: Promise) {
        promise.resolve(isThisServiceEnabled(reactApplicationContext))
    }

    @ReactMethod
    fun openAccessibilitySettings(promise: Promise) {
        reactApplicationContext.startActivity(
            Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        promise.resolve(true)
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    companion object {
        @Volatile private var instance: AccessibilityModule? = null

        private fun isThisServiceEnabled(context: Context): Boolean {
            val expected = ComponentName(context, GuardianAccessibilityService::class.java).flattenToString()
            val enabledServices = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
            ) ?: return false
            val colonSplitter = TextUtils.SimpleStringSplitter(':')
            colonSplitter.setString(enabledServices)
            while (colonSplitter.hasNext()) {
                if (colonSplitter.next().equals(expected, ignoreCase = true)) return true
            }
            return false
        }

        /** Called by `GuardianAccessibilityService` on an `AdKeywords` match. */
        fun emitBlockAttempt(patternId: String, matchedText: String, packageName: String?) {
            val map = Arguments.createMap()
            map.putString("patternId", patternId)
            map.putString("matchedText", matchedText)
            if (packageName != null) map.putString("packageName", packageName)
            instance?.sendEvent("guardianBlockAttempt", map)
        }

        /** Called by `GuardianAccessibilityService` on a best-effort YouTube video capture.
         * Payload shape matches T18's contract exactly: `{title, url, watchedAt}`. */
        fun emitYouTubeView(title: String, url: String, watchedAtIso: String) {
            val map = Arguments.createMap()
            map.putString("title", title)
            map.putString("url", url)
            map.putString("watchedAt", watchedAtIso)
            instance?.sendEvent("guardianYouTubeView", map)
        }

        /** Called by `GuardianAccessibilityService.onUnbind()` — the accessibility half of spec
         * §3.7's tamper alert (VPN half: T22's `BypassPrevention`; Device Admin half: T24). */
        fun emitTamperEvent(event: TamperDeviceEvent) {
            val map = Arguments.createMap()
            map.putString("id", event.id)
            map.putString("type", event.type)
            map.putString("occurredAt", event.occurredAtIso)
            instance?.sendEvent("guardianTamperDetected", map)
        }

        /** Called periodically by `GuardianAccessibilityService`'s presence-tick loop. **Partial**
         * `PresenceSignalSample` (packages/domain/src/presence/types.ts) — only ever fills
         * `level0Idle`/`foregroundAppCategory`/`now`; `level1Still`/`level2FaceSamples` are not
         * this native layer's to supply (T24/T25). See LEDGER.md's T23 entry for the RISK note on
         * T21's `useLocalBucketEngine` not yet merging partial samples like this one. */
        fun emitPresenceTick(sample: PartialPresenceSample) {
            val map = Arguments.createMap()
            map.putBoolean("level0Idle", sample.level0Idle)
            map.putString("foregroundAppCategory", sample.foregroundAppCategory)
            map.putString("now", sample.now)
            instance?.sendEvent("guardianPresenceTick", map)
        }
    }
}

/** Minimal Kotlin-side mirror of the one field set this module needs to emit for T02's
 * `DeviceEvent` — the full event (with `deviceId`/`childId`, both only known JS-side) is
 * assembled by whatever listens for `AccessibilityModule`'s `guardianTamperDetected` RN event.
 * Same shape as `com.guardian.vpn.TamperDeviceEvent` (T22) — duplicated rather than shared across
 * the vpn/accessibility package boundary, matching this repo's precedent of small per-layer data
 * classes over a premature shared-module extraction. */
data class TamperDeviceEvent(val id: String, val type: String, val occurredAtIso: String)

/** Kotlin-side mirror of `PresenceSignalSample`'s partial-fill subset this service can actually
 * supply — see `emitPresenceTick`'s doc comment above. */
data class PartialPresenceSample(val level0Idle: Boolean, val foregroundAppCategory: String, val now: String)
