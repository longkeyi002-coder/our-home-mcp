package com.hermes.companion

import android.app.Application
import com.hermes.companion.data.UploadWorker
import com.hermes.companion.data.SettingsRepository
import com.hermes.companion.local.LocalMcpServer
import com.hermes.companion.push.HermesNotifications
import com.hermes.companion.push.PushRegistration

class HermesCompanionApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        if (SettingsRepository(this).isLocalMode()) LocalMcpServer.start(this) else UploadWorker.schedulePeriodic(this)
        HermesNotifications.createChannel(this)
        PushRegistration.refresh(this)
    }
}
