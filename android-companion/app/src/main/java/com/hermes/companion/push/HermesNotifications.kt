package com.hermes.companion.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.hermes.companion.MainActivity

data class HermesNotification(val candidateId: String, val title: String, val body: String)

object HermesNotifications {
    const val CHANNEL_ID = "hermes_life"

    fun fromPayload(data: Map<String, String>, notificationTitle: String?, notificationBody: String?) = HermesNotification(
        candidateId = data["candidateId"].orEmpty(),
        title = notificationTitle ?: data["title"].orEmpty(),
        body = notificationBody ?: data["body"].orEmpty(),
    )

    fun createChannel(context: Context) {
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Hermes Life", NotificationManager.IMPORTANCE_DEFAULT),
        )
    }

    fun show(context: Context, value: HermesNotification) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
        val intent = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val pending = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(value.title)
            .setContentText(value.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(value.body))
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(value.candidateId.hashCode(), notification) }
    }
}
