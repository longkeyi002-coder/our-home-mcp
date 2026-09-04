package com.hermes.companion

import com.hermes.companion.data.TelemetryPolicy
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class TelemetryPolicyTest {
    @Test
    fun `OH-41 OH-42 telemetry requires endpoint and credential`() {
        assertFalse(TelemetryPolicy.isConfigured("", null, null))
        assertFalse(TelemetryPolicy.isConfigured("https://runtime.example", null, null))
        assertFalse(TelemetryPolicy.isConfigured("", "bootstrap", null))
        assertTrue(TelemetryPolicy.isConfigured("https://runtime.example", "bootstrap", null))
        assertTrue(TelemetryPolicy.isConfigured("https://runtime.example", null, "device-token"))
    }

    @Test
    fun `OH-40 periodic heartbeat id is stable inside one bucket`() {
        val bucket = TelemetryPolicy.HEARTBEAT_BUCKET_MS
        val first = TelemetryPolicy.periodicHeartbeatEventId("android-test", bucket * 42 + 1)
        val sameBucket = TelemetryPolicy.periodicHeartbeatEventId("android-test", bucket * 42 + bucket - 1)
        val nextBucket = TelemetryPolicy.periodicHeartbeatEventId("android-test", bucket * 43)

        assertEquals(first, sameBucket)
        assertNotEquals(first, nextBucket)
    }
}
