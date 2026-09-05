package com.hermes.companion.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.hermes.companion.data.SettingsRepository

class HermesFirebaseMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        PushRegistration.onTokenRefresh(applicationContext, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        HermesNotifications.createChannel(this)
        val value = HermesNotifications.fromPayload(message.data, message.notification?.title, message.notification?.body)
        val settings = SettingsRepository(this)
        synchronized(displayLock) {
            if (value.candidateId.isNotBlank() && settings.hasDisplayedNotification(value.candidateId)) return
            val shown = HermesNotifications.show(this, value, settings.notificationPrivacyMode())
            if (shown && value.candidateId.isNotBlank()) settings.markNotificationDisplayed(value.candidateId)
        }
    }

    companion object {
        private val displayLock = Any()
    }
}
