package com.hermes.companion

import android.app.Application
import com.hermes.companion.data.PeriodicHeartbeatWorker

class HermesCompanionApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        PeriodicHeartbeatWorker.schedule(this)
    }
}
