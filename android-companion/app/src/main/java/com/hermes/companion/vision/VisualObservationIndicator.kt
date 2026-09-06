package com.hermes.companion.vision

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * OH-45/OH-47 transparency rule: visual observation is never silent.
 *
 * Actual screenshot + provider analysis now reuses the persistent sensing-status
 * notification instead of creating a second notification. The state changes to an
 * unmistakable "正在观察屏幕" before capture and is restored afterwards. If Android
 * cannot show that state, visual observation fails closed.
 */
object VisualObservationIndicator {
    private val activeRequests = mutableSetOf<String>()
    private val _active = MutableStateFlow(false)
    val active = _active.asStateFlow()

    @Synchronized
    private fun markActive(requestId: String, active: Boolean) {
        if (active) activeRequests.add(requestId) else activeRequests.remove(requestId)
        _active.value = activeRequests.isNotEmpty()
    }

    fun start(context: Context, request: VisualCaptureRequest): Boolean {
        val shown = ObservationStatusNotification.beginObservation(context.applicationContext, request)
        if (shown) markActive(request.requestId, true)
        return shown
    }

    fun stop(context: Context, request: VisualCaptureRequest) {
        try {
            ObservationStatusNotification.endObservation(context.applicationContext, request)
        } finally {
            markActive(request.requestId, false)
        }
    }
}
