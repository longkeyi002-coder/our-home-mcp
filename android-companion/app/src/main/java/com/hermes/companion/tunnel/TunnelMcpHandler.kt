package com.hermes.companion.tunnel

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import com.hermes.companion.platform.DeviceStatusReader
import com.hermes.companion.platform.UsagePrivacyFilter
import com.hermes.companion.platform.UsageTimelineReader
import com.hermes.companion.privacy.PresencePrivacyStore
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

/**
 * P7.1 read-only MCP surface for the outbound reverse tunnel.
 * App identity is filtered locally before any response leaves Android.
 */
internal class TunnelMcpHandler(context: Context) {
    private val appContext = context.applicationContext
    private val json = Json { ignoreUnknownKeys = false }
    private val presencePrivacy = PresencePrivacyStore(appContext)

    fun handleMcp(body: String): String {
        if (body.toByteArray(Charsets.UTF_8).size > RelayProtocol.MAX_MCP_BODY_BYTES) {
            return error(JsonNull, -32600, "Request too large")
        }
        val request = runCatching { json.parseToJsonElement(body).jsonObject }.getOrElse {
            return error(JsonNull, -32700, "Invalid JSON")
        }
        val id = request["id"] ?: JsonNull
        val result = runCatching {
            when (request["method"]?.jsonPrimitive?.content) {
                "initialize" -> initialize()
                "notifications/initialized" -> JsonObject(emptyMap())
                "tools/list" -> buildJsonObject { put("tools", tools()) }
                "tools/call" -> callTool(request["params"]?.jsonObject ?: JsonObject(emptyMap()))
                else -> throw IllegalArgumentException("Method not allowed")
            }
        }
        return result.fold(
            onSuccess = { value -> response(id, value) },
            onFailure = { throwable -> error(id, -32602, throwable.message ?: "Request failed") },
        )
    }

    private fun initialize() = buildJsonObject {
        put("protocolVersion", "2025-03-26")
        put("serverInfo", buildJsonObject {
            put("name", "our-home-companion-remote-read")
            put("version", "0.1.0")
        })
        put("capabilities", buildJsonObject { put("tools", JsonObject(emptyMap())) })
    }

    private fun tools() = buildJsonArray {
        add(tool("get_local_health", "Read local health."))
        add(tool("get_device_context", "Read privacy-filtered current device facts."))
        add(tool("get_current_usage", "Read privacy-filtered current usage summary."))
    }

    private fun tool(name: String, description: String) = buildJsonObject {
        put("name", name)
        put("description", description)
        put("inputSchema", buildJsonObject {
            put("type", "object")
            put("additionalProperties", false)
        })
    }

    private fun callTool(params: JsonObject): JsonObject {
        val name = params["name"]?.jsonPrimitive?.content
            ?: throw IllegalArgumentException("Missing tool name")
        val arguments = params["arguments"]?.jsonObject ?: JsonObject(emptyMap())
        require(arguments.isEmpty()) { "Tool takes no arguments" }
        val value = when (name) {
            "get_local_health" -> health()
            "get_device_context" -> deviceContext()
            "get_current_usage" -> usage()
            else -> throw IllegalArgumentException("Tool is not allowed")
        }
        return buildJsonObject {
            put("content", buildJsonArray {
                add(buildJsonObject {
                    put("type", "text")
                    put("text", value.toString())
                })
            })
        }
    }

    private fun health() = buildJsonObject {
        put("mode", "REMOTE_READ")
        put("usageAccess", DeviceStatusReader.hasUsageAccess(appContext))
        put("notificationPermission", NotificationManagerCompat.from(appContext).areNotificationsEnabled())
    }

    private fun deviceContext(): JsonObject {
        val status = DeviceStatusReader.read(appContext)
        val foreground = UsagePrivacyFilter.redactCurrentPackage(
            status.foregroundPackage,
            presencePrivacy::exposesIdentity,
        )
        return buildJsonObject {
            put("battery", status.batteryPercent)
            put("charging", status.charging)
            put("connectivity", if (status.online) "online" else "offline")
            foreground?.let { put("foregroundPackage", it) }
            put("observedAt", System.currentTimeMillis())
        }
    }

    private fun usage(): JsonObject {
        val raw = UsageTimelineReader.read(appContext)
            ?: return buildJsonObject { put("available", false) }
        val summary = UsagePrivacyFilter.redact(raw, presencePrivacy::exposesIdentity)
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

    private fun response(id: JsonElement, result: JsonElement) =
        json.encodeToString(JsonObject.serializer(), buildJsonObject {
            put("jsonrpc", "2.0")
            put("id", id)
            put("result", result)
        })

    private fun error(id: JsonElement, code: Int, message: String) =
        json.encodeToString(JsonObject.serializer(), buildJsonObject {
            put("jsonrpc", "2.0")
            put("id", id)
            put("error", buildJsonObject {
                put("code", code)
                put("message", message.take(300))
            })
        })
}
