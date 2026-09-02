package com.hermes.companion.data

import android.content.Context
import com.hermes.companion.platform.AppTimelineReader
import com.hermes.companion.platform.DeviceStatusReader
import com.hermes.companion.platform.StepCounterReader
import java.time.Instant
import java.util.UUID

data class CaptureResult(
    val upload: QueueRepository.UploadResult,
    val timelineCount: Int,
    val steps: Long?,
)

/** Single capture path shared by the UI, foreground service, and notification action. */
object CompanionCapture {
    suspend fun captureAndUpload(context: Context): CaptureResult {
        val appContext = context.applicationContext
        val settings = SettingsRepository(appContext)
        val queue = QueueRepository.create(appContext)
        val status = DeviceStatusReader.read(appContext)
        val deviceId = settings.deviceId()
        val observedAt = Instant.now().toString()
        queue.enqueueHeartbeat(
            HeartbeatRequest(
                deviceId = deviceId,
                batteryPercent = status.batteryPercent,
                charging = status.charging,
                appVersion = com.hermes.companion.BuildConfig.VERSION_NAME,
                connectivityState = if (status.online) "online" else "offline",
                foregroundPackage = status.foregroundPackage,
                observedAt = observedAt,
                clientEventId = UUID.randomUUID().toString(),
            ),
        )

        val timeline = AppTimelineReader.read(appContext)
        queue.enqueueTimeline(timeline, deviceId)
        val steps = StepCounterReader.readToday(appContext, settings)
        if (steps != null) queue.enqueueSteps(steps, deviceId, observedAt)
        return CaptureResult(queue.uploadPending(), timeline.size, steps)
    }
}
