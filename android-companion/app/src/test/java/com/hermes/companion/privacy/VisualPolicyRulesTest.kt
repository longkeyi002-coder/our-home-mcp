package com.hermes.companion.privacy

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class VisualPolicyRulesTest {
    @Test
    fun `protected AUTO is never a durable policy`() {
        assertEquals(
            VisualAppPolicy.ASK_ONLY,
            VisualPolicyRules.normalizePersistentPolicy(SensitivityClass.PROTECTED, VisualAppPolicy.AUTO),
        )
        assertFailsWith<IllegalArgumentException> {
            VisualPolicyRules.requirePersistable(SensitivityClass.PROTECTED, VisualAppPolicy.AUTO)
        }
    }

    @Test
    fun `protected ASK_ONLY and NEVER remain valid`() {
        assertEquals(
            VisualAppPolicy.ASK_ONLY,
            VisualPolicyRules.normalizePersistentPolicy(SensitivityClass.PROTECTED, VisualAppPolicy.ASK_ONLY),
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
