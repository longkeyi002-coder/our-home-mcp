package com.hermes.companion

import com.hermes.companion.push.NotificationLockScreenVisibility
import com.hermes.companion.push.NotificationPrivacyMode
import com.hermes.companion.push.NotificationPrivacyPolicy
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class NotificationPrivacyPolicyTest {
    @Test
    fun `unknown stored mode defaults to lock screen hiding`() {
        assertEquals(NotificationPrivacyMode.HIDE_ON_LOCK_SCREEN, NotificationPrivacyMode.fromStorage(null))
        assertEquals(NotificationPrivacyMode.HIDE_ON_LOCK_SCREEN, NotificationPrivacyMode.fromStorage("future-mode"))
    }

    @Test
    fun `full mode keeps original content public`() {
        val value = NotificationPrivacyPolicy.present(NotificationPrivacyMode.FULL, "哥哥", "回来看看")
        assertEquals("哥哥", value.title)
        assertEquals("回来看看", value.body)
        assertEquals(NotificationLockScreenVisibility.PUBLIC, value.lockScreenVisibility)
        assertNull(value.publicTitle)
        assertNull(value.publicBody)
    }

    @Test
    fun `generic mode never exposes original notification text`() {
        val value = NotificationPrivacyPolicy.present(NotificationPrivacyMode.GENERIC, "secret title", "secret body")
        assertEquals(NotificationPrivacyPolicy.GENERIC_TITLE, value.title)
        assertEquals(NotificationPrivacyPolicy.GENERIC_BODY, value.body)
        assertEquals(NotificationLockScreenVisibility.PUBLIC, value.lockScreenVisibility)
        assertNull(value.publicTitle)
        assertNull(value.publicBody)
    }

    @Test
    fun `lock screen hidden mode keeps full unlocked content but has a generic public version`() {
        val value = NotificationPrivacyPolicy.present(NotificationPrivacyMode.HIDE_ON_LOCK_SCREEN, "哥哥", "回来看看")
        assertEquals("哥哥", value.title)
        assertEquals("回来看看", value.body)
        assertEquals(NotificationLockScreenVisibility.PRIVATE, value.lockScreenVisibility)
        assertEquals(NotificationPrivacyPolicy.GENERIC_TITLE, value.publicTitle)
        assertEquals(NotificationPrivacyPolicy.GENERIC_BODY, value.publicBody)
    }
}
