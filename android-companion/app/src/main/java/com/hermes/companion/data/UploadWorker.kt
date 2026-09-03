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
import com.hermes.companion.BuildConfig
import java.time.Instant
import java.util.concurrent.TimeUnit
import androidx.work.workDataOf

class UploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val queue = QueueRepository.create(applicationContext)
        val settings = SettingsRepository(applicationContext)
        if (settings.isLocalMode()) return Result.success()
        val periodicRun = inputData.getBoolean(KEY_PERIODIC_RUN, false)
        val collectionStartedAt = System.currentTimeMillis()
        if (periodicRun) settings.recordPeriodicCollection(collectionStartedAt)
        val status = com.hermes.companion.platform.DeviceStatusReader.read(applicationContext)
        val now = System.currentTimeMillis()
        val bucket = now / (15 * 60 * 1000L)
        queue.enqueueHeartbeat(
            HeartbeatRequest(
                deviceId = settings.deviceId(),
                batteryPercent = status.batteryPercent,
                charging = status.charging,
                appVersion = BuildConfig.VERSION_NAME,
                connectivityState = if (status.online) "online" else "offline",
                foregroundPackage = status.foregroundPackage,
                observedAt = Instant.ofEpochMilli(now).toString(),
                clientEventId = "periodic-heartbeat:${settings.deviceId()}:$bucket",
            ),
            scheduleUpload = false,
        )
        val usage = com.hermes.companion.platform.UsageTimelineReader.read(applicationContext)
        if (usage != null) {
            queue.enqueueUsageSummary(usage, settings.deviceId(), scheduleUpload = false)
        }
        if (!status.online) {
            enqueue(applicationContext)
            return Result.success()
        }
        val result = queue.uploadPending()
        return if (result.error == null) Result.success() else Result.retry()
    }

    companion object {
        private const val IMMEDIATE_NAME = "hermes-upload-now"
        const val PERIODIC_WORK_NAME = "hermes-periodic-upload"
        const val KEY_PERIODIC_RUN = "periodic_run"

        fun enqueue(context: Context) {
            val request = OneTimeWorkRequestBuilder<UploadWorker>()
                .setConstraints(androidx.work.Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(IMMEDIATE_NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
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
