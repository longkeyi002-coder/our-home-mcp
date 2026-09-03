package com.hermes.companion

import com.hermes.companion.data.ApiClient
import com.hermes.companion.data.HeartbeatRequest
import com.hermes.companion.data.RegisterRequest
import com.hermes.companion.data.WireJson
import com.hermes.companion.push.HermesNotifications
import com.hermes.companion.push.PushRegistration
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse

class ApiClientTest {
    @Test
    fun acceptsHttpsAndLocalHttpOnly() {
        ApiClient.create("https://example.com")
        ApiClient.create("http://localhost:8787")
        assertFailsWith<IllegalArgumentException> { ApiClient.create("http://example.com") }
    }

    @Test
    fun heartbeatSerializationUsesServerFieldNames() {
        val request = HeartbeatRequest("android-test", batteryPercent = 82, charging = true, appVersion = "0.2.0", connectivityState = "online", observedAt = "2026-09-02T00:00:00Z", clientEventId = "event-1")
        val payload = WireJson.parseToJsonElement(WireJson.encodeToString(request)).jsonObject

        assertEquals(setOf("deviceId", "status", "batteryPercent", "charging", "appVersion", "connectivityState", "observedAt", "clientEventId"), payload.keys)
        assertEquals("android-test", payload.getValue("deviceId").jsonPrimitive.content)
        assertEquals("online", payload.getValue("status").jsonPrimitive.content)
        assertEquals(82, payload.getValue("batteryPercent").jsonPrimitive.int)
        assertEquals(true, payload.getValue("charging").jsonPrimitive.boolean)
        assertEquals("2026-09-02T00:00:00Z", payload.getValue("observedAt").jsonPrimitive.content)
        assertEquals(null, payload["foregroundPackage"])
        assertFalse(payload.values.any { it is JsonNull })
    }

    @Test
    fun registerSerializationUsesServerContract() {
        val payload = WireJson.parseToJsonElement(
            WireJson.encodeToString(RegisterRequest("android-test", "0.2.0", "fid-1", "push-1")),
        ).jsonObject

        assertEquals(setOf("deviceId", "appVersion", "pushFid", "pushToken"), payload.keys)
        assertEquals("android-test", payload.getValue("deviceId").jsonPrimitive.content)
        assertEquals("0.2.0", payload.getValue("appVersion").jsonPrimitive.content)
        assertEquals("fid-1", payload.getValue("pushFid").jsonPrimitive.content)
        assertEquals("push-1", payload.getValue("pushToken").jsonPrimitive.content)
    }

    @Test
    fun tokenRefreshTriggersRegistration() = runTest {
        val calls = mutableListOf<Pair<String?, String>>()
        PushRegistration.handleRefresh("fid-refresh", "token-refresh") { fid, token -> calls += fid to token }
        assertEquals(listOf("fid-refresh" to "token-refresh"), calls)
    }

    @Test
    fun notificationPayloadPreservesCandidateTitleAndBody() {
        val notification = HermesNotifications.fromPayload(
            mapOf("candidateId" to "candidate-1"), "Title", "Body",
        )
        assertEquals("candidate-1", notification.candidateId)
        assertEquals("Title", notification.title)
        assertEquals("Body", notification.body)
        assertEquals("hermes_life", HermesNotifications.CHANNEL_ID)
    }
}
