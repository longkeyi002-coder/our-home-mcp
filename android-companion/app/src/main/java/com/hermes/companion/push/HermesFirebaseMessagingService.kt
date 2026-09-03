package com.hermes.companion.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class HermesFirebaseMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        PushRegistration.onTokenRefresh(applicationContext, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        HermesNotifications.createChannel(this)
        HermesNotifications.show(this, HermesNotifications.fromPayload(message.data, message.notification?.title, message.notification?.body))
    }
}
