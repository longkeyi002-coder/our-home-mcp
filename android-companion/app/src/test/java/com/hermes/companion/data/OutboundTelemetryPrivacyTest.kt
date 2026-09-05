package com.hermes.companion.data

import com.hermes.companion.platform.UsageSession
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class OutboundTelemetryPrivacyTest {
    private val hiddenPackage = "com.example.secret"
    private val allowedPackage = "com.example.allowed"
    private val privacy = OutboundTelemetryPrivacy { it != hiddenPackage }

    @Test
    fun `queued heartbeat is rechecked against current presence policy`() {
        val queued = HeartbeatRequest(
            deviceId = "phone-1",
            batteryPercent = 80,
            charging = false,
            appVersion = "0.1",
            connectivityState = "online",
            foregroundPackage = hiddenPackage,
            observedAt = "2026-09-05T00:00:00Z",
            clientEventId = "heartbeat-1",
        )

        val safe = privacy.sanitizeHeartbeat(queued)

        assertEquals(OutboundTelemetryPrivacy.PRIVATE_APP_LABEL, safe.foregroundPackage)
    }

    @Test
    fun `queued presence transition removes hidden package from all identity fields`() {
        val queued = ObservationRequest(
            kind = "presence_app_transition",
            label = hiddenPackage,
            value = hiddenPackage,
            observedAt = "2026-09-05T00:00:00Z",
            deviceId = "phone-1",
            metadata = mapOf(
                "fromPackage" to allowedPackage,
                "toPackage" to hiddenPackage,
                "previousDurationMs" to "1000",
            ),
            clientEventId = "presence-app:phone-1:1:$hiddenPackage",
        )

        val safe = privacy.sanitizeObservation(queued)!!
        val serialized = WireJson.encodeToString(safe)

        assertEquals(OutboundTelemetryPrivacy.PRIVATE_APP_LABEL, safe.label)
        assertEquals(OutboundTelemetryPrivacy.PRIVATE_APP_LABEL, safe.value)
        assertEquals(OutboundTelemetryPrivacy.PRIVATE_APP_LABEL, safe.metadata?.get("toPackage"))
        assertEquals(allowedPackage, safe.metadata?.get("fromPackage"))
        assertEquals("true", safe.metadata?.get("identityHidden"))
        assertFalse(serialized.contains(hiddenPackage))
    }

    @Test
    fun `queued visual summary is discarded when app became hidden`() {
        val queued = ObservationRequest(
            kind = "visual_observation_summary",
            label = "gaming",
            value = "game activity",
            observedAt = "2026-09-05T00:00:00Z",
            deviceId = "phone-1",
            metadata = mapOf(
                "packageName" to hiddenPackage,
                "activity" to "gaming",
                "confidence" to "0.9",
            ),
            clientEventId = "visual-summary:request-1",
        )

        assertNull(privacy.sanitizeObservation(queued))
    }

    @Test
    fun `legacy queued usage summary is rebuilt with hidden session identity redacted`() {
        val sessions = listOf(
            UsageSession(allowedPackage, 1_000L, 3_000L, 2_000L, "social"),
            UsageSession(hiddenPackage, 3_000L, 8_000L, 5_000L, "shopping"),
        )
        val queued = ObservationRequest(
            kind = "usage_summary",
            label = "app usage timeline",
            value = hiddenPackage,
            observedAt = "2026-09-05T00:00:00Z",
            deviceId = "phone-1",
            metadata = mapOf(
                "currentPackage" to hiddenPackage,
                "currentDurationMs" to "5000",
                "appTotalsMs" to WireJson.encodeToString(mapOf(allowedPackage to 2_000L, hiddenPackage to 5_000L)),
                "categoryTotalsMs" to WireJson.encodeToString(mapOf("social" to 2_000L, "shopping" to 5_000L)),
                "sessions" to WireJson.encodeToString(sessions),
            ),
            clientEventId = "usage-summary:phone-1:2026-09-05:1",
        )

        val safe = privacy.sanitizeObservation(queued)!!
        val safeSessions = WireJson.decodeFromString<List<UsageSession>>(safe.metadata!!.getValue("sessions"))
        val serialized = WireJson.encodeToString(safe)

        assertEquals(OutboundTelemetryPrivacy.PRIVATE_APP_LABEL, safe.value)
        assertEquals(OutboundTelemetryPrivacy.PRIVATE_APP_LABEL, safe.metadata?.get("currentPackage"))
        assertEquals(
            listOf(allowedPackage, OutboundTelemetryPrivacy.PRIVATE_APP_LABEL),
            safeSessions.map { it.packageName },
        )
        assertEquals(listOf("social", "private"), safeSessions.map { it.category })
        assertFalse(serialized.contains(hiddenPackage))
        assertFalse(serialized.contains("shopping"))
        assertTrue(serialized.contains(OutboundTelemetryPrivacy.PRIVATE_APP_LABEL))
    }

    @Test
    fun `malformed legacy usage aggregates fail closed instead of forwarding raw package maps`() {
        val queued = ObservationRequest(
            kind = "usage_summary",
            label = "app usage timeline",
            value = hiddenPackage,
            observedAt = "2026-09-05T00:00:00Z",
            deviceId = "phone-1",
            metadata = mapOf(
                "currentPackage" to hiddenPackage,
                "appTotalsMs" to "{\"$hiddenPackage\":999999}",
                "categoryTotalsMs" to "{\"shopping\":999999}",
                "sessions" to "not-json",
            ),
        )

        val safe = privacy.sanitizeObservation(queued)!!
        val serialized = WireJson.encodeToString(safe)

        assertEquals("{}", safe.metadata?.get("appTotalsMs"))
        assertEquals("{}", safe.metadata?.get("categoryTotalsMs"))
        assertEquals("[]", safe.metadata?.get("sessions"))
        assertFalse(serialized.contains(hiddenPackage))
        assertFalse(serialized.contains("shopping"))
    }
}
