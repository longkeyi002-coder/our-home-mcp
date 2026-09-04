package com.hermes.companion.push

import android.content.Context
import com.hermes.companion.data.SettingsRepository

object PushRegistration {
    fun interface RegistrationSink { suspend fun register(pushFid: String?, pushToken: String) }

    suspend fun handleRefresh(pushFid: String?, pushToken: String, sink: RegistrationSink) {
        sink.register(pushFid, pushToken)
    }

    /** Schedule durable registration/retry instead of swallowing coroutine failures. */
    fun refresh(context: Context) {
        PushRegistrationWorker.enqueue(context.applicationContext)
    }

    /** Preserve the newest token locally before the durable worker updates Runtime. */
    fun onTokenRefresh(context: Context, token: String) {
        val appContext = context.applicationContext
        SettingsRepository(appContext).savePushAddress(null, token)
        PushRegistrationWorker.enqueue(appContext)
    }
}
