package com.hermes.companion.presence

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertNotNull

class PresenceReducerTest {
    @Test
    fun `OH-43 duplicate accessibility package does not create a transition`() {
        assertNull(
            PresenceReducer.transition(
                previousPackage = "com.example.game",
                previousStartedAtMs = 1_000L,
                candidatePackage = "com.example.game",
                nowMs = 6_000L,
            ),
        )
    }

    @Test
    fun `OH-43 app change closes previous dwell and starts a semantic transition`() {
        val value = assertNotNull(
            PresenceReducer.transition(
                previousPackage = "com.example.chat",
                previousStartedAtMs = 1_000L,
                candidatePackage = "com.example.game",
                nowMs = 11_000L,
            ),
        )
        assertEquals("com.example.chat", value.fromPackage)
        assertEquals("com.example.game", value.toPackage)
        assertEquals(10_000L, value.previousDurationMs)
    }

    @Test
    fun `OH-68 first observed package has no invented previous dwell`() {
        val value = assertNotNull(
            PresenceReducer.transition(
                previousPackage = null,
                previousStartedAtMs = 0L,
                candidatePackage = "com.example.game",
                nowMs = 11_000L,
            ),
        )
        assertEquals(0L, value.previousDurationMs)
        assertEquals(null, value.fromPackage)
    }

    @Test
    fun `OH-68 blank package names are ignored`() {
        assertNull(PresenceReducer.transition(null, 0L, "   ", 1_000L))
    }
}
