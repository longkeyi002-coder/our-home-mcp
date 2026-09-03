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
    private val explicitPackages = mapOf(
        "com.xingin.xhs" to UsageCategory.SOCIAL.wireName,
        "com.ss.android.ugc.aweme" to UsageCategory.ENTERTAINMENT.wireName,
        "tv.danmaku.bili" to UsageCategory.ENTERTAINMENT.wireName,
        "com.taobao.taobao" to UsageCategory.SHOPPING.wireName,
        "com.xunmeng.pinduoduo" to UsageCategory.SHOPPING.wireName,
        "com.eg.android.alipaygphone" to UsageCategory.OTHER.wireName,
        "com.tencent.mm" to UsageCategory.SOCIAL.wireName,
        "com.openai.chatgpt" to UsageCategory.AI.wireName,
        "com.anthropic.claude" to UsageCategory.AI.wireName,
    )

    fun classify(packageName: String): String {
        val normalized = packageName.trim().lowercase()
        explicitPackages[normalized]?.let { return it }
        return when {
            listOf("youtube", "netflix", "spotify", "tiktok", "bilibili", "douyin").any(normalized::contains) -> UsageCategory.ENTERTAINMENT.wireName
            listOf("instagram", "facebook", "twitter", "x.", "wechat", "whatsapp", "telegram", "discord").any(normalized::contains) -> UsageCategory.SOCIAL.wireName
            listOf("slack", "teams", "zoom", "notion", "docs", "sheets", "office", "outlook").any(normalized::contains) -> UsageCategory.WORK.wireName
            listOf("taobao", "alibaba", "jd.", "pinduoduo", "shopping").any(normalized::contains) -> UsageCategory.SHOPPING.wireName
            listOf("chatgpt", "claude", "gemini", "copilot", "perplexity").any(normalized::contains) -> UsageCategory.AI.wireName
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

const val FOREGROUND_FRESHNESS_MS = 5 * 60 * 1000L

class UsageTimelineTracker {
    private val completed = mutableListOf<UsageSession>()
    private var activePackage: String? = null
    private var activeStartedAt: Long = 0L
    private var lastForegroundEventAt: Long = 0L

    fun onForeground(packageName: String, at: Long) {
        require(packageName.isNotBlank())
        if (activePackage == packageName) { lastForegroundEventAt = at; return }
        closeActive(at)
        activePackage = packageName
        activeStartedAt = at
        lastForegroundEventAt = at
    }

    fun onBackground(packageName: String, at: Long) {
        if (activePackage == packageName) closeActive(at)
    }

    fun onExcludedForeground(at: Long) { closeActive(at) }

    fun summary(now: Long, dayStart: Long): UsageTimelineSummary {
        val sessions = (completed + listOfNotNull(activeSession(now)))
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
            if (activeStartedAt < now && now - lastForegroundEventAt <= FOREGROUND_FRESHNESS_MS) UsageSession(packageName, activeStartedAt, null, now - activeStartedAt, UsageCategoryClassifier.classify(packageName)) else null
        }
        return UsageTimelineSummary(now, current?.packageName, current?.durationMs ?: 0L, sessions, appTotals, categoryTotals)
    }

    private fun closeActive(at: Long) {
        val packageName = activePackage ?: return
        if (at <= activeStartedAt) return
        completed += UsageSession(packageName, activeStartedAt, at, at - activeStartedAt, UsageCategoryClassifier.classify(packageName))
        activePackage = null
        activeStartedAt = 0L
        lastForegroundEventAt = 0L
    }

    private fun activeSession(now: Long): UsageSession? = activePackage?.let { packageName ->
        // A missing STOP/PAUSE must not extend a foreground session indefinitely.
        val effectiveEnd = minOf(now, lastForegroundEventAt + FOREGROUND_FRESHNESS_MS)
        if (activeStartedAt < effectiveEnd) {
            UsageSession(
                packageName,
                activeStartedAt,
                effectiveEnd,
                effectiveEnd - activeStartedAt,
                UsageCategoryClassifier.classify(packageName),
            )
        } else null
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
                UsageEvents.Event.ACTIVITY_RESUMED -> if (isMeaningfulForeground(context, event.packageName)) tracker.onForeground(event.packageName, event.timeStamp) else tracker.onExcludedForeground(event.timeStamp)
                UsageEvents.Event.ACTIVITY_PAUSED, UsageEvents.Event.ACTIVITY_STOPPED -> tracker.onBackground(event.packageName, event.timeStamp)
            }
        }
        return tracker.summary(now, dayStart)
    }

    private fun isMeaningfulForeground(context: Context, packageName: String?): Boolean {
        val value = packageName?.lowercase() ?: return false
        if (value == context.packageName.lowercase()) return false
        return !value.contains("launcher") && !value.contains("settings") && value != "com.android.systemui"
    }

    private fun hasUsageAccess(context: Context): Boolean {
        val appOps = context.getSystemService(AppOpsManager::class.java)
        return appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName) == AppOpsManager.MODE_ALLOWED
    }
}
