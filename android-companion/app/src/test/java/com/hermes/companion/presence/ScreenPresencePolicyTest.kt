package com.hermes.companion.presence

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ScreenPresencePolicyTest {
    @Test
    fun interactiveUnlockedDeviceIsUsable() {
        assertTrue(ScreenPresencePolicy.unlocked(interactive = true, deviceLocked = false))
    }

    @Test
    fun lockedDeviceIsNotUsable() {
        assertFalse(ScreenPresencePolicy.unlocked(interactive = true, deviceLocked = true))
    }

    @Test
    fun screenOffIsNeverUsable() {
        assertFalse(ScreenPresencePolicy.unlocked(interactive = false, deviceLocked = false))
    }
}
