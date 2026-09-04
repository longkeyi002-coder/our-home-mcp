package com.hermes.companion

import android.app.Application
import com.hermes.companion.data.CompanionMode
import com.hermes.companion.data.SettingsRepository
import com.hermes.companion.data.UploadWorker
import com.hermes.companion.local.LocalMcpServer
import com.hermes.companion.push.HermesNotifications

class HermesCompanionApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        HermesNotifications.createChannel(this)

        // This build is a one-button local/reverse-relay companion. Cloud upload stays disabled.
        val settings = SettingsRepository(this)
        settings.setMode(CompanionMode.LOCAL)
        UploadWorker.cancelCloudWork(this)
        if (settings.tunnelEnabled()) LocalMcpServer.start(this)
    }
}
