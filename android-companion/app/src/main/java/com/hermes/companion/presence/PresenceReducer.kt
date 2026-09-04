package com.hermes.companion.presence

import kotlin.math.max

data class AppTransition(
    val fromPackage: String?,
    val toPackage: String,
    val observedAtMs: Long,
    val previousStartedAtMs: Long,
    val previousDurationMs: Long,
)

object PresenceReducer {
    /**
     * OH-43/OH-68: collapse duplicate Accessibility events into one semantic app transition.
     * The service performs a short debounce before calling this reducer.
     */
    fun transition(
        previousPackage: String?,
        previousStartedAtMs: Long,
        candidatePackage: String?,
        nowMs: Long,
    ): AppTransition? {
        val candidate = candidatePackage?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        if (candidate == previousPackage) return null
        val duration = if (previousPackage != null && previousStartedAtMs > 0L) {
            max(0L, nowMs - previousStartedAtMs)
        } else 0L
        return AppTransition(
            fromPackage = previousPackage,
            toPackage = candidate,
            observedAtMs = nowMs,
            previousStartedAtMs = previousStartedAtMs,
            previousDurationMs = duration,
        )
    }
}

data class AppSessionEnd(
    val packageName: String,
    val startedAtMs: Long,
    val endedAtMs: Long,
    val durationMs: Long,
    val reason: String,
)
