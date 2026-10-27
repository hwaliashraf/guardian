package com.guardian.accessibility

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.TextView

/**
 * Layer 3 (spec §4): "the screen is covered with a block overlay." System-alert-window overlay
 * shown by `GuardianAccessibilityService` on an `AdKeywords` match.
 *
 * UNVERIFIED — this file cannot be compiled/run in this build environment (see SETUP.md).
 */
object BlockOverlayView {

    private const val AUTO_HIDE_TIMEOUT_MS = 8_000L

    private var overlayView: View? = null
    private var windowManager: WindowManager? = null
    private var hideHandler: Handler? = null

    /**
     * No-op (does not throw, does not silently pretend it succeeded) if `SYSTEM_ALERT_WINDOW`
     * hasn't been granted — this is a user-grantable app-op (`Settings.ACTION_MANAGE_OVERLAY_
     * PERMISSION`), not something this service can force. The `block_attempt` `DeviceEvent` is
     * still emitted by the caller regardless of whether the visual overlay actually rendered:
     * detection and enforcement are deliberately decoupled, so a parent still sees the attempt
     * logged even without the grant. Building the one-time consent-request flow (analogous to
     * `VpnService.prepare()`'s pattern) is out of this ticket's scope — flagged as a follow-up,
     * not silently left unmentioned.
     */
    fun show(context: Context, message: String) {
        if (!Settings.canDrawOverlays(context)) return
        if (overlayView != null) return // already showing — avoid stacking duplicate views

        val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val overlayType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_SYSTEM_ALERT
        }
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            overlayType,
            // Deliberately no FLAG_NOT_TOUCHABLE/FLAG_NOT_FOCUSABLE — the overlay must actually
            // block interaction with the content underneath, not just visually cover it.
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        )
        val view = TextView(context).apply {
            text = "This content was blocked.\n$message"
            setBackgroundColor(Color.BLACK)
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            textSize = 20f
        }
        wm.addView(view, params)
        windowManager = wm
        overlayView = view
        // Safety net: primary dismissal is `GuardianAccessibilityService` calling hide() on the
        // next foreground-package change away from the offending app; this timeout exists in
        // case that window-state transition never fires (e.g. the offending app force-closes),
        // so the overlay can never get permanently stuck covering the screen.
        hideHandler = Handler(Looper.getMainLooper()).also {
            it.postDelayed({ hide() }, AUTO_HIDE_TIMEOUT_MS)
        }
    }

    fun hide() {
        hideHandler?.removeCallbacksAndMessages(null)
        try {
            overlayView?.let { windowManager?.removeView(it) }
        } catch (e: IllegalArgumentException) {
            // View already detached (e.g. hide() raced with a system-driven teardown) — nothing
            // left to remove, not an error condition worth surfacing.
        }
        overlayView = null
        windowManager = null
        hideHandler = null
    }
}
