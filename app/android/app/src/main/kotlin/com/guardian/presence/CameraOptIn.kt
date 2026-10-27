package com.guardian.presence

import android.content.Context
import android.content.SharedPreferences

/**
 * On-device "camera opt-in" flag (spec §6, T25 Requirement 2): `CameraPresenceService` must only
 * ever start if this flag has been explicitly set, in addition to the parent-configured
 * `level2Enabled` policy bit. Flat `SharedPreferences` — same avoid-Room/KSP rationale as T24's
 * `SessionStore`/T22's `BlocklistLoader` (no annotation-processor Gradle setup this environment
 * can verify compiles).
 *
 * **RISK**: no screen in `app/src/child` sets this flag today (confirmed by grep — zero
 * opt-in/setup-flow matches anywhere in the child app). This ticket's scope is the native module,
 * not new RN screens (ticket's explicit "Out of scope"), so `setOptedIn`/`isOptedIn` are exposed
 * via `PresenceModule`'s RN bridge for a future T21 (or later) screen to call — until one exists,
 * this flag can only ever be flipped by a human calling the bridge method directly (e.g. via a
 * debug menu), never through a real parent/child-facing UI.
 */
object CameraOptIn {
    private const val PREFS_NAME = "guardian_presence_optin"
    private const val KEY_CAMERA_OPT_IN = "camera_opt_in"

    @Volatile private var prefs: SharedPreferences? = null

    private fun requirePrefs(context: Context): SharedPreferences =
        prefs ?: context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).also { prefs = it }

    fun isOptedIn(context: Context): Boolean = requirePrefs(context).getBoolean(KEY_CAMERA_OPT_IN, false)

    fun setOptedIn(context: Context, optedIn: Boolean) {
        requirePrefs(context).edit().putBoolean(KEY_CAMERA_OPT_IN, optedIn).apply()
    }
}
