package com.hermes.companion

import com.hermes.companion.data.describeApiError
import kotlin.test.assertEquals
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class ApiDiagnosticsTest {
    @Test
    fun http401NamesTheAuthStage() {
        val body = "{}".toResponseBody("application/json".toMediaType())
        val error = HttpException(Response.error<Any>(401, body))
        assertEquals("registration HTTP 401 — token rejected", describeApiError("registration", error))
    }

    @Test
    fun networkErrorKeepsStageWithoutSecrets() {
        val error = java.io.IOException("connection reset")
        assertEquals("upload: connection reset", describeApiError("upload", error))
    }
}
