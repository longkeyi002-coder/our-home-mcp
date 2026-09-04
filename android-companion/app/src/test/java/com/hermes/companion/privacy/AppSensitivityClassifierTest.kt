package com.hermes.companion.privacy

import kotlin.test.Test
import kotlin.test.assertEquals

class AppSensitivityClassifierTest {
    @Test
    fun `OH-45 known payment apps are protected`() {
        assertEquals(SensitivityClass.PROTECTED, AppSensitivityClassifier.classify("com.eg.android.AlipayGphone"))
        assertEquals(SensitivityClass.PROTECTED, AppSensitivityClassifier.classify("com.example.banking.mobile"))
    }

    @Test
    fun `OH-45 photo and chat style packages are private by default`() {
        assertEquals(SensitivityClass.PRIVATE, AppSensitivityClassifier.classify("com.example.gallery"))
        assertEquals(SensitivityClass.PRIVATE, AppSensitivityClassifier.classify("com.example.chat.mobile"))
    }

    @Test
    fun `OH-45 ordinary app remains normal`() {
        assertEquals(SensitivityClass.NORMAL, AppSensitivityClassifier.classify("com.example.game"))
    }

    @Test
    fun `OH-45 unknown blank package is conservative`() {
        assertEquals(SensitivityClass.PRIVATE, AppSensitivityClassifier.classify("  "))
    }
}
