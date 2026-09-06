package com.hermes.companion.tunnel

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
internal data class RelayRequest(
    val id: String,
    val method: String,
    val path: String,
    val body: String,
)

@Serializable
internal data class RelayResponse(
    val id: String,
    val status: Int,
    val body: String,
)

internal object RelayProtocol {
    private val json = Json { ignoreUnknownKeys = false }

    fun parseRequest(raw: String): RelayRequest? {
        if (raw.toByteArray(Charsets.UTF_8).size > MAX_RELAY_FRAME_BYTES) return null
        return runCatching {
            val request = json.decodeFromString(RelayRequest.serializer(), raw)
            request.takeIf {
                it.id.isNotBlank() &&
                    it.method == "mcp" &&
                    it.path == "/mcp" &&
                    it.body.toByteArray(Charsets.UTF_8).size <= MAX_MCP_BODY_BYTES
            }
        }.getOrNull()
    }

    fun response(id: String, status: Int, body: String): String =
        json.encodeToString(RelayResponse.serializer(), RelayResponse(id, status, body))

    const val MAX_MCP_BODY_BYTES = 64 * 1024
    const val MAX_RELAY_FRAME_BYTES = 72 * 1024
}
