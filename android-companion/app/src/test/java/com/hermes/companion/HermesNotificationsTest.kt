package com.hermes.companion

import com.hermes.companion.push.HermesNotifications
import com.hermes.companion.push.NotificationDestinationScreen
import kotlin.test.Test
import kotlin.test.assertEquals

class HermesNotificationsTest {
    @Test
    fun `missing destination defaults to chat and preserves trace ids`() {
        val value = HermesNotifications.fromPayload(
            data = mapOf(
                "candidateId" to "candidate-1",
                "wakeEventId" to "wake-1",
                "title" to "哥哥",
                "body" to "回来看看",
            ),
            notificationTitle = null,
            notificationBody = null,
        )

        assertEquals("candidate-1", value.candidateId)
        assertEquals("wake-1", value.wakeEventId)
        assertEquals(HermesNotifications.CHAT_DESTINATION, value.destination)
        assertEquals(NotificationDestinationScreen.APP, HermesNotifications.destinationScreen(value.destination))
    }

    @Test
    fun `chat destination returns to current app`() {
        assertEquals(
            NotificationDestinationScreen.APP,
            HermesNotifications.destinationScreen("/chat"),
        )
    }

    @Test
    fun `unknown destination also falls back to current app`() {
        assertEquals(
            NotificationDestinationScreen.APP,
            HermesNotifications.destinationScreen("/some-future-place"),
        )
    }
}
