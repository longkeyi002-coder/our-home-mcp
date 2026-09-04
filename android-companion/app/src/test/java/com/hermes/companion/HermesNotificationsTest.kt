package com.hermes.companion

import com.hermes.companion.push.HermesNotifications
import com.hermes.companion.push.NotificationDestinationScreen
import kotlin.test.Test
import kotlin.test.assertEquals

class HermesNotificationsTest {
    @Test
    fun `missing destination defaults to chat`() {
        val value = HermesNotifications.fromPayload(
            data = mapOf("candidateId" to "candidate-1", "title" to "哥哥", "body" to "回来看看"),
            notificationTitle = null,
            notificationBody = null,
        )

        assertEquals(HermesNotifications.CHAT_DESTINATION, value.destination)
        assertEquals(NotificationDestinationScreen.CHAT_MESSAGE, HermesNotifications.destinationScreen(value.destination))
    }

    @Test
    fun `chat destination opens message screen`() {
        assertEquals(
            NotificationDestinationScreen.CHAT_MESSAGE,
            HermesNotifications.destinationScreen("/chat"),
        )
    }

    @Test
    fun `unknown destination falls back to home`() {
        assertEquals(
            NotificationDestinationScreen.HOME,
            HermesNotifications.destinationScreen("/some-future-place"),
        )
    }
}
