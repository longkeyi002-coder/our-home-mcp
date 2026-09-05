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
    private val presencePrivacy = PresencePrivacyStore(appContext)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /**
     * OH-41/OH-45/OH-69: audit policy decisions without storing screenshot bytes,
     * screen text, password/OTP content, accessibility-tree data, or a package identity
     * that the user has explicitly hidden from Presence.
     */
    fun report(event: VisualAuditEvent) {
        val deviceId = settings.deviceId()
        val exposeIdentity = presencePrivacy.exposesIdentity(event.packageName)
        val auditedPackage = if (exposeIdentity) event.packageName else PRIVATE_APP_LABEL
        scope.launch {
            queue.enqueueObservation(
                ObservationRequest(
                    kind = "visual_policy_audit",
                    label = event.action,
                    value = event.reason,
                    observedAt = Instant.ofEpochMilli(event.atMs).toString(),
                    deviceId = deviceId,
                    metadata = mapOf(
                        "packageName" to auditedPackage,
                        "identityHidden" to (!exposeIdentity).toString(),
                        "action" to event.action,
                        "allowed" to event.allowed.toString(),
                        "reason" to event.reason,
                        "sensitivity" to if (exposeIdentity) event.sensitivity.name else PRIVATE_SENSITIVITY,
                        "temporaryGrantUsed" to event.temporaryGrantUsed.toString(),
                    ),
                    clientEventId = "visual-audit:$deviceId:${event.atMs}:${event.action}:$auditedPackage:${event.reason}",
                ),
            )
        }
    }

    companion object {
        private const val PRIVATE_APP_LABEL = "private_app_active"
        private const val PRIVATE_SENSITIVITY = "PRIVATE_HIDDEN"
    }
}
