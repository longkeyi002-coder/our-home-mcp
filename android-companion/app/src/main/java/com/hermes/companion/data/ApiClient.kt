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
        val parsedUri = requireNotNull(uri) { "Server URL is invalid" }
        require(parsedUri.scheme.equals("https", ignoreCase = true) ||
            (parsedUri.scheme.equals("http", ignoreCase = true) && parsedUri.host.equals("localhost", ignoreCase = true))) {
            "Server URL must use HTTPS; HTTP is only allowed for localhost development"
        }
        require(!parsedUri.host.isNullOrBlank()) { "Server URL must include a host" }
        return Retrofit.Builder()
            .baseUrl(normalized)
            .client(OkHttpClient.Builder().build())
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(HermesApi::class.java)
    }
}
