package com.guardian.presence

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.concurrent.thread

/**
 * Level 2 (spec §6): periodic front-camera presence check. Foreground service
 * (`foregroundServiceType="camera"`, Play Store requirement per spec §8) that wakes every N
 * minutes (`PresencePolicyGate.level2IntervalMs`), samples the front camera for a single frame
 * (~1s per spec's literal framing), runs ML Kit `FaceDetector` on that one frame, and immediately
 * discards it. Appends the boolean result to `FaceWindow`, feeding `PresenceSignalSample.
 * level2FaceSamples` (`packages/domain/src/presence/types.ts`).
 *
 * **Privacy guardrail checklist (spec §6, restated as literal code-level facts)**:
 * 1. Boolean-only result persisted/logged: `FaceWindow.append(Boolean)` (see that file) is the
 *    only state this service retains across ticks — no `Bitmap`/`ImageProxy`/`InputImage`/media
 *    field is ever stored on this class or anywhere else; `onFrame()` keeps every such reference
 *    local to itself and closes the buffer (`imageProxy.close()`) once detection completes.
 * 2. No network call ever made with camera data: this file makes zero network calls of any kind
 *    (confirm by inspection — no `HttpURLConnection`/`OkHttp`/`fetch` usage anywhere below).
 * 3. Persistent notification shown while running: `buildForegroundNotification()` /
 *    `setOngoing(true)`, built and shown before any camera bind happens.
 * 4. Feature gated off unless `PresencePolicyGate.level2Enabled` AND `CameraOptIn.isOptedIn` are
 *    both true — checked in `onStartCommand` BEFORE `startForeground`/any camera bind, fails
 *    closed (stops itself, never shows the notification or touches the camera, if either is
 *    false).
 *
 * UNVERIFIED — this file cannot be compiled/run in this build environment (see SETUP.md).
 */
class CameraPresenceService : Service(), LifecycleOwner {

    private val lifecycleRegistry = LifecycleRegistry(this)
    override val lifecycle: Lifecycle get() = lifecycleRegistry

    private var cameraExecutor: ExecutorService? = null
    private var tickThread: Thread? = null

    @Volatile private var running = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        lifecycleRegistry.currentState = Lifecycle.State.CREATED
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Fail-closed gate (privacy checklist item 4) — checked before startForeground/camera
        // bind. Neither the notification nor the camera is ever touched if this fails.
        if (!PresencePolicyGate.level2Enabled || !CameraOptIn.isOptedIn(applicationContext)) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (running) return START_STICKY

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, buildForegroundNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA)
        } else {
            startForeground(NOTIFICATION_ID, buildForegroundNotification())
        }
        lifecycleRegistry.currentState = Lifecycle.State.STARTED
        lifecycleRegistry.currentState = Lifecycle.State.RESUMED
        cameraExecutor = Executors.newSingleThreadExecutor()
        running = true
        startTickLoop()
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        tickThread?.interrupt()
        cameraExecutor?.shutdown()
        lifecycleRegistry.currentState = Lifecycle.State.DESTROYED
        super.onDestroy()
    }

    private fun startTickLoop() {
        tickThread = thread(name = "GuardianCameraPresenceTick") {
            while (!Thread.currentThread().isInterrupted && running) {
                try {
                    capture()
                } catch (e: Exception) {
                    // Best-effort — a single failed sample must never crash the service; the
                    // rolling window simply doesn't get an entry for this tick.
                }
                try {
                    Thread.sleep(PresencePolicyGate.level2IntervalMs)
                } catch (e: InterruptedException) {
                    return@thread
                }
            }
        }
    }

    /**
     * Binds the front camera, captures exactly one frame, then unbinds — the camera is never left
     * active between ticks (spec's "~1 second every N minutes" framing).
     *
     * **`bindToLifecycle`/`unbindAll` are `@MainThread`-only (CameraX's own documented
     * contract)** — calling them off the main thread throws (caught below and silently treated as
     * "skip this tick", which would otherwise make every single tick silently fail — reviewer
     * caught this on first pass). `providerFuture.addListener` and the analyzer's `unbindAll` call
     * are therefore both dispatched via `mainExecutor` (`ContextCompat.getMainExecutor`), not
     * `cameraExecutor`. Frame *processing* (`onFrame`/ML Kit) still runs on `cameraExecutor` (the
     * analyzer's own callback thread) — only the CameraX lifecycle calls need the main thread.
     * The analyzer calls `provider.unbindAll()` as its very first action (before face detection
     * even starts), so no second frame can ever be delivered for this tick regardless of how long
     * detection takes.
     */
    private fun capture() {
        val executor = cameraExecutor ?: return
        val mainExecutor = ContextCompat.getMainExecutor(applicationContext)
        val providerFuture = ProcessCameraProvider.getInstance(applicationContext)
        providerFuture.addListener({
            val provider = try {
                providerFuture.get()
            } catch (e: Exception) {
                return@addListener
            }
            val analysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()

            analysis.setAnalyzer(executor) { imageProxy ->
                // Stop the camera immediately (main thread, CameraX's @MainThread contract) —
                // exactly one frame is ever analyzed per tick.
                mainExecutor.execute { provider.unbindAll() }
                onFrame(imageProxy)
            }

            try {
                provider.unbindAll()
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_FRONT_CAMERA, analysis)
            } catch (e: Exception) {
                // No front camera, CAMERA permission not granted, or already bound — skip this
                // tick rather than crash; the rolling window simply gets no entry.
            }
        }, mainExecutor)
    }

    /**
     * `imageProxy`/`mediaImage`/`inputImage` are local to this call — none is ever assigned to a
     * field or otherwise handed anywhere outside this function, and `imageProxy.close()` (which
     * releases the underlying camera buffer) fires in `addOnCompleteListener`, guaranteed to run
     * exactly once whether detection succeeds or fails. It cannot close earlier/in a `finally`
     * here since ML Kit reads the buffer asynchronously — closing before that read completes
     * would hand `FaceDetection` an invalidated buffer. Only the resulting boolean
     * (`FaceWindow.append`) survives past this call; that is the "structurally impossible to
     * accidentally persist" guarantee Requirement 2 asks for.
     */
    private fun onFrame(imageProxy: ImageProxy) {
        val mediaImage = imageProxy.image
        if (mediaImage == null) {
            imageProxy.close()
            return
        }
        val inputImage = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
        faceDetector.process(inputImage)
            .addOnSuccessListener { faces ->
                FaceWindow.append(faces.isNotEmpty())
                PresenceModule.emitLevel2FaceSamples(FaceWindow.snapshot())
            }
            .addOnFailureListener {
                // Best-effort — a failed detection contributes no sample, never a crash.
            }
            .addOnCompleteListener {
                imageProxy.close()
            }
    }

    private fun buildForegroundNotification(): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "Guardian camera presence check",
                NotificationManager.IMPORTANCE_LOW,
            )
            manager?.createNotificationChannel(channel)
        }
        // setOngoing(true) — non-dismissible while this service runs (Requirement 2's explicit
        // ask), same pattern as T22's GuardianVpnService.buildForegroundNotification.
        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("Guardian is checking device presence")
            .setContentText("Briefly samples the front camera to detect presence. No images are stored or sent anywhere.")
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val NOTIFICATION_ID = 1002
        private const val NOTIFICATION_CHANNEL_ID = "guardian_camera_presence"

        private val faceDetector by lazy {
            FaceDetection.getClient(
                FaceDetectorOptions.Builder()
                    .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
                    .build(),
            )
        }
    }
}
