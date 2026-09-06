package com.hermes.companion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.hermes.companion.data.CompanionCapture
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class RealtimeCaptureService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var loopStarted = false

    override fun onCreate() {
        super.onCreate()
        createChannel()
        startForeground(NOTIFICATION_ID, notification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_CAPTURE_NOW) {
            scope.launch { captureSafely() }
        } else if (!loopStarted) {
            loopStarted = true
            scope.launch {
                while (isActive) {
                    captureSafely()
                    delay(CAPTURE_INTERVAL_MS)
                }
            }
        }
        return START_STICKY
    }

    private suspend fun captureSafely() {
        try {
            CompanionCapture.captureAndUpload(applicationContext)
            val pkg = com.hermes.companion.platform.DeviceStatusReader.currentForegroundPackage(applicationContext)
            val label = if (pkg != null) resolveAppLabel(pkg) else "未知"
            updateNotification("当前应用：$label")
        } catch (_: CancellationException) {
            throw CancellationException()
        } catch (error: Exception) {
            applicationContext.getSharedPreferences("companion_settings", MODE_PRIVATE)
                .edit().putString("last_error", error.message?.take(300).orEmpty()).apply()
        }
    }

    private fun resolveAppLabel(packageName: String): String {
        return try {
            val appInfo = applicationContext.packageManager.getApplicationInfo(packageName, 0)
            applicationContext.packageManager.getApplicationLabel(appInfo).toString()
        } catch (_: Exception) {
            packageName
        }
    }

    private fun updateNotification(text: String) {
        val manager = getSystemService(NotificationManager::class.java)
        val actionIntent = Intent(this, NotificationActionReceiver::class.java).setAction(ACTION_CAPTURE_NOW)
        val action = android.app.PendingIntent.getBroadcast(
            this, 1001, actionIntent,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            .setContentTitle("Hermes Companion")
            .setContentText(text)
            .setOngoing(true)
            .addAction(NotificationCompat.Action(android.R.drawable.ic_popup_sync, "立即同步", action))
            .build()
        manager.notify(NOTIFICATION_ID, notification)
    }

    private fun createChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Hermes 实时模式", NotificationManager.IMPORTANCE_LOW))
    }

    private fun notification(): Notification {
        val actionIntent = Intent(this, NotificationActionReceiver::class.java).setAction(ACTION_CAPTURE_NOW)
        val action = android.app.PendingIntent.getBroadcast(
            this,
            1001,
            actionIntent,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            .setContentTitle("Hermes Companion")
            .setContentText("正在采集并上传手机生活状态")
            .setOngoing(true)
            .addAction(NotificationCompat.Action(android.R.drawable.ic_popup_sync, "立即同步", action))
            .build()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_CAPTURE_NOW = "com.hermes.companion.action.CAPTURE_NOW"
        private const val CHANNEL_ID = "hermes-realtime"
        private const val NOTIFICATION_ID = 1001
        private const val CAPTURE_INTERVAL_MS = 60_000L
    }
}
