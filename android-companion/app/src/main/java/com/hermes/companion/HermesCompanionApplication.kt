package com.hermes.companion

import android.app.Application
import com.hermes.companion.push.HermesNotifications
import com.hermes.companion.push.PushRegistration

class HermesCompanionApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        HermesNotifications.createChannel(this)
        PushRegistration.refresh(this)
    }
}
