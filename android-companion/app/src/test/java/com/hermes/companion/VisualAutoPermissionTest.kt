package com.hermes.companion

import com.hermes.companion.privacy.SensitiveVisualGuard
import com.hermes.companion.privacy.SensitivityClass
import com.hermes.companion.privacy.VisualAppPolicy
import com.hermes.companion.privacy.VisualDecisionReason
import com.hermes.companion.privacy.VisualRequestContext
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.junit.Test

class VisualAutoPermissionTest {
    private fun context(
        sensitivity: SensitivityClass,
        policy: VisualAppPolicy?,
        screenUsable: Boolean = true,
        secureWindow: Boolean = false,
    ) = VisualRequestContext(
        packageName = "com.example.app",
        sensitivity = sensitivity,
        userPolicy = policy,
        screenUsable = screenUsable,
        secureWindow = secureWindow,
        sessionId = "com.example.app:123",
        nowMs = 1_000L,
    )

    @Test
    fun autoPermissionAllowsProtectedAppWithoutPerRequestGrant() {
        val decision = SensitiveVisualGuard.decide(
            context(SensitivityClass.PROTECTED, VisualAppPolicy.AUTO),
        )

        assertTrue(decision.allowed)
        assertEquals(VisualDecisionReason.ALLOWED_USER_AUTO, decision.reason)
        assertFalse(decision.consumeTemporaryGrant)
    }

    @Test
    fun neverStillBlocksProtectedApp() {
        val decision = SensitiveVisualGuard.decide(
            context(SensitivityClass.PROTECTED, VisualAppPolicy.NEVER),
        )

        assertFalse(decision.allowed)
        assertEquals(VisualDecisionReason.USER_NEVER, decision.reason)
    }

    @Test
    fun secureWindowStillOverridesAutoPermission() {
        val decision = SensitiveVisualGuard.decide(
            context(
                sensitivity = SensitivityClass.PROTECTED,
                policy = VisualAppPolicy.AUTO,
                secureWindow = true,
            ),
        )

        assertFalse(decision.allowed)
        assertEquals(VisualDecisionReason.SECURE_WINDOW, decision.reason)
    }
}
