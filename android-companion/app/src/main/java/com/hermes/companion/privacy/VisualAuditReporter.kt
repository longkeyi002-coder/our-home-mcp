package com.hermes.companion.privacy

import android.content.Context
import com.hermes.companion.data.ObservationRequest
import com.hermes.companion.data.QueueRepository
import com.hermes.companion.data.SettingsRepository
import java.time.Instant
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

data class VisualAuditEvent(
    val packageName: String,
    val action: String,
    val allowed: Boolean,
    val reason: String,
    val sensitivity: SensitivityClass,
    val atMs: Long,
    val temporaryGrantUsed: Boolean = false,
)

class VisualAuditReporter(context: Context) {
    private val appContext = context.applicationContext
    private val queue = QueueRepository.create(appContext)
    private val settings = SettingsRepository(appContext)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /**
     * OH-45/OH-69: audit policy decisions without storing screenshot bytes,
     * screen text, password/OTP content, or accessibility-tree data.
     */
    fun report(event: VisualAuditEvent) {
        val deviceId = settings.deviceId()
        scope.launch {
            queue.enqueueObservation(
                ObservationRequest(
                    kind = "visual_policy_audit",
                    label = event.action,
                    value = event.reason,
                    observedAt = Instant.ofEpochMilli(event.atMs).toString(),
                    deviceId = deviceId,
                    metadata = mapOf(
                        "packageName" to event.packageName,
                        "action" to event.action,
                        "allowed" to event.allowed.toString(),
                        "reason" to event.reason,
                        "sensitivity" to event.sensitivity.name,
                        "temporaryGrantUsed" to event.temporaryGrantUsed.toString(),
                    ),
                    clientEventId = "visual-audit:$deviceId:${event.atMs}:${event.action}:${event.packageName}:${event.reason}",
                ),
            )
        }
    }
}
