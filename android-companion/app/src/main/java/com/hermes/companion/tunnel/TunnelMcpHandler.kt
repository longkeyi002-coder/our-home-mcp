package com.hermes.companion.tunnel

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import com.hermes.companion.platform.DeviceStatusReader
import com.hermes.companion.platform.UsageTimelineReader
import com.hermes.companion.push.HermesNotification
import com.hermes.companion.push.HermesNotifications
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

internal data class TunnelMcpResult(val status: Int, val body: String?)

internal class TunnelMcpHandler(private val context: Context) {
    private val json = Json { ignoreUnknownKeys = true }

    /** Handles the HTTP MCP JSON body forwarded by the deployed Relay. */
    fun handleMcp(body: String): TunnelMcpResult {
        val request = runCatching { json.parseToJsonElement(body).jsonObject }.getOrElse {
            return TunnelMcpResult(200, error(JsonNull, -32700, "Invalid JSON"))
        }
        val method = request["method"]?.jsonPrimitive?.content
        if (method == "notifications/initialized") {
            // MCP notifications do not have a response body or JSON-RPC response id.
            return TunnelMcpResult(202, null)
        }
        val id = request["id"] ?: JsonNull
        val result = runCatching {
            when (method) {
                "initialize" -> initialize()
                "tools/list" -> buildJsonObject { put("tools", tools()) }
                "tools/call" -> callTool(request["params"]?.jsonObject ?: JsonObject(emptyMap()))
                else -> throw IllegalArgumentException("Method not allowed")
            }
        }
        return result.fold(
            onSuccess = { value -> TunnelMcpResult(200, response(id, value)) },
            onFailure = { error -> TunnelMcpResult(200, error(id, -32602, error.message ?: "Request failed")) },
        )
    }

    private fun initialize() = buildJsonObject {
        put("protocolVersion", "2025-03-26")
        put("serverInfo", buildJsonObject { put("name", "our-home-companion-tunnel"); put("version", "0.1.0") })
        put("capabilities", buildJsonObject { put("tools", JsonObject(emptyMap())) })
    }

    private fun tools() = buildJsonArray {
        add(tool("get_local_health", "Read local health.", JsonObject(emptyMap())))
        add(tool("get_device_context", "Read current device facts.", JsonObject(emptyMap())))
        add(tool("get_current_usage", "Read current usage summary.", JsonObject(emptyMap())))
        add(tool("send_local_notification", "Show a local notification.", buildJsonObject {
            put("type", "object")
            put("required", buildJsonArray { add(JsonPrimitive("title")); add(JsonPrimitive("message")) })
            put("properties", buildJsonObject {
                put("title", buildJsonObject { put("type", "string") })
                put("message", buildJsonObject { put("type", "string") })
            })
        }))
    }

    private fun tool(name: String, description: String, schema: JsonObject) = buildJsonObject {
        put("name", name); put("description", description); put("inputSchema", schema)
    }

    private fun callTool(params: JsonObject): JsonObject {
        val name = params["name"]?.jsonPrimitive?.content ?: throw IllegalArgumentException("Missing tool name")
        val arguments = params["arguments"]?.jsonObject ?: JsonObject(emptyMap())
        val value = when (name) {
            "get_local_health" -> health()
            "get_device_context" -> deviceContext()
            "get_current_usage" -> usage()
            "send_local_notification" -> notification(arguments)
            else -> throw IllegalArgumentException("Tool is not allowed")
        }
        return buildJsonObject {
            put("content", buildJsonArray { add(buildJsonObject { put("type", "text"); put("text", value.toString()) }) })
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
                        put("packageName", session.packageName); put("startedAt", session.startedAt)
                        session.endedAt?.let { put("endedAt", it) }
                        put("duration", session.durationMs); put("category", session.category)
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

    private fun response(id: JsonElement, result: JsonElement) = json.encodeToString(JsonObject.serializer(), buildJsonObject {
        put("jsonrpc", "2.0"); put("id", id); put("result", result)
    })

    private fun error(id: JsonElement, code: Int, message: String) = json.encodeToString(JsonObject.serializer(), buildJsonObject {
        put("jsonrpc", "2.0"); put("id", id); put("error", buildJsonObject { put("code", code); put("message", message.take(300)) })
    })
}
