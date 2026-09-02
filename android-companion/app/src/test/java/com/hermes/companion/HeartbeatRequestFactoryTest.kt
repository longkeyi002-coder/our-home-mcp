package com.hermes.companion

import com.hermes.companion.data.HeartbeatRequestFactory
import com.hermes.companion.platform.DeviceStatus
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HeartbeatRequestFactoryTest {
    @Test
    fun mapsAutomaticDeviceStatus() {
        val request = HeartbeatRequestFactory.create(
            deviceId = "android-test",
            appVersion = "0.2.0",
            status = DeviceStatus(
                batteryPercent = 82,
                charging = true,
                online = true,
                foregroundPackage = "com.example.reader",
            ),
            observedAt = "2026-09-02T00:00:00Z",
            clientEventId = "event-1",
        )

        assertEquals("android-test", request.deviceId)
        assertEquals(82, request.batteryPercent)
        assertEquals(true, request.charging)
        assertEquals("online", request.connectivityState)
        assertEquals("com.example.reader", request.foregroundPackage)
        assertEquals("2026-09-02T00:00:00Z", request.observedAt)
        assertEquals("event-1", request.clientEventId)
    }

    @Test
    fun missingUsageAccessProducesNullForegroundPackage() {
        val request = HeartbeatRequestFactory.create(
            deviceId = "android-test",
            appVersion = "0.2.0",
            status = DeviceStatus(50, false, false, null),
        )

        assertEquals("offline", request.connectivityState)
        assertNull(request.foregroundPackage)
        assertTrue(runCatching { Instant.parse(request.observedAt) }.isSuccess)
        assertTrue(request.clientEventId.isNotBlank())
    }

    @Test
    fun eachHeartbeatGetsFreshClientEventId() {
        val status = DeviceStatus(50, false, true, null)
        val first = HeartbeatRequestFactory.create("android-test", "0.2.0", status)
        val second = HeartbeatRequestFactory.create("android-test", "0.2.0", status)

        assertNotEquals(first.clientEventId, second.clientEventId)
        assertTrue(first.observedAt.isNotBlank())
        assertTrue(second.observedAt.isNotBlank())
    }
}
