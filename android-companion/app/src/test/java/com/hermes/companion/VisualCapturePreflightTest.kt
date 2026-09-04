package com.hermes.companion

import com.hermes.companion.presence.PresenceSnapshot
import com.hermes.companion.vision.VisualCapturePreflight
import com.hermes.companion.vision.VisualCaptureRequest
import com.hermes.companion.vision.VisualPreflightReason
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.junit.Test

class VisualCapturePreflightTest {
    private fun snapshot(
        packageName: String? = "com.example.game",
        startedAtMs: Long = 1_000L,
        screenInteractive: Boolean = true,
        unlocked: Boolean = true,
    ) = PresenceSnapshot(
        currentPackage = packageName,
        currentStartedAtMs = startedAtMs,
        lastTransitionAtMs = startedAtMs,
        lastFromPackage = null,
        lastToPackage = packageName,
        screenInteractive = screenInteractive,
        unlocked = unlocked,
        accessibilityConnected = true,
        lastAccessibilityEventAtMs = startedAtMs,
    )

    private fun request(
        packageName: String = "com.example.game",
        sessionId: String = "com.example.game:1000",
    ) = VisualCaptureRequest(
        requestId = "visual-1",
        packageName = packageName,
        sessionId = sessionId,
        reason = "unknown_dwell",
    )

    @Test
    fun exactCurrentAppSessionIsReady() {
        val result = VisualCapturePreflight.decide(snapshot(), request())
        assertTrue(result.allowed)
        assertEquals(VisualPreflightReason.READY, result.reason)
    }

    @Test
    fun staleRequestCannotCaptureAfterAppSwitch() {
        val result = VisualCapturePreflight.decide(
            snapshot(packageName = "com.example.chat", startedAtMs = 2_000L),
            request(),
        )
        assertFalse(result.allowed)
        assertEquals(VisualPreflightReason.APP_MISMATCH, result.reason)
    }

    @Test
    fun staleRequestCannotCaptureNewSessionOfSameApp() {
        val result = VisualCapturePreflight.decide(
            snapshot(startedAtMs = 3_000L),
            request(sessionId = "com.example.game:1000"),
        )
        assertFalse(result.allowed)
        assertEquals(VisualPreflightReason.SESSION_MISMATCH, result.reason)
    }

    @Test
    fun screenOffBlocksBeforeCapture() {
        val result = VisualCapturePreflight.decide(snapshot(screenInteractive = false, unlocked = false), request())
        assertFalse(result.allowed)
        assertEquals(VisualPreflightReason.SCREEN_NOT_USABLE, result.reason)
    }

    @Test
    fun lockedScreenBlocksBeforeCapture() {
        val result = VisualCapturePreflight.decide(snapshot(screenInteractive = true, unlocked = false), request())
        assertFalse(result.allowed)
        assertEquals(VisualPreflightReason.SCREEN_NOT_USABLE, result.reason)
    }

    @Test
    fun noForegroundAppBlocksBeforeCapture() {
        val result = VisualCapturePreflight.decide(snapshot(packageName = null), request())
        assertFalse(result.allowed)
        assertEquals(VisualPreflightReason.NO_CURRENT_APP, result.reason)
    }
}
