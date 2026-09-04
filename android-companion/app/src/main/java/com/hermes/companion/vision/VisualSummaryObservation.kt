package com.hermes.companion.vision

import com.hermes.companion.data.ObservationRequest
import java.time.Instant
import java.util.Locale

/**
 * OH-42/OH-69: Provider free-form text is never persisted to Runtime. Runtime receives
 * only an allowlisted activity plus a generic local phrase and bounded provenance fields.
 */
object VisualSummaryObservation {
    fun create(
        deviceId: String,
        request: VisualCaptureRequest,
        summary: VisualObservationSummary,
        observedAtMs: Long = System.currentTimeMillis(),
    ): ObservationRequest {
        val activity = summary.activity.takeIf(ALLOWED_ACTIVITIES::contains) ?: "unknown"
        val confidence = summary.confidence.coerceIn(0.0, 1.0)
        return ObservationRequest(
            kind = "visual_observation_summary",
            label = activity,
            value = GENERIC_CONTENT.getValue(activity),
            observedAt = Instant.ofEpochMilli(observedAtMs).toString(),
            deviceId = deviceId,
            metadata = mapOf(
                "packageName" to request.packageName.take(300),
                "activity" to activity,
                "confidence" to String.format(Locale.US, "%.3f", confidence),
                "provider" to summary.provider.take(120),
                "model" to summary.model.take(120),
                "requestId" to request.requestId.take(300),
                "sessionId" to request.sessionId.take(300),
                "curiosityReason" to request.reason.take(120),
            ),
            clientEventId = "visual-summary:${request.requestId.take(240)}",
        )
    }

    private val GENERIC_CONTENT = mapOf(
        "gaming" to "game activity",
        "video" to "video activity",
        "social" to "social activity",
        "shopping" to "shopping activity",
        "work" to "work activity",
        "reading" to "reading activity",
        "navigation" to "navigation activity",
        "other" to "other screen activity",
        "unknown" to "screen activity unclear",
    )
    private val ALLOWED_ACTIVITIES = GENERIC_CONTENT.keys
}
