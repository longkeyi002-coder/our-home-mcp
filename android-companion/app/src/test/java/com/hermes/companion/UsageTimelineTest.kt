package com.hermes.companion

import com.hermes.companion.platform.UsageCategoryClassifier
import com.hermes.companion.platform.UsageTimelineTracker
import kotlin.test.assertEquals
import kotlin.test.assertNull
import org.junit.Test

class UsageTimelineTest {
    @Test
    fun continuousForegroundIsOneSession() {
        val tracker = UsageTimelineTracker()
        tracker.onForeground("com.example.video", 1_000)
        tracker.onForeground("com.example.video", 2_000)
        tracker.onBackground(5_000)

        val summary = tracker.summary(5_000, 0)
        assertEquals(1, summary.sessions.size)
        assertEquals(4_000, summary.sessions.single().durationMs)
        assertEquals(UsageCategoryClassifier.classify("com.example.video"), summary.sessions.single().category)
    }

    @Test
    fun switchingAppsClosesPreviousSession() {
        val tracker = UsageTimelineTracker()
        tracker.onForeground("com.example.work", 1_000)
        tracker.onForeground("com.example.chat", 4_000)
        val summary = tracker.summary(6_000, 0)

        assertEquals(listOf("com.example.work", "com.example.chat"), summary.sessions.map { it.packageName })
        assertEquals(listOf(3_000L, 2_000L), summary.sessions.map { it.durationMs })
        assertEquals("com.example.chat", summary.currentPackageName)
        assertEquals(2_000, summary.currentDurationMs)
        assertEquals(3_000L, summary.appTotalsMs.getValue("com.example.work"))
        assertEquals(5_000L, summary.categoryTotalsMs.getValue("other"))
    }

    @Test
    fun unknownPackageIsOther() {
        assertEquals("other", UsageCategoryClassifier.classify("com.unrecognized.product"))
    }

    @Test
    fun noCurrentAppWhenSessionEnded() {
        val tracker = UsageTimelineTracker()
        tracker.onForeground("com.example.app", 1_000)
        tracker.onBackground(2_000)
        assertNull(tracker.summary(2_000, 0).currentPackageName)
    }
}
