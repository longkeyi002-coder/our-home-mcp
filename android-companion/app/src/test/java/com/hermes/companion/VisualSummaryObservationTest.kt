package com.hermes.companion

import com.hermes.companion.vision.VisualCaptureRequest
import com.hermes.companion.vision.VisualObservationSummary
import com.hermes.companion.vision.VisualSummaryObservation
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import org.junit.Test

class VisualSummaryObservationTest {
    @Test
    fun providerFreeTextIsNotPersistedInRuntimeObservation() {
        val request = VisualCaptureRequest(
            requestId = "request-1",
            packageName = "com.example.game",
            sessionId = "com.example.game:100",
            reason = "unknown_dwell",
        )
        val providerText = "Alice OTP 123456 account 99887766"
        val observation = VisualSummaryObservation.create(
            deviceId = "android-1",
            request = request,
            summary = VisualObservationSummary(
                activity = "gaming",
                content = providerText,
                confidence = 0.91,
                provider = "zhipu",
                model = "glm-4.6v-flash",
            ),
            observedAtMs = 1_757_030_400_000L,
        )

        assertEquals("visual_observation_summary", observation.kind)
        assertEquals("gaming", observation.label)
        assertEquals("game activity", observation.value)
        assertFalse(observation.value.orEmpty().contains("Alice"))
        assertFalse(observation.value.orEmpty().contains("123456"))
        assertFalse(observation.metadata.orEmpty().values.any { it.contains(providerText) })
        assertEquals("gaming", observation.metadata?.get("activity"))
        assertEquals("zhipu", observation.metadata?.get("provider"))
    }

    @Test
    fun unknownProviderActivityFailsClosed() {
        val observation = VisualSummaryObservation.create(
            deviceId = "android-1",
            request = VisualCaptureRequest("r2", "com.example.app", "com.example.app:200", "stale_context"),
            summary = VisualObservationSummary("unexpected", "private model text", 4.0, "zhipu", "glm-4.6v-flash"),
            observedAtMs = 1_757_030_400_000L,
        )
        assertEquals("unknown", observation.label)
        assertEquals("screen activity unclear", observation.value)
        assertEquals("1.000", observation.metadata?.get("confidence"))
    }
}
