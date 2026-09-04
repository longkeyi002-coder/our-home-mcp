package com.hermes.companion

import com.hermes.companion.vision.EphemeralVisualFrame
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import org.junit.Test

class EphemeralVisualFrameTest {
    @Test
    fun closeZeroesBackingBytesAndMakesFrameUnreadable() {
        val backing = byteArrayOf(1, 2, 3, 4)
        val frame = EphemeralVisualFrame.jpeg("request-1", "com.example.game", backing)

        assertEquals(4, frame.size)
        frame.useBytes { assertContentEquals(byteArrayOf(1, 2, 3, 4), it) }

        frame.close()

        assertTrue(frame.isClosed)
        assertEquals(0, frame.size)
        assertContentEquals(byteArrayOf(0, 0, 0, 0), backing)
        assertFailsWith<IllegalStateException> { frame.useBytes { it.size } }
    }

    @Test
    fun closeIsIdempotent() {
        val frame = EphemeralVisualFrame.jpeg("request-2", "com.example.game", byteArrayOf(9))
        frame.close()
        frame.close()
        assertTrue(frame.isClosed)
    }
}
