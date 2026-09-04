package com.hermes.companion.privacy

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SensitiveVisualGuardTest {
    private fun request(
        sensitivity: SensitivityClass = SensitivityClass.NORMAL,
        userPolicy: VisualAppPolicy? = null,
        screenUsable: Boolean = true,
        secureWindow: Boolean = false,
        grant: TemporaryVisualGrant? = null,
        packageName: String = "com.example.game",
        sessionId: String = "session-1",
        nowMs: Long = 2_000L,
    ) = VisualRequestContext(
        packageName = packageName,
        sensitivity = sensitivity,
        userPolicy = userPolicy,
        screenUsable = screenUsable,
        secureWindow = secureWindow,
        temporaryGrant = grant,
        sessionId = sessionId,
        nowMs = nowMs,
    )

    @Test
    fun `OH-45 secure window is never bypassed by a temporary grant`() {
        val grant = TemporaryVisualGrant("com.example.bank", 1_000L, 5_000L, "session-1")
        val decision = SensitiveVisualGuard.decide(
            request(
                packageName = "com.example.bank",
                sensitivity = SensitivityClass.PROTECTED,
                secureWindow = true,
                grant = grant,
            ),
        )
        assertFalse(decision.allowed)
        assertEquals(VisualDecisionReason.SECURE_WINDOW, decision.reason)
    }

    @Test
    fun `OH-45 user NEVER wins over every non-system grant`() {
        val grant = TemporaryVisualGrant("com.example.photos", 1_000L, 5_000L, "session-1")
        val decision = SensitiveVisualGuard.decide(
            request(
                packageName = "com.example.photos",
                sensitivity = SensitivityClass.PRIVATE,
                userPolicy = VisualAppPolicy.NEVER,
                grant = grant,
            ),
        )
        assertFalse(decision.allowed)
        assertEquals(VisualDecisionReason.USER_NEVER, decision.reason)
    }

    @Test
    fun `OH-45 protected app requires matching live temporary grant`() {
        val blocked = SensitiveVisualGuard.decide(
            request(packageName = "com.example.bank", sensitivity = SensitivityClass.PROTECTED),
        )
        assertFalse(blocked.allowed)
        assertEquals(VisualDecisionReason.PROTECTED_REQUIRES_TEMPORARY_GRANT, blocked.reason)

        val grant = TemporaryVisualGrant("com.example.bank", 1_000L, 5_000L, "session-1")
        val allowed = SensitiveVisualGuard.decide(
            request(packageName = "com.example.bank", sensitivity = SensitivityClass.PROTECTED, grant = grant),
        )
        assertTrue(allowed.allowed)
        assertTrue(allowed.consumeTemporaryGrant)
        assertEquals(VisualDecisionReason.ALLOWED_TEMPORARY_GRANT, allowed.reason)
    }

    @Test
    fun `OH-45 grant for another app or session cannot leak`() {
        val otherApp = TemporaryVisualGrant("com.example.bank", 1_000L, 5_000L, "session-1")
        val decision = SensitiveVisualGuard.decide(
            request(
                packageName = "com.example.otherbank",
                sensitivity = SensitivityClass.PROTECTED,
                grant = otherApp,
            ),
        )
        assertFalse(decision.allowed)

        val otherSession = TemporaryVisualGrant("com.example.otherbank", 1_000L, 5_000L, "session-other")
        val decision2 = SensitiveVisualGuard.decide(
            request(
                packageName = "com.example.otherbank",
                sensitivity = SensitivityClass.PROTECTED,
                grant = otherSession,
            ),
        )
        assertFalse(decision2.allowed)
    }

    @Test
    fun `OH-45 expired temporary grant is rejected`() {
        val expired = TemporaryVisualGrant("com.example.bank", 1_000L, 2_000L, "session-1")
        val decision = SensitiveVisualGuard.decide(
            request(
                packageName = "com.example.bank",
                sensitivity = SensitivityClass.PROTECTED,
                grant = expired,
                nowMs = 2_000L,
            ),
        )
        assertFalse(decision.allowed)
    }

    @Test
    fun `OH-45 private app default asks but user can opt into auto`() {
        val defaultDecision = SensitiveVisualGuard.decide(
            request(packageName = "com.example.photos", sensitivity = SensitivityClass.PRIVATE),
        )
        assertFalse(defaultDecision.allowed)
        assertEquals(VisualDecisionReason.PRIVATE_REQUIRES_CONSENT, defaultDecision.reason)

        val optedIn = SensitiveVisualGuard.decide(
            request(
                packageName = "com.example.photos",
                sensitivity = SensitivityClass.PRIVATE,
                userPolicy = VisualAppPolicy.AUTO,
            ),
        )
        assertTrue(optedIn.allowed)
        assertEquals(VisualDecisionReason.ALLOWED_USER_AUTO, optedIn.reason)
    }

    @Test
    fun `OH-45 normal app can be automatic unless user asks or forbids`() {
        assertTrue(SensitiveVisualGuard.decide(request()).allowed)
        assertFalse(SensitiveVisualGuard.decide(request(userPolicy = VisualAppPolicy.ASK_ONLY)).allowed)
        assertFalse(SensitiveVisualGuard.decide(request(userPolicy = VisualAppPolicy.NEVER)).allowed)
    }
}
