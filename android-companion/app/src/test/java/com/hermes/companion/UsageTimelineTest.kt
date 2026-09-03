package com.hermes.companion

import com.hermes.companion.platform.UsageCategoryClassifier
import com.hermes.companion.platform.UsageTimelineTracker
import com.hermes.companion.platform.FOREGROUND_FRESHNESS_MS
import kotlin.test.assertEquals
import kotlin.test.assertNull
import org.junit.Test

class UsageTimelineTest {
    @Test
    fun continuousForegroundIsOneSession() {
        val tracker = UsageTimelineTracker()
        tracker.onForeground("com.example.video", 1_000)
        tracker.onForeground("com.example.video", 2_000)
        tracker.onBackground("com.example.video", 5_000)

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
        tracker.onBackground("com.example.app", 2_000)
        assertNull(tracker.summary(2_000, 0).currentPackageName)
    }

    @Test
    fun delayedStopForOldPackageDoesNotCloseCurrentSession() {
        val tracker = UsageTimelineTracker()
        tracker.onForeground("com.example.first", 1_000)
        tracker.onForeground("com.example.second", 4_000)
        tracker.onBackground("com.example.first", 5_000)

        val summary = tracker.summary(6_000, 0)

        assertEquals(listOf("com.example.first", "com.example.second"), summary.sessions.map { it.packageName })
        assertEquals(listOf(3_000L, 2_000L), summary.sessions.map { it.durationMs })
        assertEquals("com.example.second", summary.currentPackageName)
        assertEquals(2_000L, summary.currentDurationMs)
    }

    @Test
    fun staleForegroundSessionStopsAtFreshnessBoundary() {
        val tracker = UsageTimelineTracker()
        val startedAt = 1_000L
        tracker.onForeground("com.example.app", startedAt)

        val now = startedAt + FOREGROUND_FRESHNESS_MS + 60_000L
        val summary = tracker.summary(now, 0L)

        assertNull(summary.currentPackageName)
        assertEquals(FOREGROUND_FRESHNESS_MS, summary.sessions.single().durationMs)
        assertEquals(FOREGROUND_FRESHNESS_MS, summary.appTotalsMs.getValue("com.example.app"))
        assertEquals(FOREGROUND_FRESHNESS_MS, summary.categoryTotalsMs.getValue("other"))
    }

    @Test
    fun commonChinesePackagesUseExplicitMappings() {
        assertEquals("social", UsageCategoryClassifier.classify("com.xingin.xhs"))
        assertEquals("entertainment", UsageCategoryClassifier.classify("com.ss.android.ugc.aweme"))
        assertEquals("entertainment", UsageCategoryClassifier.classify("tv.danmaku.bili"))
        assertEquals("shopping", UsageCategoryClassifier.classify("com.taobao.taobao"))
        assertEquals("shopping", UsageCategoryClassifier.classify("com.xunmeng.pinduoduo"))
        assertEquals("other", UsageCategoryClassifier.classify("com.eg.android.AlipayGphone"))
        assertEquals("social", UsageCategoryClassifier.classify("com.tencent.mm"))
        assertEquals("ai", UsageCategoryClassifier.classify("com.openai.chatgpt"))
    }
}
