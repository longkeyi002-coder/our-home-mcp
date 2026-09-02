package com.hermes.companion

import android.app.Application
import com.hermes.companion.data.UploadWorker

class HermesCompanionApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        UploadWorker.schedulePeriodic(this)
    }
}
