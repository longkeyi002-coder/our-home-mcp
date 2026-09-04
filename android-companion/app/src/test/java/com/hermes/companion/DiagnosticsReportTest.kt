package com.hermes.companion

import kotlin.test.assertContains
import kotlin.test.assertFalse
import org.junit.Test

class DiagnosticsReportTest {
    @Test
    fun copiedReportContainsUsefulStateWithoutUrlSecrets() {
        val text = DiagnosticsReport(
            appVersion = "0.1.0",
            deviceId = "android-test",
            runtimeUrl = "https://runtime.example/v1?token=url-secret#fragment",
            bootstrapTokenPresent = true,
            deviceTokenPresent = true,
            connected = false,
            periodicWorkerStatus = "scheduled",
            immediateWorkerStatus = "retrying (2)",
            lastWorkerRun = 0,
            lastPeriodicCollection = 0,
            lastSuccessfulUpload = 0,
            lastManualHeartbeat = 0,
            pendingEvents = 4,
            usageSummaryAvailable = true,
            usageAccessGranted = true,
            detectedForegroundPackage = null,
            usageCurrentPackage = "com.example.app",
            lastApiError = "registration HTTP 401 — token rejected",
        ).asText()

        assertContains(text, "Runtime URL: https://runtime.example/v1")
        assertContains(text, "Registration token present: yes")
        assertContains(text, "Device token present: yes")
        assertContains(text, "Immediate upload worker: retrying (2)")
        assertContains(text, "Pending events: 4")
        assertContains(text, "registration HTTP 401")
        assertFalse(text.contains("url-secret"))
        assertFalse(text.contains("fragment"))
    }
}
