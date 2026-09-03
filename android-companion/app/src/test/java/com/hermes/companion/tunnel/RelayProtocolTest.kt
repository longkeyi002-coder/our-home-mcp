package com.hermes.companion.tunnel

import kotlin.test.assertEquals
import kotlin.test.assertNull
import org.junit.Test

class RelayProtocolTest {
    @Test
    fun parsesOnlyBoundedToolsCallRequests() {
        val request = RelayProtocol.parseRequest(
            """{"type":"request","requestId":"abc-123","method":"tools/call","params":{"name":"get_device_context"}}""",
        )

        assertEquals("abc-123", request?.requestId)
        assertEquals("tools/call", request?.method)
        assertEquals("get_device_context", request?.params?.get("name")?.toString()?.trim('"'))
    }

    @Test
    fun rejectsUnsupportedInboundFrames() {
        assertNull(RelayProtocol.parseRequest("""{"type":"request","requestId":"x","method":"shell","params":{}}"""))
        assertNull(RelayProtocol.parseRequest("""{"type":"response","requestId":"x"}"""))
    }

    @Test
    fun responsesPreserveRequestId() {
        val frame = RelayProtocol.error("same-id", "tool_error", "failed")
        assert(frame.contains("\"requestId\":\"same-id\""))
    }
}
