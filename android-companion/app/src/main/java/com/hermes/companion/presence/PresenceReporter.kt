package com.hermes.companion.presence

import android.content.Context
import com.hermes.companion.data.ObservationRequest
import com.hermes.companion.data.QueueRepository
import com.hermes.companion.data.SettingsRepository
import java.time.Instant
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class PresenceReporter(context: Context) {
    private val appContext = context.applicationContext
    private val queue = QueueRepository.create(appContext)
    private val settings = SettingsRepository(appContext)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun reportTransition(value: AppTransition) {
        val deviceId = settings.deviceId()
        scope.launch {
            queue.enqueueObservation(
                ObservationRequest(
                    kind = "presence_app_transition",
                    label = value.toPackage,
                    value = value.toPackage,
                    observedAt = Instant.ofEpochMilli(value.observedAtMs).toString(),
                    deviceId = deviceId,
                    metadata = mapOf(
                        "fromPackage" to value.fromPackage.orEmpty(),
                        "toPackage" to value.toPackage,
                        "previousStartedAt" to value.previousStartedAtMs.takeIf { it > 0L }?.let { Instant.ofEpochMilli(it).toString() }.orEmpty(),
                        "previousDurationMs" to value.previousDurationMs.toString(),
                    ),
                    clientEventId = "presence-app:$deviceId:${value.observedAtMs}:${value.toPackage}",
                ),
            )
        }
    }

    fun reportSessionEnd(value: AppSessionEnd) {
        val deviceId = settings.deviceId()
        scope.launch {
            queue.enqueueObservation(
                ObservationRequest(
                    kind = "presence_app_session_end",
                    label = value.packageName,
                    value = value.reason,
                    observedAt = Instant.ofEpochMilli(value.endedAtMs).toString(),
                    deviceId = deviceId,
                    metadata = mapOf(
                        "packageName" to value.packageName,
                        "startedAt" to value.startedAtMs.takeIf { it > 0L }?.let { Instant.ofEpochMilli(it).toString() }.orEmpty(),
                        "durationMs" to value.durationMs.toString(),
                        "reason" to value.reason,
                    ),
                    clientEventId = "presence-end:$deviceId:${value.endedAtMs}:${value.packageName}:${value.reason}",
                ),
            )
        }
    }

    fun reportScreen(interactive: Boolean, unlocked: Boolean, atMs: Long, reason: String) {
        val deviceId = settings.deviceId()
        scope.launch {
            queue.enqueueObservation(
                ObservationRequest(
                    kind = "presence_screen",
                    label = if (interactive) "screen_on" else "screen_off",
                    value = if (interactive) "on" else "off",
                    observedAt = Instant.ofEpochMilli(atMs).toString(),
                    deviceId = deviceId,
                    metadata = mapOf(
                        "interactive" to interactive.toString(),
                        "unlocked" to unlocked.toString(),
                        "reason" to reason,
                    ),
                    clientEventId = "presence-screen:$deviceId:$atMs:${if (interactive) "on" else "off"}:$reason",
                ),
            )
        }
    }
}
