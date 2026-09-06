package com.hermes.companion.tunnel

import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

internal object TunnelEndpointPolicy {
    fun isAllowedRelayUrl(value: String): Boolean = runCatching {
        normalizeRelayUrl(value)
    }.isSuccess

    fun normalizeRelayUrl(value: String): String {
        val normalized = value.trim()
        require(normalized.isNotEmpty()) { "Relay URL is required" }
        val uri = runCatching { URI(normalized) }
            .getOrElse { throw IllegalArgumentException("Relay URL is invalid") }
        require(uri.scheme.equals("wss", ignoreCase = true)) { "Relay URL must use wss://" }
        require(!uri.host.isNullOrBlank()) { "Relay URL host is required" }
        require(uri.userInfo == null) { "Relay URL must not contain user info" }
        require(uri.fragment == null) { "Relay URL must not contain a fragment" }
        val hasEmbeddedToken = uri.rawQuery
            ?.split('&')
            ?.asSequence()
            ?.map { it.substringBefore('=').trim() }
            ?.any { it.equals("token", ignoreCase = true) }
            ?: false
        require(!hasEmbeddedToken) { "Relay URL must not embed the tunnel token" }
        return uri.toString()
    }

    fun withToken(relayUrl: String, token: String): String {
        val normalizedRelay = normalizeRelayUrl(relayUrl)
        val normalizedToken = token.trim()
        require(normalizedToken.isNotEmpty()) { "Tunnel token is required" }
        val separator = if (URI(normalizedRelay).rawQuery.isNullOrEmpty()) "?" else "&"
        val encoded = URLEncoder.encode(normalizedToken, StandardCharsets.UTF_8.name())
        return "$normalizedRelay${separator}token=$encoded"
    }
}

internal object TunnelReconnectPolicy {
    const val MAX_RECONNECT_MS = 30_000L

    fun delayMillis(failureAttempt: Int): Long {
        val exponent = failureAttempt.coerceIn(0, 5)
        val exponential = 1_000L shl exponent
        return exponential.coerceAtMost(MAX_RECONNECT_MS)
    }
}
