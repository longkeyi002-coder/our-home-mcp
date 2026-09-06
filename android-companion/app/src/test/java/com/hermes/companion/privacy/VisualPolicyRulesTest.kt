package com.hermes.companion.privacy

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class VisualPolicyRulesTest {
    @Test
    fun `protected AUTO remains durable enabled policy`() {
        assertEquals(
            VisualAppPolicy.AUTO,
            VisualPolicyRules.normalizePersistentPolicy(SensitivityClass.PROTECTED, VisualAppPolicy.AUTO),
        )
        VisualPolicyRules.requirePersistable(SensitivityClass.PROTECTED, VisualAppPolicy.AUTO)
    }

    @Test
    fun `legacy ASK_ONLY and unset migrate to enabled while NEVER stays disabled`() {
        assertEquals(
            VisualAppPolicy.AUTO,
            VisualPolicyRules.normalizePersistentPolicy(SensitivityClass.PROTECTED, VisualAppPolicy.ASK_ONLY),
        )
        assertEquals(
            VisualAppPolicy.AUTO,
            VisualPolicyRules.normalizePersistentPolicy(SensitivityClass.NORMAL, null),
        )
        assertEquals(
            VisualAppPolicy.NEVER,
            VisualPolicyRules.normalizePersistentPolicy(SensitivityClass.PROTECTED, VisualAppPolicy.NEVER),
        )
        VisualPolicyRules.requirePersistable(SensitivityClass.PROTECTED, VisualAppPolicy.ASK_ONLY)
        VisualPolicyRules.requirePersistable(SensitivityClass.PROTECTED, VisualAppPolicy.NEVER)
    }

    @Test
    fun `armed grant is package and time bounded`() {
        val grant = ArmedVisualGrant("com.example.bank", issuedAtMs = 1_000L, expiresAtMs = 2_000L)
        assertTrue(grant.isUsable("com.example.bank", 1_500L))
        assertEquals(false, grant.isUsable("com.example.other", 1_500L))
        assertEquals(false, grant.isUsable("com.example.bank", 2_000L))
    }
}
