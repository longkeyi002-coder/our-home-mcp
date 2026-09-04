package com.hermes.companion

import com.hermes.companion.data.planAutoConfiguration
import kotlin.test.assertEquals
import kotlin.test.assertNull
import org.junit.Test

class AutoConfigurationTest {
    @Test
    fun firstInstallUsesBuildDefaults() {
        val plan = planAutoConfiguration(
            existingUrl = "",
            hasBootstrapToken = false,
            defaultUrl = "https://runtime.example",
            enrollmentToken = "enroll-secret",
        )
        assertEquals("https://runtime.example", plan.serverUrlToSave)
        assertEquals("enroll-secret", plan.enrollmentTokenToSave)
    }

    @Test
    fun explicitCustomRuntimeIsNeverOverwrittenOrGivenDefaultToken() {
        val plan = planAutoConfiguration(
            existingUrl = "https://custom.example",
            hasBootstrapToken = false,
            defaultUrl = "https://runtime.example",
            enrollmentToken = "enroll-secret",
        )
        assertNull(plan.serverUrlToSave)
        assertNull(plan.enrollmentTokenToSave)
    }

    @Test
    fun existingCredentialIsNotReplaced() {
        val plan = planAutoConfiguration(
            existingUrl = "https://runtime.example",
            hasBootstrapToken = true,
            defaultUrl = "https://runtime.example",
            enrollmentToken = "new-secret",
        )
        assertNull(plan.serverUrlToSave)
        assertNull(plan.enrollmentTokenToSave)
    }
}
