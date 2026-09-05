package com.hermes.companion.presence

import android.content.Context
import com.hermes.companion.data.ObservationRequest
import com.hermes.companion.data.QueueRepository
import com.hermes.companion.data.SettingsRepository
import com.hermes.companion.privacy.PresencePrivacyStore
import java.time.Instant
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class PresenceReporter(context: Context) {
    private val appContext = context.applicationContext
    private val queue = QueueRepository.create(appContext)
    private val settings = SettingsRepository(appContext)
    private val privacy = PresencePrivacyStore(appContext)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun reportTransition(value: AppTransition) {
        val deviceId = settings.deviceId()
        val exposeTo = privacy.exposesIdentity(value.toPackage)
        val exposeFrom = value.fromPackage?.let(privacy::exposesIdentity) == true
        scope.launch {
            queue.enqueueObservation(
                if (!exposeTo) {
                    ObservationRequest(
                        kind = "presence_private_app_transition",
                        label = PRIVATE_APP_LABEL,
                        value = PRIVATE_APP_LABEL,
                        observedAt = Instant.ofEpochMilli(value.observedAtMs).toString(),
                        deviceId = deviceId,
                        metadata = mapOf(
                            "identityHidden" to "true",
                            "previousDurationMs" to value.previousDurationMs.toString(),
                        ),
                        clientEventId = "presence-private:$deviceId:${value.observedAtMs}",
                    )
                } else {
                    ObservationRequest(
                        kind = "presence_app_transition",
                        label = value.toPackage,
                        value = value.toPackage,
                        observedAt = Instant.ofEpochMilli(value.observedAtMs).toString(),
                        deviceId = deviceId,
                        metadata = mapOf(
                            "fromPackage" to value.fromPackage.takeIf { exposeFrom }.orEmpty(),
                            "toPackage" to value.toPackage,
                            "previousStartedAt" to value.previousStartedAtMs.takeIf { it > 0L }?.let { Instant.ofEpochMilli(it).toString() }.orEmpty(),
                            "previousDurationMs" to value.previousDurationMs.toString(),
                        ),
                        clientEventId = "presence-app:$deviceId:${value.observedAtMs}:${value.toPackage}",
                    )
                },
            )
        }
    }

    fun reportSessionEnd(value: AppSessionEnd) {
        val deviceId = settings.deviceId()
        val expose = privacy.exposesIdentity(value.packageName)
        scope.launch {
            queue.enqueueObservation(
                if (!expose) {
                    ObservationRequest(
                        kind = "presence_private_app_session_end",
                        label = PRIVATE_APP_LABEL,
                        value = value.reason,
                        observedAt = Instant.ofEpochMilli(value.endedAtMs).toString(),
                        deviceId = deviceId,
                        metadata = mapOf(
                            "identityHidden" to "true",
                            "startedAt" to value.startedAtMs.takeIf { it > 0L }?.let { Instant.ofEpochMilli(it).toString() }.orEmpty(),
                            "durationMs" to value.durationMs.toString(),
                            "reason" to value.reason,
                        ),
                        clientEventId = "presence-private-end:$deviceId:${value.endedAtMs}:${value.reason}",
                    )
                } else {
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
                    )
                },
            )
        }
    }

    fun reportDwell(packageName: String, startedAtMs: Long, durationMs: Long, stage: Int, atMs: Long) {
        val deviceId = settings.deviceId()
        val label = PresenceDwellPolicy.stageLabel(stage)
        val expose = privacy.exposesIdentity(packageName)
        scope.launch {
            queue.enqueueObservation(
                if (!expose) {
                    ObservationRequest(
                        kind = "presence_private_app_dwell",
                        label = PRIVATE_APP_LABEL,
                        value = label,
                        observedAt = Instant.ofEpochMilli(atMs).toString(),
                        deviceId = deviceId,
                        metadata = mapOf(
                            "identityHidden" to "true",
                            "startedAt" to Instant.ofEpochMilli(startedAtMs).toString(),
                            "durationMs" to durationMs.toString(),
                            "stage" to stage.toString(),
                            "stageLabel" to label,
                        ),
                        clientEventId = "presence-private-dwell:$deviceId:$startedAtMs:$stage",
                    )
                } else {
                    ObservationRequest(
                        kind = "presence_app_dwell",
                        label = packageName,
                        value = label,
                        observedAt = Instant.ofEpochMilli(atMs).toString(),
                        deviceId = deviceId,
                        metadata = mapOf(
                            "packageName" to packageName,
                            "startedAt" to Instant.ofEpochMilli(startedAtMs).toString(),
                            "durationMs" to durationMs.toString(),
                            "stage" to stage.toString(),
                            "stageLabel" to label,
                        ),
                        clientEventId = "presence-dwell:$deviceId:$startedAtMs:$stage",
                    )
                },
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

    companion object {
        private const val PRIVATE_APP_LABEL = "private_app_active"
    }
}
