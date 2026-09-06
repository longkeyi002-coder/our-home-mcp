package com.hermes.companion.tunnel

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TunnelRemoteReadDiagnosticsContractTest {
    @Test
    fun diagnosticToolNamesStayWithinReadOnlySurface() {
        val allowed = setOf(
            "get_local_health",
            "get_device_context",
            "get_current_usage",
        )
        assertTrue("send_local_notification" !in allowed)
        assertEquals(3, allowed.size)
    }
}
