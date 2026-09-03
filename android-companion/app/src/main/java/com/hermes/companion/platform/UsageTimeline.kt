package com.hermes.companion.platform

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Process
import java.time.Instant
import java.time.ZoneId
import kotlinx.serialization.Serializable

enum class UsageCategory(val wireName: String) {
    ENTERTAINMENT("entertainment"),
    SOCIAL("social"),
    WORK("work"),
    SHOPPING("shopping"),
    AI("ai"),
    OTHER("other"),
}

object UsageCategoryClassifier {
    fun classify(packageName: String): String {
        val value = packageName.lowercase()
        return when {
            listOf("youtube", "netflix", "spotify", "tiktok", "bilibili", "douyin").any(value::contains) -> UsageCategory.ENTERTAINMENT.wireName
            listOf("instagram", "facebook", "twitter", "x.", "wechat", "whatsapp", "telegram", "discord").any(value::contains) -> UsageCategory.SOCIAL.wireName
            listOf("slack", "teams", "zoom", "notion", "docs", "sheets", "office", "outlook").any(value::contains) -> UsageCategory.WORK.wireName
            listOf("taobao", "alibaba", "jd.", "pinduoduo", "shopping").any(value::contains) -> UsageCategory.SHOPPING.wireName
            listOf("chatgpt", "claude", "gemini", "copilot", "perplexity").any(value::contains) -> UsageCategory.AI.wireName
            else -> UsageCategory.OTHER.wireName
        }
    }
}

@Serializable
data class UsageSession(
    val packageName: String,
    val startedAt: Long,
    val endedAt: Long?,
    val durationMs: Long,
    val category: String,
)

data class UsageTimelineSummary(
    val observedAt: Long,
    val currentPackageName: String?,
    val currentDurationMs: Long,
    val sessions: List<UsageSession>,
    val appTotalsMs: Map<String, Long>,
    val categoryTotalsMs: Map<String, Long>,
)

class UsageTimelineTracker {
    private val completed = mutableListOf<UsageSession>()
    private var activePackage: String? = null
    private var activeStartedAt: Long = 0L

    fun onForeground(packageName: String, at: Long) {
        require(packageName.isNotBlank())
        if (activePackage == packageName) return
        closeActive(at)
        activePackage = packageName
        activeStartedAt = at
    }

    fun onBackground(at: Long) = closeActive(at)

    fun summary(now: Long, dayStart: Long): UsageTimelineSummary {
        val sessions = (completed + activeSession(now))
            .filter { it.startedAt < now && it.endedAt?.let { end -> end > dayStart } != false }
            .map { session ->
                val start = maxOf(session.startedAt, dayStart)
                val end = session.endedAt?.let { minOf(it, now) }
                session.copy(startedAt = start, endedAt = end, durationMs = ((end ?: now) - start).coerceAtLeast(0L))
            }
            .filter { it.durationMs > 0L }
        val appTotals = sessions.groupingBy { it.packageName }.fold(0L) { total, session -> total + session.durationMs }
        val categoryTotals = sessions.groupingBy { it.category }.fold(0L) { total, session -> total + session.durationMs }
        val current = activePackage?.let { packageName ->
            if (activeStartedAt < now) UsageSession(packageName, activeStartedAt, null, now - activeStartedAt, UsageCategoryClassifier.classify(packageName)) else null
        }
        return UsageTimelineSummary(now, current?.packageName, current?.durationMs ?: 0L, sessions, appTotals, categoryTotals)
    }

    private fun closeActive(at: Long) {
        val packageName = activePackage ?: return
        if (at <= activeStartedAt) return
        completed += UsageSession(packageName, activeStartedAt, at, at - activeStartedAt, UsageCategoryClassifier.classify(packageName))
        activePackage = null
        activeStartedAt = 0L
    }

    private fun activeSession(now: Long): UsageSession? = activePackage?.let { packageName ->
        if (activeStartedAt < now) UsageSession(packageName, activeStartedAt, null, now - activeStartedAt, UsageCategoryClassifier.classify(packageName)) else null
    }
}

object UsageTimelineReader {
    fun read(context: Context, now: Long = System.currentTimeMillis()): UsageTimelineSummary? {
        if (!hasUsageAccess(context)) return null
        val manager = context.getSystemService(UsageStatsManager::class.java) ?: return null
        val zone = ZoneId.systemDefault()
        val dayStart = Instant.ofEpochMilli(now).atZone(zone).toLocalDate().atStartOfDay(zone).toInstant().toEpochMilli()
        val events = manager.queryEvents(dayStart, now)
        val tracker = UsageTimelineTracker()
        val event = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            when (event.eventType) {
                UsageEvents.Event.ACTIVITY_RESUMED -> tracker.onForeground(event.packageName, event.timeStamp)
                UsageEvents.Event.ACTIVITY_PAUSED, UsageEvents.Event.ACTIVITY_STOPPED -> tracker.onBackground(event.timeStamp)
            }
        }
        return tracker.summary(now, dayStart)
    }

    private fun hasUsageAccess(context: Context): Boolean {
        val appOps = context.getSystemService(AppOpsManager::class.java)
        return appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName) == AppOpsManager.MODE_ALLOWED
    }
}
