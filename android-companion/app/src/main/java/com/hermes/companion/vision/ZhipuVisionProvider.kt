package com.hermes.companion.vision

import android.util.Base64
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

interface VisionProvider {
    suspend fun analyze(frame: EphemeralVisualFrame): VisualObservationSummary
}

data class VisualObservationSummary(
    val activity: String,
    val content: String,
    val confidence: Double,
    val provider: String,
    val model: String,
)

/**
 * OH-42/OH-69: the raw frame is sent directly from Android to the user-selected
 * vision provider. It never transits Our Home Runtime. Only a bounded structured
 * summary may be reported back to Runtime by a higher-level coordinator.
 */
class ZhipuVisionProvider(
    private val settingsStore: VisionProviderSettingsStore,
    private val client: OkHttpClient = OkHttpClient(),
) : VisionProvider {
    override suspend fun analyze(frame: EphemeralVisualFrame): VisualObservationSummary = withContext(Dispatchers.IO) {
        try {
            val settings = settingsStore.snapshot()
            require(settings.enabled) { "visual observation is disabled" }
            val apiKey = settingsStore.apiKey()?.takeIf { it.isNotBlank() }
                ?: throw IllegalStateException("vision API key is not configured")

            val imageBase64 = frame.useBytes { Base64.encodeToString(it, Base64.NO_WRAP) }
            val payload = buildRequestJson(settings.model, imageBase64)
            val endpoint = settings.baseUrl + "chat/completions"
            val request = Request.Builder()
                .url(endpoint)
                .header("Authorization", "Bearer $apiKey")
                .header("Content-Type", "application/json")
                .post(payload.toRequestBody(JSON_MEDIA_TYPE))
                .build()

            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw IOException("vision provider HTTP ${response.code}")
                }
                val body = response.body?.string()?.takeIf { it.isNotBlank() }
                    ?: throw IOException("vision provider returned an empty response")
                parseResponse(body, settings.model)
            }
        } finally {
            // The JPEG bytes are unusable after every success/failure path.
            frame.close()
        }
    }

    companion object {
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
        private val json = Json { ignoreUnknownKeys = true }
        const val PROVIDER_ID = "zhipu"

        /**
         * The provider is explicitly told not to transcribe private screen text. The job is
         * coarse activity/context understanding, not OCR or message extraction.
         */
        const val PRIVACY_PROMPT = """You are a privacy-minimizing screen activity classifier for a companion app. Infer only coarse activity and visible context. Do NOT transcribe, quote, summarize, or repeat messages, names, usernames, phone numbers, account numbers, bank/card data, passwords, PINs, OTP/verification codes, payment details, notification text, addresses, identifiers, or other private text. Do not perform OCR. If sensitive or uncertain, keep content generic. Return JSON only: {\"activity\":\"gaming|video|social|shopping|work|reading|navigation|other|unknown\",\"content\":\"brief generic visual context with no identifying text\",\"confidence\":0.0}."""

        fun buildRequestJson(model: String, imageBase64: String): String = buildJsonObject {
            put("model", model)
            put("stream", false)
            put("max_tokens", 256)
            put("temperature", 0.1)
            put("thinking", buildJsonObject { put("type", "disabled") })
            put("messages", buildJsonArray {
                add(buildJsonObject {
                    put("role", "user")
                    put("content", buildJsonArray {
                        add(buildJsonObject {
                            put("type", "image_url")
                            put("image_url", buildJsonObject { put("url", imageBase64) })
                        })
                        add(buildJsonObject {
                            put("type", "text")
                            put("text", PRIVACY_PROMPT)
                        })
                    })
                })
            })
        }.toString()

        fun parseResponse(responseBody: String, model: String): VisualObservationSummary {
            val root = json.parseToJsonElement(responseBody).jsonObject
            val content = root["choices"]
                ?.jsonArray
                ?.firstOrNull()
                ?.jsonObject
                ?.get("message")
                ?.jsonObject
                ?.get("content")
                ?.jsonPrimitive
                ?.content
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
                ?: throw IOException("vision provider response has no content")

            val summaryJson = stripJsonFence(content)
            val summary = json.parseToJsonElement(summaryJson).jsonObject
            return parseSummary(summary, model)
        }

        private fun parseSummary(value: JsonObject, model: String): VisualObservationSummary {
            val activity = value["activity"]?.jsonPrimitive?.content?.trim()?.lowercase()
                ?.takeIf { it in ALLOWED_ACTIVITIES }
                ?: "unknown"
            val content = value["content"]?.jsonPrimitive?.content?.trim()
                ?.replace(Regex("\\s+"), " ")
                ?.take(MAX_CONTENT_LENGTH)
                ?.takeIf { it.isNotEmpty() }
                ?: ""
            val confidence = value["confidence"]?.jsonPrimitive?.doubleOrNull
                ?.coerceIn(0.0, 1.0)
                ?: 0.0
            return VisualObservationSummary(
                activity = activity,
                content = content,
                confidence = confidence,
                provider = PROVIDER_ID,
                model = model.take(120),
            )
        }

        private fun stripJsonFence(value: String): String {
            if (!value.startsWith("```")) return value
            return value
                .removePrefix("```json")
                .removePrefix("```JSON")
                .removePrefix("```")
                .removeSuffix("```")
                .trim()
        }

        private val ALLOWED_ACTIVITIES = setOf(
            "gaming", "video", "social", "shopping", "work", "reading", "navigation", "other", "unknown",
        )
        private const val MAX_CONTENT_LENGTH = 240
    }
}
