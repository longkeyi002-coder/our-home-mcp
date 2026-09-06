package com.hermes.companion

import android.app.Application
import com.hermes.companion.data.AutoConfiguration
import com.hermes.companion.data.UploadWorker
import com.hermes.companion.presence.PresenceRuntime
import com.hermes.companion.push.HermesNotifications
import com.hermes.companion.push.PushRegistration
import com.hermes.companion.push.PushRegistrationWorker
import com.hermes.companion.update.UpdateNotifier
import com.hermes.companion.update.UpdateWorker

class HermesCompanionApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        AutoConfiguration.applyIfNeeded(this)
        UploadWorker.schedulePeriodic(this)
        UploadWorker.enqueueIfConfigured(this)
        PresenceRuntime.start(this)
        HermesNotifications.createChannel(this)
        PushRegistrationWorker.schedulePeriodic(this)
        PushRegistration.refresh(this)
        UpdateNotifier.createChannel(this)
        UpdateWorker.schedulePeriodic(this)
        UpdateWorker.enqueueImmediate(this)
    }
}
