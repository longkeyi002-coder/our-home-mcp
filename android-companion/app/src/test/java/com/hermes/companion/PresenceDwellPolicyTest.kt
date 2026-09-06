package com.hermes.companion

import com.hermes.companion.presence.PresenceDwellPolicy
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.Test

class PresenceDwellPolicyTest {
    @Test
    fun noMilestoneBeforeFiveMinutes() {
        assertNull(PresenceDwellPolicy.stageFor(4 * 60_000L + 59_000L))
    }

    @Test
    fun meaningfulMilestonesAdvanceWithoutPerMinuteSpam() {
        assertEquals(1, PresenceDwellPolicy.stageFor(5 * 60_000L))
        assertEquals(1, PresenceDwellPolicy.stageFor(9 * 60_000L))
        assertEquals(2, PresenceDwellPolicy.stageFor(10 * 60_000L))
        assertEquals(3, PresenceDwellPolicy.stageFor(20 * 60_000L))
        assertEquals(5, PresenceDwellPolicy.stageFor(45 * 60_000L))
        assertEquals(8, PresenceDwellPolicy.stageFor(120 * 60_000L))
    }

    @Test
    fun unattendedLitScreenStopsQualifyingAsRecentActivity() {
        val lastInteractionAt = 1_000_000L
        assertTrue(PresenceDwellPolicy.isRecentlyActive(
            lastInteractionAt + PresenceDwellPolicy.ACTIVE_USE_FRESHNESS_MS,
            lastInteractionAt,
        ))
        assertFalse(PresenceDwellPolicy.isRecentlyActive(
            lastInteractionAt + PresenceDwellPolicy.ACTIVE_USE_FRESHNESS_MS + 1L,
            lastInteractionAt,
        ))
        assertFalse(PresenceDwellPolicy.isRecentlyActive(lastInteractionAt - 1L, lastInteractionAt))
    }

    @Test
    fun latestInteractionUsesSessionTransitionOrAccessibilityActivity() {
        assertEquals(30L, PresenceDwellPolicy.latestInteractionAtMs(10L, 20L, 30L))
        assertEquals(50L, PresenceDwellPolicy.latestInteractionAtMs(50L, 20L, 30L))
    }

    @Test
    fun afterTwoHoursMilestonesAreHourly() {
        assertEquals(8, PresenceDwellPolicy.stageFor(179 * 60_000L))
        assertEquals(9, PresenceDwellPolicy.stageFor(180 * 60_000L))
        assertEquals("180m", PresenceDwellPolicy.stageLabel(9))
        assertEquals(10, PresenceDwellPolicy.stageFor(240 * 60_000L))
    }
}
