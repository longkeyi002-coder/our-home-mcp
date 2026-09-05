package com.hermes.companion

import com.hermes.companion.push.NotificationReceiptWindow
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class NotificationReceiptWindowTest {
    @Test
    fun `receipt memory is bounded to the newest candidates`() {
        var serialized: String? = null
        repeat(80) { index ->
            serialized = NotificationReceiptWindow.record(serialized, "candidate-$index")
        }

        assertEquals(NotificationReceiptWindow.MAX_RECEIPTS, serialized!!.lines().size)
        assertFalse(NotificationReceiptWindow.contains(serialized, "candidate-0"))
        assertFalse(NotificationReceiptWindow.contains(serialized, "candidate-15"))
        assertTrue(NotificationReceiptWindow.contains(serialized, "candidate-16"))
        assertTrue(NotificationReceiptWindow.contains(serialized, "candidate-79"))
    }

    @Test
    fun `recording the same candidate remains unique and refreshes it as newest`() {
        var serialized: String? = null
        serialized = NotificationReceiptWindow.record(serialized, "candidate-a")
        serialized = NotificationReceiptWindow.record(serialized, "candidate-b")
        serialized = NotificationReceiptWindow.record(serialized, "candidate-a")

        assertEquals(listOf("candidate-b", "candidate-a"), serialized!!.lines())
        assertTrue(NotificationReceiptWindow.contains(serialized, "candidate-a"))
    }

    @Test
    fun `blank candidate ids are never treated as receipts`() {
        assertFalse(NotificationReceiptWindow.contains("candidate-a", "   "))
        assertEquals("candidate-a", NotificationReceiptWindow.record("candidate-a", ""))
    }
}
