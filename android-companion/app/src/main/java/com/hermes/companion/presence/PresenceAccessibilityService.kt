package com.hermes.companion.presence

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import androidx.annotation.RequiresApi
import com.hermes.companion.privacy.AppSensitivityClassifier
import com.hermes.companion.privacy.SensitiveVisualGuard
import com.hermes.companion.privacy.SensitivityClass
import com.hermes.companion.privacy.VisualAuditEvent
import com.hermes.companion.privacy.VisualAuditReporter
import com.hermes.companion.privacy.VisualPrivacyStore
import com.hermes.companion.privacy.VisualRequestContext
import com.hermes.companion.vision.EphemeralVisualFrame
import com.hermes.companion.vision.VisualCaptureBridge
import com.hermes.companion.vision.VisualCaptureOutcome
import com.hermes.companion.vision.VisualCapturePreflight
import com.hermes.companion.vision.VisualCaptureRequest
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class PresenceAccessibilityService : AccessibilityService() {
    private val handler = Handler(Looper.getMainLooper())
    private val captureScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private lateinit var store: PresenceStateStore
    private lateinit var reporter: PresenceReporter
    private lateinit var privacy: VisualPrivacyStore
    private lateinit var visualAudit: VisualAuditReporter
    private var pendingPackage: String? = null
    private val commitPending = Runnable {
        val candidate = pendingPackage ?: return@Runnable
        pendingPackage = null
        val now = System.currentTimeMillis()
        store.commitPackage(candidate, now)?.let { transition ->
            // OH-45: a sensitive visual grant is scoped to the current App session.
            // Switching away invalidates it before any future visual request can use it.
            privacy.invalidateGrantForPackageChange(transition.toPackage)
            reporter.reportTransition(transition)
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        store = PresenceStateStore(applicationContext)
        reporter = PresenceReporter(applicationContext)
        privacy = VisualPrivacyStore(applicationContext)
        visualAudit = VisualAuditReporter(applicationContext)
        privacy.pruneExpiredGrant(System.currentTimeMillis())
        store.setAccessibilityConnected(true)
        VisualCaptureBridge.attach(this)
        PresenceRuntime.start(applicationContext)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (!::store.isInitialized || !::reporter.isInitialized) return
        val type = event?.eventType ?: return
        if (type != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && type != AccessibilityEvent.TYPE_WINDOWS_CHANGED) return
        val candidate = event.packageName?.toString()?.trim()?.takeIf { it.isNotEmpty() } ?: return
        val now = System.currentTimeMillis()
        store.recordAccessibilityEvent(now)

        // OH-68: Accessibility can emit several window events for one semantic switch.
        // A short local debounce prevents transient windows from becoming noisy Presence events.
        pendingPackage = candidate
        handler.removeCallbacks(commitPending)
        handler.postDelayed(commitPending, APP_TRANSITION_DEBOUNCE_MS)
    }

    /**
     * OH-45/OH-69: this is the only screenshot entry point. A Runtime request is advisory;
     * Android re-checks the exact App session, lock/screen state and local privacy policy
     * before the OS screenshot API is called.
     */
    fun captureVisual(request: VisualCaptureRequest, callback: (VisualCaptureOutcome) -> Unit) {
        if (!::store.isInitialized || !::privacy.isInitialized || !::visualAudit.isInitialized) {
            callback(VisualCaptureOutcome.Failed("service_not_ready"))
            return
        }

        val now = System.currentTimeMillis()
        privacy.pruneExpiredGrant(now)
        val snapshot = store.snapshot()
        val sensitivity = AppSensitivityClassifier.classify(request.packageName)
        val preflight = VisualCapturePreflight.decide(snapshot, request)
        if (!preflight.allowed) {
            reportAudit(
                request = request,
                sensitivity = sensitivity,
                allowed = false,
                reason = "PREFLIGHT_${preflight.reason.name}",
                action = "capture_preflight",
            )
            callback(VisualCaptureOutcome.Blocked(preflight.reason.name))
            return
        }

        // A user may arm a one-time grant from the Privacy page before returning to the
        // target App. Bind it only now, after Android has verified the exact live session.
        privacy.bindArmedGrantToSession(
            packageName = request.packageName,
            sessionId = request.sessionId,
            nowMs = now,
        )

        val guard = SensitiveVisualGuard.decide(
            VisualRequestContext(
                packageName = request.packageName,
                sensitivity = sensitivity,
                userPolicy = privacy.policyFor(request.packageName),
                screenUsable = snapshot.screenInteractive && snapshot.unlocked,
                // Secure windows are enforced by the OS screenshot API below. On API 34+
                // ERROR_TAKE_SCREENSHOT_SECURE_WINDOW is treated as an absolute block.
                secureWindow = false,
                sessionId = request.sessionId,
                nowMs = now,
                temporaryGrant = privacy.temporaryGrant(),
            ),
        )
        reportAudit(
            request = request,
            sensitivity = sensitivity,
            allowed = guard.allowed,
            reason = guard.reason.name,
            action = "capture_guard",
            temporaryGrantUsed = guard.consumeTemporaryGrant,
        )
        if (!guard.allowed) {
            callback(VisualCaptureOutcome.Blocked(guard.reason.name))
            return
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            reportAudit(request, sensitivity, false, "UNSUPPORTED_ANDROID_VERSION", "capture_failed")
            callback(VisualCaptureOutcome.Failed("unsupported_android_version"))
            return
        }

        captureScreenshotR(request, sensitivity, guard.consumeTemporaryGrant, callback)
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun captureScreenshotR(
        request: VisualCaptureRequest,
        sensitivity: SensitivityClass,
        consumeTemporaryGrant: Boolean,
        callback: (VisualCaptureOutcome) -> Unit,
    ) {
        takeScreenshot(
            Display.DEFAULT_DISPLAY,
            mainExecutor,
            object : TakeScreenshotCallback {
                override fun onSuccess(screenshot: ScreenshotResult) {
                    val hardwareBuffer = screenshot.hardwareBuffer
                    val hardwareBitmap = runCatching {
                        Bitmap.wrapHardwareBuffer(hardwareBuffer, screenshot.colorSpace)
                    }.getOrNull()
                    if (hardwareBitmap == null) {
                        hardwareBuffer.close()
                        reportAudit(request, sensitivity, false, "BITMAP_WRAP_FAILED", "capture_failed")
                        callback(VisualCaptureOutcome.Failed("bitmap_wrap_failed"))
                        return
                    }

                    val softwareBitmap = runCatching {
                        hardwareBitmap.copy(Bitmap.Config.ARGB_8888, false)
                    }.getOrNull()
                    hardwareBitmap.recycle()
                    hardwareBuffer.close()
                    if (softwareBitmap == null) {
                        reportAudit(request, sensitivity, false, "BITMAP_COPY_FAILED", "capture_failed")
                        callback(VisualCaptureOutcome.Failed("bitmap_copy_failed"))
                        return
                    }

                    captureScope.launch {
                        val output = ZeroingByteArrayOutputStream()
                        val compressed = runCatching {
                            softwareBitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, output)
                        }.getOrDefault(false)
                        softwareBitmap.recycle()
                        if (!compressed) {
                            output.wipe()
                            mainExecutor.execute {
                                reportAudit(request, sensitivity, false, "JPEG_COMPRESS_FAILED", "capture_failed")
                                callback(VisualCaptureOutcome.Failed("jpeg_compress_failed"))
                            }
                            return@launch
                        }

                        val jpeg = output.copyAndWipe()
                        val frame = runCatching {
                            EphemeralVisualFrame.jpeg(request.requestId, request.packageName, jpeg)
                        }.getOrElse {
                            jpeg.fill(0)
                            mainExecutor.execute {
                                reportAudit(request, sensitivity, false, "FRAME_CREATE_FAILED", "capture_failed")
                                callback(VisualCaptureOutcome.Failed("frame_create_failed"))
                            }
                            return@launch
                        }
                        mainExecutor.execute {
                            if (consumeTemporaryGrant) privacy.consumeTemporaryGrant()
                            reportAudit(
                                request = request,
                                sensitivity = sensitivity,
                                allowed = true,
                                reason = "CAPTURED_EPHEMERAL",
                                action = "capture_succeeded",
                                temporaryGrantUsed = consumeTemporaryGrant,
                            )
                            callback(VisualCaptureOutcome.Captured(frame))
                        }
                    }
                }

                override fun onFailure(errorCode: Int) {
                    val secureWindow = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE &&
                        errorCode == ERROR_TAKE_SCREENSHOT_SECURE_WINDOW
                    val reason = if (secureWindow) "SECURE_WINDOW" else "SCREENSHOT_ERROR_$errorCode"
                    reportAudit(request, sensitivity, false, reason, "capture_failed")
                    callback(
                        if (secureWindow) VisualCaptureOutcome.Blocked("SECURE_WINDOW")
                        else VisualCaptureOutcome.Failed(reason.lowercase()),
                    )
                }
            },
        )
    }

    private fun reportAudit(
        request: VisualCaptureRequest,
        sensitivity: SensitivityClass,
        allowed: Boolean,
        reason: String,
        action: String,
        temporaryGrantUsed: Boolean = false,
    ) {
        visualAudit.report(
            VisualAuditEvent(
                packageName = request.packageName,
                action = action,
                allowed = allowed,
                reason = reason,
                sensitivity = sensitivity,
                atMs = System.currentTimeMillis(),
                temporaryGrantUsed = temporaryGrantUsed,
            ),
        )
    }

    override fun onInterrupt() = Unit

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        if (::store.isInitialized) store.setAccessibilityConnected(false)
        VisualCaptureBridge.detach(this)
        handler.removeCallbacks(commitPending)
        pendingPackage = null
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        if (::store.isInitialized) store.setAccessibilityConnected(false)
        VisualCaptureBridge.detach(this)
        handler.removeCallbacks(commitPending)
        pendingPackage = null
        captureScope.cancel()
        super.onDestroy()
    }

    private class ZeroingByteArrayOutputStream : ByteArrayOutputStream() {
        fun copyAndWipe(): ByteArray {
            val copied = toByteArray()
            wipe()
            return copied
        }

        fun wipe() {
            buf.fill(0)
            reset()
            close()
        }
    }

    companion object {
        const val APP_TRANSITION_DEBOUNCE_MS = 400L
        private const val JPEG_QUALITY = 60
    }
}
