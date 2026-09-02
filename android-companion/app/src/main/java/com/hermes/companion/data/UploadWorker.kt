package com.hermes.companion.data

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.hermes.companion.BuildConfig
import com.hermes.companion.platform.DeviceStatusReader
import java.util.concurrent.TimeUnit

class UploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val settings = SettingsRepository(applicationContext)
        val hasCredentials = settings.serverUrl().isNotBlank() &&
            (!settings.bootstrapToken().isNullOrBlank() || !settings.deviceToken().isNullOrBlank())
        if (!hasCredentials) return Result.success()

        val queue = QueueRepository.create(applicationContext)
        val status = runCatching { DeviceStatusReader.read(applicationContext) }
            .getOrElse { return Result.retry() }
        queue.enqueueHeartbeat(
            HeartbeatRequestFactory.create(
                deviceId = settings.deviceId(),
                appVersion = BuildConfig.VERSION_NAME,
                status = status,
            ),
            scheduleUpload = false,
        )
        val result = queue.uploadPending()
        return if (result.error == null) Result.success() else Result.retry()
    }

    companion object {
        private const val IMMEDIATE_NAME = "hermes-upload-now"
        private const val PERIODIC_NAME = "hermes-periodic-upload"

        fun enqueue(context: Context) {
            val request = OneTimeWorkRequestBuilder<UploadWorker>()
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(IMMEDIATE_NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
        }

        fun schedulePeriodic(context: Context) {
            val request = PeriodicWorkRequestBuilder<UploadWorker>(15, TimeUnit.MINUTES)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}
