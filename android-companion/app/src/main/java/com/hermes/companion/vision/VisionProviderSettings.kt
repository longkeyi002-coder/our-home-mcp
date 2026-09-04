package com.hermes.companion.vision

import android.content.Context
import java.net.URI

data class VisionProviderSettings(
    val enabled: Boolean,
    val baseUrl: String,
    val model: String,
    val hasApiKey: Boolean,
)

class VisionProviderSettingsStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val secrets = VisionSecretStore(context)

    fun snapshot(): VisionProviderSettings = VisionProviderSettings(
        enabled = prefs.getBoolean(KEY_ENABLED, false),
        baseUrl = prefs.getString(KEY_BASE_URL, null)?.takeIf { it.isNotBlank() } ?: DEFAULT_BASE_URL,
        model = prefs.getString(KEY_MODEL, null)?.takeIf { it.isNotBlank() } ?: DEFAULT_MODEL,
        hasApiKey = secrets.hasApiKey(),
    )

    fun saveProvider(baseUrl: String, model: String) {
        val normalizedUrl = normalizeHttpsBaseUrl(baseUrl)
        val normalizedModel = model.trim().takeIf { it.isNotEmpty() }
            ?: throw IllegalArgumentException("vision model is required")
        require(normalizedModel.length <= 120) { "vision model is too long" }
        prefs.edit()
            .putString(KEY_BASE_URL, normalizedUrl)
            .putString(KEY_MODEL, normalizedModel)
            .apply()
    }

    fun setEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_ENABLED, enabled).apply()
    }

    fun saveApiKey(apiKey: String) {
        val normalized = apiKey.trim()
        if (normalized.isEmpty()) return
        require(normalized.length <= 500) { "vision API key is too long" }
        secrets.saveApiKey(normalized)
    }

    fun clearApiKey() = secrets.clearApiKey()

    internal fun apiKey(): String? = secrets.apiKey()

    companion object {
        const val DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4/"
        const val DEFAULT_MODEL = "glm-4.6v-flash"
        private const val PREFS = "vision_provider"
        private const val KEY_ENABLED = "enabled"
        private const val KEY_BASE_URL = "base_url"
        private const val KEY_MODEL = "model"

        fun normalizeHttpsBaseUrl(value: String): String {
            val trimmed = value.trim()
            require(trimmed.isNotEmpty()) { "vision base URL is required" }
            val uri = runCatching { URI(trimmed) }.getOrElse { throw IllegalArgumentException("invalid vision base URL") }
            require(uri.scheme.equals("https", ignoreCase = true) && !uri.host.isNullOrBlank()) {
                "vision base URL must use HTTPS"
            }
            require(uri.userInfo == null && uri.fragment == null) { "vision base URL must not contain credentials or fragment" }
            return if (trimmed.endsWith('/')) trimmed else "$trimmed/"
        }
    }
}
