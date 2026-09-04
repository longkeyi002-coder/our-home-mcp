package com.hermes.companion.vision

import android.content.Context
import com.hermes.companion.data.ObservationRequest
import com.hermes.companion.data.SettingsRepository
import com.hermes.companion.data.VisualRequestAck
import java.time.Instant

/**
 * Converts one short-lived Runtime proposal into a locally guarded visual observation.
 * Invalid/expired requests fail closed before capture.
 */
class VisualRequestAckHandler(
    context: Context,
    private val coordinator: VisualObservationCoordinator = VisualObservationCoordinator.create(context),
    private val nowMs: () -> Long = System::currentTimeMillis,
) {
    private val settings = SettingsRepository(context.applicationContext)

    suspend fun handle(ack: VisualRequestAck): ObservationRequest? {
        val issuedAtMs = parseTime(ack.issuedAt) ?: return null
        val expiresAtMs = parseTime(ack.expiresAt) ?: return null
        val now = nowMs()
        if (expiresAtMs <= issuedAtMs || now < issuedAtMs - CLOCK_SKEW_MS || now >= expiresAtMs) return null
        if (expiresAtMs - issuedAtMs > MAX_REQUEST_TTL_MS) return null

        val request = VisualCaptureRequest(
            requestId = ack.requestId,
            packageName = ack.packageName,
            sessionId = ack.sessionId,
            reason = ack.reason,
        )
        return when (val outcome = coordinator.observe(request)) {
            is VisualObservationOutcome.Observed -> VisualSummaryObservation.create(
                deviceId = settings.deviceId(),
                request = request,
                summary = outcome.summary,
                observedAtMs = nowMs(),
            )
            is VisualObservationOutcome.Blocked,
            is VisualObservationOutcome.Failed -> null
        }
    }

    private fun parseTime(value: String): Long? = runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()

    companion object {
        private const val MAX_REQUEST_TTL_MS = 5 * 60_000L
        private const val CLOCK_SKEW_MS = 30_000L
    }
}
