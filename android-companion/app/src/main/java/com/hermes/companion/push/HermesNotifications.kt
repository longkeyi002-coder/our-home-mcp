package com.hermes.companion.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.hermes.companion.MainActivity

data class HermesNotification(
    val candidateId: String,
    val title: String,
    val body: String,
    val destination: String,
)

object HermesNotifications {
    // Keep the existing channel id for installed-app compatibility; the visible name is provider-neutral.
    const val CHANNEL_ID = "hermes_life"
    const val EXTRA_DESTINATION = "our_home_destination"
    const val EXTRA_CANDIDATE_ID = "our_home_candidate_id"
    const val EXTRA_MESSAGE_TITLE = "our_home_message_title"
    const val EXTRA_MESSAGE_BODY = "our_home_message_body"
    const val CHAT_DESTINATION = "/chat"

    fun fromPayload(data: Map<String, String>, notificationTitle: String?, notificationBody: String?) = HermesNotification(
        candidateId = data["candidateId"].orEmpty(),
        title = notificationTitle ?: data["title"].orEmpty(),
        body = notificationBody ?: data["body"].orEmpty(),
        destination = data["destination"].takeUnless { it.isNullOrBlank() } ?: CHAT_DESTINATION,
    )

    fun createChannel(context: Context) {
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Our Home", NotificationManager.IMPORTANCE_DEFAULT),
        )
    }

    fun show(context: Context, value: HermesNotification) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
        val intent = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_DESTINATION, value.destination)
            .putExtra(EXTRA_CANDIDATE_ID, value.candidateId)
            .putExtra(EXTRA_MESSAGE_TITLE, value.title)
            .putExtra(EXTRA_MESSAGE_BODY, value.body)
        val requestCode = value.candidateId.hashCode()
        val pending = PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(value.title)
            .setContentText(value.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(value.body))
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(requestCode, notification) }
    }
}
