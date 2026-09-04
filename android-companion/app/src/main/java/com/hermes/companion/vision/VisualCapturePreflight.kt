package com.hermes.companion.vision

import com.hermes.companion.presence.PresenceSnapshot

data class VisualCaptureRequest(
    val requestId: String,
    val packageName: String,
    val sessionId: String,
    val reason: String,
)

enum class VisualPreflightReason {
    READY,
    NO_CURRENT_APP,
    APP_MISMATCH,
    SESSION_MISMATCH,
    SCREEN_NOT_USABLE,
}

data class VisualPreflightDecision(
    val allowed: Boolean,
    val reason: VisualPreflightReason,
)

/**
 * OH-45/OH-69: server curiosity is only a request. Android must independently verify
 * that the request still targets the exact foreground App session and usable screen.
 */
object VisualCapturePreflight {
    fun sessionId(packageName: String, startedAtMs: Long): String = "$packageName:$startedAtMs"

    fun decide(snapshot: PresenceSnapshot, request: VisualCaptureRequest): VisualPreflightDecision {
        val current = snapshot.currentPackage
            ?: return VisualPreflightDecision(false, VisualPreflightReason.NO_CURRENT_APP)
        if (current != request.packageName) {
            return VisualPreflightDecision(false, VisualPreflightReason.APP_MISMATCH)
        }
        val expectedSession = sessionId(current, snapshot.currentStartedAtMs)
        if (request.sessionId != expectedSession) {
            return VisualPreflightDecision(false, VisualPreflightReason.SESSION_MISMATCH)
        }
        if (!snapshot.screenInteractive || !snapshot.unlocked) {
            return VisualPreflightDecision(false, VisualPreflightReason.SCREEN_NOT_USABLE)
        }
        return VisualPreflightDecision(true, VisualPreflightReason.READY)
    }
}
