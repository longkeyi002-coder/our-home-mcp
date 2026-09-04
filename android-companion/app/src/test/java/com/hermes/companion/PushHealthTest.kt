package com.hermes.companion

import com.hermes.companion.data.SettingsRepository
import com.hermes.companion.push.ProactiveMessageHealth
import com.hermes.companion.push.PushHealth
import kotlin.test.Test
import kotlin.test.assertEquals

class PushHealthTest {
    @Test
    fun `notification permission alone is not enough`() {
        assertEquals(
            ProactiveMessageHealth.PUSH_NOT_READY,
            PushHealth.evaluate(true, SettingsRepository.PUSH_NEVER),
        )
    }

    @Test
    fun `registered push plus notification permission is ready`() {
        assertEquals(
            ProactiveMessageHealth.READY,
            PushHealth.evaluate(true, SettingsRepository.PUSH_REGISTERED),
        )
    }

    @Test
    fun `system notification denial always wins`() {
        assertEquals(
            ProactiveMessageHealth.NOTIFICATION_PERMISSION_REQUIRED,
            PushHealth.evaluate(false, SettingsRepository.PUSH_REGISTERED),
        )
    }

    @Test
    fun `push error is surfaced independently`() {
        assertEquals(
            ProactiveMessageHealth.PUSH_ERROR,
            PushHealth.evaluate(true, SettingsRepository.PUSH_ERROR),
        )
    }
}
