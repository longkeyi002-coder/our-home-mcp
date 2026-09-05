package com.hermes.companion

import com.hermes.companion.push.ProactiveMessageHealth
import kotlin.test.Test
import kotlin.test.assertEquals

class PermissionOnboardingTest {
    @Test
    fun `accessibility is always the first missing permission`() {
        assertEquals(
            PermissionOnboardingStep.ACCESSIBILITY,
            nextPermissionOnboardingStep(
                accessibilityEnabled = false,
                proactiveHealth = ProactiveMessageHealth.NOTIFICATION_PERMISSION_REQUIRED,
                usageAccess = false,
            ),
        )
    }

    @Test
    fun `notification permission follows accessibility`() {
        assertEquals(
            PermissionOnboardingStep.NOTIFICATIONS,
            nextPermissionOnboardingStep(
                accessibilityEnabled = true,
                proactiveHealth = ProactiveMessageHealth.NOTIFICATION_PERMISSION_REQUIRED,
                usageAccess = false,
            ),
        )
    }

    @Test
    fun `push repair remains ahead of optional usage reconciliation`() {
        assertEquals(
            PermissionOnboardingStep.PUSH_REPAIR,
            nextPermissionOnboardingStep(
                accessibilityEnabled = true,
                proactiveHealth = ProactiveMessageHealth.PUSH_ERROR,
                usageAccess = false,
            ),
        )
        assertEquals(
            PermissionOnboardingStep.PUSH_CONNECT,
            nextPermissionOnboardingStep(
                accessibilityEnabled = true,
                proactiveHealth = ProactiveMessageHealth.PUSH_NOT_READY,
                usageAccess = false,
            ),
        )
    }

    @Test
    fun `usage access is offered after proactive messaging no longer needs user action`() {
        assertEquals(
            PermissionOnboardingStep.USAGE_ACCESS,
            nextPermissionOnboardingStep(
                accessibilityEnabled = true,
                proactiveHealth = ProactiveMessageHealth.READY,
                usageAccess = false,
            ),
        )
        assertEquals(
            PermissionOnboardingStep.USAGE_ACCESS,
            nextPermissionOnboardingStep(
                accessibilityEnabled = true,
                proactiveHealth = ProactiveMessageHealth.REGISTERING,
                usageAccess = false,
            ),
        )
    }

    @Test
    fun `complete means no Home repair card is needed`() {
        assertEquals(
            PermissionOnboardingStep.COMPLETE,
            nextPermissionOnboardingStep(
                accessibilityEnabled = true,
                proactiveHealth = ProactiveMessageHealth.READY,
                usageAccess = true,
            ),
        )
    }
}
