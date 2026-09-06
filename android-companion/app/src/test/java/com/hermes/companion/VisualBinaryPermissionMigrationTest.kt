package com.hermes.companion

import com.hermes.companion.privacy.SensitivityClass
import com.hermes.companion.privacy.VisualAppPolicy
import com.hermes.companion.privacy.VisualPolicyRules
import kotlin.test.assertEquals
import org.junit.Test

class VisualBinaryPermissionMigrationTest {
    @Test
    fun legacyAskOnlyBecomesEnabledAuto() {
        assertEquals(
            VisualAppPolicy.AUTO,
            VisualPolicyRules.normalizePersistentPolicy(
                sensitivity = SensitivityClass.PRIVATE,
                policy = VisualAppPolicy.ASK_ONLY,
            ),
        )
    }

    @Test
    fun protectedAutoStaysAuto() {
        assertEquals(
            VisualAppPolicy.AUTO,
            VisualPolicyRules.normalizePersistentPolicy(
                sensitivity = SensitivityClass.PROTECTED,
                policy = VisualAppPolicy.AUTO,
            ),
        )
    }

    @Test
    fun explicitNeverStaysDisabled() {
        assertEquals(
            VisualAppPolicy.NEVER,
            VisualPolicyRules.normalizePersistentPolicy(
                sensitivity = SensitivityClass.PROTECTED,
                policy = VisualAppPolicy.NEVER,
            ),
        )
    }

    @Test
    fun unsetPolicyDefaultsToEnabledAuto() {
        assertEquals(
            VisualAppPolicy.AUTO,
            VisualPolicyRules.normalizePersistentPolicy(
                sensitivity = SensitivityClass.NORMAL,
                policy = null,
            ),
        )
    }
}
