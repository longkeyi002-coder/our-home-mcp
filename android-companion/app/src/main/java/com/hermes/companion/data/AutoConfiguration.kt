package com.hermes.companion.data

import android.content.Context
import com.hermes.companion.BuildConfig

/**
 * OH-P1.11: apply build-time defaults only when the user has not explicitly
 * configured another Runtime. Local settings always take precedence.
 */
object AutoConfiguration {
    data class Result(
        val appliedDefaultUrl: Boolean,
        val appliedEnrollmentToken: Boolean,
        val configured: Boolean,
    )

    fun applyIfNeeded(context: Context): Result {
        val settings = SettingsRepository(context.applicationContext)
        val defaultUrl = BuildConfig.DEFAULT_RUNTIME_URL.trim()
        val enrollmentToken = BuildConfig.ENROLLMENT_TOKEN.trim()
        val existingUrl = settings.serverUrl().trim()

        var urlApplied = false
        var tokenApplied = false

        if (existingUrl.isBlank() && defaultUrl.isNotBlank()) {
            settings.saveServerUrl(defaultUrl)
            urlApplied = true
        }

        val effectiveUrl = settings.serverUrl().trim()
        val defaultRuntimeSelected = defaultUrl.isNotBlank() && effectiveUrl == defaultUrl
        if (defaultRuntimeSelected && !settings.hasBootstrapToken() && enrollmentToken.isNotBlank()) {
            settings.saveBootstrapToken(enrollmentToken)
            tokenApplied = true
        }

        return Result(
            appliedDefaultUrl = urlApplied,
            appliedEnrollmentToken = tokenApplied,
            configured = TelemetryPolicy.isConfigured(
                settings.serverUrl(),
                settings.bootstrapToken(),
                settings.deviceToken(),
            ),
        )
    }
}
