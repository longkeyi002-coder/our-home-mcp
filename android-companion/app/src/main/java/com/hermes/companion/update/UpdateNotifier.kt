package com.hermes.companion.update

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

object UpdateNotifier {
    private const val CHANNEL_ID = "our_home_updates"
    private const val NOTIFICATION_ID = 3107

    fun createChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Our Home 更新",
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = "Our Home Android Companion 新版本安装提醒"
            },
        )
    }

    fun showReady(context: Context, versionName: String) {
        createChannel(context)
        val intent = Intent(context, UpdateInstallActivity::class.java).apply {
            action = UpdateInstallActivity.ACTION_INSTALL_READY_UPDATE
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            3107,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Our Home 可以更新了")
            .setContentText("新版本 $versionName 已下载并校验，点这里安装")
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification) }
    }
}
