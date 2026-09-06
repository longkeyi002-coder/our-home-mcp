package com.hermes.companion

import com.hermes.companion.platform.UsageSession
import com.hermes.companion.platform.UsageTimelineSummary
import com.hermes.companion.presence.PresencePackageFilter
import com.hermes.companion.presence.PresenceSnapshot
import com.hermes.companion.presence.PresenceUsageReconciliation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PresenceSystemOverlayFilterTest {
    @Test
    fun keyboardSystemUiAndLauncherAreIgnoredButRealAppIsNot() {
        val ignored = setOf(
            "com.sohu.inputmethod.sogou",
            "com.android.systemui",
            "com.oplus.launcher",
        )
        assertTrue(PresencePackageFilter.shouldIgnore("com.sohu.inputmethod.sogou", ignored))
        assertTrue(PresencePackageFilter.shouldIgnore("com.android.systemui", ignored))
        assertTrue(PresencePackageFilter.shouldIgnore("com.oplus.launcher", ignored))
        assertFalse(PresencePackageFilter.shouldIgnore("com.openai.chatgpt", ignored))
    }

    @Test
    fun usageRecoveryKeepsRealAppWhenOverlayIsReportedAsCurrent() {
        val now = 1_000_000L
        val ignored = setOf("com.sohu.inputmethod.sogou", "com.android.systemui", "com.oplus.launcher")
        val summary = UsageTimelineSummary(
            observedAt = now,
            currentPackageName = "com.sohu.inputmethod.sogou",
            currentDurationMs = 1_000,
            sessions = listOf(
                UsageSession("com.openai.chatgpt", now - 20_000, null, 20_000, "ai"),
                UsageSession("com.sohu.inputmethod.sogou", now - 5_000, null, 5_000, "other"),
                UsageSession("com.android.systemui", now - 2_000, null, 2_000, "other"),
            ),
            appTotalsMs = emptyMap(),
            categoryTotalsMs = emptyMap(),
        )
        val snapshot = PresenceSnapshot(
            currentPackage = "com.openai.chatgpt",
            currentStartedAtMs = now - 30_000,
            lastTransitionAtMs = now - 30_000,
            lastFromPackage = null,
            lastToPackage = "com.openai.chatgpt",
            screenInteractive = true,
            unlocked = true,
            accessibilityConnected = false,
            lastAccessibilityEventAtMs = 0,
        )

        val candidates = PresenceUsageReconciliation.candidates(summary, snapshot, now, ignored)
        assertEquals(listOf("com.openai.chatgpt"), candidates.map { it.packageName })
    }
}
