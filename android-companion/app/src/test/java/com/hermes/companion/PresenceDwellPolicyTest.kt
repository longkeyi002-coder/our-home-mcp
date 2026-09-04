package com.hermes.companion

import com.hermes.companion.presence.PresenceDwellPolicy
import kotlin.test.assertEquals
import kotlin.test.assertNull
import org.junit.Test

class PresenceDwellPolicyTest {
    @Test
    fun noMilestoneBeforeTenMinutes() {
        assertNull(PresenceDwellPolicy.stageFor(9 * 60_000L + 59_000L))
    }

    @Test
    fun meaningfulMilestonesAdvanceWithoutPerMinuteSpam() {
        assertEquals(1, PresenceDwellPolicy.stageFor(10 * 60_000L))
        assertEquals(1, PresenceDwellPolicy.stageFor(19 * 60_000L))
        assertEquals(2, PresenceDwellPolicy.stageFor(20 * 60_000L))
        assertEquals(4, PresenceDwellPolicy.stageFor(45 * 60_000L))
        assertEquals(7, PresenceDwellPolicy.stageFor(120 * 60_000L))
    }

    @Test
    fun afterTwoHoursMilestonesAreHourly() {
        assertEquals(7, PresenceDwellPolicy.stageFor(179 * 60_000L))
        assertEquals(8, PresenceDwellPolicy.stageFor(180 * 60_000L))
        assertEquals("180m", PresenceDwellPolicy.stageLabel(8))
        assertEquals(9, PresenceDwellPolicy.stageFor(240 * 60_000L))
    }
}
