package com.hermes.companion.push

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.installations.FirebaseInstallations
import com.google.firebase.messaging.FirebaseMessaging
import com.hermes.companion.data.QueueRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

object PushRegistration {
    fun interface RegistrationSink { suspend fun register(pushFid: String?, pushToken: String) }

    suspend fun handleRefresh(pushFid: String?, pushToken: String, sink: RegistrationSink) {
        sink.register(pushFid, pushToken)
    }

    fun refresh(context: Context) {
        if (FirebaseApp.getApps(context).isEmpty()) return
        CoroutineScope(Dispatchers.IO).launch {
            runCatching {
                val token = FirebaseMessaging.getInstance().token.await()
                register(context, token)
            }
        }
    }

    fun onTokenRefresh(context: Context, token: String) {
        CoroutineScope(Dispatchers.IO).launch { runCatching { register(context, token) } }
    }

    private suspend fun register(context: Context, token: String) {
        val fid = FirebaseInstallations.getInstance().id.await()
        handleRefresh(fid, token) { pushFid, pushToken ->
            QueueRepository.create(context).registerPushAddress(pushFid, pushToken)
        }
    }
}
