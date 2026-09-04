package com.hermes.companion.tunnel

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.hermes.companion.data.SettingsRepository

class BootCompletedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val settings = SettingsRepository(context)
        if (!settings.tunnelEnabled()) return
        ReverseTunnelService.start(context)
    }
}
