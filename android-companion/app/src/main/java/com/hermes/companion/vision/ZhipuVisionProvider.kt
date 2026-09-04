package com.hermes.companion.vision

import android.util.Base64
import java.io.IOException
import java.util.concurrent.TimeUnit
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
    private val client: OkHttpClient = defaultClient(),
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

        private fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .callTimeout(35, TimeUnit.SECONDS)
            .build()

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
            val clean = content
                .removePrefix("```json").removePrefix("```")
                .removeSuffix("```")
                .trim()
            val parsed = json.parseToJsonElement(clean).jsonObject
            val activity = parsed["activity"]?.jsonPrimitive?.content?.trim().orEmpty()
            val safeActivity = activity.takeIf(ALLOWED_ACTIVITIES::contains) ?: "unknown"
            val genericContent = sanitizeContent(parsed["content"]?.jsonPrimitive?.content.orEmpty())
            val confidence = parsed["confidence"]?.jsonPrimitive?.doubleOrNull?.coerceIn(0.0, 1.0) ?: 0.0
            return VisualObservationSummary(
                activity = safeActivity,
                content = genericContent,
                confidence = confidence,
                provider = PROVIDER_ID,
                model = model,
            )
        }

        private fun sanitizeContent(value: String): String = value
            .replace(Regex("[\\r\\n\\t]+"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
            .take(160)

        private val ALLOWED_ACTIVITIES = setOf(
            "gaming", "video", "social", "shopping", "work", "reading", "navigation", "other", "unknown",
        )
    }
}
