package com.hermes.companion.data

import com.hermes.companion.platform.UsagePrivacyFilter
import com.hermes.companion.platform.UsageSession
import com.hermes.companion.platform.UsageTimelineSummary
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString

/**
 * Final privacy boundary immediately before a queued payload crosses the network.
 *
 * Collection-time filtering is still required, but it is not sufficient: an event may have
 * been queued while offline, by an older build, or before the user changed an App policy.
 * This second pass makes the CURRENT local privacy choice authoritative at send time.
 */
class OutboundTelemetryPrivacy(
    private val exposesIdentity: (String) -> Boolean,
) {
    fun sanitizeHeartbeat(request: HeartbeatRequest): HeartbeatRequest = request.copy(
        foregroundPackage = sanitizePackage(request.foregroundPackage),
    )

    /**
     * Returns null when the safest action is to discard a stale queued observation rather than
     * send a redacted version whose semantic content would still reveal a now-hidden App.
     */
    fun sanitizeObservation(request: ObservationRequest): ObservationRequest? = when (request.kind) {
        "presence_app_transition" -> sanitizeTransition(request)
        "presence_app_session_end", "presence_app_dwell" -> sanitizePresencePackage(request)
        "usage_summary" -> sanitizeUsageSummary(request)
        "visual_policy_audit" -> sanitizeVisualAudit(request)
        "visual_observation_summary" -> sanitizeVisualSummary(request)
        else -> sanitizeKnownPackageMetadata(request)
    }

    private fun sanitizeTransition(request: ObservationRequest): ObservationRequest {
        val metadata = request.metadata.orEmpty()
        val rawTo = firstNonBlank(metadata["toPackage"], request.value, request.label)
        val rawFrom = metadata["fromPackage"].orEmpty()
        val safeTo = sanitizePackage(rawTo) ?: PRIVATE_APP_LABEL
        val safeFrom = sanitizePackage(rawFrom).orEmpty()
        val hiddenTo = rawTo.isNotBlank() && safeTo != rawTo
        val hiddenFrom = rawFrom.isNotBlank() && safeFrom != rawFrom
        return request.copy(
            label = safeTo,
            value = safeTo,
            metadata = metadata + mapOf(
                "toPackage" to safeTo,
                "fromPackage" to safeFrom,
                "identityHidden" to hiddenTo.toString(),
                "previousIdentityHidden" to hiddenFrom.toString(),
            ),
            clientEventId = sanitizeClientEventId(request.clientEventId, rawTo, rawFrom),
        )
    }

    private fun sanitizePresencePackage(request: ObservationRequest): ObservationRequest {
        val metadata = request.metadata.orEmpty()
        val rawPackage = firstNonBlank(metadata["packageName"], request.label)
        val safePackage = sanitizePackage(rawPackage) ?: PRIVATE_APP_LABEL
        val hidden = rawPackage.isNotBlank() && safePackage != rawPackage
        return request.copy(
            label = safePackage,
            metadata = metadata + mapOf(
                "packageName" to safePackage,
                "identityHidden" to hidden.toString(),
            ),
            clientEventId = sanitizeClientEventId(request.clientEventId, rawPackage),
        )
    }

    private fun sanitizeUsageSummary(request: ObservationRequest): ObservationRequest {
        val metadata = request.metadata.orEmpty()
        val rawCurrent = firstNonBlank(metadata["currentPackage"], request.value)
        val sessions = runCatching {
            WireJson.decodeFromString<List<UsageSession>>(metadata["sessions"].orEmpty())
        }.getOrNull()

        // If an old/malformed queued payload cannot be safely reconstructed, remove all aggregate
        // fields that might contain package/category identity rather than forwarding raw JSON.
        if (sessions == null) {
            val safeCurrent = sanitizePackage(rawCurrent).orEmpty()
            return request.copy(
                value = safeCurrent.ifBlank { null },
                metadata = metadata + mapOf(
                    "currentPackage" to safeCurrent,
                    "appTotalsMs" to "{}",
                    "categoryTotalsMs" to "{}",
                    "sessions" to "[]",
                    "privacyReconstructed" to "false",
                ),
            )
        }

        val summary = UsageTimelineSummary(
            observedAt = 0L,
            currentPackageName = rawCurrent.ifBlank { null },
            currentDurationMs = metadata["currentDurationMs"]?.toLongOrNull() ?: 0L,
            sessions = sessions,
            appTotalsMs = emptyMap(),
            categoryTotalsMs = emptyMap(),
        )
        val redacted = UsagePrivacyFilter.redact(summary, exposesIdentity)
        return request.copy(
            value = redacted.currentPackageName,
            metadata = metadata + mapOf(
                "currentPackage" to redacted.currentPackageName.orEmpty(),
                "currentDurationMs" to redacted.currentDurationMs.toString(),
                "appTotalsMs" to WireJson.encodeToString(redacted.appTotalsMs),
                "categoryTotalsMs" to WireJson.encodeToString(redacted.categoryTotalsMs),
                "sessions" to WireJson.encodeToString(redacted.sessions),
                "privacyReconstructed" to "true",
            ),
        )
    }

    private fun sanitizeVisualAudit(request: ObservationRequest): ObservationRequest {
        val metadata = request.metadata.orEmpty()
        val rawPackage = metadata["packageName"].orEmpty()
        if (rawPackage.isBlank()) return request
        val safePackage = sanitizePackage(rawPackage) ?: PRIVATE_APP_LABEL
        if (safePackage == rawPackage) return request
        return request.copy(
            metadata = metadata + mapOf(
                "packageName" to PRIVATE_APP_LABEL,
                "identityHidden" to "true",
                "sensitivity" to PRIVATE_SENSITIVITY,
            ),
            clientEventId = sanitizeClientEventId(request.clientEventId, rawPackage),
        )
    }

    private fun sanitizeVisualSummary(request: ObservationRequest): ObservationRequest? {
        val rawPackage = request.metadata?.get("packageName")?.takeIf { it.isNotBlank() }
            ?: return null
        // Activity labels such as gaming/social can still reveal what the user was doing, even if
        // the package name is removed. A queued summary for an App that is hidden NOW is dropped.
        return request.takeIf { exposesIdentity(rawPackage) }
    }

    private fun sanitizeKnownPackageMetadata(request: ObservationRequest): ObservationRequest {
        val metadata = request.metadata ?: return request
        var changed = false
        val rawPackages = mutableListOf<String>()
        val safe = metadata.toMutableMap()
        PACKAGE_METADATA_KEYS.forEach { key ->
            val raw = safe[key]?.takeIf { it.isNotBlank() } ?: return@forEach
            val sanitized = sanitizePackage(raw).orEmpty()
            if (sanitized != raw) {
                safe[key] = sanitized
                rawPackages += raw
                changed = true
            }
        }
        if (!changed) return request
        safe["identityHidden"] = "true"
        return request.copy(
            metadata = safe,
            clientEventId = sanitizeClientEventId(request.clientEventId, *rawPackages.toTypedArray()),
        )
    }

    private fun sanitizePackage(packageName: String?): String? {
        val normalized = packageName?.trim()?.takeIf { it.isNotBlank() } ?: return packageName
        if (normalized == PRIVATE_APP_LABEL) return PRIVATE_APP_LABEL
        return if (exposesIdentity(normalized)) normalized else PRIVATE_APP_LABEL
    }

    private fun sanitizeClientEventId(clientEventId: String?, vararg rawPackages: String): String? {
        var safe = clientEventId ?: return null
        rawPackages.filter { it.isNotBlank() && !exposesIdentity(it) }.forEach { raw ->
            safe = safe.replace(raw, PRIVATE_APP_LABEL)
        }
        return safe
    }

    private fun firstNonBlank(vararg values: String?): String =
        values.firstOrNull { !it.isNullOrBlank() }?.trim().orEmpty()

    companion object {
        const val PRIVATE_APP_LABEL = "private_app_active"
        private const val PRIVATE_SENSITIVITY = "PRIVATE_HIDDEN"
        private val PACKAGE_METADATA_KEYS = setOf(
            "packageName",
            "currentPackage",
            "foregroundPackage",
            "toPackage",
            "fromPackage",
        )
    }
}
