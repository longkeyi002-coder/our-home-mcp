package com.hermes.companion.tunnel

import kotlin.test.assertEquals
import kotlin.test.assertNull
import org.junit.Test

class RelayProtocolTest {
    @Test
    fun parsesDeployedRelayMcpEnvelope() {
        val request = RelayProtocol.parseRequest(
            """{"id":42,"method":"mcp","path":"/mcp","body":"{\"jsonrpc\":\"2.0\",\"method\":\"tools/list\"}"}""",
        )

        assertEquals("42", request?.id?.toString())
        assertEquals("""{"jsonrpc":"2.0","method":"tools/list"}""", request?.body)
    }

    @Test
    fun rejectsNonMcpOrOtherPaths() {
        assertNull(RelayProtocol.parseRequest("""{"id":"x","method":"shell","path":"/mcp","body":"{}"}"""))
        assertNull(RelayProtocol.parseRequest("""{"id":"x","method":"mcp","path":"/other","body":"{}"}"""))
    }

    @Test
    fun responsePreservesRelayIdAndJsonBody() {
        val response = RelayProtocol.response(
            RelayProtocol.parseRequest("""{"id":"same-id","method":"mcp","path":"/mcp","body":"{}"}""")!!.id,
            200,
            """{"jsonrpc":"2.0","id":1,"result":{}}""",
        )
        assert(response.contains("\"id\":\"same-id\""))
        assert(response.contains("\"status\":200"))
        assert(response.contains("\"contentType\":\"application/json\""))
    }
}
