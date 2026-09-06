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
    private val presenceState = PresenceStateStore(appContext)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun reportTransition(value: AppTransition) {
        val deviceId = settings.deviceId()
        val exposeTo = privacy.exposesIdentity(value.toPackage)
        val exposeFrom = value.fromPackage?.let(privacy::exposesIdentity) == true
        val toPackage = if (exposeTo) value.toPackage else PRIVATE_APP_LABEL
        val fromPackage = if (exposeFrom) value.fromPackage.orEmpty() else if (value.fromPackage != null) PRIVATE_APP_LABEL else ""
        val snapshot = presenceState.snapshot()
        val startedAtMs = snapshot.currentStartedAtMs.takeIf { it > 0L } ?: value.observedAtMs
        val lastInteractionAtMs = snapshot.lastAccessibilityEventAtMs.takeIf { it > 0L } ?: value.observedAtMs
        scope.launch {
            queue.enqueueObservation(
                ObservationRequest(
                    kind = "presence_app_transition",
                    label = toPackage,
                    value = toPackage,
                    observedAt = Instant.ofEpochMilli(value.observedAtMs).toString(),
                    deviceId = deviceId,
                    metadata = mapOf(
                        "fromPackage" to fromPackage,
                        "toPackage" to toPackage,
                        "identityHidden" to (!exposeTo).toString(),
                        "previousIdentityHidden" to (value.fromPackage != null && !exposeFrom).toString(),
                        "previousStartedAt" to value.previousStartedAtMs.takeIf { it > 0L }?.let { Instant.ofEpochMilli(it).toString() }.orEmpty(),
                        "previousDurationMs" to value.previousDurationMs.toString(),
                        "startedAt" to Instant.ofEpochMilli(startedAtMs).toString(),
                        "screenInteractive" to snapshot.screenInteractive.toString(),
                        "unlocked" to snapshot.unlocked.toString(),
                        "lastInteractionAt" to Instant.ofEpochMilli(lastInteractionAtMs).toString(),
                    ),
                    clientEventId = "presence-app:$deviceId:${value.observedAtMs}:$toPackage",
                ),
            )
        }
    }

    fun reportSessionEnd(value: AppSessionEnd) {
        val deviceId = settings.deviceId()
        val expose = privacy.exposesIdentity(value.packageName)
        val exposedPackage = if (expose) value.packageName else PRIVATE_APP_LABEL
        scope.launch {
            queue.enqueueObservation(
                ObservationRequest(
                    kind = "presence_app_session_end",
                    label = exposedPackage,
                    value = value.reason,
                    observedAt = Instant.ofEpochMilli(value.endedAtMs).toString(),
                    deviceId = deviceId,
                    metadata = mapOf(
                        "packageName" to exposedPackage,
                        "identityHidden" to (!expose).toString(),
                        "startedAt" to value.startedAtMs.takeIf { it > 0L }?.let { Instant.ofEpochMilli(it).toString() }.orEmpty(),
                        "durationMs" to value.durationMs.toString(),
                        "reason" to value.reason,
                    ),
                    clientEventId = "presence-end:$deviceId:${value.endedAtMs}:$exposedPackage:${value.reason}",
                ),
            )
        }
    }

    fun reportDwell(
        packageName: String,
        startedAtMs: Long,
        durationMs: Long,
        stage: Int,
        atMs: Long,
        screenInteractive: Boolean,
        unlocked: Boolean,
        lastInteractionAtMs: Long,
    ) {
        val deviceId = settings.deviceId()
        val label = PresenceDwellPolicy.stageLabel(stage)
        val expose = privacy.exposesIdentity(packageName)
        val exposedPackage = if (expose) packageName else PRIVATE_APP_LABEL
        scope.launch {
            queue.enqueueObservation(
                ObservationRequest(
                    kind = "presence_app_dwell",
                    label = exposedPackage,
                    value = label,
                    observedAt = Instant.ofEpochMilli(atMs).toString(),
                    deviceId = deviceId,
                    metadata = mapOf(
                        "packageName" to exposedPackage,
                        "identityHidden" to (!expose).toString(),
                        "startedAt" to Instant.ofEpochMilli(startedAtMs).toString(),
                        "durationMs" to durationMs.toString(),
                        "stage" to stage.toString(),
                        "stageLabel" to label,
                        "screenInteractive" to screenInteractive.toString(),
                        "unlocked" to unlocked.toString(),
                        "lastInteractionAt" to Instant.ofEpochMilli(lastInteractionAtMs).toString(),
                    ),
                    clientEventId = "presence-dwell:$deviceId:$startedAtMs:$stage:$exposedPackage",
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

    companion object {
        private const val PRIVATE_APP_LABEL = "private_app_active"
    }
}
