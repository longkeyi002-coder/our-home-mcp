package com.hermes.companion.data

import android.content.Context
import com.hermes.companion.BuildConfig

data class AutoConfigurationPlan(
    val serverUrlToSave: String?,
    val enrollmentTokenToSave: String?,
)

fun planAutoConfiguration(
    existingUrl: String,
    hasBootstrapToken: Boolean,
    defaultUrl: String,
    enrollmentToken: String,
): AutoConfigurationPlan {
    val normalizedExisting = existingUrl.trim()
    val normalizedDefault = defaultUrl.trim()
    val normalizedEnrollment = enrollmentToken.trim()
    val urlToSave = normalizedDefault.takeIf { normalizedExisting.isBlank() && it.isNotBlank() }
    val effectiveUrl = urlToSave ?: normalizedExisting
    val tokenToSave = normalizedEnrollment.takeIf {
        !hasBootstrapToken && normalizedDefault.isNotBlank() && effectiveUrl == normalizedDefault && it.isNotBlank()
    }
    return AutoConfigurationPlan(urlToSave, tokenToSave)
}

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
        val plan = planAutoConfiguration(
            existingUrl = settings.serverUrl(),
            hasBootstrapToken = settings.hasBootstrapToken(),
            defaultUrl = BuildConfig.DEFAULT_RUNTIME_URL,
            enrollmentToken = BuildConfig.ENROLLMENT_TOKEN,
        )

        plan.serverUrlToSave?.let(settings::saveServerUrl)
        plan.enrollmentTokenToSave?.let(settings::saveBootstrapToken)

        return Result(
            appliedDefaultUrl = plan.serverUrlToSave != null,
            appliedEnrollmentToken = plan.enrollmentTokenToSave != null,
            configured = TelemetryPolicy.isConfigured(
                settings.serverUrl(),
                settings.bootstrapToken(),
                settings.deviceToken(),
            ),
        )
    }
}
