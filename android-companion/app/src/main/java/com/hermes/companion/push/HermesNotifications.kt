package com.hermes.companion.push

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.hermes.companion.MainActivity

data class HermesNotification(
    val candidateId: String,
    val title: String,
    val body: String,
    val destination: String,
)

enum class NotificationDestinationScreen {
    APP,
}

object HermesNotifications {
    // Keep the existing channel id for installed-app compatibility; the visible name is provider-neutral.
    const val CHANNEL_ID = "hermes_life"
    const val EXTRA_DESTINATION = "our_home_destination"
    const val EXTRA_CANDIDATE_ID = "our_home_candidate_id"
    const val EXTRA_MESSAGE_TITLE = "our_home_message_title"
    const val EXTRA_MESSAGE_BODY = "our_home_message_body"

    /**
     * Logical destination carried by Runtime/FCM. In the current Android product, Chat is
     * the Our Home app itself, so tapping any proactive notification returns to MainActivity.
     */
    const val CHAT_DESTINATION = "/chat"

    fun fromPayload(data: Map<String, String>, notificationTitle: String?, notificationBody: String?) = HermesNotification(
        candidateId = data["candidateId"].orEmpty(),
        title = notificationTitle ?: data["title"].orEmpty(),
        body = notificationBody ?: data["body"].orEmpty(),
        destination = data["destination"].takeUnless { it.isNullOrBlank() } ?: CHAT_DESTINATION,
    )

    /** All current proactive destinations land in the installed Our Home companion app. */
    fun destinationScreen(@Suppress("UNUSED_PARAMETER") destination: String): NotificationDestinationScreen =
        NotificationDestinationScreen.APP

    fun createChannel(context: Context) {
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Our Home", NotificationManager.IMPORTANCE_DEFAULT),
        )
    }

    fun show(
        context: Context,
        value: HermesNotification,
        privacyMode: NotificationPrivacyMode = NotificationPrivacyMode.HIDE_ON_LOCK_SCREEN,
    ): Boolean {
        if (!canPostNotifications(context)) return false
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
        val presentation = NotificationPrivacyPolicy.present(privacyMode, value.title, value.body)
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(presentation.title)
            .setContentText(presentation.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(presentation.body))
            .setVisibility(
                when (presentation.lockScreenVisibility) {
                    NotificationLockScreenVisibility.PUBLIC -> NotificationCompat.VISIBILITY_PUBLIC
                    NotificationLockScreenVisibility.PRIVATE -> NotificationCompat.VISIBILITY_PRIVATE
                },
            )
            .setAutoCancel(true)
            .setContentIntent(pending)

        if (presentation.publicTitle != null && presentation.publicBody != null) {
            val publicVersion = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(presentation.publicTitle)
                .setContentText(presentation.publicBody)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setContentIntent(pending)
                .build()
            builder.setPublicVersion(publicVersion)
        }

        return try {
            NotificationManagerCompat.from(context).notify(requestCode, builder.build())
            true
        } catch (_: SecurityException) {
            false
        }
    }

    private fun canPostNotifications(context: Context): Boolean {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
    }
}
