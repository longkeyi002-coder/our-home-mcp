package com.hermes.companion.tunnel

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import com.hermes.companion.platform.DeviceStatusReader
import com.hermes.companion.platform.UsageTimelineReader
import com.hermes.companion.push.HermesNotification
import com.hermes.companion.push.HermesNotifications
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

internal class TunnelMcpHandler(private val context: Context) {
    fun handle(params: JsonObject) = runCatching {
        val name = params["name"]?.jsonPrimitive?.content ?: throw IllegalArgumentException("Missing tool name")
        val arguments = params["arguments"]?.jsonObject ?: JsonObject(emptyMap())
        when (name) {
            "get_local_health" -> health()
            "get_device_context" -> deviceContext()
            "get_current_usage" -> usage()
            "send_local_notification" -> notification(arguments)
            else -> throw IllegalArgumentException("Tool is not allowed")
        }
    }

    private fun health() = buildJsonObject {
        put("mode", "REVERSE_TUNNEL")
        put("usageAccess", DeviceStatusReader.hasUsageAccess(context))
        put("notificationPermission", NotificationManagerCompat.from(context).areNotificationsEnabled())
    }

    private fun deviceContext(): JsonObject {
        val status = DeviceStatusReader.read(context)
        return buildJsonObject {
            put("battery", status.batteryPercent)
            put("charging", status.charging)
            put("connectivity", if (status.online) "online" else "offline")
            status.foregroundPackage?.let { put("foregroundPackage", it) }
            put("observedAt", System.currentTimeMillis())
        }
    }

    private fun usage(): JsonObject {
        val summary = UsageTimelineReader.read(context) ?: return buildJsonObject { put("available", false) }
        return buildJsonObject {
            put("available", true)
            summary.currentPackageName?.let { put("currentPackage", it) }
            put("currentDuration", summary.currentDurationMs)
            put("observedAt", summary.observedAt)
            put("recentSessions", buildJsonArray {
                summary.sessions.takeLast(50).forEach { session ->
                    add(buildJsonObject {
                        put("packageName", session.packageName)
                        put("startedAt", session.startedAt)
                        session.endedAt?.let { put("endedAt", it) }
                        put("duration", session.durationMs)
                        put("category", session.category)
                    })
                }
            })
            put("todayAppTotals", JsonObject(summary.appTotalsMs.mapValues { JsonPrimitive(it.value) }))
            put("categoryTotals", JsonObject(summary.categoryTotalsMs.mapValues { JsonPrimitive(it.value) }))
        }
    }

    private fun notification(arguments: JsonObject): JsonObject {
        val title = arguments["title"]?.jsonPrimitive?.content?.trim().orEmpty()
        val message = arguments["message"]?.jsonPrimitive?.content?.trim().orEmpty()
        require(title.isNotEmpty() && message.isNotEmpty()) { "title and message are required" }
        HermesNotifications.show(context, HermesNotification("reverse-tunnel:$title:$message", title, message))
        return buildJsonObject { put("accepted", true) }
    }
}
