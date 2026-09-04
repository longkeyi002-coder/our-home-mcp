package com.hermes.companion.tunnel

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
        assertTrue(url.startsWith("wss://"))
        assertTrue(url.contains("token=abc%2B123"))
    }

    @Test
    fun replacesExistingTokenInsteadOfSendingTwoTokens() {
        val url = ReverseTunnelService.buildRelayWebSocketUrl(
            "wss://relay.example/mcp?token=old-secret&mode=phone",
            "new-secret",
        )!!
        assertTrue(url.contains("token=new-secret"))
        assertTrue(url.contains("mode=phone"))
        assertEquals(1, "token=".toRegex().findAll(url).count())
        assertTrue(!url.contains("old-secret"))
    }

    @Test
    fun rejectsNonTlsOrMalformedRelayUrl() {
        assertNull(ReverseTunnelService.buildRelayWebSocketUrl("http://relay.example", "secret"))
        assertNull(ReverseTunnelService.buildRelayWebSocketUrl("wss://", "secret"))
        assertNull(ReverseTunnelService.buildRelayWebSocketUrl("wss://relay.example", ""))
    }
}
