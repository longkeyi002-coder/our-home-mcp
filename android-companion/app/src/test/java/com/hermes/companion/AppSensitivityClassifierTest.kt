package com.hermes.companion

import com.hermes.companion.privacy.AppSensitivityClassifier
import com.hermes.companion.privacy.SensitivityClass
import kotlin.test.assertEquals
import org.junit.Test

class AppSensitivityClassifierTest {
    @Test
    fun financialAndAuthenticationAppsAreProtected() {
        assertEquals(SensitivityClass.PROTECTED, AppSensitivityClassifier.classify("com.eg.android.AlipayGphone"))
        assertEquals(SensitivityClass.PROTECTED, AppSensitivityClassifier.classify("com.example.mobilebank"))
        assertEquals(SensitivityClass.PROTECTED, AppSensitivityClassifier.classify("com.example.authenticator"))
        assertEquals(SensitivityClass.PROTECTED, AppSensitivityClassifier.classify("com.example.password.manager"))
    }

    @Test
    fun cameraGalleryChatAndBrowsersArePrivateByDefault() {
        assertEquals(SensitivityClass.PRIVATE, AppSensitivityClassifier.classify("com.android.camera"))
        assertEquals(SensitivityClass.PRIVATE, AppSensitivityClassifier.classify("com.example.gallery"))
        assertEquals(SensitivityClass.PRIVATE, AppSensitivityClassifier.classify("com.example.chat"))
        assertEquals(SensitivityClass.PRIVATE, AppSensitivityClassifier.classify("com.android.chrome"))
        assertEquals(SensitivityClass.PRIVATE, AppSensitivityClassifier.classify("org.mozilla.firefox"))
    }

    @Test
    fun ordinaryAppsRemainNormal() {
        assertEquals(SensitivityClass.NORMAL, AppSensitivityClassifier.classify("com.example.game"))
        assertEquals(SensitivityClass.NORMAL, AppSensitivityClassifier.classify("tv.danmaku.bili"))
    }
}
