package com.hermes.companion.presence

import com.hermes.companion.platform.UsageSession
import com.hermes.companion.platform.UsageTimelineSummary
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PresenceUsageReconciliationTest {
    private val now = 1_000_000L

    @Test
    fun healthyAccessibilityDoesNotBackfillUsageSessions() {
        val result = PresenceUsageReconciliation.candidates(
            summary = summary(
                current = "app.b",
                sessions = listOf(session("app.b", now - 10_000L)),
            ),
            snapshot = snapshot(
                current = "app.a",
                connected = true,
                lastAccessibilityEventAt = now - 1_000L,
            ),
            nowMs = now,
        )

        assertTrue(result.isEmpty())
    }

    @Test
    fun disconnectedAccessibilityBackfillsRecentTransitionsInOrder() {
        val result = PresenceUsageReconciliation.candidates(
            summary = summary(
                current = "app.c",
                sessions = listOf(
                    session("app.b", now - 20_000L),
                    session("app.c", now - 10_000L),
                ),
            ),
            snapshot = snapshot(current = "app.a", connected = false),
            nowMs = now,
        )

        assertEquals(listOf("app.b", "app.c"), result.map { it.packageName })
        assertEquals(listOf(now - 20_000L, now - 10_000L), result.map { it.observedAtMs })
    }

    @Test
    fun staleConnectedAccessibilityAlsoRecovers() {
        val result = PresenceUsageReconciliation.candidates(
            summary = summary(
                current = "app.b",
                sessions = listOf(session("app.b", now - 10_000L)),
            ),
            snapshot = snapshot(
                current = "app.a",
                connected = true,
                lastAccessibilityEventAt = now - PresenceUsageReconciliation.ACCESSIBILITY_STALE_AFTER_MS,
            ),
            nowMs = now,
        )

        assertEquals(listOf("app.b"), result.map { it.packageName })
    }

    @Test
    fun oldHistoryIsNotReplayedAfterLongOutage() {
        val result = PresenceUsageReconciliation.candidates(
            summary = summary(
                current = "app.b",
                sessions = listOf(session("old.app", now - PresenceUsageReconciliation.MAX_BACKFILL_AGE_MS - 1L)),
            ),
            snapshot = snapshot(current = "app.a", connected = false),
            nowMs = now,
        )

        assertEquals(listOf("app.b"), result.map { it.packageName })
        assertEquals(now, result.single().observedAtMs)
    }

    private fun summary(current: String?, sessions: List<UsageSession>) = UsageTimelineSummary(
        observedAt = now,
        currentPackageName = current,
        currentDurationMs = 0L,
        sessions = sessions,
        appTotalsMs = emptyMap(),
        categoryTotalsMs = emptyMap(),
    )

    private fun session(packageName: String, startedAt: Long) = UsageSession(
        packageName = packageName,
        startedAt = startedAt,
        endedAt = startedAt + 5_000L,
        durationMs = 5_000L,
        category = "other",
    )

    private fun snapshot(
        current: String?,
        connected: Boolean,
        lastAccessibilityEventAt: Long = 0L,
    ) = PresenceSnapshot(
        currentPackage = current,
        currentStartedAtMs = 0L,
        lastTransitionAtMs = 0L,
        lastFromPackage = null,
        lastToPackage = current,
        screenInteractive = true,
        unlocked = true,
        accessibilityConnected = connected,
        lastAccessibilityEventAtMs = lastAccessibilityEventAt,
    )
}
