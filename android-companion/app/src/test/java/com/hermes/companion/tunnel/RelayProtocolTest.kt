package com.hermes.companion.tunnel

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RelayProtocolTest {
    @Test
    fun `accepts only bounded mcp path requests`() {
        val parsed = RelayProtocol.parseRequest(
            """{"id":"req-1","method":"mcp","path":"/mcp","body":"{\\"jsonrpc\\":\\"2.0\\"}"}""",
        )
        requireNotNull(parsed)
        assertEquals("req-1", parsed.id)
        assertEquals("mcp", parsed.method)
        assertEquals("/mcp", parsed.path)
    }

    @Test
    fun `rejects wrong method path malformed and oversized frames`() {
        assertNull(RelayProtocol.parseRequest("""{"id":"1","method":"get","path":"/mcp","body":"{}"}"""))
        assertNull(RelayProtocol.parseRequest("""{"id":"1","method":"mcp","path":"/other","body":"{}"}"""))
        assertNull(RelayProtocol.parseRequest("not-json"))
        val hugeBody = "x".repeat(RelayProtocol.MAX_MCP_BODY_BYTES + 1)
        val raw = """{"id":"1","method":"mcp","path":"/mcp","body":"$hugeBody"}"""
        assertNull(RelayProtocol.parseRequest(raw))
    }

    @Test
    fun `response preserves request id and status`() {
        val encoded = RelayProtocol.response("abc", 200, "{}")
        assertTrue(encoded.contains("\"id\":\"abc\""))
        assertTrue(encoded.contains("\"status\":200"))
    }
}
