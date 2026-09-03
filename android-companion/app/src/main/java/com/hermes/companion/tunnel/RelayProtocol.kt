package com.hermes.companion.tunnel

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

internal data class RelayRequest(
    val requestId: String,
    val method: String,
    val params: JsonObject,
)

internal object RelayProtocol {
    private val json = Json { ignoreUnknownKeys = true }

    fun parseRequest(frame: String): RelayRequest? = runCatching {
        val root = json.parseToJsonElement(frame).jsonObject
        if (root["type"]?.jsonPrimitive?.content != "request") return null
        val requestId = root["requestId"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() && it.length <= 128 } ?: return null
        val method = root["method"]?.jsonPrimitive?.content?.takeIf { it == "tools/call" } ?: return null
        RelayRequest(requestId, method, root["params"]?.jsonObject ?: JsonObject(emptyMap()))
    }.getOrNull()

    fun hello(deviceId: String): String = encode(buildJsonObject {
        put("type", "hello")
        put("deviceId", deviceId)
        put("protocolVersion", "our-home-tunnel-v0.1")
    })

    fun response(requestId: String, result: JsonElement): String = encode(buildJsonObject {
        put("type", "response")
        put("requestId", requestId)
        put("result", result)
    })

    fun error(requestId: String, code: String, message: String): String = encode(buildJsonObject {
        put("type", "error")
        put("requestId", requestId)
        put("code", code)
        put("message", message.take(300))
    })

    private fun encode(value: JsonObject): String = json.encodeToString(JsonObject.serializer(), value)
}
