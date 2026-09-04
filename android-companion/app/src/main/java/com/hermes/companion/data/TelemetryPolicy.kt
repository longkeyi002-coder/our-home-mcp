package com.hermes.companion.data

/**
 * OH-41/OH-42/OH-61: automatic telemetry starts only after the user has
 * configured a Runtime endpoint and at least one valid registration credential.
 */
object TelemetryPolicy {
    const val HEARTBEAT_BUCKET_MS = 15 * 60 * 1000L

    fun isConfigured(serverUrl: String, bootstrapToken: String?, deviceToken: String?): Boolean =
        serverUrl.isNotBlank() && (!bootstrapToken.isNullOrBlank() || !deviceToken.isNullOrBlank())

    fun periodicHeartbeatEventId(deviceId: String, observedAtMs: Long): String {
        val bucket = observedAtMs / HEARTBEAT_BUCKET_MS
        return "periodic-heartbeat:$deviceId:$bucket"
    }
}
