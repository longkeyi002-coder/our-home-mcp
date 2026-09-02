package com.hermes.companion.platform

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import com.hermes.companion.data.AppTimelineEntry
import java.time.Instant

/** Reads app foreground transitions only; it never reads screen contents. */
object AppTimelineReader {
    fun read(context: Context, windowMs: Long = 24 * 60 * 60 * 1000L, limit: Int = 100): List<AppTimelineEntry> {
        if (!DeviceStatusReader.hasUsageAccess(context)) return emptyList()
        val manager = context.getSystemService(UsageStatsManager::class.java) ?: return emptyList()
        val end = System.currentTimeMillis()
        val events = manager.queryEvents(end - windowMs, end)
        val event = UsageEvents.Event()
        var currentPackage: String? = null
        var currentStart = 0L
        val entries = mutableListOf<AppTimelineEntry>()

        fun closeCurrent(at: Long) {
            val packageName = currentPackage ?: return
            if (currentStart <= 0L || at < currentStart) return
            entries += AppTimelineEntry(
                packageName = packageName,
                startedAt = Instant.ofEpochMilli(currentStart).toString(),
                endedAt = Instant.ofEpochMilli(at).toString(),
                durationMs = at - currentStart,
            )
            currentPackage = null
            currentStart = 0L
        }

        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            when (event.eventType) {
                UsageEvents.Event.ACTIVITY_RESUMED -> {
                    if (currentPackage != event.packageName) {
                        closeCurrent(event.timeStamp)
                        currentPackage = event.packageName
                        currentStart = event.timeStamp
                    }
                }
                UsageEvents.Event.ACTIVITY_PAUSED,
                UsageEvents.Event.ACTIVITY_STOPPED -> {
                    if (currentPackage == event.packageName) closeCurrent(event.timeStamp)
                }
            }
        }
        closeCurrent(end)
        return entries.takeLast(limit.coerceAtLeast(1))
    }
}
