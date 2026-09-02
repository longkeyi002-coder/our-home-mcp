package com.hermes.companion.data

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.hermes.companion.BuildConfig
import com.hermes.companion.platform.DeviceStatusReader
import java.time.Instant
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Produces heartbeats. UploadWorker remains the sole queue consumer. */
class PeriodicHeartbeatWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = runCatching {
        val settings = SettingsRepository(applicationContext)
        val status = DeviceStatusReader.read(applicationContext)
        QueueRepository.create(applicationContext).enqueueHeartbeat(
            HeartbeatRequest(
                deviceId = settings.deviceId(),
                batteryPercent = status.batteryPercent,
                charging = status.charging,
                appVersion = BuildConfig.VERSION_NAME,
                connectivityState = if (status.online) "online" else "offline",
                foregroundPackage = status.foregroundPackage,
                observedAt = Instant.now().toString(),
                clientEventId = UUID.randomUUID().toString(),
            ),
        )
        settings.recordHeartbeat(System.currentTimeMillis())
    }.fold(onSuccess = { Result.success() }, onFailure = { Result.retry() })

    companion object {
        internal const val PERIODIC_NAME = "hermes-periodic-heartbeat"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<PeriodicHeartbeatWorker>(15, TimeUnit.MINUTES).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                PERIODIC_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                request,
            )
        }
    }
}
