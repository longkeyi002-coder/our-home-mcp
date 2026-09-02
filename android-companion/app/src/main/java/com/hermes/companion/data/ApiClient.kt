package com.hermes.companion.data

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import java.net.URI

object ApiClient {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    fun create(baseUrl: String): HermesApi {
        val normalized = baseUrl.trim().let { if (it.endsWith('/')) it else "$it/" }
        val uri = runCatching { URI(normalized) }.getOrNull()
        val localHttp = uri?.scheme == "http" && uri.host == "localhost"
        require(uri?.scheme == "https" || localHttp) {
            "Server URL must use HTTPS (HTTP is allowed only for local development)"
        }
        return Retrofit.Builder()
            .baseUrl(normalized)
            .client(OkHttpClient.Builder().build())
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(HermesApi::class.java)
    }
}
