package com.hermes.companion.tunnel

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** Wire format implemented by the deployed 8788/8790 Relay. */
internal data class RelayMcpRequest(
    val id: JsonElement,
    val body: String,
)

internal object RelayProtocol {
    private val json = Json { ignoreUnknownKeys = true }

    fun parseRequest(frame: String): RelayMcpRequest? = runCatching {
        val root = json.parseToJsonElement(frame).jsonObject
        if (root["method"]?.jsonPrimitive?.content != "mcp") return null
        if (root["path"]?.jsonPrimitive?.content != "/mcp") return null
        val id = root["id"] ?: return null
        val body = root["body"]?.jsonPrimitive?.content ?: return null
        RelayMcpRequest(id, body)
    }.getOrNull()

    /** Empty-body successes (for MCP notifications) keep body="" and omit a JSON content type. */
    fun response(id: JsonElement, status: Int, body: String?): String = encode(buildJsonObject {
        put("id", id)
        put("status", status)
        if (body != null) {
            put("contentType", "application/json")
            put("body", body)
        } else {
            put("body", "")
        }
    })

    private fun encode(value: JsonObject): String = json.encodeToString(JsonObject.serializer(), value)
}
