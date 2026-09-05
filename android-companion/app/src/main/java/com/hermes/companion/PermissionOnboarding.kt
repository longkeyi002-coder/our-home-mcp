package com.hermes.companion

import com.hermes.companion.push.ProactiveMessageHealth

enum class PermissionOnboardingStep {
    ACCESSIBILITY,
    NOTIFICATIONS,
    PUSH_REPAIR,
    PUSH_CONNECT,
    USAGE_ACCESS,
    COMPLETE,
}

/**
 * OH-46 / Stage 6: keep permission onboarding restrained. The Home page shows only the
 * next actionable repair. Returning from Android settings refreshes state and naturally
 * advances to the following step.
 */
fun nextPermissionOnboardingStep(
    accessibilityEnabled: Boolean,
    proactiveHealth: ProactiveMessageHealth,
    usageAccess: Boolean,
): PermissionOnboardingStep {
    if (!accessibilityEnabled) return PermissionOnboardingStep.ACCESSIBILITY

    return when (proactiveHealth) {
        ProactiveMessageHealth.NOTIFICATION_PERMISSION_REQUIRED -> PermissionOnboardingStep.NOTIFICATIONS
        ProactiveMessageHealth.PUSH_ERROR -> PermissionOnboardingStep.PUSH_REPAIR
        ProactiveMessageHealth.PUSH_NOT_READY -> PermissionOnboardingStep.PUSH_CONNECT
        ProactiveMessageHealth.REGISTERING,
        ProactiveMessageHealth.READY,
        -> if (usageAccess) PermissionOnboardingStep.COMPLETE else PermissionOnboardingStep.USAGE_ACCESS
    }
}
