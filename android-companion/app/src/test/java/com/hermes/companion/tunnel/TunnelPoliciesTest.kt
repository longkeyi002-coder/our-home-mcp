package com.hermes.companion.tunnel

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TunnelPoliciesTest {
    @Test
    fun `relay endpoint only accepts safe wss urls without embedded credentials`() {
        assertTrue(TunnelEndpointPolicy.isAllowedRelayUrl("wss://relay.example.com/mcp"))
        assertTrue(TunnelEndpointPolicy.isAllowedRelayUrl("wss://relay.example.com/mcp?device=phone"))

        assertFalse(TunnelEndpointPolicy.isAllowedRelayUrl("ws://relay.example.com/mcp"))
        assertFalse(TunnelEndpointPolicy.isAllowedRelayUrl("https://relay.example.com/mcp"))
        assertFalse(TunnelEndpointPolicy.isAllowedRelayUrl("wss://user:pass@relay.example.com/mcp"))
        assertFalse(TunnelEndpointPolicy.isAllowedRelayUrl("wss://relay.example.com/mcp#fragment"))
        assertFalse(TunnelEndpointPolicy.isAllowedRelayUrl("wss://relay.example.com/mcp?token=secret"))
        assertFalse(TunnelEndpointPolicy.isAllowedRelayUrl("not-a-url"))
    }

    @Test
    fun `token is encoded and appended without replacing existing query`() {
        assertEquals(
            "wss://relay.example.com/mcp?token=a+b%2Bc%26d",
            TunnelEndpointPolicy.withToken("wss://relay.example.com/mcp", "a b+c&d"),
        )
        assertEquals(
            "wss://relay.example.com/mcp?device=phone&token=secret",
            TunnelEndpointPolicy.withToken("wss://relay.example.com/mcp?device=phone", "secret"),
        )
    }

    @Test
    fun `reconnect is exponential and capped at thirty seconds`() {
        val expected = listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 30_000L, 30_000L, 30_000L)
        assertEquals(expected, (0..7).map(TunnelReconnectPolicy::delayMillis))
        assertEquals(1_000L, TunnelReconnectPolicy.delayMillis(-1))
        assertTrue((0..100).all { TunnelReconnectPolicy.delayMillis(it) <= TunnelReconnectPolicy.MAX_RECONNECT_MS })
    }
}
