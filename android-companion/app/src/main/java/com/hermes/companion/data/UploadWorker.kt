package com.hermes.companion.data

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.hermes.companion.BuildConfig
import com.hermes.companion.platform.UsagePrivacyFilter
import com.hermes.companion.privacy.PresencePrivacyStore
import java.time.Instant
import java.util.concurrent.TimeUnit

class UploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val settings = SettingsRepository(applicationContext)
        val presencePrivacy = PresencePrivacyStore(applicationContext)
        val workerStartedAt = System.currentTimeMillis()
        settings.recordWorkerRun(workerStartedAt)
        if (!TelemetryPolicy.isConfigured(settings.serverUrl(), settings.bootstrapToken(), settings.deviceToken())) {
            return Result.success()
        }

        val queue = QueueRepository.create(applicationContext)
        val periodicRun = inputData.getBoolean(KEY_PERIODIC_RUN, false)
        val visualDecisionPoll = inputData.getBoolean(KEY_VISUAL_DECISION_POLL, false)
        if (periodicRun) settings.recordPeriodicCollection(workerStartedAt)

        val status = com.hermes.companion.platform.DeviceStatusReader.read(applicationContext)
        val now = System.currentTimeMillis()
        queue.enqueueHeartbeat(
            HeartbeatRequest(
                deviceId = settings.deviceId(),
                batteryPercent = status.batteryPercent,
                charging = status.charging,
                appVersion = BuildConfig.VERSION_NAME,
                connectivityState = if (status.online) "online" else "offline",
                foregroundPackage = UsagePrivacyFilter.redactCurrentPackage(
                    status.foregroundPackage,
                    presencePrivacy::exposesIdentity,
                ),
                observedAt = Instant.ofEpochMilli(now).toString(),
                clientEventId = TelemetryPolicy.periodicHeartbeatEventId(settings.deviceId(), now),
            ),
            scheduleUpload = false,
        )

        // A Brain visual-decision follow-up exists only to fetch the short-lived decision.
        // Avoid the heavier UsageEvents reconciliation on these sparse extra heartbeats.
        if (!visualDecisionPoll) {
            val usage = com.hermes.companion.platform.UsageTimelineReader.read(applicationContext)
            if (usage != null) {
                queue.enqueueUsageSummary(
                    UsagePrivacyFilter.redact(usage, presencePrivacy::exposesIdentity),
                    settings.deviceId(),
                    scheduleUpload = false,
                )
            }
        }

        if (!status.online) {
            enqueue(applicationContext)
            return Result.success()
        }

        val result = queue.uploadPending()
        return if (result.error == null) Result.success() else Result.retry()
    }

    companion object {
        const val IMMEDIATE_WORK_NAME = "hermes-upload-now"
        const val PERIODIC_WORK_NAME = "hermes-periodic-upload"
        const val VISUAL_DECISION_POLL_WORK_NAME = "hermes-visual-decision-poll"
        const val KEY_PERIODIC_RUN = "periodic_run"
        const val KEY_VISUAL_DECISION_POLL = "visual_decision_poll"
        private const val VISUAL_DECISION_POLL_DELAY_SECONDS = 75L

        fun enqueue(context: Context) {
            val request = OneTimeWorkRequestBuilder<UploadWorker>()
                .setConstraints(androidx.work.Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(IMMEDIATE_WORK_NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
        }

        /**
         * Only scheduled when Runtime says a Brain visual decision is actually pending.
         * Repeated pending ACKs append another bounded delayed poll; once the decision resolves,
         * no further poll is scheduled.
         */
        fun enqueueVisualDecisionPoll(context: Context) {
            val request = OneTimeWorkRequestBuilder<UploadWorker>()
                .setInputData(workDataOf(KEY_VISUAL_DECISION_POLL to true))
                .setInitialDelay(VISUAL_DECISION_POLL_DELAY_SECONDS, TimeUnit.SECONDS)
                .setConstraints(androidx.work.Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                VISUAL_DECISION_POLL_WORK_NAME,
                ExistingWorkPolicy.APPEND_OR_REPLACE,
                request,
            )
        }

        fun enqueueIfConfigured(context: Context) {
            val settings = SettingsRepository(context.applicationContext)
            if (TelemetryPolicy.isConfigured(settings.serverUrl(), settings.bootstrapToken(), settings.deviceToken())) {
                enqueue(context)
            }
        }

        fun schedulePeriodic(context: Context) {
            val request = PeriodicWorkRequestBuilder<UploadWorker>(15, TimeUnit.MINUTES)
                .setInputData(workDataOf(KEY_PERIODIC_RUN to true))
                .setConstraints(androidx.work.Constraints.Builder().build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC_WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}
