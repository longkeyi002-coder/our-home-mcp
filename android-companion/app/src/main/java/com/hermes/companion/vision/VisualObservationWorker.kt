package com.hermes.companion.vision

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.hermes.companion.data.QueueRepository
import com.hermes.companion.data.VisualRequestAck
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout

/**
 * Visual observation is intentionally outside the telemetry upload transaction.
 * The telemetry worker only persists this request in WorkManager and immediately moves on.
 * Capture + provider work has its own timeout/retry budget and cannot block a telemetry batch.
 */
class VisualObservationWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val ack = inputData.toVisualRequestAck() ?: return Result.failure()
        return try {
            // Do not surface a visual-consent prompt unless the local vision provider is actually
            // ready to analyze a captured frame. Stable APKs intentionally never embed API keys.
            val vision = VisionProviderSettingsStore(applicationContext).snapshot()
            if (!vision.enabled || !vision.hasApiKey) return Result.success()

            // ASK_ONLY/PRIVATE/PROTECTED requests are surfaced locally before screenshot work.
            // This worker ends immediately; explicit approval schedules a fresh consent-bound attempt.
            if (VisualConsentPrompt.promptIfNeeded(applicationContext, ack)) return Result.success()

            val summary = withTimeout(VISUAL_TIMEOUT_MS) {
                VisualRequestAckHandler(applicationContext).handle(ack)
            }
            if (summary != null) {
                QueueRepository.create(applicationContext).enqueueObservation(summary, scheduleUpload = true)
            }
            Result.success()
        } catch (_: TimeoutCancellationException) {
            // Request TTL is deliberately short. A timed-out visual attempt is not worth replaying.
            Result.success()
        } catch (_: Throwable) {
            // Keep visual failure isolated from normal phone telemetry. Network/provider retry is
            // bounded by WorkManager and the request TTL check inside VisualRequestAckHandler.
            Result.retry()
        }
    }

    companion object {
        private const val WORK_PREFIX = "our-home-visual-"
        private const val CONSENT_WORK_PREFIX = "our-home-visual-consent-"
        private const val VISUAL_TIMEOUT_MS = 45_000L

        fun enqueue(context: Context, ack: VisualRequestAck) {
            enqueueNamed(context, ack, "$WORK_PREFIX${ack.requestId}")
        }

        fun enqueueAfterConsent(context: Context, ack: VisualRequestAck) {
            enqueueNamed(context, ack, "$CONSENT_WORK_PREFIX${ack.requestId}")
        }

        private fun enqueueNamed(context: Context, ack: VisualRequestAck, workName: String) {
            val request = OneTimeWorkRequestBuilder<VisualObservationWorker>()
                .setInputData(workDataOf(
                    KEY_REQUEST_ID to ack.requestId,
                    KEY_PACKAGE_NAME to ack.packageName,
                    KEY_SESSION_ID to ack.sessionId,
                    KEY_REASON to ack.reason,
                    KEY_ISSUED_AT to ack.issuedAt,
                    KEY_EXPIRES_AT to ack.expiresAt,
                ))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
                workName,
                ExistingWorkPolicy.KEEP,
                request,
            )
        }

        private const val KEY_REQUEST_ID = "request_id"
        private const val KEY_PACKAGE_NAME = "package_name"
        private const val KEY_SESSION_ID = "session_id"
        private const val KEY_REASON = "reason"
        private const val KEY_ISSUED_AT = "issued_at"
        private const val KEY_EXPIRES_AT = "expires_at"

        private fun androidx.work.Data.toVisualRequestAck(): VisualRequestAck? {
            val requestId = getString(KEY_REQUEST_ID)?.takeIf { it.isNotBlank() } ?: return null
            val packageName = getString(KEY_PACKAGE_NAME)?.takeIf { it.isNotBlank() } ?: return null
            val sessionId = getString(KEY_SESSION_ID)?.takeIf { it.isNotBlank() } ?: return null
            val reason = getString(KEY_REASON)?.takeIf { it.isNotBlank() } ?: return null
            val issuedAt = getString(KEY_ISSUED_AT)?.takeIf { it.isNotBlank() } ?: return null
            val expiresAt = getString(KEY_EXPIRES_AT)?.takeIf { it.isNotBlank() } ?: return null
            return VisualRequestAck(requestId, packageName, sessionId, reason, issuedAt, expiresAt)
        }
    }
}
