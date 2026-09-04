package com.hermes.companion.tunnel

import androidx.core.net.toUri
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.Test

class ReverseTunnelUrlTest {
    @Test
    fun buildsWssUrlAndEncodesToken() {
        val url = ReverseTunnelService.buildRelayWebSocketUrl(
            "wss://east-closure-maria-exploration.trycloudflare.com/",
            "abc+123",
        )!!
        assertEquals("wss", url.toUri().scheme)
        assertEquals("abc+123", url.toUri().getQueryParameter("token"))
        assertTrue(url.contains("token=abc%2B123"))
    }

    @Test
    fun replacesExistingTokenInsteadOfSendingTwoTokens() {
        val url = ReverseTunnelService.buildRelayWebSocketUrl(
            "wss://relay.example/mcp?token=old-secret&mode=phone",
            "new-secret",
        )!!
        assertEquals("new-secret", url.toUri().getQueryParameter("token"))
        assertEquals("phone", url.toUri().getQueryParameter("mode"))
        assertEquals(1, url.toUri().getQueryParameters("token").size)
        assertTrue(!url.contains("old-secret"))
    }

    @Test
    fun rejectsNonTlsOrMalformedRelayUrl() {
        assertNull(ReverseTunnelService.buildRelayWebSocketUrl("http://relay.example", "secret"))
        assertNull(ReverseTunnelService.buildRelayWebSocketUrl("wss://", "secret"))
        assertNull(ReverseTunnelService.buildRelayWebSocketUrl("wss://relay.example", ""))
    }
}
