package com.hermes.companion.local

import java.io.ByteArrayInputStream
import kotlin.test.assertEquals
import org.junit.Test

class LocalMcpServerTest {
    @Test
    fun utf8BodyUsesContentLengthBytesForChineseNotificationRequest() {
        val body = """{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"send_local_notification","arguments":{"title":"闻砚哥哥","message":"我到家了"}}}"""
        val bytes = body.toByteArray(Charsets.UTF_8)

        val decoded = LocalMcpServer.readUtf8Body(ByteArrayInputStream(bytes), bytes.size)

        // handle() hands this exact UTF-8 string to JSONObject once on Android.
        assertEquals(body, decoded)
        assertEquals(bytes.size, decoded!!.toByteArray(Charsets.UTF_8).size)
    }
}
