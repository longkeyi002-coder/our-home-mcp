package com.hermes.companion.privacy

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PresencePrivacyRulesTest {
    @Test
    fun `unset presence policy preserves existing allow behavior`() {
        assertEquals(PresenceAppPolicy.ALLOW, PresencePrivacyRules.effectivePolicy(null))
        assertTrue(PresencePrivacyRules.exposesIdentity(null))
        assertEquals("com.example.app", PresencePrivacyRules.exposedPackage("com.example.app", null))
    }

    @Test
    fun `hidden presence redacts package identity and blocks visual observation`() {
        val policy = PresenceAppPolicy.HIDE_IDENTITY
        assertFalse(PresencePrivacyRules.exposesIdentity(policy))
        assertNull(PresencePrivacyRules.exposedPackage("com.example.private", policy))
        assertFalse(PresencePrivacyRules.visualObservationAllowed(policy))
    }

    @Test
    fun `allowed presence keeps package identity and permits visual policy evaluation`() {
        val policy = PresenceAppPolicy.ALLOW
        assertTrue(PresencePrivacyRules.exposesIdentity(policy))
        assertEquals("com.example.allowed", PresencePrivacyRules.exposedPackage("com.example.allowed", policy))
        assertTrue(PresencePrivacyRules.visualObservationAllowed(policy))
    }
}
