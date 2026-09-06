package com.hermes.companion.presence

import com.hermes.companion.platform.UsageTimelineSummary

/**
 * Low-frequency recovery for a realtime Accessibility Presence stream that has stopped
 * producing events. UsageEvents never replaces realtime Presence; it only backfills a
 * small recent window while Accessibility is disconnected or stale.
 */
object PresenceUsageReconciliation {
    const val ACCESSIBILITY_STALE_AFTER_MS = 5 * 60 * 1000L
    const val MAX_BACKFILL_AGE_MS = 30 * 60 * 1000L
    const val MAX_BACKFILL_TRANSITIONS = 20

    data class Candidate(val packageName: String, val observedAtMs: Long)

    fun candidates(
        summary: UsageTimelineSummary,
        snapshot: PresenceSnapshot,
        nowMs: Long,
        ignoredPackages: Set<String> = emptySet(),
    ): List<Candidate> {
        if (!isAccessibilityStale(snapshot, nowMs)) return emptyList()

        val lowerBound = maxOf(snapshot.lastTransitionAtMs, nowMs - MAX_BACKFILL_AGE_MS)
        val recovered = summary.sessions.asSequence()
            .filter { it.packageName.isNotBlank() && it.packageName !in ignoredPackages }
            .filter { it.startedAt > lowerBound && it.startedAt <= nowMs }
            .sortedBy { it.startedAt }
            .map { Candidate(it.packageName, it.startedAt) }
            .fold(mutableListOf<Candidate>()) { acc, candidate ->
                if (acc.lastOrNull()?.packageName != candidate.packageName) acc += candidate
                acc
            }
            .takeLast(MAX_BACKFILL_TRANSITIONS)
            .toMutableList()

        val current = summary.currentPackageName?.trim()?.takeIf { it.isNotEmpty() && it !in ignoredPackages }
        if (current != null) {
            val lastKnown = recovered.lastOrNull()?.packageName ?: snapshot.currentPackage
            if (lastKnown != current) recovered += Candidate(current, nowMs)
        }
        return recovered
    }

    fun isAccessibilityStale(snapshot: PresenceSnapshot, nowMs: Long): Boolean {
        if (!snapshot.accessibilityConnected) return true
        val lastEvent = snapshot.lastAccessibilityEventAtMs
        return lastEvent <= 0L || nowMs - lastEvent >= ACCESSIBILITY_STALE_AFTER_MS
    }
}
