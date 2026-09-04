package com.hermes.companion

import java.net.URI
import java.text.DateFormat
import java.util.Date

data class DiagnosticsReport(
    val appVersion: String,
    val deviceId: String,
    val runtimeUrl: String,
    val bootstrapTokenPresent: Boolean,
    val deviceTokenPresent: Boolean,
    val connected: Boolean,
    val periodicWorkerStatus: String,
    val immediateWorkerStatus: String,
    val lastWorkerRun: Long,
    val lastPeriodicCollection: Long,
    val lastSuccessfulUpload: Long,
    val lastManualHeartbeat: Long,
    val pendingEvents: Int,
    val usageSummaryAvailable: Boolean,
    val usageAccessGranted: Boolean,
    val detectedForegroundPackage: String?,
    val usageCurrentPackage: String?,
    val lastApiError: String,
) {
    fun asText(): String = buildString {
        appendLine("Our Home Android diagnostics")
        appendLine("App version: $appVersion")
        appendLine("Device ID: $deviceId")
        appendLine("Runtime URL: ${safeRuntimeUrl(runtimeUrl)}")
        appendLine("Connected: ${yesNo(connected)}")
        appendLine("Registration token present: ${yesNo(bootstrapTokenPresent)}")
        appendLine("Device token present: ${yesNo(deviceTokenPresent)}")
        appendLine("Periodic worker: $periodicWorkerStatus")
        appendLine("Immediate upload worker: $immediateWorkerStatus")
        appendLine("Last worker run: ${formatTime(lastWorkerRun)}")
        appendLine("Last periodic collection: ${formatTime(lastPeriodicCollection)}")
        appendLine("Last successful upload: ${formatTime(lastSuccessfulUpload)}")
        appendLine("Last manual heartbeat attempt: ${formatTime(lastManualHeartbeat)}")
        appendLine("Pending events: $pendingEvents")
        appendLine("Usage summary available: ${yesNo(usageSummaryAvailable)}")
        appendLine("Usage Access: ${if (usageAccessGranted) "granted" else "required"}")
        appendLine("Detected foreground package: ${detectedForegroundPackage ?: "none"}")
        appendLine("Usage current package: ${usageCurrentPackage ?: "none"}")
        append("Last API error: ${lastApiError.ifBlank { "none" }}")
    }

    private fun yesNo(value: Boolean): String = if (value) "yes" else "no"

    private fun formatTime(value: Long): String =
        if (value == 0L) "never" else DateFormat.getDateTimeInstance().format(Date(value))

    private fun safeRuntimeUrl(value: String): String {
        if (value.isBlank()) return "not configured"
        return runCatching {
            val uri = URI(value)
            URI(uri.scheme, null, uri.host, uri.port, uri.path, null, null).toString()
        }.getOrDefault("configured (invalid URL hidden)")
    }
}
