package com.hermes.companion

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

class NotificationActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != RealtimeCaptureService.ACTION_CAPTURE_NOW) return
        ContextCompat.startForegroundService(
            context,
            Intent(context, RealtimeCaptureService::class.java).setAction(RealtimeCaptureService.ACTION_CAPTURE_NOW),
        )
    }
}
