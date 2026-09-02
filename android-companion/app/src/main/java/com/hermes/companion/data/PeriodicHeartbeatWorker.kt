package com.hermes.companion.data

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.hermes.companion.BuildConfig
import com.hermes.companion.platform.DeviceStatusReader
import java.util.concurrent.TimeUnit

class PeriodicHeartbeatWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = runCatching {
        val settings = SettingsRepository(applicationContext)
        val queue = QueueRepository.create(applicationContext)

        runHeartbeatCycle(
            createHeartbeat = {
                HeartbeatRequestFactory.create(
                    deviceId = settings.deviceId(),
                    appVersion = BuildConfig.VERSION_NAME,
                    status = DeviceStatusReader.read(applicationContext),
                )
            },
            enqueueHeartbeat = { queue.enqueueHeartbeat(it, scheduleUpload = false) },
            recordHeartbeat = { settings.recordHeartbeat(System.currentTimeMillis()) },
            uploadPending = { queue.uploadPending().error == null },
            scheduleRecoveryUpload = { UploadWorker.enqueue(applicationContext) },
        )
        Result.success()
    }.getOrElse {
        Result.retry()
    }

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

internal suspend fun runHeartbeatCycle(
    createHeartbeat: () -> HeartbeatRequest,
    enqueueHeartbeat: suspend (HeartbeatRequest) -> Unit,
    recordHeartbeat: () -> Unit,
    uploadPending: suspend () -> Boolean,
    scheduleRecoveryUpload: () -> Unit,
) {
    val heartbeat = createHeartbeat()
    enqueueHeartbeat(heartbeat)
    recordHeartbeat()
    if (!uploadPending()) scheduleRecoveryUpload()
}
