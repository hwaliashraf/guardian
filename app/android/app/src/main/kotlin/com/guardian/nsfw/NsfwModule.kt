package com.guardian.nsfw

import android.graphics.Bitmap
import android.net.Uri
import android.provider.MediaStore
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * React Native bridge for `NsfwClassifier` (Layer 2, spec §4). Reduced scope per Phase-0/
 * LEDGER.md decision: no bundled browser this pass, so there is no automatic in-page image
 * scanning to wire this into. **The integration point for this pass is a share-intent/manual
 * "scan this image" action** (e.g. the child or parent app registers as a share target for
 * images, or offers a "scan this image" button that resolves to a local `content://` URI) — or a
 * future browser-extension hook, neither of which exists yet in `app/src`. This module only
 * exposes the classification primitive; wiring a real share-intent/browser-extension entry point
 * to call it is a future ticket's scope.
 *
 * UNVERIFIED — this file cannot be compiled/run in this build environment, and no real
 * `.tflite` model file exists to classify against even if it could (see SETUP.md).
 */
class NsfwModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val classifier: NsfwClassifier by lazy { NsfwClassifier(reactApplicationContext) }

    override fun getName(): String = "GuardianNsfw"

    /** Classifies the image at `uri` (expected to be a local `content://`/`file://` URI already
     * resolvable on-device — no image is ever fetched over the network by this module). Runs off
     * the calling JS thread; never retains the decoded `Bitmap` past this call. */
    @ReactMethod
    fun classifyImageUri(uri: String, promise: Promise) {
        Thread {
            var bitmap: Bitmap? = null
            try {
                bitmap = MediaStore.Images.Media.getBitmap(reactApplicationContext.contentResolver, Uri.parse(uri))
                val score = classifier.classify(bitmap)
                val result = Arguments.createMap().apply {
                    putDouble("nsfwScore", score.toDouble())
                    putBoolean("blocked", score >= NsfwClassifier.DEFAULT_BLOCK_THRESHOLD)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("NSFW_CLASSIFY_FAILED", e)
            } finally {
                bitmap?.recycle()
            }
        }.start()
    }
}
