package com.hermes.companion.local

import java.io.ByteArrayInputStream
import kotlin.test.assertEquals
import org.json.JSONObject
import org.junit.Test

class LocalMcpServerTest {
    @Test
    fun utf8BodyUsesContentLengthBytesForChineseNotificationRequest() {
        val body = """{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"send_local_notification","arguments":{"title":"闻砚哥哥","message":"我到家了"}}}"""
        val bytes = body.toByteArray(Charsets.UTF_8)

        val parsed = JSONObject(LocalMcpServer.readUtf8Body(ByteArrayInputStream(bytes), bytes.size)!!)

        val arguments = parsed.getJSONObject("params").getJSONObject("arguments")
        assertEquals("闻砚哥哥", arguments.getString("title"))
        assertEquals("我到家了", arguments.getString("message"))
    }
}
