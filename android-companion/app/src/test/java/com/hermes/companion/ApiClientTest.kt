package com.hermes.companion

import com.hermes.companion.data.ApiClient
import com.hermes.companion.data.HeartbeatRequest
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class ApiClientTest {
    @Test
    fun acceptsHttpsAndLocalHttpOnly() {
        ApiClient.create("https://example.com")
        ApiClient.create("http://localhost:8787")
        assertFailsWith<IllegalArgumentException> { ApiClient.create("http://example.com") }
    }

    @Test
    fun heartbeatSerializationUsesServerFieldNames() {
        val request = HeartbeatRequest("android-test", batteryPercent = 82, charging = true, appVersion = "0.1.0", connectivityState = "online", observedAt = "2026-09-02T00:00:00Z", clientEventId = "event-1")
        val json = Json.encodeToString(request)
        assertEquals(82, Json.parseToJsonElement(json).jsonObject["batteryPercent"]?.toString()?.toInt())
        assertEquals("online", Json.parseToJsonElement(json).jsonObject["connectivityState"]?.toString()?.trim('"'))
    }
}
