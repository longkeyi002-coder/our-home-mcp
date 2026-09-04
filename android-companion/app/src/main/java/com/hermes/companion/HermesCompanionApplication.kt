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
        HermesNotifications.createChannel(this)
        val settings = SettingsRepository(this)
        if (settings.isLocalMode()) {
            UploadWorker.cancelCloudWork(this)
            LocalMcpServer.start(this)
        } else {
            UploadWorker.schedulePeriodic(this)
            PushRegistration.refresh(this)
        }
    }
}
