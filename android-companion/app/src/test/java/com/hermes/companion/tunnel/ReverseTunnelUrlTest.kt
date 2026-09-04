package com.hermes.companion.tunnel

import kotlin.test.assertEquals
import kotlin.test.assertNull
import org.junit.Test

class ReverseTunnelUrlTest {
    @Test
    fun buildsWssUrlAndEncodesToken() {
        assertEquals(
            "wss://east-closure-maria-exploration.trycloudflare.com/?token=abc%2B123",
            ReverseTunnelService.buildRelayWebSocketUrl(
                "wss://east-closure-maria-exploration.trycloudflare.com/",
                "abc+123",
            ),
        )
    }

    @Test
    fun replacesExistingTokenInsteadOfSendingTwoTokens() {
        assertEquals(
            "wss://relay.example/mcp?mode=phone&token=new-secret",
            ReverseTunnelService.buildRelayWebSocketUrl(
                "wss://relay.example/mcp?token=old-secret&mode=phone",
                "new-secret",
            ),
        )
    }

    @Test
    fun rejectsNonTlsOrMalformedRelayUrl() {
        assertNull(ReverseTunnelService.buildRelayWebSocketUrl("http://relay.example", "secret"))
        assertNull(ReverseTunnelService.buildRelayWebSocketUrl("wss://", "secret"))
        assertNull(ReverseTunnelService.buildRelayWebSocketUrl("wss://relay.example", ""))
    }
}
