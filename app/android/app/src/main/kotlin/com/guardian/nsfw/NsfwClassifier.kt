package com.guardian.nsfw

import android.content.Context
import android.graphics.Bitmap
import org.tensorflow.lite.Interpreter
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel

/**
 * Layer 2 (spec §4/§2.2): TFLite `Interpreter` wrapper around an on-device NSFW image classifier,
 * targeting the spec's <50ms/image KPI. **No model file ships in this repo** — a real
 * `.tflite` binary is out of this ticket's scope (cannot be downloaded/trained in this
 * environment, and this ticket must not fabricate a fake/placeholder model file). See
 * `SETUP.md`'s "TFLite NSFW model" section for the exact sourcing step and expected path
 * (`app/android/app/src/main/assets/nsfw_classifier.tflite`).
 *
 * **Input/output contract — documented as constants below, matching the specific open-source
 * conversion `SETUP.md` names** (GantMan/nsfw_model's `mobilenet_v2_140_224` TFLite export,
 * per spec §2.2's "open NSFW models" pointer): 224x224 RGB input, normalized to `[0, 1]` float32
 * (not `[-1, 1]` or raw `[0, 255]` — that model's own documented preprocessing), 5-class softmax
 * output in the fixed order `[drawings, hentai, neutral, porn, sexy]`. **If a human sources a
 * different open NSFW TFLite conversion, these constants (and `OUTPUT_CLASS_ORDER`'s
 * interpretation in `classify()`) must be updated to match that model's actual documented
 * contract — this file cannot self-detect a mismatched model's shape/normalization/class order.**
 *
 * UNVERIFIED — this file cannot be compiled/run in this build environment (no JVM/Gradle, and no
 * real model file exists to load even if it could — see SETUP.md).
 */
class NsfwClassifier(context: Context) {

    private val interpreter: Interpreter by lazy {
        Interpreter(loadModelFile(context), Interpreter.Options().apply { setNumThreads(NUM_THREADS) })
    }

    /**
     * Returns an NSFW score in `[0, 1]` (higher = more likely NSFW). Never retains `bitmap` or any
     * derived buffer past this call — `inputBuffer` is a local, GC-eligible the moment this
     * function returns.
     */
    fun classify(bitmap: Bitmap): Float {
        val resized = Bitmap.createScaledBitmap(bitmap, INPUT_SIZE, INPUT_SIZE, true)
        try {
            val inputBuffer = bitmapToInputBuffer(resized)
            val output = Array(1) { FloatArray(OUTPUT_CLASS_ORDER.size) }
            interpreter.run(inputBuffer, output)

            // NSFW score: sum of the non-benign classes' probabilities. `drawings`/`neutral` are
            // benign (cartoon/SFW content); `hentai`/`porn`/`sexy` are the classes spec §6's
            // content filter cares about — matches this model's documented class semantics
            // exactly.
            return NSFW_CLASS_INDICES.sumOf { output[0][it].toDouble() }.toFloat()
        } finally {
            // `createScaledBitmap` returns `bitmap` itself (not a copy) when it's already
            // INPUT_SIZE x INPUT_SIZE — must not recycle it in that case, the caller (NsfwModule)
            // owns and recycles the original `bitmap` separately.
            if (resized !== bitmap) resized.recycle()
        }
    }

    private fun bitmapToInputBuffer(bitmap: Bitmap): ByteBuffer {
        val buffer = ByteBuffer.allocateDirect(4 * INPUT_SIZE * INPUT_SIZE * INPUT_CHANNELS)
        buffer.order(ByteOrder.nativeOrder())
        val pixels = IntArray(INPUT_SIZE * INPUT_SIZE)
        bitmap.getPixels(pixels, 0, INPUT_SIZE, 0, 0, INPUT_SIZE, INPUT_SIZE)
        for (pixel in pixels) {
            buffer.putFloat(((pixel shr 16) and 0xFF) / 255.0f) // R
            buffer.putFloat(((pixel shr 8) and 0xFF) / 255.0f) // G
            buffer.putFloat((pixel and 0xFF) / 255.0f) // B
        }
        buffer.rewind()
        return buffer
    }

    private fun loadModelFile(context: Context): MappedByteBuffer {
        val assetFileDescriptor = context.assets.openFd(MODEL_ASSET_PATH)
        FileInputStream(assetFileDescriptor.fileDescriptor).use { inputStream ->
            val channel = inputStream.channel
            return channel.map(
                FileChannel.MapMode.READ_ONLY,
                assetFileDescriptor.startOffset,
                assetFileDescriptor.declaredLength,
            )
        }
    }

    companion object {
        const val MODEL_ASSET_PATH = "nsfw_classifier.tflite"
        const val INPUT_SIZE = 224
        const val INPUT_CHANNELS = 3
        private const val NUM_THREADS = 2

        // Fixed class order this model's TFLite export documents — see class doc comment.
        val OUTPUT_CLASS_ORDER = listOf("drawings", "hentai", "neutral", "porn", "sexy")
        private val NSFW_CLASS_INDICES = listOf(
            OUTPUT_CLASS_ORDER.indexOf("hentai"),
            OUTPUT_CLASS_ORDER.indexOf("porn"),
            OUTPUT_CLASS_ORDER.indexOf("sexy"),
        )

        // Spec §6/§4 policy default — content filter's "blocked" cutoff; a production build may
        // want this parent-configurable rather than hardcoded (same class as T22's hardcoded
        // upstream DNS resolver, documented not hidden).
        const val DEFAULT_BLOCK_THRESHOLD = 0.7f
    }
}
