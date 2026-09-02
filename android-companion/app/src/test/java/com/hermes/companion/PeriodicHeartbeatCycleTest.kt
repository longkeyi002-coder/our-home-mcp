package com.hermes.companion

import com.hermes.companion.data.HeartbeatRequest
import com.hermes.companion.data.runHeartbeatCycle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

class PeriodicHeartbeatCycleTest {
    @Test
    fun collectsThenQueuesThenUploads() = runTest {
        val steps = mutableListOf<String>()
        val heartbeat = sampleHeartbeat()

        runHeartbeatCycle(
            createHeartbeat = {
                steps += "collect"
                heartbeat
            },
            enqueueHeartbeat = {
                assertEquals(heartbeat, it)
                steps += "enqueue"
            },
            recordHeartbeat = { steps += "record" },
            uploadPending = {
                steps += "upload"
                true
            },
            scheduleRecoveryUpload = { steps += "recover" },
        )

        assertEquals(listOf("collect", "enqueue", "record", "upload"), steps)
    }

    @Test
    fun failedUploadSchedulesNetworkRecovery() = runTest {
        val steps = mutableListOf<String>()

        runHeartbeatCycle(
            createHeartbeat = { sampleHeartbeat() },
            enqueueHeartbeat = { steps += "enqueue" },
            recordHeartbeat = { steps += "record" },
            uploadPending = {
                steps += "upload"
                false
            },
            scheduleRecoveryUpload = { steps += "recover" },
        )

        assertEquals(listOf("enqueue", "record", "upload", "recover"), steps)
    }

    private fun sampleHeartbeat() = HeartbeatRequest(
        deviceId = "android-test",
        batteryPercent = 82,
        charging = true,
        appVersion = "0.2.0",
        connectivityState = "online",
        observedAt = "2026-09-02T00:00:00Z",
        clientEventId = "event-1",
    )
}
