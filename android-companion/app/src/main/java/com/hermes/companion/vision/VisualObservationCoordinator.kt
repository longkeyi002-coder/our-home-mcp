package com.hermes.companion.vision

import android.content.Context
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

sealed interface VisualObservationOutcome {
    data class Observed(val summary: VisualObservationSummary) : VisualObservationOutcome
    data class Blocked(val reason: String) : VisualObservationOutcome
    data class Failed(val reason: String) : VisualObservationOutcome
}

/**
 * Connects one already-approved Curiosity request to the Android-local capture guard and
 * the selected provider. It does NOT decide when to look and cannot bypass the guard.
 */
class VisualObservationCoordinator(
    private val isEnabledAndConfigured: () -> Boolean,
    private val capture: (VisualCaptureRequest, (VisualCaptureOutcome) -> Unit) -> Boolean,
    private val provider: VisionProvider,
    private val beginIndicator: (VisualCaptureRequest) -> Boolean = { true },
    private val endIndicator: (VisualCaptureRequest) -> Unit = {},
) {
    suspend fun observe(request: VisualCaptureRequest): VisualObservationOutcome {
        if (!isEnabledAndConfigured()) {
            return VisualObservationOutcome.Blocked("visual_not_enabled_or_configured")
        }
        if (!beginIndicator(request)) {
            return VisualObservationOutcome.Blocked("visual_indicator_unavailable")
        }

        return try {
            val captureOutcome = suspendCancellableCoroutine<VisualCaptureOutcome> { continuation ->
                val accepted = capture(request) { outcome ->
                    if (continuation.isActive) continuation.resume(outcome)
                    else if (outcome is VisualCaptureOutcome.Captured) outcome.frame.close()
                }
                if (!accepted && continuation.isActive) {
                    continuation.resume(VisualCaptureOutcome.Failed("accessibility_service_unavailable"))
                }
            }

            when (captureOutcome) {
                is VisualCaptureOutcome.Blocked -> VisualObservationOutcome.Blocked(captureOutcome.reason)
                is VisualCaptureOutcome.Failed -> VisualObservationOutcome.Failed(captureOutcome.reason)
                is VisualCaptureOutcome.Captured -> runCatching {
                    provider.analyze(captureOutcome.frame)
                }.fold(
                    onSuccess = { VisualObservationOutcome.Observed(it) },
                    onFailure = {
                        // Provider implementations are required to close the frame, but close again
                        // defensively; EphemeralVisualFrame.close() is idempotent.
                        captureOutcome.frame.close()
                        VisualObservationOutcome.Failed("vision_provider_failed")
                    },
                )
            }
        } finally {
            endIndicator(request)
        }
    }

    companion object {
        fun create(context: Context): VisualObservationCoordinator {
            val appContext = context.applicationContext
            val settings = VisionProviderSettingsStore(appContext)
            return VisualObservationCoordinator(
                isEnabledAndConfigured = {
                    val snapshot = settings.snapshot()
                    snapshot.enabled && snapshot.hasApiKey
                },
                capture = VisualCaptureBridge::request,
                provider = ZhipuVisionProvider(settings),
                beginIndicator = { VisualObservationIndicator.start(appContext, it) },
                endIndicator = { VisualObservationIndicator.stop(appContext, it) },
            )
        }
    }
}
