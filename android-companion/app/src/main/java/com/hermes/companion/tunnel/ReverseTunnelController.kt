package com.hermes.companion.tunnel

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

/**
 * Explicit user-controlled lifecycle for P7 remote read.
 * Enabling is the only path that persists opt-in; boot restore can only reuse that persisted opt-in.
 */
object ReverseTunnelController {
    fun enable(context: Context, relayUrl: String, token: String) {
        val appContext = context.applicationContext
        val settings = TunnelSettingsStore(appContext)
        settings.saveConfiguration(relayUrl, token)
        settings.setEnabled(true)
        startIfEnabled(appContext)
    }

    fun disable(context: Context) {
        val appContext = context.applicationContext
        TunnelSettingsStore(appContext).setEnabled(false)
        appContext.stopService(Intent(appContext, ReverseTunnelService::class.java))
    }

    fun startIfEnabled(context: Context): Boolean {
        val appContext = context.applicationContext
        val settings = TunnelSettingsStore(appContext)
        if (!settings.enabled() || settings.configuration() == null) return false
        ContextCompat.startForegroundService(
            appContext,
            Intent(appContext, ReverseTunnelService::class.java),
        )
        return true
    }
}
