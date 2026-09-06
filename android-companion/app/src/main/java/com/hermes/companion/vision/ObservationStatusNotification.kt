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
import com.hermes.companion.privacy.PresencePrivacyStore

enum class ObservationStatusMode {
    DISCONNECTED,
    SCREEN_OFF,
    LOCKED,
    PRIVATE_APP,
    SENSING,
    OBSERVING,
}

data class ObservationStatusPresentation(
    val title: String,
    val text: String,
)

fun observationStatusPresentation(
    mode: ObservationStatusMode,
    appLabel: String? = null,
): ObservationStatusPresentation = when (mode) {
    ObservationStatusMode.DISCONNECTED -> ObservationStatusPresentation(
        title = "Our Home 感知未连接",
        text = "开启“应用观察权限”后才会感知前台 App",
    )
    ObservationStatusMode.SCREEN_OFF -> ObservationStatusPresentation(
        title = "感知暂停",
        text = "屏幕已关闭，没有观察屏幕",
    )
    ObservationStatusMode.LOCKED -> ObservationStatusPresentation(
        title = "感知暂停",
        text = "设备已锁定，没有观察屏幕",
    )
    ObservationStatusMode.PRIVATE_APP -> ObservationStatusPresentation(
        title = "当前 App 已设为不感知",
        text = "Our Home 不读取此 App 身份或屏幕",
    )
    ObservationStatusMode.SENSING -> ObservationStatusPresentation(
        title = "仅感知 App",
        text = if (appLabel.isNullOrBlank()) {
            "等待识别当前前台 App · 尚未观察屏幕"
        } else {
            "当前：$appLabel · 尚未观察屏幕"
        },
    )
    ObservationStatusMode.OBSERVING -> ObservationStatusPresentation(
        title = "正在观察屏幕",
        text = if (appLabel.isNullOrBlank()) {
            "正在截图并进行视觉分析"
        } else {
            "当前：$appLabel · 正在截图并进行视觉分析"
        },
    )
}

/**
 * User-visible truth surface for Presence vs actual visual observation.
 *
 * This is deliberately one low-priority ongoing notification instead of a second
 * foreground service. AccessibilityService already owns continuous foreground-App
 * sensing. Actual screenshot/Vision still fails closed when this notification cannot
 * be shown, so visual observation is never silent.
 */
object ObservationStatusNotification {
    private const val CHANNEL_ID = "our_home_sensing_status"
    private const val CHANNEL_NAME = "感知状态"
    private const val NOTIFICATION_ID = 0x4f485354

    private data class PresenceState(
        val packageName: String?,
        val screenInteractive: Boolean,
        val unlocked: Boolean,
        val accessibilityConnected: Boolean,
    )

    private var latestPresence = PresenceState(null, false, false, false)
    private val activeVisualRequests = linkedSetOf<String>()
    private var latestVisualPackage: String? = null

    @Synchronized
    fun updatePresence(
        context: Context,
        packageName: String?,
        screenInteractive: Boolean,
        unlocked: Boolean,
        accessibilityConnected: Boolean,
    ) {
        latestPresence = PresenceState(
            packageName = packageName,
            screenInteractive = screenInteractive,
            unlocked = unlocked,
            accessibilityConnected = accessibilityConnected,
        )
        if (!accessibilityConnected) {
            activeVisualRequests.clear()
            latestVisualPackage = null
            cancel(context)
            return
        }
        if (activeVisualRequests.isEmpty()) renderPresence(context.applicationContext)
    }

    @Synchronized
    fun beginObservation(context: Context, request: VisualCaptureRequest): Boolean {
        val appContext = context.applicationContext
        if (!canShow(appContext)) return false
        activeVisualRequests.add(request.requestId)
        latestVisualPackage = request.packageName
        val label = visibleAppLabel(appContext, request.packageName)
        val shown = notify(appContext, observationStatusPresentation(ObservationStatusMode.OBSERVING, label))
        if (!shown) {
            activeVisualRequests.remove(request.requestId)
            if (activeVisualRequests.isEmpty()) latestVisualPackage = null
        }
        return shown
    }

    @Synchronized
    fun endObservation(context: Context, request: VisualCaptureRequest) {
        activeVisualRequests.remove(request.requestId)
        if (activeVisualRequests.isNotEmpty()) {
            val label = visibleAppLabel(context.applicationContext, latestVisualPackage)
            notify(context.applicationContext, observationStatusPresentation(ObservationStatusMode.OBSERVING, label))
            return
        }
        latestVisualPackage = null
        if (latestPresence.accessibilityConnected) renderPresence(context.applicationContext) else cancel(context)
    }

    @Synchronized
    fun clear(context: Context) {
        activeVisualRequests.clear()
        latestVisualPackage = null
        latestPresence = PresenceState(null, false, false, false)
        cancel(context)
    }

    private fun renderPresence(context: Context) {
        if (!canShow(context)) return
        val state = latestPresence
        val mode: ObservationStatusMode
        val label: String?
        when {
            !state.accessibilityConnected -> {
                mode = ObservationStatusMode.DISCONNECTED
                label = null
            }
            !state.screenInteractive -> {
                mode = ObservationStatusMode.SCREEN_OFF
                label = null
            }
            !state.unlocked -> {
                mode = ObservationStatusMode.LOCKED
                label = null
            }
            state.packageName != null && !PresencePrivacyStore(context).exposesIdentity(state.packageName) -> {
                mode = ObservationStatusMode.PRIVATE_APP
                label = null
            }
            else -> {
                mode = ObservationStatusMode.SENSING
                label = visibleAppLabel(context, state.packageName)
            }
        }
        notify(context, observationStatusPresentation(mode, label))
    }

    private fun notify(context: Context, presentation: ObservationStatusPresentation): Boolean {
        createChannel(context)
        if (!channelEnabled(context)) return false
        val intent = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pendingIntent = PendingIntent.getActivity(
            context,
            NOTIFICATION_ID,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle(presentation.title)
            .setContentText(presentation.text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(presentation.text))
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setContentIntent(pendingIntent)
            .build()
        return try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
            true
        } catch (_: SecurityException) {
            false
        }
    }

    private fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW).apply {
            description = "显示 Our Home 当前是在感知 App，还是实际观察屏幕"
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun canShow(context: Context): Boolean {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return false
        }
        createChannel(context)
        return channelEnabled(context)
    }

    private fun channelEnabled(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
        val channel = context.getSystemService(NotificationManager::class.java).getNotificationChannel(CHANNEL_ID)
        return channel == null || channel.importance != NotificationManager.IMPORTANCE_NONE
    }

    private fun visibleAppLabel(context: Context, packageName: String?): String? {
        if (packageName.isNullOrBlank()) return null
        if (!PresencePrivacyStore(context).exposesIdentity(packageName)) return null
        return runCatching {
            val info = context.packageManager.getApplicationInfo(packageName, 0)
            context.packageManager.getApplicationLabel(info).toString().trim().ifBlank { packageName }
        }.getOrDefault(packageName)
    }

    private fun cancel(context: Context) {
        NotificationManagerCompat.from(context.applicationContext).cancel(NOTIFICATION_ID)
    }
}
