package com.hermes.companion.vision

import com.hermes.companion.presence.PresenceAccessibilityService
import java.lang.ref.WeakReference

sealed interface VisualCaptureOutcome {
    data class Captured(val frame: EphemeralVisualFrame) : VisualCaptureOutcome
    data class Blocked(val reason: String) : VisualCaptureOutcome
    data class Failed(val reason: String) : VisualCaptureOutcome
}

/**
 * Process-local bridge only. Runtime/FCM/HTTP cannot bypass the Accessibility service's
 * local preflight + SensitiveVisualGuard. The weak reference avoids keeping the service alive.
 */
object VisualCaptureBridge {
    @Volatile
    private var serviceRef = WeakReference<PresenceAccessibilityService>(null)

    internal fun attach(service: PresenceAccessibilityService) {
        serviceRef = WeakReference(service)
    }

    internal fun detach(service: PresenceAccessibilityService) {
        if (serviceRef.get() === service) serviceRef.clear()
    }

    fun request(request: VisualCaptureRequest, callback: (VisualCaptureOutcome) -> Unit): Boolean {
        val service = serviceRef.get() ?: return false
        service.captureVisual(request, callback)
        return true
    }
}
