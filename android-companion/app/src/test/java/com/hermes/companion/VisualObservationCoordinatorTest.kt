package com.hermes.companion

import com.hermes.companion.vision.EphemeralVisualFrame
import com.hermes.companion.vision.VisualCaptureOutcome
import com.hermes.companion.vision.VisualCaptureRequest
import com.hermes.companion.vision.VisualObservationCoordinator
import com.hermes.companion.vision.VisualObservationOutcome
import com.hermes.companion.vision.VisualObservationSummary
import com.hermes.companion.vision.VisionProvider
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import org.junit.Test

class VisualObservationCoordinatorTest {
    private val request = VisualCaptureRequest(
        requestId = "request-1",
        packageName = "com.example.game",
        sessionId = "com.example.game:100",
        reason = "unknown_dwell",
    )

    @Test
    fun disabledVisionNeverAttemptsCapture() = runTest {
        var captureCalled = false
        var indicatorCalled = false
        val coordinator = VisualObservationCoordinator(
            isEnabledAndConfigured = { false },
            capture = { _, _ -> captureCalled = true; true },
            provider = FakeProvider(),
            beginIndicator = { indicatorCalled = true; true },
        )

        val outcome = coordinator.observe(request)
        assertIs<VisualObservationOutcome.Blocked>(outcome)
        assertEquals("visual_not_enabled_or_configured", outcome.reason)
        assertFalse(captureCalled)
        assertFalse(indicatorCalled)
    }

    @Test
    fun unavailableIndicatorFailsClosedBeforeCapture() = runTest {
        var captureCalled = false
        val coordinator = VisualObservationCoordinator(
            isEnabledAndConfigured = { true },
            capture = { _, _ -> captureCalled = true; true },
            provider = FakeProvider(),
            beginIndicator = { false },
        )

        val outcome = coordinator.observe(request)
        assertIs<VisualObservationOutcome.Blocked>(outcome)
        assertEquals("visual_indicator_unavailable", outcome.reason)
        assertFalse(captureCalled)
    }

    @Test
    fun unavailableAccessibilityFailsWithoutProviderCallAndEndsIndicator() = runTest {
        val provider = FakeProvider()
        var endCount = 0
        val coordinator = VisualObservationCoordinator(
            isEnabledAndConfigured = { true },
            capture = { _, _ -> false },
            provider = provider,
            beginIndicator = { true },
            endIndicator = { endCount += 1 },
        )

        val outcome = coordinator.observe(request)
        assertIs<VisualObservationOutcome.Failed>(outcome)
        assertEquals("accessibility_service_unavailable", outcome.reason)
        assertFalse(provider.called)
        assertEquals(1, endCount)
    }

    @Test
    fun localGuardBlockNeverCallsProviderAndEndsIndicator() = runTest {
        val provider = FakeProvider()
        var endCount = 0
        val coordinator = VisualObservationCoordinator(
            isEnabledAndConfigured = { true },
            capture = { _, callback -> callback(VisualCaptureOutcome.Blocked("PROTECTED_REQUIRES_TEMPORARY_GRANT")); true },
            provider = provider,
            beginIndicator = { true },
            endIndicator = { endCount += 1 },
        )

        val outcome = coordinator.observe(request)
        assertIs<VisualObservationOutcome.Blocked>(outcome)
        assertEquals("PROTECTED_REQUIRES_TEMPORARY_GRANT", outcome.reason)
        assertFalse(provider.called)
        assertEquals(1, endCount)
    }

    @Test
    fun allowedCaptureIsAnalyzedExactlyOnceFrameIsClosedAndIndicatorEnds() = runTest {
        val bytes = byteArrayOf(1, 2, 3)
        val frame = EphemeralVisualFrame.jpeg("request-1", "com.example.game", bytes)
        val provider = FakeProvider()
        var beginCount = 0
        var endCount = 0
        val coordinator = VisualObservationCoordinator(
            isEnabledAndConfigured = { true },
            capture = { _, callback -> callback(VisualCaptureOutcome.Captured(frame)); true },
            provider = provider,
            beginIndicator = { beginCount += 1; true },
            endIndicator = { endCount += 1 },
        )

        val outcome = coordinator.observe(request)
        assertIs<VisualObservationOutcome.Observed>(outcome)
        assertEquals("gaming", outcome.summary.activity)
        assertTrue(provider.called)
        assertTrue(frame.isClosed)
        assertTrue(bytes.all { it == 0.toByte() })
        assertEquals(1, beginCount)
        assertEquals(1, endCount)
    }

    private class FakeProvider : VisionProvider {
        var called = false
        override suspend fun analyze(frame: EphemeralVisualFrame): VisualObservationSummary {
            called = true
            frame.close()
            return VisualObservationSummary(
                activity = "gaming",
                content = "generic game scene",
                confidence = 0.9,
                provider = "fake",
                model = "fake",
            )
        }
    }
}
