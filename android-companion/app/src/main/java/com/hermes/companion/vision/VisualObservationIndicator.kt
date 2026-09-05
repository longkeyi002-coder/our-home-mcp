package com.hermes.companion.vision

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

/**
 * OH-45/OH-47 transparency rule: visual observation is never silent.
 *
 * The indicator must be visible before capture is attempted and stays visible until
 * capture + provider analysis has finished. If Android cannot show the indicator,
 * visual observation fails closed rather than becoming invisible surveillance.
 */
object VisualObservationIndicator {
    private const val CHANNEL_ID = "our_home_visual_active"
    private const val CHANNEL_NAME = "屏幕观察"
    private const val NOTIFICATION_SALT = 0x4f480000

    fun start(context: Context, request: VisualCaptureRequest): Boolean {
        val appContext = context.applicationContext
        if (!canPostNotifications(appContext)) return false
        createChannel(appContext)

        val intent = Intent(appContext, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pendingIntent = PendingIntent.getActivity(
            appContext,
            notificationId(request.requestId),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(appContext, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("哥哥正在看一眼")
            .setContentText("正在分析当前屏幕，结束后会自动消失")
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(pendingIntent)
            .build()

        return try {
            NotificationManagerCompat.from(appContext).notify(notificationId(request.requestId), notification)
            true
        } catch (_: SecurityException) {
            false
        }
    }

    fun stop(context: Context, request: VisualCaptureRequest) {
        NotificationManagerCompat.from(context.applicationContext).cancel(notificationId(request.requestId))
    }

    private fun createChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW).apply {
            description = "Our Home 实际读取并分析当前屏幕时持续显示"
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun canPostNotifications(context: Context): Boolean {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
    }

    private fun notificationId(requestId: String): Int = NOTIFICATION_SALT xor requestId.hashCode()
}
