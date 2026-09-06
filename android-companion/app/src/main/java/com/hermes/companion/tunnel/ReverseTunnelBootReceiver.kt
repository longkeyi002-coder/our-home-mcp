package com.hermes.companion.tunnel

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Restores the outbound tunnel after reboot only when the user previously opted in. */
class ReverseTunnelBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return
        ReverseTunnelController.startIfEnabled(context)
    }
}
